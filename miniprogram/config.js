// production 使用手机号授权登录；后端需配置 config/wechat.yml 并开通手机号能力。
// 当前保留 local 一键测试入口；真实支付/退款仍须按 docs/INTEGRATION.md 接入。
module.exports = {
  mode: 'local',
  baseUrl: 'http://192.168.5.9:8086',
  serviceName: '帮你扔',
  customerServicePhone: '',
  customerServiceWechat: '',
  subscribeTemplateId: '',
  requestTimeout: 12000
};
