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
| 短剧广告 | Story / playlet 推广 |
| 自动签到 | 抓 Cookie，每日定时直播签到等 |
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
2. 每天 **07:30** 自动执行直播签到等任务
3. 不需要时将 `checkin` 设为 `false`

Cookie 仅保存在本机 `$persistentStore`，不会外传。

## 仓库结构

```text
bilibili-adblock.sgmodule   # 模块入口
js/                        # 脚本
LICENSE                    # AGPL-3.0
```

## 开发

请在 **`dev`** 分支开发与提交，不要直接往 `main` 推实验改动。稳定后再合并到 `main`。

## License

[GNU Affero General Public License v3.0](LICENSE)

Copyright (c) 2026 babana0091-sudo
