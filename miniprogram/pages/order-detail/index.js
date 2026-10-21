const api = require('../../services/api');
const f = require('../../utils/format');
const ui = require('../../utils/ui');
const payments = require('../../services/payments');
const config = require('../../config');
Page({
  data: { loading: true, error: '', order: null, busy: false, canSubscribe: config.mode === 'production' && !!config.subscribeTemplateId },
  onLoad(options) { this.id = options.id; },
  onShow() { this.refresh(); this.timer = setInterval(() => { if (this.data.order) this.setData({ order: f.orderView(this.data.order) }); }, 15000); },
  onHide() { clearInterval(this.timer); }, onUnload() { clearInterval(this.timer); },
  onPullDownRefresh() { this.refresh(); },
  refresh() { return ui.load(this, async () => { if (!this.id) throw new Error('订单信息不完整'); this.setData({ order: f.orderView(await api.order(this.id)) }); }); },
  async cancel() {
    if (this.data.busy) return;
    const order = this.data.order;
    let text = order.isMember ? '取消本场后不退款、不累积次数。当天不会再自动生成这一场。' : `取消本场后将原路退回 ¥${f.money(order.amount)}，另一场服务不受影响。`;
    if (order.status === 'UNPAID') text = '这笔预约尚未支付。如果同一支付单包含两场，两场待支付预约都会关闭，你可以重新选择。';
    if (!await ui.confirm('确认取消本场服务？', text, '确认取消')) return;
    this.setData({ busy: true });
    try { if (order.isMember) await api.skip(order.id); else await api.cancel(order.id); ui.toast('本场已取消'); }
    catch (e) { ui.error(e); }
    finally { this.setData({ busy: false }); await this.refresh(); }
  },
  async pay() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try { ui.toast(payments.message(await payments.pay(this.data.order.payment_id))); }
    catch (e) { ui.error(e); }
    finally { this.setData({ busy: false }); await this.refresh(); }
  },
  preview() { if (this.data.order.photo_url) wx.previewImage({ urls: [this.data.order.photo_url] }); },
  subscribe() { payments.subscribe(); },
  support() { wx.navigateTo({ url: '/pages/support/index' }); }
});
