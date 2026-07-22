# 安装与自动更新

## 请用这条（可自动更新）

```text
https://raw.githubusercontent.com/babana0091-sudo/bilibili-adblock-surge/main/bilibili-adblock.sgmodule
```

## 为什么别人的能更新

他们装的是 **GitHub raw 分支文件**：

- app2smile: `raw.githubusercontent.com/.../master/module/bilibili.sgmodule`
- ClydeTime 签到: `raw.githubusercontent.com/.../main/modules/BiliBiliDailyBonus.sgmodule`

Surge 保存的是这个 URL；点更新时重新下载同一路径最新内容。

## 为什么 release 链不适合日常更新

```text
.../releases/download/v1.0.1/bilibili-adblock.sgmodule
```

URL 里写死了 `v1.0.1`，发 v1.2 时旧 URL 仍指向旧文件，**不会自动跳版本**。

## 操作

1. 模块 → 安装新模块 → 粘贴 raw 链  
2. 以后：模块 → 更新  
3. 开 MITM + HTTP/2
