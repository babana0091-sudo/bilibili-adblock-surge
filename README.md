# 哔哩哔哩去广告 · Surge

<p align="center">
  <strong>纯网络 MITM</strong> · 不改包 · 不越狱 · 可自动更新
</p>

适用于 **Surge iOS / Mac** 的哔哩哔哩去广告模块，可选每日自动签到。

## 功能

| 能力 | 说明 |
|:--|:--|
| 常规广告 | 开屏、推荐流、Banner、直播/番剧页等 |
| 暂停广告 | 播放暂停相关商业内容（网络层） |
| 小游戏广告 | biligame / miniapp 广告位 |
| 短剧广告 | 竖屏 Story 流里的 playlet/短剧外推（含下载引导类） |
| 自动签到 | 抓 Cookie，每日多时段尝试直播签到等 |
| 风控上报 | 可选拦截 Gaia 设备上报（默认关） |

> 仅处理网络请求/响应。端内本地 UI 广告无法 100% 保证。

## 安装（推荐，可自动更新）

```text
https://raw.githubusercontent.com/babana0091-sudo/bilibili-adblock-surge/main/bilibili-adblock.sgmodule
```

1. Surge → **模块** → **安装新模块…**
2. 粘贴上方 **raw** 链接（必须以 `.sgmodule` 结尾）
3. 启用模块
4. 开启 **MITM**，并打开 **MITM over HTTP/2**
5. 以后更新：模块 → **更新**

固定某一版可用 Releases 资产；日常请用 raw `main` 链以便自动更新。

## 参数

| 参数 | 默认 | 含义 |
|:--|:--:|:--|
| `ad_normal` | true | 常规广告 |
| `ad_pause` | true | 暂停广告 |
| `ad_game` | true | 小游戏广告 |
| `ad_drama` | true | 短剧广告 |
| `checkin` | true | 自动签到 |
| `silver2coin` | false | 银瓜子换硬币 |
| `block_risk` | false | 拦截 Gaia 风控上报 |
| `debug` | false | 调试日志 |

参数键使用 **ASCII**（`ad_normal` 等），说明可用中文。

### 自动签到

1. 启用模块并打开 App 首页一次（抓取 Cookie）
2. 按 **北京时间（Asia/Shanghai）** 在 **0:00 / 10:00 / 19:00 / 21:00** 各尝试一次（与手机系统时区无关）
   - **当日（北京时间）任一时段成功** → 标记成功，后续时段跳过
   - 失败则下一时段继续尝试
   - 次日北京时间 0 点起重新开始（按日期，不是终身只签一次）
3. 不需要时将 `checkin` 设为 `false`

Cookie 仅保存在本机 `$persistentStore`，不会外传。

#### 直播签到入口在哪？

本模块**不点 App 按钮**，直接调直播签到 API：

```text
GET https://api.live.bilibili.com/xlive/web-ucenter/v1/sign/DoSign
```

App 内对应能力一般在：**直播 Tab / 直播中心 → 签到**。  
模块侧：脚本 `js/checkin.js`；cron 每小时整点触发，脚本内用北京时间过滤到 0/10/19/21。

## 仓库结构

```text
bilibili-adblock.sgmodule   # 模块入口
js/                        # 脚本
LICENSE                    # AGPL-3.0
```

## 开发

请在 **`dev`** 分支开发与提交，不要直接往 `main` 推实验改动。稳定后再合并到 `main`。

## 免责声明与侵权投诉

### 免责声明

1. 本项目仅供学习、研究网络代理与 Surge 模块编写使用，**请勿用于任何违反法律法规或平台服务协议的行为**。
2. 使用本模块可能违反哔哩哔哩用户协议或相关规定，由此产生的账号风险、功能异常、数据损失等，均由使用者自行承担。
3. 作者不对模块的可用性、准确性、完整性作任何明示或默示保证；因使用或无法使用本项目造成的任何直接/间接损失，作者不承担责任。
4. 请在下载、安装、使用前自行评估风险；继续使用即视为已阅读并同意本声明。

### 侵权投诉

若权利人认为本仓库内容侵犯其合法权益，请通过邮件联系，并尽量提供：

- 权利人身份与联系方式
- 被侵权内容的具体位置（链接 / 文件路径）
- 权属证明与侵权说明
- 希望的处理方式（下架、修改、标注等）

**投诉邮箱：** [babana0091@gmail.com](mailto:babana0091@gmail.com)

收到有效通知后，将尽快核实并处理。

## License

[GNU Affero General Public License v3.0](LICENSE)

Copyright (c) 2026 babana0091-sudo
