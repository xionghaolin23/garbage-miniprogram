const config = require('../config');
const session = require('./session');
const { runtimeError } = require('./runtime');
// 从 HTTP Date 校准设备时间，仅影响展示；最终场次校验仍由后端执行。
let serverOffset = 0;
function now() { return Date.now() + serverOffset; }
function request(path, method = 'GET', data, options = {}) {
  const error = runtimeError();
  if (error) return Promise.reject(Object.assign(new Error(error), { code: 'CONFIG_ERROR' }));
  const login = session.read();
  const header = { 'Content-Type': 'application/json' };
  if (!options.public && login) header.Authorization = `Bearer ${login.token}`;
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.baseUrl.replace(/\/$/, '') + path,
      method, data, header, timeout: options.timeout || config.requestTimeout,
      success(response) {
        const date = response.header && (response.header.Date || response.header.date);
        if (date && Number.isFinite(Date.parse(date))) serverOffset = Date.parse(date) - Date.now();
        const body = response.data === '' ? null : response.data;
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(body);
        if (response.statusCode === 401) session.clear();
        reject(Object.assign(new Error(body && body.message || '服务暂时不可用，请稍后重试'), {
          code: body && body.code || 'HTTP_ERROR', status: response.statusCode
        }));
      },
      fail() { reject(Object.assign(new Error('暂时连接不上服务，请检查网络后重试'), { code: 'NETWORK_ERROR' })); }
    });
  });
}
module.exports = { request, now };
