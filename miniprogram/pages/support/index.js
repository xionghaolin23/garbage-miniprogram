const config = require('../../config');
const ui = require('../../utils/ui');
Page({
  data: { phone: config.customerServicePhone, wechat: config.customerServiceWechat },
  call() { if (this.data.phone) wx.makePhoneCall({ phoneNumber: this.data.phone }); },
  copy() { if (this.data.wechat) wx.setClipboardData({ data: this.data.wechat }); },
  rules() { wx.navigateTo({ url: '/pages/rules/index' }); }
});
