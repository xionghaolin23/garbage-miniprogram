const api = require('../../services/api');
const f = require('../../utils/format');
Page({
 data: { catalog: null, error: '' },
 async onShow() { try { this.setData({ catalog: f.catalogView(await api.catalog()), error: '' }); } catch(e) { this.setData({ error: e.message }); } },
 support() { wx.navigateTo({ url: '/pages/support/index' }); }
});
