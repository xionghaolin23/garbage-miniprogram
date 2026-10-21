const api = require('./api');
const { beijingDate } = require('../utils/format');
async function todayOrders() {
  let page = 1;
  const result = [];
  const today = beijingDate();
  while (true) {
    const rows = await api.orders(page++, 100);
    result.push(...rows.filter(order => order.service_date === today));
    if (rows.length < 100) return result;
  }
}
module.exports = { todayOrders };
