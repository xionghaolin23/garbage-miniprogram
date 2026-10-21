const api = require('./api');
const intents = require('./intents');
const payments = require('./payments');
async function checkout(type, body) {
  const intent = intents.get(type) || intents.begin(type, body);
  let paymentId = intent.paymentId;
  if (!paymentId) {
    let response;
    try { response = type === 'member' ? await api.buyMember(intent.body) : await api.createOrder(intent.body); }
    catch (e) {
      // 网络/服务错误保留请求号；明确的业务拒绝说明没有创建此请求。
      if (e.status >= 400 && e.status < 500 && !['PENDING_PURCHASE', 'UNAUTHORIZED'].includes(e.code)) intents.clear(type);
      throw e;
    }
    paymentId = type === 'member' ? response.id : response.payment.id;
    intents.attach(type, paymentId);
  }
  const result = await payments.pay(paymentId);
  if (['PAID', 'REFUND', 'CLOSED'].includes(result.state)) intents.clear(type);
  return { ...result, paymentId };
}
module.exports = { checkout };
