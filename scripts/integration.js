// 使用小程序实际 request/api/checkout 模块连接真实 Java 进程。
// 只把 wx.request 替换为 Node fetch 桥接；独立临时 H2，不访问正常开发数据库。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { mockWx, page } = require('../tests/helpers');
const jar = process.env.BACKEND_JAR || path.resolve(__dirname, '../../garbage-service/target/garbage-service-0.1.0.jar');
assert.ok(fs.existsSync(jar), `Missing backend JAR: ${jar}`);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'garbage-mini-integration-'));
const admin = 'integration-admin';
let child;
let log = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  child = spawn('java', ['-jar', jar, '--server.port=0', '--spring.profiles.active=local', '--app.jobs-enabled=false', `--app.admin-token=${admin}`, '--spring.datasource.url=jdbc:h2:mem:mini-integration;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1'], { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => { log += bytes; }); child.stderr.on('data', bytes => { log += bytes; });
  child.on('error', error => { log += error.message; });
  let port;
  for (let i = 0; i < 150; i++) {
    const match = /Tomcat started on port\(s\): (\d+)/.exec(log);
    if (match) { port = match[1]; break; }
    if (child.exitCode !== null) throw new Error('Backend exited during startup: ' + log.slice(-3000));
    await pause(200);
  }
  assert.ok(port, 'Backend startup timeout: ' + log.slice(-3000));
  const mockedWx = mockWx();
  const config = require('../miniprogram/config'); config.baseUrl = `http://127.0.0.1:${port}`;
  wx.request = args => {
    fetch(args.url, { method: args.method, headers: args.header, body: args.method === 'GET' || args.data === undefined ? undefined : JSON.stringify(args.data), signal: AbortSignal.timeout(args.timeout) })
      .then(async response => { const text = await response.text(); args.success({ statusCode: response.status, header: Object.fromEntries(response.headers), data: text ? JSON.parse(text) : '' }); })
      .catch(error => args.fail({ errMsg: error.message }));
  };
  const api = require('../miniprogram/services/api');
  const session = require('../miniprogram/utils/session');
  const { checkout } = require('../miniprogram/services/checkout');
  const f = require('../miniprogram/utils/format');
  async function operator(route, body) {
    const res = await fetch(config.baseUrl + route, { method: 'POST', headers: { 'X-Admin-Token': admin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(res.status, 200, await res.clone().text()); return res.json();
  }
  const initialCatalog = await api.catalog();
  assert.equal(initialCatalog.singlePriceFen, 300); assert.equal(initialCatalog.memberPriceFen, 7500); assert.equal(initialCatalog.memberDailyLimit, 1);
  assert.equal((await fetch(config.baseUrl + '/manage/index.html')).status, 200);
  assert.equal((await fetch(config.baseUrl + '/admin/pricing')).status, 401);
  session.save(await api.localLogin('integration-family'));
  assert.equal(await api.address(), null);
  const community = await operator('/admin/community/save', { name: '联调专用小区', noonStart: '00:01', noonEnd: '00:02', noonDeadline: '00:00', nightDeadline: '23:58', nightStart: '23:58', nightEnd: '23:59' });
  await api.saveAddress({ floor: 12, communityId: community.id, building: '3栋', unit: '2单元', room: '1201', placement: '家门口' });
  assert.equal((await api.address()).room, '1201');
  const home = page('home'); await home.refresh(); assert.equal(home.data.community.name, '联调专用小区');
  const tomorrow = f.addDays(f.beijingDate(), 1);
  await home.chooseDate({ currentTarget: { dataset: { date: tomorrow } } });
  assert.equal(home.data.serviceDate, tomorrow); assert.equal(home.data.error, '');
  const booked = await checkout('single', { serviceDate: tomorrow, periods: ['NIGHT'], remark: '不用敲门' }); assert.equal(booked.state, 'PAID');
  assert.equal((await api.availability(tomorrow)).slots[1].bookedCount, 1);
  const orders = await api.orders(); assert.equal(orders.length, 1); assert.equal(orders[0].status, 'WAITING');
  const detail = page('order-detail'); detail.id = orders[0].id; await detail.refresh();
  assert.equal(detail.data.order.canCancel, true); await detail.cancel(); assert.equal(detail.data.order.status, 'CANCELLED');
  assert.equal(detail.data.order.refunds[0].amount, 300);
  await operator(`/admin/refund/${encodeURIComponent(detail.data.order.refunds[0].id)}/retry`);
  await detail.refresh(); assert.equal(detail.data.order.refunds[0].status, 'SUCCEEDED');
  const card = await checkout('member', { quotedPriceFen: 7500, quotedDailyLimit: 1 }); assert.equal(card.state, 'PAID');
  const member = await api.member(); const start = f.addDays(f.beijingDate(), 1);
  assert.equal(member.start_date, start); assert.equal(member.expire_date, f.addDays(start, 29)); assert.equal(member.status, 'PENDING');
  const memberPage = page('member'); await memberPage.refresh(); assert.equal(memberPage.data.range.start, f.addDays(member.expire_date, 1));
  const renewed = await checkout('member', {}); assert.equal(renewed.state, 'PAID'); assert.equal((await api.member()).expire_date, f.addDays(start, 59));
  const plan = page('plan'); await plan.refresh(); plan.setData({ noonEnabled: false, nightEnabled: true, placement: '鞋柜旁', remark: '不用敲门' }); await plan.save();
  assert.equal((await api.plan()).placement, '鞋柜旁');
  const profile = page('profile'); await profile.refresh(); assert.equal(profile.data.member.status, 'PENDING');
  const ordersPage = page('orders'); await ordersPage.refresh(); assert.ok(ordersPage.data.rows.some(row => row.status === 'CANCELLED')); 
  assert.equal((await api.orders()).length, 7, 'Default card reserves six evening tasks plus the cancelled single order');
  assert.ok((await api.orders()).filter(row => row.status === 'WAITING').every(row => row.service_date >= tomorrow));
  assert.equal((await api.availability(tomorrow)).slots[1].bookedCount, 1);
  assert.equal((await api.availability(tomorrow)).memberEligible, true);
  assert.equal((await api.availability(tomorrow)).memberRemaining, 0);
  assert.equal((await api.plan()).night_enabled, true);
  const settingsResponse = await fetch(config.baseUrl + '/admin/pricing', { headers: { 'X-Admin-Token': admin } });
  const settings = await settingsResponse.json();
  const edited = { version: settings.version, singlePriceFen: 300, memberPriceFen: 7500, memberDailyLimit: 1, promotionEnabled: true, promotionTitle: '开业优惠', singlePromoFen: 200, memberPromoFen: 6500 };
  const saved = await fetch(config.baseUrl + '/admin/pricing', { method: 'PUT', headers: { 'X-Admin-Token': admin, 'Content-Type': 'application/json' }, body: JSON.stringify(edited) });
  assert.equal(saved.status, 200);
  await home.refresh();
  assert.equal(home.data.catalog.singlePriceText, '2.00'); assert.equal(home.data.catalog.memberPriceText, '65.00');
  const rejected = await fetch(config.baseUrl + '/admin/pricing', { method: 'PUT', headers: { 'X-Admin-Token': admin, 'Content-Type': 'application/json' }, body: JSON.stringify(edited) });
  assert.equal(rejected.status, 409);
  const extra = await checkout('single', { serviceDate: tomorrow, periods: ['NOON'], remark: '', quotedTotalFen: 200 });
  assert.equal(extra.state, 'PAID');
  const extraOrders = await api.orders();
  const paidNoon = extraOrders.find(row => row.service_date === tomorrow && row.period === 'NOON');
  assert.equal(paidNoon.amount, 200); assert.equal(paidNoon.source, 'SINGLE');
  await api.cancel(paidNoon.id); assert.equal((await api.order(paidNoon.id)).refunds[0].amount, 200);
  console.log('PASS: admin authentication, public pricing, discount save, version conflict, mini-program live prices, default evening entitlement, extra paid service and actual-price refund');
  const own = session.read(); session.save(await api.localLogin('another-family'));
  await assert.rejects(api.order(orders[0].id), error => error.status === 404);
  session.save(own);
  const applicantLogin = await api.localLogin('community-applicant'); session.save(applicantLogin);
  const applicationPage = page('community-apply'); await applicationPage.refresh();
  applicationPage.setData({ name: '新入驻联调小区', city: '杭州市余杭区', detailAddress: '联调路18号', contactName: '联调用户' });
  await applicationPage.submit();
  assert.equal(applicationPage.data.applications.length, 1);
  const submitted = applicationPage.data.applications[0]; assert.equal(submitted.status, 'PENDING');
  assert.ok(!(await api.communities()).some(c => c.name === '新入驻联调小区'));
  const pendingResponse = await fetch(config.baseUrl + '/admin/community/applications?status=PENDING', { headers: { 'X-Admin-Token': admin } });
  assert.equal((await pendingResponse.json()).pendingCount, 1);
  const approved = await operator('/admin/community/applications/' + submitted.id + '/review', { decision: 'APPROVED', community: { name: '新入驻联调小区' } });
  assert.equal(approved.status, 'APPROVED');
  const addressPage = page('address'); await addressPage.refresh();
  assert.ok(addressPage.data.names.includes('新入驻联调小区'));
  await api.saveAddress({ floor: 12, communityId: approved.community_id, building: '7', unit: '', room: '101' });
  await addressPage.refresh(); assert.equal(addressPage.data.address.displayText, '7栋101号房');
  await applicationPage.refresh(); assert.equal(applicationPage.data.applications[0].statusText, '已通过');
  session.save(own); assert.equal((await api.communityApplications()).total, 0);
  console.log('PASS: resident application, pending review, hidden until approved, administrator publication, refreshed address selection, status history and owner isolation');
  const originalUser = session.read().userId;
  const logoutPage=page('profile'); logoutPage.refresh=()=>{};
  await logoutPage.logout(); assert.equal(session.read(),null);
  const loginPage=page('login');loginPage.data.agreement=true;
  await loginPage.login();assert.equal(session.read().userId,originalUser);
  assert.equal(mockedWx.calls.at(-1)[1].url,'/pages/home/index');
  assert.equal((await api.address()).room,'1201');
  session.clear();session.rememberLocal('new-one-click-family');
  const newLogin=page('login');newLogin.data.agreement=true;await newLogin.login();
  assert.equal(mockedWx.calls.at(-1)[1].url,'/pages/address/index');
  assert.equal(await api.address(),null);
  console.log('PASS: one-click login preserves existing household after logout and routes new household to address setup');
  console.log('PASS: real backend HTTP integration through mini-program modules: login, address, home, single payment, detail, cancellation, refund, next-day card, renewal, plan, profile, orders and ownership');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    for (let i = 0; i < 50 && child.exitCode === null; i++) await pause(100);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  fs.rmSync(scratch, { recursive: true, force: true });
});
