# 哔哩哔哩去广告（融合增强）

<p align="center">
  <b>Surge 纯网络 MITM 模块</b><br/>
  不改包 · 不越狱 · 支持自动更新
</p>

面向 **Surge iOS / Mac** 的哔哩哔哩网络层去广告方案，打开 App 时后台自动签到（大积分/经验分享等）。

## 功能概览

| 功能 | 说明 |
|:--|:--|
| 常规广告 | 开屏、推荐信息流、Banner、部分直播/番剧商业位等 |
| 暂停广告 | 播放暂停相关商业内容（网络层清理） |
| 小游戏广告 | biligame / miniapp 等广告位 |
| 短剧广告 | 竖屏 Story 流中的红果等推广卡尽量整卡移除 |
| 自动签到 | 捕获登录态后，按北京时间多时段尝试大积分签到等 |
| 大积分签到 | 大会员账号可顺带尝试大积分相关签到 |
| 风控上报 | 可选拦截 Gaia 设备上报类请求（默认关闭） |

> 本模块只改写/拦截**网络请求与响应**。端内写死的 UI 广告无法保证 100% 去掉。

## 安装

推荐使用 raw 链接安装，便于后续在 Surge 内一键更新：

```text
https://raw.githubusercontent.com/babana0091-sudo/bilibili-adblock-surge/main/bilibili-adblock.sgmodule
```

1. 打开 Surge → **模块** → **安装新模块…**
2. 粘贴上方链接（需以 `.sgmodule` 结尾）
3. 启用本模块
4. 开启 **MITM**，并打开 **MITM over HTTP/2**（gRPC / 部分接口需要）
5. 之后可在模块列表中点 **更新**

也可从 [Releases](https://github.com/babana0091-sudo/bilibili-adblock-surge/releases) 下载固定版本的 `.sgmodule`。

## 参数说明

在模块参数中配置（键名为英文，界面说明可为中文）：

| 参数 | 默认 | 含义 |
|:--|:--:|:--|
| `ad_normal` | true | 常规广告 |
| `ad_pause` | true | 暂停广告 |
| `ad_game` | true | 小游戏广告 |
| `ad_drama` | true | 短剧 / Story 推广 |
| `checkin` | true | 自动签到 |
| `silver2coin` | false | 银瓜子换硬币 |
| `block_risk` | false | 拦截 Gaia 风控上报 |
| `debug` | false | 调试日志 |

## 自动签到说明

1. 启用 `checkin` 后，打开哔哩哔哩 App 首页一次，模块会捕获登录态（App 侧多为 `access_key`，不一定有浏览器 Cookie）。
2. 打开哔哩哔哩 App 时自动尝试签到（**无定时任务**）；**北京时间当天成功一次后**当天不再重复。
3. 签到**失败会立即通知**；成功也会通知一次。
4. - 请使用官方 Surge，并保持模块与脚本资源可正常访问 GitHub raw。
- 若首页或播放异常，可先关闭本模块对照，再检查是否开启了全局 MITM 抓包（`*`）等额外配置。
- 日志中可搜索 `[BiliCheckin]`、`[BiliAD]` 查看脚本输出（视 Surge 版本在「日志」中查看）。

## 仓库结构

```text
bilibili-adblock.sgmodule   # 模块入口
js/                        # 去广告与签到脚本
LICENSE                    # AGPL-3.0
```

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
