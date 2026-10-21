const api = require('../../services/api');
const { checkout } = require('../../services/checkout');
const intents = require('../../services/intents');
const payments = require('../../services/payments');
const config = require('../../config');
const session = require('../../utils/session');
const f = require('../../utils/format');
const ui = require('../../utils/ui');
Page({
  data: { loading: false, error: '', loggedIn: false, local: config.mode === 'local', address: null, community: null, member: null, slots: [], selected: [], remark: '', today: [], agreement: false, busy: false, total: '0.00', pendingIntent: false, serviceDate: '', dateLabel: '今天', dates: [], dateLoading: false, coveredForDate: false, catalog: null, memberRemaining: 0, quotedTotalFen: 0, memberUsageText: '' },
  onShow() {
    this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (!this.data.busy && !this.data.loading && !this.data.dateLoading) this.refreshAvailability(); }, 15000);
  },
  onHide() { clearInterval(this.timer); },
  onUnload() { clearInterval(this.timer); },
  onPullDownRefresh() { this.refresh(); },
  async refresh() {
    if (!session.read()) { this.requestVersion = (this.requestVersion || 0) + 1; this.setData({ loggedIn: false, address: null, member: null, today: [], slots: [], selected: [], remark: '', pendingIntent: false }); }
    try { this.setData({ catalog: f.catalogView(await api.catalog()) }); }
    catch (e) { this.setData({ catalog: null, error: e.message, loading: false }); wx.stopPullDownRefresh(); return; }
    if (!session.read()) { this.requestVersion = (this.requestVersion || 0) + 1; this.setData({ loggedIn: false, loading: false, address: null, member: null, today: [], slots: [], error: '' }); wx.stopPullDownRefresh(); return; }
    this.setData({ loggedIn: true });
    await ui.load(this, async () => {
      const [address, communities, member] = await Promise.all([api.address(), api.communities(), api.member()]);
      const pending = intents.get('single');
      const dates = f.bookingDates();
      const preferred = pending ? pending.body.serviceDate || f.beijingDate(pending.createdAt) : this.data.serviceDate;
      const serviceDate = dates.some(d => d.date === preferred) ? preferred : dates[0].date;
      this.setData({ address: address && { ...address, displayText: f.addressText(address) }, community: address && communities.find(c => c.id === address.community_id) || null,
        member: f.memberView(member), dates, serviceDate,
        pendingIntent: !!pending, pendingDate: pending && preferred || '',
        selected: pending ? pending.body.periods : this.data.selected,
        remark: pending ? pending.body.remark : this.data.remark
      });
      if (address) await this.loadAvailability();
    });
  },
  async loadAvailability() {
    const version = this.requestVersion = (this.requestVersion || 0) + 1;
    const date = this.data.serviceDate;
    this.setData({ dateLoading: true });
    try {
      const availability = await api.availability(date);
      if (version !== this.requestVersion) return;
      this.availability = availability;
      this.rows = availability.orders;
      this.day = f.beijingDate();
      const option = this.data.dates.find(d => d.date === date);
      this.setData({ error: '', dateLabel: option ? option.label + ' ' + option.short : f.shortDate(date),
        today: this.rows.filter(row => row.status !== 'CANCELLED').map(row => f.orderView(row)),
        coveredForDate: availability.memberRemaining > 0, memberRemaining: availability.memberRemaining, catalog: f.catalogView(availability.catalog),
        memberUsageText: availability.memberDailyLimit ? `当日月卡剩余 ${availability.memberRemaining} / ${availability.memberDailyLimit} 次，超出部分按单次付费` : '' });
      this.recompute();
    } catch (e) { if (version === this.requestVersion) throw e; }
    finally { if (version === this.requestVersion) this.setData({ dateLoading: false }); }
  },
  async refreshAvailability() {
    if (!session.read() || !this.data.address) return;
    if (this.day && this.day !== f.beijingDate()) { this.setData({ serviceDate: '', selected: [] }); return this.refresh(); }
    try { await this.loadAvailability(); }
    catch (e) { this.setData({ error: e.message || '预约人数加载失败，请重试' }); }
  },
  async chooseDate(event) {
    if (this.data.pendingIntent || this.data.busy || this.data.loading) return;
    const date = event.currentTarget.dataset.date;
    if (date === this.data.serviceDate || !this.data.dates.some(d => d.date === date)) return;
    this.setData({ serviceDate: date, selected: [], today: [], slots: [], total: '0.00' });
    await this.refreshAvailability();
  },
  recompute() {
    if (!this.data.loggedIn) return;
    const member = f.memberView(this.data.member);
    const choices = f.slots(this.data.community, this.rows || [], member, undefined, this.data.serviceDate, this.availability);
    const selected = this.data.pendingIntent ? this.data.selected : this.data.selected.filter(p => choices.some(s => s.period === p && !s.disabled));
    const quote = f.bookingQuote(selected, this.data.memberRemaining, this.data.catalog ? this.data.catalog.singlePriceFen : 0);
    this.setData({ member, selected, quotedTotalFen: quote.totalFen,
      slots: choices.map(s => ({ ...s, selected: selected.includes(s.period),
        priceText: selected.includes(s.period) ? (quote.free.includes(s.period) ? '月卡抵扣' : '¥' + this.data.catalog.singlePriceText + ' / 次') : s.priceText })),
      coveredForDate: selected.length > 0 && quote.totalFen === 0,
      total: f.money(quote.totalFen) });
  },
  choose(event) {
    if (this.data.pendingIntent || this.data.busy || this.data.dateLoading || this.data.error) return;
    const period = event.currentTarget.dataset.period;
    const slot = this.data.slots.find(s => s.period === period);
    if (!slot || slot.disabled) return;
    const selected = this.data.selected.includes(period) ? this.data.selected.filter(p => p !== period) : [...this.data.selected, period];
    this.setData({ selected }); this.recompute();
  },
  inputRemark(event) { this.setData({ remark: event.detail.value }); },
  agree(event) { this.setData({ agreement: event.detail.value.length > 0 }); },
  async book() {
    if (this.data.busy || this.data.loading || this.data.dateLoading || this.data.error || !this.data.catalog || !session.requireLogin()) return;
    if (!this.data.address) return this.goAddress();
    if (!this.data.pendingIntent && !this.data.selected.length) return ui.toast('请选择中午或晚上场次');
    if (!this.data.agreement) return ui.toast('请先阅读并同意服务规则');
    this.setData({ busy: true });
    try {
      const result = await checkout('single', { quotedTotalFen: this.data.quotedTotalFen, serviceDate: this.data.serviceDate || f.beijingDate(), periods: this.data.selected, remark: this.data.remark.trim() });
      ui.toast(payments.message(result));
      if (result.state === 'PAID' || result.state === 'REFUND') wx.switchTab({ url: '/pages/orders/index' });
    } catch (e) { ui.error(e); }
    finally { this.setData({ busy: false }); await this.refresh(); }
  },
  login() { wx.navigateTo({ url: '/pages/login/index' }); },
  goAddress() { if (session.requireLogin()) wx.navigateTo({ url: '/pages/address/index' }); },
  goMember() { if (session.requireLogin()) wx.navigateTo({ url: '/pages/member/index' }); },
  goPlan() { wx.navigateTo({ url: '/pages/plan/index' }); },
  goRules() { wx.navigateTo({ url: '/pages/rules/index' }); },
  goOrders() { wx.switchTab({ url: '/pages/orders/index' }); },
  openOrder: ui.openOrder
});
