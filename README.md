# 哔哩哔哩去广告（融合增强）· Surge 模块

> **纯网络 MITM**：只改 HTTP/HTTPS/gRPC 响应。  
> **不修改 App、不涉及越狱/注入。**

## 安装（重要）

Surge **不能** 安装 GitHub 仓库首页链接。  
必须安装 **`.sgmodule` 的 raw 直链**（和 BiliUniverse / app2smile 一样）。

### 推荐安装链接（复制整行）

```text
https://raw.githubusercontent.com/babana0091-sudo/bilibili-adblock-surge/main/bilibili-adblock.sgmodule
```

备用（jsDelivr）：

```text
https://cdn.jsdelivr.net/gh/babana0091-sudo/bilibili-adblock-surge@main/bilibili-adblock.sgmodule
```

### iOS Surge 操作步骤

1. 打开 **Surge** → 底部 **首页**
2. 点 **模块**
3. 点 **安装新模块...**
4. 粘贴上面的 **raw 链接**（以 `raw.githubusercontent.com` 或 `cdn.jsdelivr.net` 开头，以 `.sgmodule` 结尾）
5. 点右上角保存 / 勾选启用
6. 确认模块名显示为：**哔哩哔哩去广告（融合增强）**
7. 开启 **MITM**，并打开 **MITM over HTTP/2**
8. 如已安装其他 B 站去广告模块（如 BiliUniverse），建议先关掉，避免重复处理

### 错误对照

| 现象 | 原因 | 处理 |
|---|---|---|
| `并非有效的 Surge 配置文件` | 装了仓库首页 / HTML / 非 raw 链接 | 改用本文 raw 链接 |
| 模块名是一串 hash、描述「无描述」 | 同上，下载到的不是 sgmodule | 删除该模块，重装 raw 链接 |
| 模块装上了但广告还在 | 未开 HTTP/2 MITM，或与其他模块冲突 | 开 HTTP/2；只保留一个 B 站模块 |

### 不要用这些链接安装

```text
https://github.com/babana0091-sudo/bilibili-adblock-surge
https://github.com/babana0091-sudo/bilibili-adblock-surge.git
https://github.com/babana0091-sudo/bilibili-adblock-surge/blob/main/bilibili-adblock.sgmodule
```

以上都会拿到网页 HTML，Surge 会报「并非有效的配置文件」。

## 功能开关（默认全开）

| 开关 | 作用 |
|---|---|
| **常规广告** | 开屏 / 推荐 / Banner / 搜索 / 直播番剧基础广告 |
| **暂停广告** | 播放页 gRPC 商业卡清理（网络层能清的部分） |
| **小游戏广告** | biligame 广告位、IAA、miniapp ad query、直播小游戏物料 |
| **短剧广告** | Story 竖屏流广告 + playlet 推广 + PGC 投放 |

装好后：模块 → 点本模块 → 参数里可开关。

## 仓库结构

```text
bilibili-adblock.sgmodule   # 给 Surge「安装新模块」用的入口
js/json-response.js
js/proto-response.js
js/common.js
docs/interfaces.md
```

## 能力边界

**能做：** Rule / Map Local / Script 改写网络响应  
**不能做：** 改 IPA、越狱 Hook、控制播放器本地 UI

## License

MIT
