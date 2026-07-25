# B 站播放页 gRPC / Protobuf 结构（从 IPA 反查）

> 来源：`bilibili_9.4.0` 解密 IPA 主二进制 `bili-universal` 字符串 / ObjC·Swift 符号  
> 目的：评估「只改播放页广告、不动其它 gRPC」是否可行  
> **本文件不是完整 .proto**（字段号未从二进制直接解出），是 **消息图 + 广告相关类型清单**。

## 1. 结论先说

| 问题 | 结论 |
|:--|:--|
| IPA 里有没有 gRPC/protobuf 结构痕迹？ | **有**（大量 `BAPI…` GPB 消息类 + `type.googleapis.com/bilibili…`） |
| 能不能一次反出带 field number 的完整 `.proto`？ | **目前不能**（无可读 `FieldNumber` 常量、无内嵌 `.proto` 文本） |
| 对改广告有没有用？ | **有用**：已定位「播放页广告」挂在哪些 message / Any 类型上 |
| 下一步还要什么？ | **一次真实 View/PlayPause 抓包** + 按 field 扫描 / 或 descriptor 工具 |

## 2. 相关 package（二进制内字符串）

```
bilibili.app.viewunite.v1
bilibili.app.viewunite.common
bilibili.app.viewunite.ugcanymodel / pgcanymodel / pugvanymodel
bilibili.app.playerunite.v1
bilibili.app.view.v1          # 旧 View
bilibili.ad.v1                # 商业 DTO（框下/暂停页）
```

`type.googleapis.com` 已确认：

```
type.googleapis.com/bilibili.ad.v1.AdsControlDto
type.googleapis.com/bilibili.ad.v1.SourceContentDto
type.googleapis.com/bilibili.ad.v1.Tab2ExtraDto
type.googleapis.com/bilibili.ad.v1.TabExtraDto
```

## 3. 播放页主响应（ViewUnite）

核心响应类型（符号名）：

```
BAPIAppViewuniteV1ViewReply
```

与广告强相关的子类型（同一命名空间 `…V1`）：

| 类型 | 含义（从命名 + 调用链推断） |
|:--|:--|
| `PauseAds` | 暂停广告集合 |
| `PauseAdsAV` | 暂停广告稿件 AV |
| `PauseBar` | 暂停条 / 倒计时条相关 |
| `PauseSourceContentList` | 暂停广告 source_content 列表 |
| `PauseType` | 暂停广告类型枚举 |
| `PlayPauseReq` / `PlayPauseReply` | **独立 PlayPause RPC**（暂停时再拉） |
| `CM` | 商业模块容器 |
| `SourceContentItem` / `SourceContentAV` / `SourceContentType` | 广告素材项 |
| `RelateCM` / `PadRelateCM` / `RelateLiveCM` | 相关推荐里的商业卡 |
| `FloorAdSearchReq/Reply/Item/Tab` | 框下/楼层广告搜索 |
| `Material` / `PointMaterial` | 素材 |
| `DeliveryData`（Common） | 投放数据 |

App 广告侧模型（非 GPB 名，但挂 View 数据）：

```
AdUGCCMModel
  - cmUnderPlayerDto : BAPIAdV1Tab2ExtraDto   // 框下
  - cmHalfPanelDto   : BAPIAdV1Tab2ExtraDto   // 半屏
  - sourceContentItemArray
  - adsControlDto    : BAPIAdV1AdsControlDto
```

属性名（运行时）：

```
cmUnderPlayer / cmUnderPlayerDto
cmHalfPanel
sourceContent / source_contents
adsControl / ads_control
pauseBar / pauseAdData / pauseBcmAdInfo
```

## 4. bilibili.ad.v1（暂停页 / 框下商业）

已出现的 DTO 族：

```
Tab2ExtraDto          # 框下/半屏扩展（cmUnderPlayer 用这个）
TabExtraDto
AdsControlDto
SourceContentDto
BrandPausePageDto / BrandPauseLoopCardDto / BrandPauseLoopImageDto / …
PauseAdLandingPage / PauseAdHeaderComponent / PauseAdBottomComponent /
PauseAdForm / PauseAdProductComponent / PauseAdRelateVideos / …
```

这与「暂停后展开大页 + 倒计时 toast」UI 模块 `BBAdUGCPauseAdPage` 一致。

## 5. 可能的 RPC 面（推断，路径字符串未完整写出）

二进制 **没有** 直接扫到完整  
`/bilibili.app.viewunite.v1.View/View` 字符串，但有：

- package `bilibili.app.viewunite.v1`
- `ViewReply` / `ViewReq` / `PlayPauseReq` / `PlayPauseReply` / `FloorAdSearch*`
- App 使用 Moss/gRPC 客户端模式

**实操匹配建议（Surge pattern，待抓包确认）：**

```
grpc.biliapi.net
app.biliapi.net
# path 常见形态（需抓包核对）：
# /bilibili.app.viewunite.v1.View/View
# /bilibili.app.viewunite.v1.View/PlayPause
# /bilibili.app.viewunite.v1.View/FloorAdSearch
# 或 bilibili.app.playerunite.v1.*
```

**策略：只 hook 上述 method，其它 gRPC 一律不碰。**

## 6. 为什么还没有完整 .proto 字段号

IPA 里：

- ✅ 消息类名、属性、Any type URL  
- ❌ 几乎没有 `Xxx_FieldNumber_Yyy = N` 明文  
- ❌ 没有 `syntax = "proto3"` 源文件  
- 字段布局在 GPB descriptor **二进制表**里，需专用解析或对真实 payload 做 field scan

因此：**结构骨架有了，字段号地图还没有。**

## 7. 「有了结构就能改」——可行性

```
能做：
  1) 只匹配播放页相关 gRPC method
  2) binary-body-mode 取 body
  3) 拆 gRPC length-prefixed frames
  4) 在 protobuf 层：
     - 清空/删除已知广告 submessage（一旦有 field number）
     - 或启发式：去掉 type.googleapis.com/bilibili.ad.v1.* 的 Any
     - 或把 PauseAds / CM under player 对应 field 置空

风险（已有教训）：
  - field 搞错 → 简介空白 / 播放页骨架异常
  - 必须只改广告 field，禁止整包乱删
  - 响应可能压缩 / 多 frame / 较大，受 Surge max-size 限制
```

## 8. 建议的下一步（最小成本）

1. **你抓 1 份**：打开任意视频详情页 + 暂停 1 次 的 Surge archive  
2. 我从中抽出：
   - 真实 gRPC path  
   - ViewReply / PlayPause 原始二进制  
3. 对 payload 做 **protobuf wire 扫描**（field number + wire type + 嵌套）  
4. 对照本文件类型名，标出 **广告 field 号**  
5. 再写 **仅 View/PlayPause** 的 `binary-body-mode` 脚本（只 dev）

在没有真实包之前：**不要上线 gRPC 改写**（容易再次弄坏简介）。

## 9. 当前模块应对（非 gRPC）

在拿到 field map 前，继续：

- 空 `cm.bilibili.com`  
- JSON 清 `PauseAds` / `cmUnderPlayer` 等（仅 JSON 路径）  
- **不** 对全站 gRPC REJECT  

---

*生成自 IPA 静态分析；字段号待抓包补全。*


---

## 更新：抓包交叉验证（2026-07-26）

详见 **[viewunite-underplayer-ad-structure.md](./viewunite-underplayer-ad-structure.md)**。

结论摘要：框下广告在 `View/View` 响应 **field 7**（CM + `SourceContentDto` Any），不是 PlayPause。
