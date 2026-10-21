const config = require('../../config');
const api = require('../../services/api');
const session = require('../../utils/session');
const ui = require('../../utils/ui');
const { runtimeError } = require('../../utils/runtime');
Page({
  data: { local: config.mode === 'local', agreement: false, busy: false, error: '', hasSession: false, loginError: '' },
  async onLoad() {
    this.setData({ error: runtimeError(), hasSession: !!session.read() });
    if (session.read() && !this.data.error) await this.continueLogin();
  },
  agree(event) { this.setData({ agreement: event.detail.value.length > 0 }); },
  async route() {
    const address = await api.address();
    if (address) wx.switchTab({ url: '/pages/home/index' });
    else wx.redirectTo({ url: '/pages/address/index' });
  },
  failure(e) {
    this.setData({ loginError: e.message || '登录失败，请重试', hasSession: !!session.read() });
    ui.error(e);
  },
  async continueLogin() {
    if (this.data.busy || this.data.error) return;
    this.setData({ busy: true, loginError: '' });
    try { await this.route(); } catch(e) { this.failure(e); }
    finally { this.setData({ busy: false }); }
  },
  async login() {
    if (this.data.busy || this.data.error || !this.data.local) return;
    if (!this.data.agreement) return ui.toast('请先阅读服务规则与隐私说明');
    this.setData({ busy: true, loginError: '' });
    try {
      const result = await api.localLogin(session.localIdentity());
      session.save(result);
      this.setData({ hasSession: true });
      await this.route();
    } catch(e) { this.failure(e); }
    finally { this.setData({ busy: false }); }
  },
  async phoneLogin(event) {
    if (this.data.local || this.data.busy || this.data.error) return;
    if (!this.data.agreement) return ui.toast('请先阅读服务规则与隐私说明');
    const phoneCode = event.detail && event.detail.code;
    if (!phoneCode) {
      this.setData({ loginError: '未获取手机号授权，请点击按钮重新授权。' });
      return;
    }
    this.setData({ busy: true, loginError: '' });
    try {
      const code = await new Promise((resolve,reject) => wx.login({
        success: res => res.code ? resolve(res.code) : reject(new Error('微信登录失败，请重新点击授权')),
        fail: () => reject(new Error('微信登录失败，请重新点击授权'))
      }));
      const result = await api.wechatLogin(code, phoneCode);
      session.save(result);
      this.setData({ hasSession: true });
      await this.route();
    } catch(e) { this.failure(e); }
    finally { this.setData({ busy: false }); }
  },
  rules() { wx.navigateTo({ url: '/pages/rules/index' }); }
});
