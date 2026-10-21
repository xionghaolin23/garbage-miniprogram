// 官方 miniprogram-ci 内附 WCC/WCSC 离线编译与模板渲染检查。
// 不调用 CI 上传/预览接口，不需要 AppID 或上传私钥。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
const root = path.join(project, 'miniprogram');
const version = '2.1.31';
const integrity = 'SREx6UnJC74aQ2a1YMNShqQOB97nHO+ll6ZQrCQp98NHXcRq848VjZoD5ELpd95z+8uTASQUAcFtl/HrXuM7Nw==';
const tools = path.join(project, '.tools', `miniprogram-ci-${version}`);
const compilerPath = path.join(tools, 'package/dist/modules/fullcompiler/trans/wcc/lib');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(path.join(dir, item.name)) : [path.join(dir, item.name)]);
}
async function compiler() {
  assert.ok(['darwin', 'win32'].includes(process.platform), '此离线原生编译脚本使用 CI 包内 macOS/Windows 编译器；其他系统请使用微信开发者工具。');
  if (!fs.existsSync(path.join(compilerPath, 'index.js'))) {
    console.log(`Downloading official miniprogram-ci ${version} compiler package...`);
    const response = await fetch(`https://registry.npmjs.org/miniprogram-ci/-/miniprogram-ci-${version}.tgz`, { signal: AbortSignal.timeout(60000) });
    assert.ok(response.ok, `Download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(crypto.createHash('sha512').update(bytes).digest('base64'), integrity, '下载包完整性校验失败');
    fs.mkdirSync(tools, { recursive: true });
    const archive = path.join(tools, 'compiler.tgz');
    fs.writeFileSync(archive, bytes);
    execFileSync('tar', ['-xzf', archive, '-C', tools]);
    fs.unlinkSync(archive);
  }
  return require(compilerPath);
}
async function main() {
  const { wcc, wcsc } = await compiler();
  const app = require(path.join(root, 'app.json'));
  const views = files(root).filter(file => file.endsWith('.wxml')).map(file => path.relative(root, file).split(path.sep).join('/'));
  const styles = files(root).filter(file => file.endsWith('.wxss') && path.basename(file) !== 'app.wxss').map(file => path.relative(root, file).split(path.sep).join('/'));
  styles.push('app.wxss');
  const wxml = await wcc({ cwd: root, files: views, genfuncname: '$gwx', lazyload: false });
  const wxss = await wcsc({ cwd: root, files: styles, pageCount: styles.length - 1 });
  assert.equal(typeof wxml, 'string'); assert.ok(wxml.length > 1000);
  for (const style of styles) assert.ok(wxss[style] || wxss['./' + style], `Missing compiled style ${style}`);
  const diagnostics = [];
  const context = { window: { __webview_engine_version__: 0.02 }, console: { log: (...args) => diagnostics.push(args.join(' ')), warn: (...args) => diagnostics.push(args.join(' ')) } };
  vm.createContext(context); vm.runInContext(wxml, context);
  const { mockWx, page } = require('../tests/helpers'); mockWx();
  let rendered = 0;
  function render(name, data) {
    const renderTemplate = context.$gwx(`${name}.wxml`);
    assert.equal(typeof renderTemplate, 'function', `Missing template ${name}`);
    const tree = renderTemplate(data);
    assert.ok(tree && tree.children, `Empty template ${name}`);
    assert.deepEqual(diagnostics, [], `WXML runtime errors: ${diagnostics.join('; ')}`);
    rendered++; return tree;
  }
  function text(tree) { return typeof tree === 'string' ? tree : (tree.children || []).map(text).join(''); }
  function nodes(tree) { return typeof tree === 'string' ? [] : [tree, ...(tree.children || []).flatMap(nodes)]; }
  for (const name of app.pages) {
    const instance = page(name.split('/')[1]);
    render(name, instance.data);
    render(name, { ...instance.data, loading: false, error: '' });
    render(name, { ...instance.data, loggedIn: true, loading: false, error: '网络暂时不可用' });
  }
  const loginState = page('login').data;
  const phoneLoginTree = render('pages/login/index', { ...loginState, local: false, agreement: true });
  assert.match(text(phoneLoginTree), /手机号授权登录/);
  assert.ok(nodes(phoneLoginTree).some(n => n.tag === 'wx-button' && n.attr.openType === 'getPhoneNumber' && n.attr.bindgetphonenumber === 'phoneLogin'));
  assert.ok(!nodes(phoneLoginTree).some(n => n.tag === 'wx-input'), 'Login must not require a nickname');
  const deniedConsent = render('pages/login/index', { ...loginState, local: false, agreement: false });
  assert.ok(nodes(deniedConsent).some(n => n.tag === 'wx-button' && n.attr.openType === 'getPhoneNumber' && n.attr.disabled));
  const resumeLogin = render('pages/login/index', { ...loginState, local: false, hasSession: true });
  assert.match(text(resumeLogin), /继续进入/);assert.doesNotMatch(text(resumeLogin), /手机号授权登录/);
  const pending = { start_date: '2026-09-17', expire_date: '2026-10-16', status: 'PENDING', statusText: '待生效', usable: false, canPlan: true };
  const home = page('home');
  const homeData = { ...home.data, loggedIn: true, loading: false, address: { building: '3栋', unit: '2单元', room: '1201' }, member: pending, community: { name: '阳光花园' }, selected: ['NIGHT'], total: '3.00', catalog: { singlePriceText: '3.00', memberPriceText: '75.00', memberDailyLimit: 1 },
    dates: [{ date: '2026-09-16', label: '今天', short: '09/16' }, { date: '2026-09-17', label: '明天', short: '09/17' }], serviceDate: '2026-09-16',
    slots: [{ bookedCount: 100, capacity: 100, period: 'NOON', title: '中午帮你扔', time: '11:30 – 13:30', disabled: true, closed: true, label: '今日已截止', priceText: '¥3 / 次' }, { bookedCount: 42, capacity: 100, pendingCount: 2, period: 'NIGHT', title: '晚上帮你扔', time: '18:30 – 21:00', deadline: '18:00', selected: true, disabled: false, priceText: '¥3 / 次' }] };
  const homeTree = render('pages/home/index', homeData);
  assert.match(text(homeTree), /今日已截止/); assert.match(text(homeTree), /本次合计/); assert.match(text(homeTree), /¥3\.00/); assert.match(text(homeTree), /立即预约/);
  assert.doesNotMatch(text(homeTree), /本次月卡权益/);
  assert.match(text(homeTree), /已预约 42 \/ 100 户/); assert.match(text(homeTree), /另有 2 户待支付占位/); assert.match(text(homeTree), /明天/);
  assert.match(text(render('pages/home/index', { ...homeData, coveredForDate: true, dateLabel: '明天 09/17', serviceDate: '2026-09-17' })), /明天 09\/17，什么时候取/);
  assert.match(text(render('pages/home/index', { ...homeData, coveredForDate: true, member: { ...pending, status: 'ACTIVE', usable: true }, total: '0.00' })), /本次月卡权益/);
  const noneSelected = render('pages/home/index', { ...homeData, selected: [] });
  assert.ok(nodes(noneSelected).some(node => node.tag === 'wx-button' && node.attr.bindtap === 'book' && node.attr.disabled), 'No-selection booking must be disabled');
  const application = page('community-apply');
  const applicationTree = render('pages/community-apply/index', { ...application.data, loading: false, applications: [{ id: 'a', name: '新小区', status: 'REJECTED', statusText: '未通过', city: '杭州', detail_address: '测试路18号', createdText: '2026-09-17 10:00', review_reason: '请补充街道' }, { id: 'b', name: '已入驻', status: 'APPROVED', statusText: '已通过' }] });
  assert.match(text(applicationTree), /确认提交申请/); assert.match(text(applicationTree), /请补充街道/); assert.match(text(applicationTree), /返回选择家庭地址/);
  const member = page('member');
  const promoMember = render('pages/member/index', { ...member.data, loading: false, member: null, address: {}, catalog: { memberPriceText: '65.00', memberListPriceText: '75.00', memberDiscounted: true, promotionTitle: '开业优惠', memberDailyLimit: 1 } });
  assert.match(text(promoMember), /65\.00/); assert.match(text(promoMember), /原价 ¥75\.00/); assert.match(text(promoMember), /默认晚上/);
  assert.match(text(render('pages/member/index', { ...member.data, loading: false, member: pending, address: {}, range: { start: '2026-10-17', end: '2026-11-15' } })), /续费 30 天/);
  assert.match(text(render('pages/member/index', { ...member.data, loading: false, member: null, address: {}, range: { start: '2026-09-17', end: '2026-10-16' } })), /开通月卡/);
  const detail = page('order-detail');
  const order = { id: 'order-1', status: 'WAITING', statusText: '等待取走', canCancel: false, canPay: false, periodText: '中午场', refunds: [] };
  const detailTree = render('pages/order-detail/index', { ...detail.data, loading: false, order });
  assert.match(text(detailTree), /本场已截止/);
  assert.ok(!nodes(detailTree).some(node => node.tag === 'wx-button' && node.attr.bindtap === 'cancel'), 'Closed period must not render cancellation action');
  assert.match(text(render('components/order-card/index', { order: { ...order, isMember: true, dateText: '今天' } })), /月卡服务/);
  assert.match(text(render('components/page-state/index', { error: '连接失败', loading: false })), /重新加载/);
  console.log(`PASS: official WCC/WCSC compiled ${views.length} WXML and ${styles.length} WXSS files; ${rendered} native-template render scenarios passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
