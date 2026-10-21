const api = require('../../services/api');
const ui = require('../../utils/ui');
const f = require('../../utils/format');
Page({
  data: { loading: true, error: '', busy: false, address: null, communities: [], names: [], selectedIndex: -1, floor: '', building: '', unit: '', room: '', placement: '家门口' },
  onShow() { this.refresh(); },
  refresh() { return ui.load(this, async () => {
    const selected = this.data.communities[this.data.selectedIndex];
    const [address, communities] = await Promise.all([api.address(), api.communities()]);
    const community = address && communities.find(c => c.id === address.community_id);
    this.setData({ address: address && { ...address, displayText: f.addressText(address) }, selectedIndex: selected ? communities.findIndex(c => c.id === selected.id) : -1, communities, names: communities.map(c => c.name), communityName: community ? community.name : '已登记小区' });
  }); },
  input(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  select(event) { this.setData({ selectedIndex: Number(event.detail.value) }); },
  async save() {
    if (this.data.busy || this.data.address) return;
    const d = this.data;
    if (d.selectedIndex < 0 || !d.building.trim() || !d.room.trim() || !d.placement.trim()) return ui.toast('请填写小区、楼栋、房号和放置位置');
    if (!/^[1-9][0-9]*$/.test(String(d.floor)) || Number(d.floor) > 2147483647) return ui.toast('请填写正整数楼层');
    const ok = await ui.confirm('确认家庭地址', `${d.names[d.selectedIndex]} ${f.addressText(d)} · ${d.floor}层\n登记后如需修改，请联系客服。`, '确认登记');
    if (!ok) return;
    this.setData({ busy: true });
    try { await api.saveAddress({ floor: Number(d.floor), communityId: d.communities[d.selectedIndex].id, building: d.building.trim(), unit: d.unit.trim(), room: d.room.trim(), placement: d.placement.trim() }); wx.switchTab({ url: '/pages/home/index' }); }
    catch (e) { ui.error(e); if (e.code === 'CONTACT_SUPPORT') this.refresh(); }
    finally { this.setData({ busy: false }); }
  },
  async fillFloor() {
    if (this.data.busy) return;
    const floor = this.data.floor;
    if (!/^[1-9][0-9]*$/.test(String(floor)) || Number(floor) > 2147483647) return ui.toast('请填写正整数楼层');
    if (!await ui.confirm('确认楼层', `家庭所在楼层：${floor}层。补填后如需修改，请联系客服。`, '确认补填')) return;
    this.setData({ busy: true });
    try { await api.fillFloor(Number(floor)); await this.refresh(); }
    catch(e) { ui.error(e); }
    finally { this.setData({ busy: false }); }
  },
  applyCommunity() { wx.navigateTo({ url: '/pages/community-apply/index' }); },
  support() { wx.navigateTo({ url: '/pages/support/index' }); }
});
