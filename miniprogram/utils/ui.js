const session = require('./session');
function toast(title) { wx.showToast({ title, icon: 'none', duration: 2500 }); }
function error(error) {
  if (error.code === 'PAYMENT_CANCELLED') return;
  if (error.status === 401) { toast('登录已过期，请重新登录'); wx.navigateTo({ url: '/pages/login/index' }); return; }
  toast(error.message || '操作未完成，请重试');
}
function confirm(title, content, confirmText = '确定') {
  return new Promise(resolve => wx.showModal({ title, content, confirmText, confirmColor: '#236746', success: result => resolve(result.confirm), fail: () => resolve(false) }));
}
function openOrder(event) {
  const id = event.detail.id || event.currentTarget.dataset.id;
  wx.navigateTo({ url: `/pages/order-detail/index?id=${encodeURIComponent(id)}` });
}
async function load(page, action) {
  if (!session.requireLogin()) return;
  page.setData({ loading: true, error: '' });
  try { await action(); }
  catch (e) { page.setData({ error: e.message || '加载失败，请重试' }); if (e.status === 401) error(e); }
  finally { page.setData({ loading: false }); wx.stopPullDownRefresh(); }
}
module.exports = { toast, error, confirm, openOrder, load };
