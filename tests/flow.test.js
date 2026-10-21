const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockWx, page } = require('./helpers');
mockWx();
const api = require('../miniprogram/services/api');
const config = require('../miniprogram/config');
const session = require('../miniprogram/utils/session');
const intents = require('../miniprogram/services/intents');
const { checkout } = require('../miniprogram/services/checkout');
const payments = require('../miniprogram/services/payments');
const { request } = require('../miniprogram/utils/request');
const f = require('../miniprogram/utils/format');
const original = { ...api };
const future = () => `${f.beijingDate(Date.now() + 86400000)}T23:59:00`;
const catalogFixture = { singlePriceFen: 300, memberPriceFen: 7500, singleListPriceFen: 300, memberListPriceFen: 7500, memberDailyLimit: 1 };
let mock;
beforeEach(() => { api.catalog = async () => catalogFixture; mock = mockWx(); config.mode = 'local'; config.baseUrl = 'http://127.0.0.1:8086'; session.save({ token: 'user-token', userId: 'user-id' }); });
afterEach(() => { Object.assign(api, original); });
test('HTTP adapter sends auth and normalizes empty Spring response to null', async () => {
  wx.request = args => { assert.equal(args.header.Authorization, 'Bearer user-token'); assert.equal(args.url, config.baseUrl + '/api/address/default'); args.success({ statusCode: 200, data: '' }); };
  assert.equal(await api.address(), null);
});
test('401 clears login and preserves server error code', async () => {
  wx.request = args => args.success({ statusCode: 401, data: { code: 'UNAUTHORIZED', message: 'expired' } });
  await assert.rejects(request('/api/order/list'), error => error.status === 401 && error.code === 'UNAUTHORIZED'); assert.equal(session.read(), null);
});
test('Network failure is reported without fabricating a success', async () => {
  wx.request = args => args.fail({ errMsg: 'timeout' }); await assert.rejects(api.member(), error => error.code === 'NETWORK_ERROR');
});
test('Cancelled payment remains recoverable and never creates a second payment', async () => {
  let creates = 0; let pays = 0; let state = 'PENDING';
  api.createOrder = async () => { creates++; return { payment: { id: 'p' } }; };
  api.payment = async () => ({ id: 'p', status: state, amount: 100, expires_at: future() });
  api.localPay = async () => { pays++; state = 'PAID'; };
  wx.showModal = args => args.success({ confirm: false });
  await assert.rejects(checkout('single', { periods: ['NOON'], remark: '' }), error => error.code === 'PAYMENT_CANCELLED');
  assert.equal(intents.get('single').paymentId, 'p'); assert.equal(pays, 0);
  wx.showModal = args => args.success({ confirm: true });
  assert.equal((await checkout('single', { periods: ['NIGHT'] })).state, 'PAID'); assert.equal(creates, 1); assert.equal(pays, 1); assert.equal(intents.get('single'), null);
});
test('Lost create response replays the identical request body and key', async () => {
  const bodies = []; let count = 0;
  api.createOrder = async body => { bodies.push(body); if (++count === 1) throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' }); return { payment: { id: 'p' } }; };
  api.payment = async () => ({ status: 'COVERED', amount: 0 });
  await assert.rejects(checkout('single', { periods: ['NOON'], remark: '原备注' }));
  await checkout('single', { periods: ['NIGHT'], remark: '不能替换原备注' });
  assert.deepEqual(bodies[0], bodies[1]);
});
test('Confirmed refunded payment cannot appear as successful booking', async () => {
  api.payment = async () => ({ status: 'PAID', refunds: [{ status: 'PENDING', amount: 100 }] });
  const result = await payments.pay('p'); assert.equal(result.state, 'REFUND');
});
test('Expired payment is not submitted again', async () => {
  api.payment = async () => ({ status: 'PENDING', expires_at: '2020-01-01T10:00:00', amount: 100 });
  api.localPay = async () => assert.fail('Expired payment was submitted');
  assert.equal((await payments.pay('p')).state, 'CLOSED');
});
test('Business rejection releases intent so the next selection can change', async () => {
  api.createOrder = async () => { throw Object.assign(new Error('closed'), { code: 'BOOKING_CLOSED', status: 409 }); };
  await assert.rejects(checkout('single', { periods: ['NOON'] })); assert.equal(intents.get('single'), null);
});
test('Local payment response alone is not trusted; backend state is polled', async () => {
  let count = 0;
  api.payment = async () => ({ status: ++count === 1 ? 'PENDING' : 'PAID', amount: 100, expires_at: future() });
  api.localPay = async () => ({ status: 'PAID' });
  assert.equal((await payments.pay('p')).state, 'PAID'); assert.equal(count, 2);
});
test('Home guest state does not retain another household data', async () => {
  session.clear(); const home = page('home'); home.data.address = { room: 'private' }; await home.refresh();
  assert.equal(home.data.loggedIn, false); assert.equal(home.data.address, null);
});
test('Home pending intent keeps original periods and remark', async () => {
  intents.begin('single', { periods: ['NIGHT'], remark: '原备注' });
  api.address = async () => ({ community_id: 'c', building: '1栋', room: '101' });
  api.communities = async () => [{ id: 'c', noon_start: '11:30', noon_end: '13:30', noon_deadline: '11:00', night_start: '18:30', night_end: '21:00', night_deadline: '18:00' }];
  api.member = async () => null; api.orders = async () => [];
  api.availability = async date => ({ serviceDate: date, slots: [], orders: [], memberEligible: false, memberRemaining: 0, catalog: catalogFixture });
  const home = page('home'); await home.refresh(); assert.equal(home.data.pendingIntent, true); assert.deepEqual(home.data.selected, ['NIGHT']);
  home.choose({ currentTarget: { dataset: { period: 'NOON' } } }); assert.deepEqual(home.data.selected, ['NIGHT']); assert.equal(home.data.remark, '原备注');
});
test('Orders paginate from the backend even when the selected state has no results yet', async () => {
  api.orders = async page => page === 1 ? Array.from({ length: 20 }, (_, i) => ({ id: 'first-' + i, status: 'CANCELLED', source: 'SINGLE' })) : [{ id: 'target', status: 'WAITING', source: 'MEMBER' }];
  const orders = page('orders'); await orders.refresh(); orders.select({ currentTarget: { dataset: { filter: 'WAITING' } } }); assert.equal(orders.data.visible.length, 0); assert.equal(orders.data.hasMore, true);
  await orders.more(); assert.equal(orders.data.visible.length, 1); assert.equal(orders.data.visible[0].id, 'target'); assert.equal(orders.data.hasMore, false);
});
test('Order detail cancellation uses correct member endpoint then refreshes', async () => {
  let called = '';
  api.skip = async id => { called = id; };
  api.order = async () => ({ id: 'm', source: 'MEMBER', status: 'CANCELLED', refunds: [] });
  const detail = page('order-detail'); detail.id = 'm'; detail.data.order = { id: 'm', isMember: true, status: 'WAITING' };
  await detail.cancel(); assert.equal(called, 'm'); assert.equal(detail.data.order.status, 'CANCELLED');
});
test('Home duplicate taps are ignored while checkout is busy', async () => {
  const home = page('home'); home.data.busy = true;
  api.createOrder = async () => assert.fail('Duplicate tap created an order'); await home.book();
});

test('Production uses wx.requestPayment and confirms through backend query', async () => {
  config.mode = 'production'; config.baseUrl = 'https://example.test';
  let queried = 0; let invoked = false;
  api.payment = async () => ({ status: ++queried === 1 ? 'PENDING' : 'PAID', amount: 100, expires_at: future() });
  api.prepay = async () => ({ timeStamp: '123', nonceStr: 'nonce', package: 'prepay_id=test', signType: 'RSA', paySign: 'signed' });
  api.localPay = async () => assert.fail('Production must never call mock payment');
  wx.requestPayment = args => { assert.equal(args.package, 'prepay_id=test'); invoked = true; args.success({}); };
  assert.equal((await payments.pay('p')).state, 'PAID'); assert.equal(invoked, true); assert.equal(queried, 2);
});
test('Unavailable real prepay does not silently fall back to mock payment', async () => {
  config.mode = 'production'; config.baseUrl = 'https://example.test';
  api.payment = async () => ({ status: 'PENDING', amount: 100, expires_at: future() });
  api.prepay = async () => { throw new Error('Real integration is not configured'); };
  api.localPay = async () => assert.fail('Mock fallback is forbidden');
  await assert.rejects(payments.pay('p'), /not configured/);
});

function homeApi() {
  api.address = async () => ({ community_id: 'c', building: '1栋', room: '101' });
  api.communities = async () => [{ id: 'c', noon_start: '11:30', noon_end: '13:30', noon_deadline: '11:00', night_start: '18:30', night_end: '21:00', night_deadline: '18:00' }];
  api.member = async () => null;
  api.availability = async date => ({ serviceDate: date, slots: ['NOON', 'NIGHT'].map(period => ({ period, capacity: 100, bookedCount: 20, pendingCount: 1, remaining: 79, closed: false })), orders: [], memberEligible: false, memberRemaining: 0, catalog: catalogFixture });
}
test('Home defaults to today, offers seven dates and submits selected service date', async () => {
  homeApi();
  const home = page('home'); await home.refresh();
  assert.equal(home.data.error, ''); assert.equal(home.data.serviceDate, f.beijingDate()); assert.equal(home.data.dates.length, 7);
  const date = f.addDays(f.beijingDate(), 6);
  await home.chooseDate({ currentTarget: { dataset: { date } } });
  assert.equal(home.data.serviceDate, date); assert.equal(home.data.slots[0].bookedCount, 20);
  home.choose({ currentTarget: { dataset: { period: 'NOON' } } });
  home.data.agreement = true;
  let body; api.createOrder = async input => { body = input; return { payment: { id: 'p' } }; };
  api.payment = async () => ({ status: 'COVERED', amount: 0 });
  await home.book(); assert.equal(body.serviceDate, date); assert.deepEqual(body.periods, ['NOON']);
});
test('Changing date clears selection and full slots cannot be selected', async () => {
  homeApi(); const home = page('home'); await home.refresh();
  home.data.selected = ['NOON'];
  api.availability = async date => ({ serviceDate: date, slots: [{ period: 'NOON', capacity: 100, bookedCount: 98, pendingCount: 2, remaining: 0 }], orders: [], memberEligible: false, memberRemaining: 0, catalog: catalogFixture });
  await home.chooseDate({ currentTarget: { dataset: { date: f.addDays(f.beijingDate(), 1) } } });
  assert.deepEqual(home.data.selected, []); assert.equal(home.data.slots[0].label, '已约满');
  home.choose({ currentTarget: { dataset: { period: 'NOON' } } }); assert.deepEqual(home.data.selected, []);
});
test('Out of order date responses do not replace the latest selection', async () => {
  homeApi(); const home = page('home'); await home.refresh();
  const pending = {};
  api.availability = date => new Promise(resolve => { pending[date] = resolve; });
  const first = f.addDays(f.beijingDate(), 1), second = f.addDays(f.beijingDate(), 2);
  const a = home.chooseDate({ currentTarget: { dataset: { date: first } } });
  const b = home.chooseDate({ currentTarget: { dataset: { date: second } } });
  pending[second]({ serviceDate: second, slots: [], orders: [], memberEligible: true, memberRemaining: 1, catalog: catalogFixture }); await b;
  pending[first]({ serviceDate: first, slots: [], orders: [], memberEligible: false, memberRemaining: 0, catalog: catalogFixture }); await a;
  assert.equal(home.data.serviceDate, second); assert.equal(home.data.memberRemaining, 1); assert.equal(home.availability.serviceDate, second);
});
test('Failed availability load blocks booking without inventing capacity', async () => {
  homeApi(); const home = page('home'); await home.refresh();
  api.availability = async () => { throw new Error('offline'); };
  await home.chooseDate({ currentTarget: { dataset: { date: f.addDays(f.beijingDate(), 1) } } });
  assert.equal(home.data.error, 'offline'); home.data.selected = ['NOON']; home.data.agreement = true;
  api.createOrder = async () => assert.fail('Booking must not proceed with failed availability'); await home.book();
});
test('Pending booking restores original date and prevents switching dates', async () => {
  homeApi(); const date = f.addDays(f.beijingDate(), 2);
  intents.begin('single', { serviceDate: date, periods: ['NIGHT'], remark: '' });
  const home = page('home'); await home.refresh();
  assert.equal(home.data.serviceDate, date); await home.chooseDate({ currentTarget: { dataset: { date: f.beijingDate() } } });
  assert.equal(home.data.serviceDate, date);
});
test('Today summary does not stop on old service dates when orders are created out of order', async () => {
  const { todayOrders } = require('../miniprogram/services/summary');
  api.orders = async p => p === 1 ? Array.from({ length: 100 }, (_, i) => ({ id: i, service_date: '2020-01-01' })) : [{ id: 'today', service_date: f.beijingDate() }];
  assert.deepEqual((await todayOrders()).map(row => row.id), ['today']);
});

test('One daily entitlement discounts evening first and charges noon when both selected', async () => {
  homeApi(); const home = page('home'); await home.refresh();
  const date = f.addDays(f.beijingDate(), 1);
  api.availability = async () => ({ serviceDate: date, orders: [], slots: [], memberRemaining: 1, memberDailyLimit: 1, catalog: catalogFixture });
  await home.chooseDate({ currentTarget: { dataset: { date } } });
  home.choose({ currentTarget: { dataset: { period: 'NOON' } } });
  assert.equal(home.data.total, '0.00');
  home.choose({ currentTarget: { dataset: { period: 'NIGHT' } } });
  assert.equal(home.data.total, '3.00'); assert.equal(home.data.quotedTotalFen, 300);
  assert.equal(home.data.slots.find(s => s.period === 'NIGHT').priceText, '月卡抵扣');
});
test('One daily card plan switches noon and evening exclusively and defaults evening', async () => {
  api.member = async () => ({ start_date: f.addDays(f.beijingDate(), 1), expire_date: f.addDays(f.beijingDate(), 30), planDailyLimit: 1 });
  api.plan = async () => null; api.address = async () => null; api.communities = async () => [];
  const plan = page('plan'); await plan.refresh(); assert.equal(plan.data.nightEnabled, true);
  plan.toggle({ currentTarget: { dataset: { field: 'noonEnabled' } }, detail: { value: true } });
  assert.equal(plan.data.noonEnabled, true); assert.equal(plan.data.nightEnabled, false);
});
test('Member checkout preserves displayed price and daily limit in request body', async () => {
  let body; api.buyMember = async input => { body = input; return { id: 'p' }; };
  api.payment = async () => ({ status: 'PAID', amount: 7500 });
  await checkout('member', { quotedPriceFen: 7500, quotedDailyLimit: 1 });
  assert.equal(body.quotedPriceFen, 7500); assert.equal(body.quotedDailyLimit, 1); assert.ok(body.requestKey);
});
test('Displayed discount and server quote mismatch requires a new user confirmation', async () => {
  api.createOrder = async () => { throw Object.assign(new Error('price changed'), { status: 409, code: 'PRICE_CHANGED' }); };
  await assert.rejects(checkout('single', { serviceDate: f.beijingDate(), periods: ['NOON'], quotedTotalFen: 100 }));
  assert.equal(intents.get('single'), null);
});

test('Community application validates fields before submitting', async () => {
  api.communityApplications = async () => ({ items: [], page: 1, total: 0 });
  api.submitCommunity = async () => assert.fail('Invalid application submitted');
  const form = page('community-apply'); await form.refresh();
  await form.submit(); assert.ok(mock.calls.some(c => c[0] === 'showToast' && c[1].title.includes('小区名称')));
  form.setData({ name: '新小区', city: '杭州', detailAddress: '测试路18号', contactPhone: '123' });
  await form.submit(); assert.ok(mock.calls.some(c => c[0] === 'showToast' && c[1].title.includes('手机号')));
});
test('Community application retains request key after lost response and restores original fields', async () => {
  api.communityApplications = async () => ({ items: [], page: 1, total: 0 });
  const calls = []; api.submitCommunity = async body => { calls.push(body); if (calls.length === 1) throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' }); return { id: 'a', status: 'PENDING' }; };
  const form = page('community-apply'); await form.refresh(); form.setData({ name: '新小区', city: '杭州', detailAddress: '测试路18号' });
  await form.submit(); assert.equal(form.data.pendingIntent, true);
  form.input({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '不应改变' } }); assert.equal(form.data.name, '新小区');
  await form.submit(); assert.deepEqual(calls[0], calls[1]); assert.equal(intents.get('community'), null); assert.equal(form.data.name, '');
});
test('Duplicate community submit taps create one request', async () => {
  api.communityApplications = async () => ({ items: [], page: 1, total: 0 });
  let finish, count = 0; api.submitCommunity = async () => { count++; return new Promise(resolve => { finish = resolve; }); };
  const form = page('community-apply'); await form.refresh(); form.setData({ name: '新小区', city: '杭州', detailAddress: '测试路18号' });
  const first = form.submit(); await Promise.resolve(); await form.submit();
  assert.equal(count, 1); finish({ id: 'one' }); await first;
});
test('Application history displays review reasons and loads further pages', async () => {
  api.communityApplications = async p => ({ items: [{ id: p === 2 ? 'a2' : 'a1', status: p === 2 ? 'APPROVED' : 'REJECTED', review_reason: '请补充门牌号', created_at: '2026-09-17T10:00:00' }], page: p || 1, total: 2 });
  const form = page('community-apply'); await form.refresh();
  assert.equal(form.data.applications[0].statusText, '未通过'); assert.equal(form.data.applications[0].review_reason, '请补充门牌号');
  await form.more(); assert.equal(form.data.applications[1].statusText, '已通过'); assert.equal(form.data.hasMore, false);
});
test('Address refresh after new community approval preserves prior selected community', async () => {
  api.address = async () => null; api.communities = async () => [{ id: 'a', name: 'A小区' }, { id: 'b', name: 'B小区' }];
  const address = page('address'); await address.refresh(); address.select({ detail: { value: 1 } });
  api.communities = async () => [{ id: 'new', name: '新入驻' }, { id: 'a', name: 'A小区' }, { id: 'b', name: 'B小区' }];
  await address.refresh(); assert.equal(address.data.selectedIndex, 2); assert.equal(address.data.names[2], 'B小区');
  address.applyCommunity(); assert.equal(mock.calls.at(-1)[1].url, '/pages/community-apply/index');
});
test('New address requires actual positive floor and submits it without inferring from room', async () => {
  const address = page('address');
  Object.assign(address.data, { selectedIndex: 0, communities: [{id:'c'}], names:['小区'], building:'7', unit:'', room:'1201', placement:'门口' });
  let saved; api.saveAddress = async body => { saved=body; };
  for (const floor of ['', '0', '-1', '1.5']) { address.data.floor=floor; await address.save(); assert.equal(saved,undefined); }
  address.data.floor='11'; await address.save(); assert.equal(saved.floor,11); assert.equal(saved.room,'1201');
});
test('Legacy address floor supplementation preserves all other address fields and refreshes', async () => {
  const address=page('address'); let savedFloor;
  address.data.address={community_id:'c',building:'7',unit:'',room:'101',floor:null};address.data.floor='2';
  api.fillFloor=async floor=>{savedFloor=floor;};api.address=async()=>({...address.data.address,floor:savedFloor});api.communities=async()=>[{id:'c',name:'小区'}];
  await address.fillFloor();assert.equal(savedFloor,2);assert.equal(address.data.address.floor,2);assert.equal(address.data.address.room,'101');
});
test('Phone authorization uses separate wx.login and phone codes then routes existing family home', async () => {
  config.mode='production';config.baseUrl='https://service.example';session.clear();
  const login=page('login');login.data.agreement=true;
  wx.login=args=>args.success({code:'identity-code'});
  let body;api.wechatLogin=async(...args)=>{body=args;return {token:'verified',userId:'family'};};api.address=async()=>({room:'101'});
  await login.phoneLogin({detail:{code:'phone-code'}});
  assert.deepEqual(body,['identity-code','phone-code']);assert.equal(session.read().userId,'family');
  assert.equal(mock.calls.at(-1)[0],'switchTab');assert.equal(mock.calls.at(-1)[1].url,'/pages/home/index');
});
test('New phone family is sent to address setup; denied authorization and missing agreement do not log in', async () => {
  config.mode='production';config.baseUrl='https://service.example';session.clear();
  const login=page('login');let calls=0;
  wx.login=args=>args.success({code:'identity-code'});api.wechatLogin=async()=>{calls++;return {token:'verified',userId:'new-family'};};api.address=async()=>null;
  await login.phoneLogin({detail:{code:'phone-code'}});assert.equal(calls,0);
  login.data.agreement=true;await login.phoneLogin({detail:{errMsg:'getPhoneNumber:fail user deny'}});assert.equal(calls,0);assert.equal(session.read(),null);
  await login.phoneLogin({detail:{code:'phone-code'}});assert.equal(calls,1);assert.equal(mock.calls.at(-1)[1].url,'/pages/address/index');
});
test('Phone login ignores double taps and address lookup failure resumes without consuming another authorization code', async () => {
  config.mode='production';config.baseUrl='https://service.example';session.clear();const login=page('login');login.data.agreement=true;
  let resolveWx;wx.login=args=>{resolveWx=()=>args.success({code:'identity-code'});};let calls=0;
  api.wechatLogin=async()=>{calls++;return {token:'verified',userId:'family'};};api.address=async()=>{throw Error('网络中断');};
  const first=login.phoneLogin({detail:{code:'phone-code'}});await login.phoneLogin({detail:{code:'phone-code'}});resolveWx();await first;
  assert.equal(calls,1);assert.equal(login.data.hasSession,true);assert.match(login.data.loginError,/网络中断/);
  api.address=async()=>({room:'101'});await login.continueLogin();assert.equal(calls,1);assert.equal(mock.calls.at(-1)[1].url,'/pages/home/index');
});
test('One-click local login persists household identity across logout without nickname input', async () => {
  session.clear();const login=page('login');login.data.agreement=true;const names=[];
  api.localLogin=async nickname=>{names.push(nickname);return {token:'t',userId:'local-family',localIdentity:nickname};};api.address=async()=>({room:'101'});
  await login.login();session.clear();await login.login();assert.equal(names.length,2);assert.equal(names[0],names[1]);assert.ok(names[0]);
});
test('Legacy local family name is retained before signing out', async () => {
  const profile=page('profile');profile.refresh=()=>{};
  api.localIdentity=async()=>({localIdentity:'以前的测试家庭'});
  await profile.logout();assert.equal(session.read(),null);assert.equal(session.localIdentity(),'以前的测试家庭');
});
test('Existing session skips authorization and nickname entirely', async () => {
  const login=page('login');api.address=async()=>({room:'101'});api.localLogin=async()=>assert.fail('Unexpected login');
  await login.onLoad();assert.equal(mock.calls.at(-1)[1].url,'/pages/home/index');
});
