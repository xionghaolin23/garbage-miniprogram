const config = require('../config');
function runtimeError() {
  const env = typeof wx.getAccountInfoSync === 'function'
    ? wx.getAccountInfoSync().miniProgram.envVersion : 'develop';
  if (!['local', 'production'].includes(config.mode)) return '服务配置不正确，请联系运营人员';
  if (config.mode === 'local' && env !== 'develop') return '当前版本尚未接入正式服务，请联系运营人员';
  if (config.mode === 'production' && !/^https:\/\//.test(config.baseUrl)) return '正式服务地址尚未配置';
  return '';
}
module.exports = { runtimeError };
