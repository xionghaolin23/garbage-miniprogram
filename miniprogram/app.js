const config = require('./config');
const { runtimeError } = require('./utils/runtime');
App({
  globalData: { config, startupError: '' },
  onLaunch() {
    this.globalData.startupError = runtimeError();
  }
});
