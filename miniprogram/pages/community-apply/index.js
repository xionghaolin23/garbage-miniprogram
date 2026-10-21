const api = require('../../services/api');
const ui = require('../../utils/ui');
const intents = require('../../services/intents');
const session = require('../../utils/session');
const labels = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '未通过' };
Page({
 data: { loading: true, error: '', busy: false, moreLoading: false, name: '', city: '', detailAddress: '', contactName: '', contactPhone: '', remark: '', pendingIntent: false, applications: [], page: 0, hasMore: false },
 onShow() { this.refresh(); },
 onPullDownRefresh() { this.refresh(); },
 refresh() { return ui.load(this, async () => {
   const pending = intents.get('community');
   if (pending) this.setData({ ...pending.body, pendingIntent: true });
   else this.setData({ pendingIntent: false });
   const result = await api.communityApplications();
   this.setData({ applications: this.views(result.items), page: 1, hasMore: result.total > result.items.length });
 }); },
 views(rows) { return rows.map(row => ({ ...row, statusText: labels[row.status] || row.status, createdText: row.created_at.replace('T', ' ').slice(0,16) })); },
 input(event) { if (!this.data.pendingIntent && !this.data.busy) this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
 async submit() {
   if (this.data.busy || this.data.loading || !session.requireLogin()) return;
   const body = {};
   for (const field of ['name','city','detailAddress','contactName','contactPhone','remark']) body[field] = this.data[field].trim();
   if (!body.name || !body.city || !body.detailAddress) return ui.toast('请填写小区名称、所在城市和详细地址');
   if (body.contactPhone && !/^1[0-9]{10}$/.test(body.contactPhone)) return ui.toast('请填写正确的 11 位手机号，或留空');
   this.setData({ busy: true });
   try {
     if (!await ui.confirm('确认提交入驻申请', `${body.name}\n${body.city} · ${body.detailAddress}\n审核通过后即可在家庭地址中选择该小区。`, '确认提交')) return;
     const intent = intents.get('community') || intents.begin('community', body);
     this.setData({ pendingIntent: true });
     const result = await api.submitCommunity(intent.body);
     intents.clear('community');
     this.setData({ name: '', city: '', detailAddress: '', contactName: '', contactPhone: '', remark: '', pendingIntent: false });
     ui.toast(result.status === 'APPROVED' ? '申请已通过，可返回选择小区' : result.status === 'REJECTED' ? '申请已审核，请查看下方原因' : '已提交，等待管理员审核');
   } catch(e) {
     if (e.status >= 400 && e.status < 500 && e.status !== 401) { intents.clear('community'); this.setData({ pendingIntent: false }); }
     ui.error(e);
   } finally { this.setData({ busy: false }); await this.refresh(); }
 },
 async more() {
   if (this.data.moreLoading || !this.data.hasMore || this.data.loading) return;
   this.setData({ moreLoading: true });
   try { const result = await api.communityApplications(this.data.page + 1); const rows = this.data.applications.concat(this.views(result.items)); this.setData({ applications: rows, page: result.page, hasMore: rows.length < result.total }); }
   catch(e) { ui.error(e); } finally { this.setData({ moreLoading: false }); }
 },
 address() { wx.navigateBack({ delta: 1 }); },
 support() { wx.navigateTo({ url: '/pages/support/index' }); }
});
