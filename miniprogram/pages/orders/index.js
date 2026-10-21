const api = require('../../services/api');
const session = require('../../utils/session');
const f = require('../../utils/format');
const ui = require('../../utils/ui');
Page({
  data: { loading: false, error: '', loggedIn: false, rows: [], visible: [], filter: 'ALL', hasMore: true, loadingMore: false, filters: [{ key: 'ALL', title: '全部' }, { key: 'UNPAID', title: '待支付' }, { key: 'WAITING', title: '待取走' }, { key: 'COMPLETED', title: '已完成' }, { key: 'OTHER', title: '取消/异常' }] },
  onShow() { this.refresh(); },
  onPullDownRefresh() { this.refresh(); },
  onReachBottom() { this.more(); },
  async refresh() {
    if (!session.read()) { this.setData({ loggedIn: false, rows: [], visible: [], error: '' }); wx.stopPullDownRefresh(); return; }
    this.setData({ loggedIn: true });
    const generation = (this.generation || 0) + 1; this.generation = generation;
    await ui.load(this, async () => {
      const rows = await api.orders(1, 20);
      if (generation !== this.generation) return;
      this.nextPage = 2; this.setData({ rows: rows.map(row => f.orderView(row)), hasMore: rows.length === 20, loadingMore: false }); this.filterRows();
    });
  },
  async more() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore || !this.data.loggedIn || this.data.error) return;
    const generation = this.generation;
    this.setData({ loadingMore: true });
    try {
      const rows = await api.orders(this.nextPage, 20);
      if (generation !== this.generation) return;
      this.nextPage++;
      const ids = new Set(this.data.rows.map(row => row.id));
      this.setData({ rows: this.data.rows.concat(rows.filter(row => !ids.has(row.id)).map(row => f.orderView(row))), hasMore: rows.length === 20 }); this.filterRows();
    } catch (e) { ui.error(e); }
    finally { if (generation === this.generation) this.setData({ loadingMore: false }); }
  },
  select(event) { this.setData({ filter: event.currentTarget.dataset.filter }); this.filterRows(); },
  filterRows() { const filter = this.data.filter; this.setData({ visible: this.data.rows.filter(row => filter === 'ALL' || (filter === 'OTHER' ? ['CANCELLED', 'EXCEPTION'].includes(row.status) : row.status === filter)) }); },
  openOrder: ui.openOrder,
  login() { wx.navigateTo({ url: '/pages/login/index' }); },
  home() { wx.switchTab({ url: '/pages/home/index' }); }
});
