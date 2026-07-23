# 哔哩哔哩去广告（融合增强）· Surge 模块

> **纯网络 MITM**：只改 HTTP/HTTPS/gRPC 响应 + 可选定时签到。  
> **不修改 App、不涉及越狱/注入。**

## 1) 能不能自动更新？

### 结论

| 安装链接类型 | 能否被 Surge 自动更新 | 例子 |
|---|---|---|
| **分支 raw 永久链**（`.../main/xxx.sgmodule`） | **能**（模块列表可「更新」拉最新文件） | app2smile、ClydeTime 签到模块 |
| **Release 带版本号链**（`.../releases/download/v1.0.1/...`） | **不能自动变到新版本**（URL 钉死版本） | 我们之前的 v1.0.1 release、BiliUniverse 部分 release 资产 |
| GitHub 仓库首页 / blob 页 | 无效 | 会报「并非有效的配置文件」 |

别人能自动更新，是因为他们给的是：

```text
https://raw.githubusercontent.com/<user>/<repo>/<branch>/xxx.sgmodule
```

**不是** release 版本号链接。

### 我们推荐安装（可自动更新）

```text
https://raw.githubusercontent.com/babana0091-sudo/bilibili-adblock-surge/main/bilibili-adblock.sgmodule
```

备用 CDN：

```text
https://cdn.jsdelivr.net/gh/babana0091-sudo/bilibili-adblock-surge@main/bilibili-adblock.sgmodule
```

Release 资产仍可用于「固定某一版」，但不适合日常自动更新。

### iOS 安装步骤

1. Surge → **模块** → **安装新模块...**
2. 粘贴上面的 **raw** 链接（必须以 `.sgmodule` 结尾）
3. 保存并勾选启用
4. 以后要更新：模块右侧 `···` → **更新**（或等 Surge 自动检查）
5. 开启 **MITM + MITM over HTTP/2**

不要用：

```text
https://github.com/babana0091-sudo/bilibili-adblock-surge
.../blob/main/...
.../releases/download/v1.0.1/...   # 固定版本，不自动升到 v1.1
```

---

## 2) 功能开关（中文）

| 开关 | 默认 | 说明 |
|---|---|---|
| **常规广告** | 开 | 开屏/推荐/Banner/搜索/直播番剧基础广告 |
| **暂停广告** | 开 | 播放页 gRPC 商业卡（网络层） |
| **小游戏广告** | 开 | biligame 广告位 / IAA / miniapp ad |
| **短剧广告** | 开 | Story / playlet 推广 |
| **自动签到** | 开 | 抓 Cookie + 每天 7:30 签到 |
| **银瓜子换硬币** | 关 | 签到时可选 |
| **调试日志** | 关 |  |

---

## 3) 自动签到怎么用

完全是 **Surge 脚本 + 网络 API**（参考 ClydeTime / chavyleung 思路，对照 IPA 中 `fingerprint` 等路径），不是越狱。

1. 安装并启用本模块  
2. **完全退出** 哔哩哔哩 App 后重新打开首页一次  
3. 若 Cookie 抓到，会通知「Cookie 已更新」  
4. 每天 **07:30** 自动执行：
   - 直播签到 `DoSign`
   - 查询经验任务状态 `exp/reward`
   - 尝试大会员福利领取 `vip/privilege/receive`（不符合资格会提示失败，可忽略）
   - 可选：银瓜子换硬币

关闭签到：模块参数里把 **自动签到** 设为 `false`。

> 说明：完整「投币/分享/点赞刷经验」链路更复杂且风控更高；当前版本先做**签到核心**（直播签到 + 福利领取 + 状态查询）。需要再加投币可继续迭代。

---

## 仓库结构

```text
bilibili-adblock.sgmodule   # 安装入口（请用 raw 链）
js/json-response.js
js/proto-response.js
js/checkin.js               # 抓 Cookie + 定时签到
js/common.js
docs/interfaces.md
INSTALL.md
```

## 短视频评论一直转圈？

根因：`DOMAIN,cm.bilibili.com,REJECT` 整域拒绝太狠。  
评论半屏广告组件会访问该域，整域拒绝时 UI 可能一直等。

### 当前版本：v1.1.5（详情页轻量化）

- **取消** `DOMAIN,cm.bilibili.com,REJECT`
- **不**对 cm 做 Map Local 空返回（1.1.3 已回退；版本号升到 1.1.4 方便 Surge 直接更新）
- 其它去广告逻辑保持

安装：

```text
https://raw.githubusercontent.com/babana0091-sudo/bilibili-adblock-surge/main/bilibili-adblock.sgmodule
```



## 视频能播、简介/评论一直骨架屏？

这通常**不是**“B站被改去代理”。

本模块 **没有** `PROXY` / 策略组规则，不会强制 B 站走代理。  
更常见原因：

1. 详情页 `View` gRPC 被 **protobuf 脚本全量改写**（CPU/时延高）→ 下方简介/评论等主接口回来了也渲染慢  
2. `api/app.biliapi.*` 被 **整域 REJECT** → 备用 API 失败重试  
3. 同时开了多个 B 站模块 + 全局 MITM，叠加更卡

v1.1.5 已：
- 去掉 `bili-proto`
- 去掉 `biliapi.*` 整域 REJECT
- 保留普通广告 Map Local / JSON 去广告


## License

MIT
