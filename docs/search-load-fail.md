# 搜索“加载失败”分析（IPA 9.4.0 + 模块对照）

## App 侧触发条件（反编译/字符串）

搜索结果页失败 UI 不是“广告没出来就报错”，而是通用空态/错误态：

- `BFCEmptyDataSet_string1 = 网络出错了...`
- `BFCEmptyDataSet_string2 = 请检查网络连接`
- `BBPegasus_string79 = 页面加载失败，请重试`
- `BBPegasus_string7 = 加载失败啦!`
- 搜索相关状态/组件：`SearchError` / `SearchRequestError` / `SearchIntentRetryContentLoad` / `SearchResultEmptyView` / `EmptyDataSetState`

判定逻辑（工程上）：
1. 搜索主请求失败（超时/断连/非 2xx/业务 code 异常）→ 展示失败空态 + 重试
2. 成功但无结果 → 空结果页（不是“加载失败”）
3. 重试后成功 → 与用户现象一致

## 模块是否误伤搜索主接口

主结果接口：
- `/x/v2/search`
- `/x/v2/search/type`
- gRPC `Search/SearchAll`

对照 v1.1.7：
- **Script 不匹配** 上述主结果接口
- 但存在：
  1. `DOMAIN, api/app.biliapi.net/com ,REJECT`  
     App 二进制含 `api.biliapi.net` / `app.biliapi.net`，搜索可能 fallback 到这些域。整域 REJECT → 偶发失败，重试切主域后成功。
  2. `URL Rewrite` hard reject `Search/DefaultWords`  
     影响搜索默认词/入口，不直接等于结果页，但会造成搜索链路异常态。
  3. Map Local 空返回 `search/square` / `recommend_words`  
     影响发现/推荐词，不是结果主接口。

## 怀疑 1：广告没加载导致搜索失败？

**低概率作为主因。**

- 搜索失败文案来自通用网络错误空态，不是广告组件文案
- 广告相关是 `Inter_ad.strings` / `BBAd_*`，与搜索失败不是同一套
- 搜索主结果接口未被广告 Map Local 直接改写

广告请求失败更可能导致“少广告卡”，而不是“整个搜索加载失败”。

## 怀疑 2：反广告暗桩专门制裁插件？

**有风控/环境检测，但未见“专门检测 Surge 去广告脚本”的明确字符串。**

IPA 中存在：
- Gaia 风控：`/x/internal/gaia-gateway/ExClimbKunLun`、`ExClimbCongLing`、`ExBadBasket`
- `BFCRiskControl` / captcha / geetest / `v_voucher`
- 通用环境：`frida`/`jailbreak`/`mitm`/`SSLPin`/`integrity`/`debugger`

这说明：
- 有设备上报、验证码、风控券（voucher）链路
- 有证书锁定/注入检测痕迹
- **没有**找到类似 `adblock_detected => fail_search` 的直接业务开关字符串

因此更像：
- 网络失败/备用域被拒/MITM 抖动 → 普通失败重试
- 或风控验证码链路偶发（通常会有验证码 UI，不完全是纯“加载失败”）

“重试几次又成功”更符合 **瞬时网络/域名 fallback/并发失败**，不太像稳定的“永久制裁开关”。

## 绕过/修复建议

1. **取消 biliapi 整域 REJECT**（已在 1.1.8）
2. **取消 DefaultWords hard reject**（已在 1.1.8）
3. 搜索主结果接口保持不改写
4. 若仍偶发：查 Surge 最近请求里搜索 URL 的策略/耗时/状态码，区分直连失败还是代理失败
5. 若出现验证码/voucher，再单独处理 Gaia 链路（那是风控，不是广告空字段）
