const api = require('../../services/api');
const ui = require('../../utils/ui');
const f = require('../../utils/format');
Page({
  data: { loading: true, error: '', busy: false, member: null, noonEnabled: false, nightEnabled: false, placement: '家门口', remark: '', community: null },
  onShow() { this.refresh(); },
  refresh() { return ui.load(this, async () => {
    const [member, plan, address, communities] = await Promise.all([api.member(), api.plan(), api.address(), api.communities()]);
    this.setData({ member: f.memberView(member), community: address && communities.find(c => c.id === address.community_id) || null,
      noonEnabled: plan ? plan.noon_enabled : false, nightEnabled: plan ? plan.night_enabled : true,
      placement: plan ? plan.placement : address ? address.placement : '家门口', remark: plan ? plan.remark : '' });
  }); },
  toggle(event) {
    const field = event.currentTarget.dataset.field;
    const change = { [field]: event.detail.value };
    if (event.detail.value && this.data.member && this.data.member.planDailyLimit === 1) change[field === 'noonEnabled' ? 'nightEnabled' : 'noonEnabled'] = false;
    this.setData(change);
  },
  input(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  async save() {
    if (this.data.busy) return;
    if (!this.data.placement.trim()) return ui.toast('请填写垃圾放置位置');
    if (!await ui.confirm('保存固定计划？', '将预留一周内的名额。关闭某场会取消该场今天和未来尚未截止的自动服务。已截止及手动预约不变，主动跳过的日期不会自动恢复。', '保存计划')) return;
    this.setData({ busy: true });
    try { await api.savePlan({ noonEnabled: this.data.noonEnabled, nightEnabled: this.data.nightEnabled, placement: this.data.placement.trim(), remark: this.data.remark.trim() }); ui.toast('计划已保存'); }
    catch (e) { ui.error(e); }
    finally { this.setData({ busy: false }); }
  },
  member() { wx.navigateTo({ url: '/pages/member/index' }); }
});
