# 接口备忘（网络层）

来源：`tv.danmaku.bilianime` 9.4.0 脱壳 IPA 字符串扫描 + 公开模块对照。  
仅列出 **可用 Surge MITM 处理** 的 HTTP/gRPC 路径。

## 常规广告

- `/x/v2/splash/list|show|event/list2|brand/list`
- `/x/v2/feed/index`
- `/x/v2/banner`
- `/x/v2/dm/ad`
- `/x/vip/ads/materials`
- `/x/resource/deeplink/ad`
- `cm.bilibili.com/*`
- `manga.bilibili.com/twirp/comic.v*.Comic/Flash`

## 暂停广告（网络侧）

- gRPC：`bilibili.app.viewunite.v1.View/View` 内商业 `cm` / `sourceContent`
- gRPC：`.../PlayPause`（若同通道下发商业卡）
- 端内模型名（仅供对照，非脚本）：`BAPIAdV1PauseAd*`、`under_player`、`underframe`
- 说明：端内 UI 状态无法由 Surge 直接关闭；本模块只清网络下发的商业字段

## 小游戏广告

- `line*-h5-mobile-api.biligame.com/.../advertising_position`
- `.../iaa_ad_style_exp`
- `.../mini_game_exit_popup`
- `miniapp.bilibili.com/.../ad/position/query`
- `miniapp.bilibili.com/.../client/ad/query`
- `api.live.bilibili.com/.../getAdLiveGameMaterial`
- 推荐流：`card_goto=game`

## 短剧广告

- `/x/v2/feed/index/story*`
- `/pgc/view/v2/story/season`
- `/pgc/activity/deliver/material/receive`
- playlet 推广卡（带广告标记时过滤）

## MITM 主机

```
app.bilibili.com, api.bilibili.com, grpc.biliapi.net,
api.live.bilibili.com, api.vc.bilibili.com, manga.bilibili.com,
cm.bilibili.com, miniapp.bilibili.com,
line1-h5-mobile-api.biligame.com, line3-h5-mobile-api.biligame.com,
game-attribute.biligame.com, app.biligame.com
```
