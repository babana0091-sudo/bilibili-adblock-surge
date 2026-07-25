# 播放页框下广告 gRPC 结构（IPA 反编译 + 抓包交叉验证）

> 抓包：`2026-07-26-065201.surgearchive`（含目标框下广告）  
> IPA：`bilibili 9.4.0` `bili-universal`  
> 目标：只改播放页广告相关结构，其它 gRPC 不动  

---

## 0. 一句话结论

**能找到，而且已经对上了。**

框下「广告 · 评分 x/5」**不是**单独的 `PlayPause` 请求，而是塞在：

```text
POST https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/View
Content-Type: application/grpc
grpc-encoding: gzip
```

响应里 **`ViewReply` 顶层 field 7** 的商业模块（CM）中。  
IPA 侧对应 **`BAPIAppViewuniteV1CM` / `cmUnderPlayer` + `bilibili.ad.v1.SourceContentDto`**。

本包 **没有** `PlayPause` RPC；暂停大页若出现，可能另走 `PlayPause`，但**你标的框下广告链路 = View 内嵌**。

---

## 1. 抓包里的关键请求

| # | 方法 | 作用 | 与框下广告 |
|:--|:--|:--|:--|
| **000094** | `.../viewunite.v1.View/View` | 播放页主数据 | **广告本体在这里**（resp ~43KB gzip → 196KB proto） |
| 000093 | `.../playerunite.v1.Player/PlayViewUnite` | 播放器/清晰度等 | 非框下卡片主数据 |
| 000098 | `.../View/ViewProgress` | 进度 | 无关 |
| 000104+ | `cm.bilibili.com/cm/api/fees/wise` | 计费/曝光类 | 本包 resp 仅 44B（多半已被空返回） |
| 多条 | `cm.../conversion/mobile/v2` | 转化上报 | 非下发卡片 |
| 000074 | `cm.../landing_pages/...` | 落地页 | 辅助 |

**只改广告时，gRPC 白名单建议仅：**

```text
^https://grpc\.biliapi\.net/bilibili\.app\.viewunite\.v1\.View/View$
```

（可选再加 `PlayPause`，本包未出现。）

---

## 2. gRPC 帧格式（本包实测）

```text
[1 byte compressed=1][4 byte BE length][gzip payload]
```

- 1 帧  
- gunzip 后 **196334** bytes = `ViewReply` protobuf  

---

## 3. ViewReply 顶层 field map（本包）

| Field | wire | size | 含义（交叉 IPA） |
|:--|:--|:--|:--|
| 1 | len | 593 | 基础/配置类 |
| 2 | len | 273 | 小模块 |
| 3 | len | 2 | 极小 |
| 4 | len | 1429 | 中等 |
| **5** | len | **158759** | 主内容（简介 Tab 等，`ViewUgcAny`） |
| 6 | len | 475 | 含 `type.googleapis.com/bilibili.app.viewunite.ugcanymodel.ViewUgcAny` |
| **7** | len | **34681** | **CM / 框下广告容器（目标）** |
| 10 | len | 重复小段 | 辅助 repeated |

**鲁棒策略：删/清空顶层 field 7**，比深挖 `SourceContentDto` 每个子 field 更稳（简介主要在 field 5）。

---

## 4. ViewReply.field 7 = CM 广告容器（核心）

### 4.1 结构（抓包还原）

```text
message /* CM-like, IPA: BAPIAppViewuniteV1CM 相关 */ {
  // field 2: google.protobuf.Any
  //   type_url = "type.googleapis.com/bilibili.ad.v1.AdsControlDto"
  //   value    = AdsControlDto 字节（本包仅 2 bytes 量级控制信息）
  Any ads_control = 2;

  // field 5: repeated 卡片包装（本包 3 张框下/相关商业卡）
  repeated UnderPlayerCard source_cards = 5;
}

message UnderPlayerCard /* 包装层 */ {
  // field 1: Any
  //   type_url = "type.googleapis.com/bilibili.ad.v1.SourceContentDto"
  //   value    = SourceContentDto（~10–12KB，含文案/评分/下载/投诉链）
  Any source_content = 1;

  // field 2: 可选 varint（本包 card1 = 1）
  // field 3: 可选小 msg（本包 card1 含「播放/弹幕」展示类）
}
```

### 4.2 本包 3 张卡内容指纹（证明就是 UI 广告）

| # | 可见文案/标记 | 备注 |
|:--|:--|:--|
| 1 | **「广告」**、**「评分4.6/5」**、游戏名、App Store、投诉/屏蔽 | 与截图「广告 · 评分4.6/5」一致 |
| 2 | **「广告」**、**「评分4.7/5」**、**「立即下载>>」** | 下载类框下 |
| 3 | **「广告」**、拼多多跳转 | 电商类 |

`SourceContentDto` 内（在 Any.value 里）出现的 field 号集合（本包）：

```text
1,2,3,4,5,6,7,8,9
```

深层 UI 文案多在 **`9 → 3 → 11/10/38/42...`** 嵌套中（含「广告」「评分」「屏蔽广告」）。  
**完整 SourceContentDto 每个子字段语义仍需更多样本**；去广告不必解全，见 §6。

### 4.3 AdsControlDto（f7.2）

```text
type_url: bilibili.ad.v1.AdsControlDto
value: 本包几乎为空控制（解析见 field 4 = varint 60）
```

---

## 5. IPA 反编译对齐（提高鲁棒性的「源结构」）

### 5.1 包名 / Any type URL（二进制字符串）

```text
bilibili.app.viewunite.v1
bilibili.app.viewunite.common
bilibili.app.viewunite.ugcanymodel
bilibili.ad.v1

type.googleapis.com/bilibili.ad.v1.AdsControlDto     ✅ 抓包命中
type.googleapis.com/bilibili.ad.v1.SourceContentDto  ✅ 抓包命中
type.googleapis.com/bilibili.ad.v1.Tab2ExtraDto      （IPA 有，本包未出现在 f7）
type.googleapis.com/bilibili.ad.v1.TabExtraDto
```

### 5.2 类 / 属性（ObjC·Swift 符号）

```text
BAPIAppViewuniteV1ViewReply
BAPIAppViewuniteV1CM
BAPIAppViewuniteV1PauseAds / PauseBar / PlayPauseReq|Reply   # 暂停页族（本包未用）
BAPIAdV1SourceContentDto
BAPIAdV1AdsControlDto
BAPIAdV1Tab2ExtraDto

AdUGCCMModel:
  cmUnderPlayerDto : Tab2ExtraDto
  cmHalfPanelDto   : Tab2ExtraDto
  sourceContentItemArray
  adsControlDto    : AdsControlDto

runtime:
  cmUnderPlayer / hasCmUnderPlayer
  sourceContentItemArray
  adsControl / ads_control
```

**对齐关系（推断 + 抓包验证）：**

| UI / IPA | 抓包位置 |
|:--|:--|
| 框下广告列表 `sourceContentItemArray` | **ViewReply.f7  repeated f5** → Any `SourceContentDto` |
| `adsControl` | **ViewReply.f7.f2** → Any `AdsControlDto` |
| `cmUnderPlayer` / Tab2Extra | 可能在 SourceContent 内部或其它版本；本包卡片已是 SourceContentDto 直出 |
| `PauseAds` / PlayPause | **另一条 RPC/字段**；框下广告不依赖它 |

---

## 6. 推荐改写策略（只动播放页广告）

### 6.1 匹配范围（窄）

```text
host: grpc.biliapi.net
path: /bilibili.app.viewunite.v1.View/View
```

其它 `DM/DmView`、`PlayViewUnite`、`ContinuousPlay` 等 **不碰**。

### 6.2 算法（按稳健性排序）

**方案 A（推荐，最鲁棒）**

1. 解析 gRPC 帧，`compressed==1` 则 gunzip  
2. 解析 `ViewReply`，**删除整个 field 7**（或写成 empty message）  
3. 重新 gzip + 封 gRPC 帧返回  

理由：本包所有框下 `SourceContentDto` 都在 f7；简介大块在 f5。

**方案 B（更细）**

1. 保留 f7 壳  
2. 删除 f7 内所有 field 5  
3. 清空 f7 field 2（AdsControl Any）  

**方案 C（类型指纹，跨版本）**

递归处理 protobuf：

- 若遇到 `google.protobuf.Any` 且 `type_url` 含  
  `bilibili.ad.v1.SourceContentDto` / `AdsControlDto` / `Tab2ExtraDto`  
  → 删除该 Any 或整段 repeated 元素  

即使 field 号漂移，**type_url 字符串仍稳**（IPA + 抓包双确认）。

### 6.3 Surge 实现要点

```text
type=http-response
binary-body-mode=true
requires-body=true
max-size 建议 ≥ 512KB～1MB（本包解压后 ~196KB，gzip 帧 ~43KB）
仅 pattern View/View
```

### 6.4 风险

| 风险 | 缓解 |
|:--|:--|
| 误删简介 | **只删 field 7 / 只删 ad type_url**，勿动 field 5 |
| field 号变更 | 方案 C 用 type_url |
| 多 frame / 无压缩 | 帧解析要兼容 `compressed=0/1` |
| 历史「简介空白」 | 因曾粗暴改整包 View；现改为 **定点删 f7** |

---

## 7. 本包未覆盖但 IPA 有的（暂停大页）

```text
PlayPauseReq / PlayPauseReply
PauseAds / PauseAdsAV / PauseBar / PauseSourceContentList
BBAdUGCPauseAdPage / requestPauseAdData
```

若以后暂停全屏广告仍在，需再抓 **暂停瞬间** 是否出现：

```text
.../viewunite.v1.View/PlayPause
```

或 View 内其它 field 的 `PauseAds`。

---

## 8. 与当前 HTTP 模块关系

| 层 | 作用 |
|:--|:--|
| `cm.bilibili.com` 空返回 | 挡二次拉取/计费；**挡不住已在 View 里的卡** |
| JSON `PauseAds` 字段清理 | 仅 JSON 路径 |
| **View/View 删 field 7** | **对本包框下广告是对症** |

本包里 `fees/wise` 已是 44 字节级空响应，但框下卡仍在 → **证实广告预嵌在 gRPC View**。

---

## 9. 产物与复现

- 抓包路径：用户 `2026-07-26-065201.surgearchive`  
- 关键 dump：`.../View/View/response.dump`  
- 本地可复现脚本思路：`parse grpc frame → gunzip → walk protobuf field 7`  

---

## 10. 状态

| 项 | 状态 |
|:--|:--|
| 真实 gRPC path | ✅ `View/View` |
| 广告所在 field | ✅ **顶层 7** |
| IPA 类型对齐 | ✅ CM / SourceContentDto / AdsControlDto / cmUnderPlayer 族 |
| 完整 .proto 每一字段名 | ⚠ 部分（足够做删除式去广告） |
| 已上线 Surge gRPC 改写 | ❌ 本文仅结构；实现需另开 dev 开发与真机验证 |

**下一步（若你点头）：** 在 **仅 dev** 写 `binary-body-mode` 脚本，只匹配 `View/View`，删除 field 7 或 ad Any，版本 bump 后你测简介是否仍正常、框下广告是否消失。
