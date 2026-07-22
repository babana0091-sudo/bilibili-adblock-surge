# 哔哩哔哩去广告（融合增强）· Surge 模块

> **纯网络 MITM 方案**：只改 HTTP/HTTPS/gRPC 响应，**不修改 App、不涉及越狱/注入**。  
> 能力边界 = Surge 能做的事（Rule / Map Local / Script / MITM）。

公开仓库，可独立维护。接口线索来自 `tv.danmaku.bilianime` 9.4.0 脱壳 IPA 字符串与公开开源模块交叉验证。

## 功能开关（中文，默认全开）

| 开关 | 默认 | 覆盖（网络层） |
|---|---|---|
| **常规广告** | 开 | 开屏、推荐 Banner/信息流、搜索、直播/番剧基础广告、VIP 广告物料、漫画闪屏、商业域名 |
| **暂停广告** | 开 | 播放页 gRPC 商业 `cm` 字段清理（含 `View`/`PlayPause`）；暂停相关 JSON 关键词兜底 |
| **小游戏广告** | 开 | biligame 广告位 / IAA、小程序 ad query、直播小游戏物料、推荐流 game 卡 |
| **短剧广告** | 开 | Story 竖屏流广告卡、playlet/短剧推广、PGC 活动投放 |

## 安装

1. Surge 安装并信任 MITM 证书  
2. 开启 **MITM** + **MITM over HTTP/2**（B 站 gRPC 必需）  
3. 模块 → 安装：

```text
https://raw.githubusercontent.com/babana0091-sudo/bilibili-adblock-surge/main/bilibili-adblock.sgmodule
```

4. 在模块参数里开关广告类型（中文）

## 仓库结构

```text
bilibili-adblock.sgmodule   # Surge 模块
js/json-response.js          # JSON 响应改写（Surge http-response）
js/proto-response.js         # gRPC/Protobuf 响应改写（binary-body）
js/common.js                 # 共享工具
docs/interfaces.md           # 关键接口备忘
```

## 能力边界（重要）

本模块 **只能**：

- 拦截/伪造/改写 App 发出的 **网络请求与响应**
- 对 JSON 做字段清洗
- 对部分 gRPC protobuf 响应做商业字段剥离
- 用 Map Local / REJECT 阻断广告域名与广告接口

本模块 **不能**：

- 修改 IPA / 注入动态库 / Frida / 越狱 Hook
- 控制播放器本地 UI 状态机
- 100% 消除所有端内渲染、强校验激励广告

暂停广告若仍有残留，通常是端内缓存或非网络下发路径，需要继续抓包补规则，而不是上越狱方案。

## 增强点（相对市面基础模块）

1. **小游戏**：`advertising_position` / `iaa_ad_style_exp` / miniapp ad query / live game material  
2. **短剧**：Story 流 `ad_info` + playlet 推广过滤 + PGC deliver material  
3. **暂停**：gRPC `View`/`PlayPause` 商业 `cm` 清理（网络层能做的部分）

## 致谢

- [app2smile/rules](https://github.com/app2smile/rules)（protobuf runtime 参考，MIT）
- [BiliUniverse/ADBlock](https://github.com/BiliUniverse/ADBlock)
- [Maasea/sgmodule](https://github.com/Maasea/sgmodule)

## License

MIT
