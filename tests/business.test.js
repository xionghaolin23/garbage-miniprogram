const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockWx } = require('./helpers');
mockWx();
const f = require('../miniprogram/utils/format');
const config = require('../miniprogram/config');
const session = require('../miniprogram/utils/session');
const intents = require('../miniprogram/services/intents');
const { runtimeError } = require('../miniprogram/utils/runtime');
const noon = '2026-09-16T11:00:00';
const epoch = f.timestamp('2026-09-16T10:00:00');
const c = { noon_start: '11:30', noon_end: '13:30', noon_deadline: '11:00', night_start: '18:30', night_end: '21:00', night_deadline: '18:00' };
const order = { id: 'o', period: 'NOON', service_date: '2026-09-16', deadline_at: noon, start_at: '2026-09-16T11:30:00', end_at: '2026-09-16T13:30:00', status: 'WAITING', source: 'SINGLE', amount: 100, building: '3栋', room: '1201' };
beforeEach(() => { mockWx(); config.mode = 'local'; config.baseUrl = 'http://127.0.0.1:8086'; });
test('Beijing date crosses day boundary independently of device timezone', () => {
  assert.equal(f.beijingDate(Date.parse('2026-09-16T16:00:00Z')), '2026-09-17');
  assert.equal(f.timestamp(noon), Date.parse('2026-09-16T03:00:00Z'));
});
test('Backend fractional timestamp parses payment expiry correctly', () => {
  assert.equal(f.timestamp('2026-09-16T11:00:00.123456'), Date.parse('2026-09-16T03:00:00.123Z'));
});
test('First purchase always starts next day for 30 inclusive days', () => {
  assert.deepEqual(f.purchaseRange(null, f.timestamp('2026-09-16T23:59:59')), { start: '2026-09-17', end: '2026-10-16' });
});
test('Renewal appends and expired membership does not carry a historical gap', () => {
  assert.deepEqual(f.purchaseRange({ expire_date: '2026-10-16' }, epoch), { start: '2026-10-17', end: '2026-11-15' });
  assert.deepEqual(f.purchaseRange({ expire_date: '2026-09-15' }, epoch), { start: '2026-09-17', end: '2026-10-16' });
});
test('Leap year and year end are counted as natural days', () => {
  assert.equal(f.addDays('2028-02-28', 1), '2028-02-29');
  assert.deepEqual(f.purchaseRange(null, f.timestamp('2026-12-31')), { start: '2027-01-01', end: '2027-01-30' });
});
test('Pending card is not usable on purchase day', () => {
  const m = { start_date: '2026-09-17', expire_date: '2026-10-16' };
  assert.equal(f.memberView(m, epoch).usable, false);
  assert.equal(f.memberView(m, f.timestamp('2026-09-17')).usable, true);
  assert.equal(f.memberView(m, f.timestamp('2026-10-17')).canPlan, false);
});
test('Exact deadline disables cancellation and booking', () => {
  assert.equal(f.orderView(order, f.timestamp(noon) - 1).canCancel, true);
  assert.equal(f.orderView(order, f.timestamp(noon)).canCancel, false);
  assert.equal(f.slots(c, [], null, f.timestamp(noon))[0].closed, true);
  assert.equal(f.slots(c, [], null, f.timestamp(noon))[1].closed, false);
});
test('Existing completed or exception service also occupies the daily slot', () => {
  for (const status of ['WAITING', 'UNPAID', 'COMPLETED', 'EXCEPTION']) assert.equal(f.slots(c, [{ ...order, status }], null, epoch)[0].disabled, true);
  assert.equal(f.slots(c, [{ ...order, status: 'CANCELLED' }], null, epoch)[0].disabled, false);
});
test('Refunds are displayed separately from cancellation status', () => {
  const view = f.orderView({ ...order, status: 'CANCELLED', refunds: [{ amount: 100, status: 'PENDING' }] }, epoch);
  assert.equal(view.statusText, '已取消'); assert.equal(view.refunds[0].statusText, '退款处理中'); assert.equal(view.refunds[0].amountText, '1.00');
});
test('Persisted intent uses the original request key and original selection', () => {
  session.save({ token: 't', userId: 'u' });
  const first = intents.begin('single', { periods: ['NOON'], remark: '' });
  assert.deepEqual(intents.begin('single', { periods: ['NIGHT'] }), first);
  intents.attach('single', 'payment'); assert.equal(intents.get('single').paymentId, 'payment');
  intents.clear('single'); assert.equal(intents.get('single'), null);
});
test('Sessions and pending purchases are isolated between users and servers', () => {
  session.save({ token: 'a', userId: 'a' }); intents.begin('member', {});
  session.save({ token: 'b', userId: 'b' }); assert.equal(intents.get('member'), null);
  config.baseUrl = 'http://another-server:8086'; assert.equal(session.read(), null);
});
test('Published builds refuse local mock mode and production refuses HTTP', () => {
  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } }); assert.notEqual(runtimeError(), '');
  config.mode = 'production'; assert.notEqual(runtimeError(), '');
  config.baseUrl = 'https://example.test'; assert.equal(runtimeError(), '');
});

test('Seven booking dates cross month and year boundaries in Beijing time', () => {
  const dates = f.bookingDates(f.timestamp('2026-12-29T23:59:59'));
  assert.equal(dates.length, 7); assert.equal(dates[0].date, '2026-12-29'); assert.equal(dates[6].date, '2027-01-04');
  assert.equal(dates[0].label, '今天'); assert.equal(dates[1].label, '明天');
});
test('Future date remains open after today cutoff and uses service date membership', () => {
  const c = { noon_start: '11:30', noon_end: '13:30', noon_deadline: '11:00', night_start: '18:30', night_end: '21:00', night_deadline: '18:00' };
  const choices = f.slots(c, [], { usable: false }, f.timestamp('2026-09-16T23:00:00'), '2026-09-17', { memberEligible: true, memberRemaining: 1, slots: [{ period: 'NOON', capacity: 100, bookedCount: 40, pendingCount: 0, remaining: 60 }] });
  assert.equal(choices[0].disabled, false); assert.equal(choices[0].priceText, '月卡可抵扣'); assert.equal(choices[0].bookedCount, 40);
});

test('Price formatting and daily deduction use server catalog values', () => {
  const c = f.catalogView({ singlePriceFen: 200, singleListPriceFen: 300, memberPriceFen: 6000, memberListPriceFen: 7500 });
  assert.equal(c.singlePriceText, '2.00'); assert.equal(c.memberPriceText, '60.00'); assert.equal(c.memberDiscounted, true);
  assert.deepEqual(f.bookingQuote(['NOON','NIGHT'],1,200), { free: ['NIGHT'], totalFen: 200 });
  assert.deepEqual(f.bookingQuote(['NOON'],0,300), { free: [], totalFen: 300 });
});
