const api = require('../../services/api');
const session = require('../../utils/session');
const config = require('../../config');
const f = require('../../utils/format');
const ui = require('../../utils/ui');
Page({
  data: { loading: false, error: '', loggedIn: false, address: null, member: null, communityName: '', catalog: null },
  onShow() { this.refresh(); },
  async refresh() {
    try { this.setData({ catalog: f.catalogView(await api.catalog()) }); } catch (_) { this.setData({ catalog: null }); }
    if (!session.read()) { this.setData({ loggedIn: false, address: null, member: null, loading: false, error: '' }); return; }
    this.setData({ loggedIn: true });
    return ui.load(this, async () => { const [address, member, communities] = await Promise.all([api.address(), api.member(), api.communities()]); const community = address && communities.find(c => c.id === address.community_id); this.setData({ address: address && { ...address, displayText: f.addressText(address) }, member: f.memberView(member), communityName: community ? community.name : '我的家庭' }); });
  },
  go(event) { const page = event.currentTarget.dataset.page; if (['rules', 'support'].includes(page) || session.requireLogin()) wx.navigateTo({ url: `/pages/${page}/index` }); },
  login() { wx.navigateTo({ url: '/pages/login/index' }); },
  async logout() { if (await ui.confirm('退出当前家庭？', '未完成的预约仍会保留，下次登录同一账号可继续查看。', '退出')) {
    try {
      if (config.mode === 'local') { const identity = await api.localIdentity(); session.rememberLocal(identity.localIdentity); }
      session.clear(); this.refresh();
    } catch(e) { ui.error(e); }
  } }
});
