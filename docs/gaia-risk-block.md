# Gaia 风控上报拦截说明（v1.2.0）

## 目标

阻断 B 站 Gaia 设备/环境上报，**请求不要打到后端**。

## IPA 确认接口

- `https://api.bilibili.com/x/internal/gaia-gateway/ExClimbKunLun`
- `https://api.bilibili.com/x/internal/gaia-gateway/ExClimbCongLing`
- `https://api.bilibili.com/x/internal/gaia-gateway/ExBadBasket`

## 实现方式

### 不用 Map Local 空返回
Map Local 虽不访问上游内容，但语义是“本地成功响应”。用户要求的是**拦截上报**。

### 使用 `type=http-request` 脚本短接
`js/gaia-block.js`：

- `拦截风控上报=true`：`$done({ response: { status: 404, body: "" } })`
  - Surge 直接本地结束该请求，**不访问后端**
- `拦截风控上报=false`：`$done({})` 放行

## 开关能力

Surge `#!arguments` 是**文本替换**，不是“条件编译整段 Map Local”。

| 写法 | 能否开关 |
|---|---|
| 纯 Map Local 行 | **不能**直接绑定布尔开关（没有 if） |
| Script + `argument=键={{{键}}}` | **能** |
| Rule 行 | 通常也不能按模块布尔参数条件生效 |

因此“给 Map Local 装开关”原生不支持；可开关的做法是改成 **Script 拦截**。

## 限制

1. 只能挡网络上报，挡不了纯本地判断。
2. 若业务强依赖上报成功后的 token/voucher，硬拦截可能导致部分页面更脆；可用开关关闭对比。
3. 搜索主接口本身被服务端拒绝时，拦上报不一定恢复搜索。
