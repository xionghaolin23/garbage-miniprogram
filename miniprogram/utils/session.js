const config = require('../config');
const KEY = 'garbage.session.v1';
const scope = () => `${config.mode}:${config.baseUrl}`;
function read() {
  const session = wx.getStorageSync(KEY);
  return session && session.scope === scope() ? session : null;
}
function save(data) {
  if (!data || !data.token || !data.userId) throw new Error('登录信息不完整，请重试');
  wx.setStorageSync(KEY, { ...data, scope: scope() });
  if (data.localIdentity) rememberLocal(data.localIdentity);
}
function clear() { wx.removeStorageSync(KEY); }
function requireLogin() {
  if (read()) return true;
  wx.navigateTo({ url: '/pages/login/index' });
  return false;
}
const localKey = () => `garbage.localIdentity.v1:${scope()}`;
function rememberLocal(value) { wx.setStorageSync(localKey(), value); }
function localIdentity() {
  let value=wx.getStorageSync(localKey());
  if(!value) {
    value='测试家庭-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
    rememberLocal(value);
  }
  return value;
}
module.exports = { read, save, clear, requireLogin, scope, rememberLocal, localIdentity };
