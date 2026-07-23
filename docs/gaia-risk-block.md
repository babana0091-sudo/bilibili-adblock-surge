# Gaia 风控上报拦截说明

## 目标

阻断 B 站 Gaia 设备/环境上报，减少“代理/异常环境”指纹上传。

## IPA 中确认的接口

- `https://api.bilibili.com/x/internal/gaia-gateway/ExClimbKunLun`
  - 设备信息上报（`report device info`）
- `https://api.bilibili.com/x/internal/gaia-gateway/ExClimbCongLing`
  - 加密 payload 上报；同区有 captcha/token 回调
- `https://api.bilibili.com/x/internal/gaia-gateway/ExBadBasket`
  - 异常环境相关上报；同区有 `kCFProxyTypeNone`、jailbreak 路径痕迹

## 策略

对上述接口 **Map Local**：
- status 200
- body `{}`

不用 hard REJECT，避免客户端因网络失败疯狂重试。

## 限制

1. 这只能挡**网络上报**，挡不了纯本地判断。
2. 若搜索主接口本身被风控码拒绝（如需验证码），空返回上报不一定能让搜索恢复。
3. 验证码展示链路（captcha UI）未主动伪造，避免把搜索彻底卡死。

## 同时修复

v1.1.9 起不再空返回：
- `/x/v2/search/square`
- `search recommend_words`

这两项更像搜索入口依赖，不是纯广告。
