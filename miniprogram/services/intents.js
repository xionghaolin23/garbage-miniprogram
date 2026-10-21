// 写请求发出前持久化请求号。网络失败/退出后，继续原请求，不生成重复扣款。
const session = require('../utils/session');
const key = type => {
  const login = session.read();
  if (!login) throw new Error('请先登录');
  return `garbage.intent.v1:${session.scope()}:${login.userId}:${type}`;
};
function get(type) { return wx.getStorageSync(key(type)) || null; }
function begin(type, body) {
  const prior = get(type);
  if (prior) return prior;
  const requestKey = `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const intent = { body: { ...body, requestKey }, createdAt: Date.now(), paymentId: null };
  wx.setStorageSync(key(type), intent);
  return intent;
}
function attach(type, id) {
  const intent = get(type);
  if (!intent) throw new Error('原预约信息已失效，请重新进入');
  intent.paymentId = id; wx.setStorageSync(key(type), intent); return intent;
}
function clear(type) { wx.removeStorageSync(key(type)); }
module.exports = { get, begin, attach, clear };
