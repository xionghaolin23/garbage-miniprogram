function mockWx() {
  const memory = new Map();
  const clone = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
  const calls = [];
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: key => clone(memory.get(key)),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    navigateTo: value => calls.push(['navigateTo', value]),
    switchTab: value => calls.push(['switchTab', value]),
    redirectTo: value => calls.push(['redirectTo', value]),
    showToast: value => calls.push(['showToast', value]),
    showModal: args => args.success({ confirm: true }),
    stopPullDownRefresh() {},
    requestSubscribeMessage() {},
    request: () => { throw new Error('Unexpected network request'); }
  };
  return { calls, memory };
}
function page(name) {
  let spec;
  global.Page = value => { spec = value; };
  const path = require.resolve(`../miniprogram/pages/${name}/index`);
  delete require.cache[path]; require(path);
  const result = { ...spec, data: JSON.parse(JSON.stringify(spec.data || {})), setData(values) { Object.assign(this.data, values); } };
  return result;
}
module.exports = { mockWx, page };
