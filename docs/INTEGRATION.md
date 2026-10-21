# 前后端对接与正式接入

## 已接通的后端

当前直接使用 `garbage-service` 提供的 `/api/community/list`、家庭地址、订单、月卡、固定计划和支付查询接口，不修改既有后端。

用户令牌通过 Authorization Bearer 传递。响应的 snake_case 字段由 format 层转为页面视图数据；所有金额仍以分为单位传输。

支付恢复依赖本机存储的请求号和 paymentId。设备清缓存或换设备后，单次待支付服务仍可从订单列表恢复。当前后端缺少“我的待支付月卡列表”接口；月卡购买记录丢失时，后端会拒绝重复待支付购买，可在原设备继续或待 15 分钟超时后重新购买。这是现有后端接口的限制。

## 正式模式预留契约（当前 Java 后端尚未实现）

### 微信登录

`wx.login()` 获取 code，然后：

```http
POST /api/user/login
Content-Type: application/json

{"code":"微信临时登录凭证"}
```

期望响应：

```json
{"token":"后端会话令牌","userId":"家庭用户 ID"}
```

后端校验 code，使用可信微信身份映射用户；不能信任客户端传入的 openid 或 userId。

### 微信预支付

已有业务支付单后调用：

```http
POST /api/payment/wechat/prepay
Authorization: Bearer <token>
Content-Type: application/json

{"paymentId":"后端支付单 ID"}
```

期望响应为 `wx.requestPayment` 参数：

```json
{"timeStamp":"秒时间戳","nonceStr":"随机串","package":"prepay_id=...","signType":"RSA","paySign":"后端签名"}
```

真实后端必须检查所有权、金额、过期时间，生成微信预支付参数；通过验签解密回调及主动查单确认到账。小程序在支付后查询 `GET /api/payment/{id}`，只根据后端状态显示成功，不以前端 success 回调判定到账。

退款需对接后端的真实 PaymentGateway，并处理受理、最终成功和失败。当前后端本地 Gateway 返回的成功只是模拟。

### 订阅消息

配置真实可用的 `subscribeTemplateId` 后，订单详情出现用户主动点击的订阅按钮，调用 `wx.requestSubscribeMessage`。后端还需实现真实通知 Gateway、模板字段及授权不足处理；前端授权成功并不代表已发送消息。

## 真机开发调试

模拟器中的 `127.0.0.1` 指开发电脑；手机中的 `127.0.0.1` 指手机自己，不能用来连接电脑。

若需要在可信开发局域网使用 local 模式调试：让后端监听开发电脑可访问的网络地址，并把 config.baseUrl 改为开发电脑局域网 IP。后端可通过 `--server.address=0.0.0.0` 临时开放监听，需同时检查开发工具及真机的网络/域名校验设置。不要把带模拟登录和支付接口的 local 服务开放到公网。

体验版与正式版不允许 local 模式。它们需要真实 HTTPS 后端、合法 request 域名、有效 AppID 和完成联调的真实微信能力。

## 配置清单

- `project.config.json`：自己的 AppID；正式发布恢复域名检查。
- `miniprogram/config.js`：mode=production、真实 HTTPS baseUrl、运营电话/微信、经确认可用的订阅模板。
- 后端：真实微信登录、预支付、回调/查单、收退款和通知实现。
- 运营内容：隐私主体、联系方式、信息保存期限、微信隐私保护指引；根据实际服务范围确认服务规则文案。

## 微信开发者工具与真机验收

1. 导入编译，检查 10 页路由、原生 Tab、不同屏宽、键盘和底部安全区。
2. 登录并登记地址，确认登记后不可自行改地址。
3. 截止前选两场支付，分别查看订单；取消一场只退 ¥1。
4. 支付取消、断网后重试，确认复用原订单。
5. 夜间购买月卡，确认次日生效；续费延长 30 天。
6. 服务日期在月卡有效期内，自动/手动预约不再收费；主动跳过的日期场次不被补跑恢复。
7. 首页今天起共 7 天可切换；每小区每场最多 100 户，固定计划和待支付占位计入容量，满额不可超卖。
7. 检查已完成照片、异常原因、退款处理中/成功显示。
8. 正式微信模式下验证真实登录、支付取消/成功/回调延迟、订阅拒绝，以及真机 HTTPS 域名配置。

参考微信官方文档：

- 项目配置：https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html
- 微信登录：https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html
- 支付接口：https://developers.weixin.qq.com/miniprogram/dev/api/open-api/payment/wx.requestPayment.html
