const config = require('../config');
const api = require('./api');
const ui = require('../utils/ui');
const { now } = require('../utils/request');
const { timestamp } = require('../utils/format');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function cancelled() { return Object.assign(new Error('已取消支付，可稍后继续'), { code: 'PAYMENT_CANCELLED' }); }
function resolved(payment) {
  if ((payment.refunds || []).length) return 'REFUND';
  if (payment.status === 'PAID' || payment.status === 'COVERED') return 'PAID';
  if (payment.status === 'CLOSED') return 'CLOSED';
  return null;
}
async function pay(id) {
  let payment = await api.payment(id);
  const state = resolved(payment);
  if (state) return { state, payment };
  if (now() >= timestamp(payment.expires_at)) return { state: 'CLOSED', payment };
  if (config.mode === 'local') {
    const ok = await ui.confirm('模拟支付', `本次 ¥${(payment.amount / 100).toFixed(2)}，仅用于开发联调，不会实际扣款。`, '模拟付款');
    if (!ok) throw cancelled();
    await api.localPay(id);
  } else {
    const args = await api.prepay(id);
    await new Promise((resolve, reject) => wx.requestPayment({ ...args, success: resolve, fail: result => reject((result.errMsg || '').includes('cancel') ? cancelled() : new Error('支付未完成，请查看订单后重试')) }));
  }
  // 前端 success 不是到账依据，始终查询后端结果。
  for (let i = 0; i < 5; i++) {
    payment = await api.payment(id);
    const status = resolved(payment);
    if (status) return { state: status, payment };
    if (i < 4) await pause(800);
  }
  return { state: 'PENDING', payment };
}
function message(result) {
  return { PAID: '预约已确认', REFUND: '本次无法受理，款项将退回', CLOSED: '支付已超时，请重新预约', PENDING: '正在确认支付，请稍后刷新' }[result.state];
}
function subscribe() {
  if (config.mode !== 'production' || !config.subscribeTemplateId) return;
  wx.requestSubscribeMessage({ tmplIds: [config.subscribeTemplateId], fail() {} });
}
module.exports = { pay, resolved, message, subscribe };
