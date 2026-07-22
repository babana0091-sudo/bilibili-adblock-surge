# 安装说明（Surge）

## 一句话

在 Surge「模块 → 安装新模块」里粘贴：

```text
https://raw.githubusercontent.com/babana0091-sudo/bilibili-adblock-surge/main/bilibili-adblock.sgmodule
```

## 和其他仓库一样的装法

| 仓库 | 安装的是 |
|---|---|
| BiliUniverse ADBlock | `.../BiliBili.ADBlock.sgmodule` 的 **release/raw 文件** |
| app2smile/rules | `.../module/bilibili.sgmodule` 的 **raw 文件** |
| 本仓库 | `.../bilibili-adblock.sgmodule` 的 **raw 文件** |

共同点：**永远是 `.sgmodule` 文件直链，不是 GitHub 仓库页。**

## 图文步骤（iOS）

1. Surge → **模块**
2. **安装新模块...**
3. 粘贴 raw 链接
4. 保存并勾选启用
5. 模块列表应出现：**哔哩哔哩去广告（融合增强）**
6. 开启 MITM + **MITM over HTTP/2**

## 你截图里的问题

- 出现 `19cb4c92...` +「无描述」+「并非有效的 Surge 配置文件」
- 说明当时导入的不是有效 sgmodule 内容（常见是仓库首页 HTML）
- **删掉那个 hash 模块**，改用 raw 链接重装即可
