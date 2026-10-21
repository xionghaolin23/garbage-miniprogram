const api = require('../../services/api');
const { checkout } = require('../../services/checkout');
const intents = require('../../services/intents');
const payments = require('../../services/payments');
const ui = require('../../utils/ui');
const f = require('../../utils/format');
const config = require('../../config');
Page({
  data: { loading: true, error: '', busy: false, local: config.mode === 'local', member: null, range: {}, address: null, agreement: false, pending: false, resultText: '', catalog: null },
  onShow() { this.refresh(); },
  onPullDownRefresh() { this.refresh(); },
  refresh() { return ui.load(this, async () => {
    const [member, address, catalog] = await Promise.all([api.member(), api.address(), api.catalog()]);
    this.setData({ catalog: f.catalogView(catalog), member: f.memberView(member), address, range: f.purchaseRange(member), pending: !!intents.get('member') });
  }); },
  agree(event) { this.setData({ agreement: event.detail.value.length > 0 }); },
  async buy() {
    if (this.data.busy || this.data.loading || this.data.error || !this.data.catalog) return;
    if (!this.data.address) { wx.navigateTo({ url: '/pages/address/index' }); return; }
    if (!this.data.agreement) return ui.toast('请先阅读月卡规则');
    this.setData({ busy: true });
    try {
      const result = await checkout('member', { quotedPriceFen: this.data.catalog.memberPriceFen, quotedDailyLimit: this.data.catalog.memberDailyLimit });
      const message = result.state === 'PAID' ? '月卡已开通，默认晚上场，可在下方调整' : payments.message(result);
      this.setData({ resultText: message }); ui.toast(message);
    } catch (e) { ui.error(e); }
    finally { this.setData({ busy: false }); await this.refresh(); }
  },
  plan() { wx.navigateTo({ url: '/pages/plan/index' }); },
  rules() { wx.navigateTo({ url: '/pages/rules/index' }); }
});
