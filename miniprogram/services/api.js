const { request } = require('../utils/request');
const part = value => encodeURIComponent(value);
module.exports = {
  catalog: () => request('/api/catalog', 'GET', undefined, { public: true }),
  localLogin: nickname => request('/local/login', 'POST', { nickname }, { public: true }),
  wechatLogin: (code, phoneCode) => request('/api/user/login', 'POST', { code, phoneCode }, { public: true, timeout: 30000 }),
  localIdentity: () => request('/local/identity'),
  submitCommunity: body => request('/api/community/applications', 'POST', body),
  communityApplications: (page = 1, size = 20) => request(`/api/community/applications?page=${page}&size=${size}`),
  communities: () => request('/api/community/list'),
  address: () => request('/api/address/default'),
  fillFloor: floor => request('/api/address/floor', 'PUT', { floor }),
  saveAddress: body => request('/api/address/save', 'POST', body),
  availability: date => request(`/api/order/availability?serviceDate=${part(date)}`),
  createOrder: body => request('/api/order/create', 'POST', body),
  orders: (page = 1, size = 20) => request(`/api/order/list?page=${page}&size=${size}`),
  order: id => request(`/api/order/${part(id)}`),
  cancel: id => request(`/api/order/${part(id)}/cancel`, 'POST'),
  skip: id => request(`/api/member/order/${part(id)}/skip`, 'POST'),
  payment: id => request(`/api/payment/${part(id)}`),
  localPay: id => request(`/local/payments/${part(id)}/pay`, 'POST'),
  prepay: id => request('/api/payment/wechat/prepay', 'POST', { paymentId: id }),
  member: () => request('/api/member/current'),
  buyMember: body => request('/api/member/buy', 'POST', typeof body === 'string' ? { requestKey: body } : body),
  plan: () => request('/api/member/plan'),
  savePlan: body => request('/api/member/plan/save', 'POST', body)
};
