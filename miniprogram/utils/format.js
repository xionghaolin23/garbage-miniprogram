const { now } = require('./request');
const pad = n => String(n).padStart(2, '0');
function beijingDate(epoch = now()) {
  const date = new Date(epoch + 8 * 3600000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
function timestamp(value) {
  if (!value) return NaN;
  // 不依赖 iOS 对无时区 YYYY-MM-DD 字符串的解析。
  const match = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d)(?:\.(\d{1,9}))?)?)?$/.exec(value);
  if (!match) return NaN;
  return Date.UTC(+match[1], +match[2] - 1, +match[3], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0), Number((match[7] || "").padEnd(3, "0").slice(0, 3))) - 8 * 3600000;
}
function addDays(value, days) { return beijingDate(timestamp(value) + days * 86400000); }
function money(fen) { return (Number(fen || 0) / 100).toFixed(2); }
function shortDate(value) { return value ? value.slice(5).replace('-', '月') + '日' : ''; }
function clockText(value) { return value ? value.slice(11, 16) : ''; }
const statusLabels = { UNPAID: '待支付', WAITING: '等待取走', COMPLETED: '已取走', CANCELLED: '已取消', EXCEPTION: '服务异常' };
function addressText(address) {
  if (!address) return '';
  const text = value => value == null ? '' : String(value).trim();
  const building = text(address.building);
  const unit = text(address.unit);
  const room = text(address.room);
  return (building ? building.replace(/(?:栋|幢|号楼|楼)$/, '') + '栋' : '')
    + (unit ? unit.replace(/单元$/, '') + '单元' : '')
    + (room ? room.replace(/(?:号房|房|室|号)$/, '') + '号房' : '');
}
function orderView(order, epoch = now()) {
  const cutoff = timestamp(order.deadline_at);
  return {
    ...order,
    periodText: order.period === 'NOON' ? '中午场' : '晚上场',
    dateText: order.service_date === beijingDate(epoch) ? '今天' : shortDate(order.service_date),
    timeText: `${clockText(order.start_at)} – ${clockText(order.end_at)}`,
    addressText: addressText(order),
    statusText: statusLabels[order.status] || '处理中',
    statusClass: String(order.status || '').toLowerCase(),
    isMember: order.source !== 'SINGLE',
    priceText: money(order.amount),
    canCancel: ['UNPAID', 'WAITING'].includes(order.status) && epoch < cutoff,
    canPay: order.status === 'UNPAID' && epoch < cutoff,
    deadlineText: clockText(order.deadline_at),
    completedText: order.completed_at ? order.completed_at.replace('T', ' ').slice(0, 19) : '',
    refunds: (order.refunds || []).map(refund => ({
      ...refund, amountText: money(refund.amount),
      statusText: { PENDING: '退款处理中', FAILED: '退款处理中，正在重试', SUCCEEDED: '退款已完成' }[refund.status] || '退款处理中'
    }))
  };
}
function memberView(member, epoch = now()) {
  if (!member) return null;
  const today = beijingDate(epoch);
  const status = today < member.start_date ? 'PENDING' : today > member.expire_date ? 'EXPIRED' : 'ACTIVE';
  return { ...member, status, statusText: { PENDING: '待生效', ACTIVE: '使用中', EXPIRED: '已到期' }[status], usable: status === 'ACTIVE', canPlan: status !== 'EXPIRED' };
}
function purchaseRange(member, epoch = now()) {
  const tomorrow = addDays(beijingDate(epoch), 1);
  const start = member && member.expire_date >= tomorrow ? addDays(member.expire_date, 1) : tomorrow;
  return { start, end: addDays(start, 29) };
}
function slots(community, orders, member, epoch = now(), serviceDate = beijingDate(epoch), availability = null) {
  if (!community) return [];
  const today = serviceDate;
  return ['NOON', 'NIGHT'].map(period => {
    const prefix = period === 'NOON' ? 'noon' : 'night';
    const existing = orders.find(o => o.service_date === today && o.period === period && o.status !== 'CANCELLED');
    const quota = availability && availability.slots.find(s => s.period === period);
    const closed = epoch >= timestamp(`${today}T${community[prefix + '_deadline']}:00`) || !!(quota && quota.closed);
    const full = !!quota && quota.remaining <= 0;
    const covered = availability ? availability.memberRemaining > 0 : member && member.usable;
    return { period, title: period === 'NOON' ? '中午帮你扔' : '晚上帮你扔',
      time: `${community[prefix + '_start']} – ${community[prefix + '_end']}`,
      deadline: community[prefix + '_deadline'], closed, existing,
      disabled: closed || !!existing || full, full,
      bookedCount: quota ? quota.bookedCount : null, pendingCount: quota ? quota.pendingCount : 0,
      capacity: quota ? quota.capacity : 100, remaining: quota ? quota.remaining : null,
      label: existing ? (statusLabels[existing.status] || '已有预约') : closed ? '该场次已截止' : full ? '已约满' : '可预约',
      priceText: covered ? '月卡可抵扣' : (availability && availability.catalog ? '¥' + money(availability.catalog.singlePriceFen) + ' / 次' : '加载中')
    };
  });
}
function bookingDates(epoch = now()) {
  const today = beijingDate(epoch);
  return Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(today, offset);
    const week = new Date(timestamp(date) + 8 * 3600000).getUTCDay();
    return { date, label: offset === 0 ? '今天' : offset === 1 ? '明天' : '周' + '日一二三四五六'[week], short: date.slice(5).replace('-', '/') };
  });
}
function catalogView(catalog) {
  if (!catalog) return null;
  return { ...catalog, singlePriceText: money(catalog.singlePriceFen), memberPriceText: money(catalog.memberPriceFen),
    singleListPriceText: money(catalog.singleListPriceFen), memberListPriceText: money(catalog.memberListPriceFen),
    singleDiscounted: catalog.singlePriceFen < catalog.singleListPriceFen, memberDiscounted: catalog.memberPriceFen < catalog.memberListPriceFen };
}
function bookingQuote(selected, remaining, price) {
  const free = ['NIGHT', 'NOON'].filter(p => selected.includes(p)).slice(0, Math.max(0, remaining || 0));
  return { free, totalFen: (selected.length - free.length) * price };
}
module.exports = { addressText, catalogView, bookingQuote, bookingDates, beijingDate, timestamp, addDays, money, shortDate, orderView, memberView, purchaseRange, slots };
