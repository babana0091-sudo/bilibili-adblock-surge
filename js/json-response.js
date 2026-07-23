// Bilibili ADBlock - JSON response rewriter
// Handles splash / feed / story / search / live / pgc / banner / vip ads / mini-game

const DEFAULTS = {
  常规广告: true,
  暂停广告: true,
  小游戏广告: true,
  短剧广告: true,
  调试日志: false,
  // ASCII aliases (v1.2.4+ module args)
  ad_normal: true,
  ad_pause: true,
  ad_game: true,
  ad_drama: true,
  debug: false,
};

function parseArgs(raw) {
  const out = Object.assign({}, DEFAULTS);
  if (raw == null || raw === "") return out;
  let src = raw;
  if (typeof raw === "string") {
    try {
      if (raw.trim().startsWith("{")) src = JSON.parse(raw);
      else {
        const obj = {};
        String(raw)
          .split(/[&,]/)
          .forEach((pair) => {
            const m = pair.match(/^\s*([^:=]+)\s*[:=]\s*(.*)\s*$/);
            if (!m) return;
            obj[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
          });
        src = obj;
      }
    } catch (e) {
      src = {};
    }
  }
  if (typeof src === "object" && src) {
    for (const k of Object.keys(out)) {
      if (src[k] === undefined) continue;
      const v = src[k];
      if (typeof v === "boolean") out[k] = v;
      else if (typeof v === "string")
        out[k] = !/^(0|false|no|off|关闭|否|#|null|undefined|)$/i.test(String(v).trim());
      else out[k] = !!v;
    }
  }
  // Normalize ASCII -> Chinese
  if (out.ad_normal !== undefined) out.常规广告 = out.ad_normal;
  if (out.ad_pause !== undefined) out.暂停广告 = out.ad_pause;
  if (out.ad_game !== undefined) out.小游戏广告 = out.ad_game;
  if (out.ad_drama !== undefined) out.短剧广告 = out.ad_drama;
  if (out.debug !== undefined) out.调试日志 = out.debug;
  return out;
}

function log(enabled, ...args) {
  if (enabled) console.log("[BiliAD][json]", ...args);
}


/**
 * 竖屏 Story 流「红果广告短剧」整卡识别。
 *
 * 从点击埋点 original_json 还原的推流 item 形态（猜测与 feed/index/story 一致）：
 * {
 *   goto: "vertical_av",          // 竖屏播放
 *   card_goto: "ad_av",           // 广告 av 卡（普通视频多为 vertical_av）
 *   card_type: "cm_v2",           // 商业卡类型
 *   idx, title, desc, uri,
 *   args: { up_id, up_name, aid },
 *   player_args: { duration, aid, type:"av", cid },
 *   three_point: { dislike_reasons: [...] },
 *   // 推流里常见额外字段（埋点侧也有）：
 *   // ad_info / ad_cb / is_ad / from_spmid / creative_id
 *   // uri 常带 ad_story_extra、creative_id、from_spmid=ad.tianma...
 * }
 * 普通竖屏视频对照：card_goto/goto 多为 vertical_av，card_type 非 cm_v2，无 ad_info。
 * 策略：整卡从 data.items 移除，而不是只去下载条。
 */
function isHongguoOrAdStory(item) {
  if (!item || typeof item !== "object") return false;
  const cardGoto = String(item.card_goto || "").toLowerCase();
  const goto = String(item.goto || item.type || item.cardType || "").toLowerCase();
  const cardType = String(item.card_type || item.cardType || "").toLowerCase();
  const uri = String(
    item.uri || item.link || item.jump_url || item.blink || item.route || ""
  );
  const title = String(
    item.title || item.desc || item.subtitle || item.rcmd_reason || ""
  );
  const desc = String(item.desc || "");
  const up = String(
    (item.args && (item.args.up_name || item.args.rname)) ||
      item.up_name ||
      item.author_name ||
      ""
  );
  const spmid = String(
    item.from_spmid ||
      item.spmid ||
      (item.three_point_v2 && item.three_point_v2.spmid) ||
      ""
  );
  const text = title + desc + up;
  const blob = (
    cardGoto +
    " " +
    goto +
    " " +
    cardType +
    " " +
    uri +
    " " +
    text +
    " " +
    spmid +
    " " +
    JSON.stringify(item.ad_info || {}) +
    " " +
    String(item.ad_story_extra || "") +
    " " +
    String(item.track_id || item.trackid || "")
  ).toLowerCase();

  // A. 红果文案 / UP（最稳）
  if (/红果/.test(text + uri) || blob.includes("hongguo")) return true;
  if (/免费短剧|海量短剧|热门短剧/.test(text)) return true;

  // B. 天马广告位 spmid
  if (spmid.includes("ad.tianma") || blob.includes("ad.tianma")) return true;

  // C. 商业 cm 卡 + 竖屏 av（抓包：card_type=cm_v2 + goto=vertical_av）
  if (
    (cardType === "cm_v2" || cardType.startsWith("cm")) &&
    (goto === "vertical_av" || cardGoto === "ad_av" || /story\//.test(uri))
  ) {
    return true;
  }

  // D. 明确广告 av 卡
  if (cardGoto === "ad_av" || cardGoto.startsWith("ad_")) return true;
  if (goto === "ad_av" || (goto.startsWith("ad_") && /av|story|vertical/.test(goto + uri)))
    return true;

  // E. uri 广告参数（ad_story_extra / creative_id + story）
  if (
    /ad_story_extra|creative_id=|from_spmid=ad\./i.test(uri) &&
    (/story\//.test(uri) || goto === "vertical_av" || cardGoto.includes("ad"))
  ) {
    return true;
  }

  // F. 通用广告字段 + 短剧/竖屏特征
  if (item.ad_info || item.ad_cb || item.is_ad || item.is_ad_loc) {
    if (
      /红果|短剧|playlet|tianma|snssdk|download|story|vertical_av|ad_av/.test(blob)
    )
      return true;
  }

  return false;
}

function isAdItem(item, opts) {
  if (!item || typeof item !== "object") return false;
  // 红果/天马广告短剧：整卡删除（彻底刷不到）
  if ((opts.短剧广告 || opts.常规广告) && isHongguoOrAdStory(item)) return true;
  if (item.ad_info || item.ad_cb || item.is_ad || item.is_ad_loc)
    return opts.常规广告;
  const goto = String(
    item.card_goto || item.goto || item.type || item.cardType || ""
  ).toLowerCase();
  const cardType = String(item.card_type || item.cardType || "").toLowerCase();
  const uri = String(
    item.uri || item.link || item.jump_url || item.blink || item.route || ""
  );

  // game / mini-game promo cards
  if (
    goto === "game" ||
    goto.includes("game") ||
    cardType.includes("game") ||
    /biligame|mini_game|minigame|gamecenter|game_center|applet\/game|small_game/i.test(
      uri
    )
  ) {
    return opts.小游戏广告 || opts.常规广告;
  }

  // short drama / playlet promo (Story 竖屏流里的短剧/外跳推广)
  // 含 playlet 链接、短剧 goto、红果等外链下载引导时，在 ad_drama 开启下剔除
  const title = String(
    item.title || item.desc || item.subtitle || item.rcmd_reason || ""
  );
  const extraText = String(
    (item.args && (item.args.up_name || item.args.rname)) ||
      item.up_name ||
      item.author_name ||
      ""
  );
  if (
    opts.短剧广告 ||
    opts.常规广告
  ) {
    if (
      /playlet|comic_drama|short_play|shortplay|bilibili:\/\/(pgc\/)?drama|bilibili:\/\/comic|hongguo|redfruit|free.?short.?play/i.test(
        uri
      ) ||
      /playlet|drama|short_play|shortplay|ogv_playlet/.test(goto) ||
      /playlet|drama|short_play/.test(cardType) ||
      /红果|免费短剧|短剧免费|海量短剧/.test(title + extraText) ||
      item.playlet_info ||
      item.playlet ||
      item.short_play_info
    ) {
      // 明确广告卡 / 外跳推广卡
      if (
        item.ad_info ||
        item.ad_cb ||
        item.is_ad ||
        item.is_ad_loc ||
        item.badge === "广告" ||
        item.badge_text === "广告" ||
        goto.startsWith("ad") ||
        cardType.startsWith("cm") ||
        /download|appstore|itunes|market:|hongguo|playlet|short_play|drama/i.test(
          uri
        )
      ) {
        return true;
      }
    }
  }

  // generic ads
  if (
    goto.startsWith("ad") ||
    goto.includes("ad_") ||
    [
      "ad_web_s",
      "ad_av",
      "ad_web_gif",
      "ad_player",
      "ad_inline_3d",
      "ad_inline_eggs",
      "ad_inline_av",
    ].includes(goto)
  ) {
    return opts.常规广告;
  }
  if (cardType.startsWith("cm") || cardType.includes("ad")) return opts.常规广告;
  if (Array.isArray(item.banner_item)) {
    if (
      item.banner_item.some(
        (b) =>
          String(b.type || "").toLowerCase() === "ad" ||
          b.is_ad ||
          b.ad_cb ||
          b.ad_info
      )
    ) {
      return opts.常规广告;
    }
  }
  return false;
}

function cleanArray(arr, opts) {
  if (!Array.isArray(arr)) return arr;
  return arr.filter((it) => !isAdItem(it, opts)).map((it) => cleanObject(it, opts));
}

function cleanObject(node, opts) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return cleanArray(node, opts);
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (opts.常规广告 && /^(ad_info|ad_cb|ads|advertisement|cm_info)$/i.test(k))
      continue;
    if (
      opts.暂停广告 &&
      /(pause_?ad|paused?_?page|under_?player|underframe|player_?ad)/i.test(k)
    ) {
      if (v && typeof v === "object") {
        out[k] = Array.isArray(v) ? [] : null;
        continue;
      }
    }
    if (
      opts.小游戏广告 &&
      /(mini_?game|small_?game|game_?ad|ad_live_game)/i.test(k) &&
      typeof v === "object"
    ) {
      out[k] = Array.isArray(v) ? [] : null;
      continue;
    }
    if (
      opts.短剧广告 &&
      /(playlet_?ad|short_?play_?ad|drama_?ad)/i.test(k) &&
      typeof v === "object"
    ) {
      out[k] = Array.isArray(v) ? [] : null;
      continue;
    }
    if (Array.isArray(v)) out[k] = cleanArray(v, opts);
    else if (v && typeof v === "object") out[k] = cleanObject(v, opts);
    else out[k] = v;
  }
  return out;
}

function handleSplash(body, opts) {
  if (!opts.常规广告) return body;
  if (body.data) {
    if (body.data.show) body.data.show = [];
    if (body.data.event_list) body.data.event_list = [];
    if (body.data.list) body.data.list = [];
    if (body.data.max_time != null) body.data.max_time = 0;
    if (body.data.min_interval != null) body.data.min_interval = 31536000;
    if (body.data.pull_interval != null) body.data.pull_interval = 31536000;
  }
  return body;
}

function handleFeed(body, opts, url) {
  // 推流：{ code, data: { items: [ storyItem, ... ] } }
  // 红果广告 item 见 isHongguoOrAdStory 注释中的结构体还原
  if (!body.data) return body;
  const isStory = /feed\/index\/story/i.test(url);
  // story/cart 等纯购物/推广挂件：可直接清空
  if (isStory && /\/story\/cart/i.test(url) && (opts.常规广告 || opts.短剧广告)) {
    if (body.data && typeof body.data === "object") {
      body.data = Array.isArray(body.data) ? [] : {};
    }
    return body;
  }
  if (Array.isArray(body.data.items)) {
    body.data.items = body.data.items.filter((item) => {
      if (isAdItem(item, opts)) return false;
      if (isStory) {
        const goto = String(item.card_goto || item.goto || "").toLowerCase();
        const uri = String(item.uri || item.link || item.jump_url || "");
        // 整卡移除：红果/天马/ad_av 广告短剧（不只去链接）
        if ((opts.短剧广告 || opts.常规广告) && isHongguoOrAdStory(item)) return false;
        // 竖屏流广告卡
        if ((opts.短剧广告 || opts.常规广告) && (goto.startsWith("ad") || item.ad_info || item.ad_cb))
          return false;
        // 短剧/外链下载推广
        if (
          opts.短剧广告 &&
          (/playlet|short_play|shortplay|hongguo|drama|ad_story|tianma/i.test(goto + uri) ||
            /红果|免费短剧|海量短剧|热门短剧/.test(
              String(item.title || "") +
                String(item.desc || "") +
                String((item.args && item.args.up_name) || item.up_name || "")
            ))
        ) {
          return false;
        }
        // 清除 story 购物/挂件推广字段
        if (opts.常规广告 || opts.短剧广告) {
          delete item.story_cart_icon;
          delete item.story_cart;
          delete item.story_cart_info;
          if (item.three_point) {
            // keep structure, strip ad-like entries if array
          }
        }
      }
      if (opts.小游戏广告) {
        const goto = String(item.card_goto || item.goto || "").toLowerCase();
        if (goto === "game" || String(item.card_type || "").includes("game"))
          return false;
      }
      return true;
    });
  }
  // 清理 story 流顶层挂件
  if (isStory && (opts.常规广告 || opts.短剧广告)) {
    for (const k of Object.keys(body.data)) {
      if (/story_cart|cart_icon|playlet_ad|short_play_ad|drama_ad/i.test(k)) {
        body.data[k] = Array.isArray(body.data[k]) ? [] : null;
      }
    }
  }
  if (Array.isArray(body.data.banner_item) && opts.常规广告) {
    body.data.banner_item = body.data.banner_item.filter(
      (b) =>
        String(b.type || "").toLowerCase() !== "ad" && !b.is_ad && !b.ad_cb
    );
  }
  return body;
}

function handleSearchSquare(body, opts) {
  if (!opts.常规广告 || !body.data) return body;
  if (Array.isArray(body.data)) body.data = body.data.filter((x) => !isAdItem(x, opts));
  if (body.data && typeof body.data === "object") {
    for (const key of ["list", "items", "square", "recommend", "trending_list"]) {
      if (Array.isArray(body.data[key]))
        body.data[key] = cleanArray(body.data[key], opts);
    }
  }
  return body;
}

function handlePGC(body, opts) {
  const root = body.result || body.data;
  if (!root) return body;
  if (Array.isArray(root.modules)) {
    root.modules = root.modules.map((mod) => {
      if (!mod) return mod;
      const style = String(mod.style || "");
      const mid = mod.module_id;
      if (opts.常规广告 && (style.startsWith("tip") || [241, 1283, 1441, 1284].includes(mid))) {
        mod.items = [];
      }
      if (Array.isArray(mod.items)) {
        mod.items = mod.items.filter((it) => {
          if (!it) return false;
          if (opts.常规广告 && isAdItem(it, opts)) return false;
          if (opts.短剧广告) {
            const link = String(it.link || it.blink || it.uri || "");
            if (
              /playlet|comic_drama|short_play/i.test(link) &&
              (it.badge === "广告" || it.is_ad || it.ad_info)
            )
              return false;
          }
          return true;
        });
      }
      return mod;
    });
  }
  if (opts.常规广告 && root.activity_banner) root.activity_banner = null;
  return body;
}

function handleLive(body, opts) {
  if (!body.data) return body;
  if (opts.常规广告) {
    delete body.data.activity_banner_info;
    if (body.data.function_card) {
      for (const k of Object.keys(body.data.function_card))
        body.data.function_card[k] = null;
    }
    if (Array.isArray(body.data.card_list)) {
      body.data.card_list = body.data.card_list.filter(
        (c) => c && c.card_type !== "banner_v2" && !isAdItem(c, opts)
      );
    }
  }
  if (opts.小游戏广告) {
    if (body.data.ad_live_game) body.data.ad_live_game = null;
    if (body.data.game_info) {
      if (body.data.game_info.ad) delete body.data.game_info.ad;
      if (body.data.game_info.advertising) delete body.data.game_info.advertising;
    }
  }
  return body;
}

function handleVipMaterials(body, opts) {
  if (!opts.常规广告) return body;
  body.data = null;
  body.code = -404;
  body.message = "-404";
  return body;
}

function handleBanner(body, opts) {
  if (!opts.常规广告) return body;
  if (Array.isArray(body.data)) body.data = [];
  if (body.data && Array.isArray(body.data.list)) body.data.list = [];
  return body;
}

const opts = parseArgs(typeof $argument !== "undefined" ? $argument : "");
const url = ($request && $request.url) || "";
log(opts.调试日志, "url=", url);

// All ad toggles off: true pass-through (no parse/re-stringify).
if (!opts.常规广告 && !opts.暂停广告 && !opts.小游戏广告 && !opts.短剧广告) {
  $done({});
} else if (!$response || $response.body == null || $response.body === "") {
  // Upstream already empty/failed — do not rewrite (homepage feed case)
  console.log("[BiliAD][json] empty/missing body pass-through");
  $done({});
} else {
  let bodyText = $response.body;
  if (typeof bodyText !== "string") {
    try {
      bodyText = bodyText.toString("utf8");
    } catch (e) {
      $done({});
    }
  }
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (e) {
    log(opts.调试日志, "json parse fail");
    $done({});
  }

  try {
    if (/x\/v2\/splash\//i.test(url)) body = handleSplash(body, opts);
    else if (/x\/v2\/feed\/index/i.test(url)) body = handleFeed(body, opts, url);
    else if (
      /x\/v2\/search\/square/i.test(url) ||
      /search_svr\/v\d\/Search\/recommend_words/i.test(url)
    )
      body = handleSearchSquare(body, opts);
    else if (
      /pgc\/page\//i.test(url) ||
      /pgc\/view\/v2\/story\/season/i.test(url) ||
      /pgc\/view\/v2\/app\/season/i.test(url)
    )
      body = handlePGC(body, opts);
    else if (
      /xlive\/app-room\/v1\/index\/getInfoByRoom/i.test(url) ||
      /xlive\/app-interface\/v2\/index\/feed/i.test(url) ||
      /adLiveGame\/getAdLiveGameMaterial/i.test(url)
    )
      body = handleLive(body, opts);
    else if (/x\/vip\/ads\/materials/i.test(url))
      body = handleVipMaterials(body, opts);
    // patch/tab is home tab config — never wipe (was empty-returning via ad-map/json)
    else if (/x\/v2\/banner/i.test(url)) body = handleBanner(body, opts);
    else if (/x\/web-interface\/wbi\/index\/top\/feed\/rcmd/i.test(url))
      body = handleFeed(body, opts, url);
    else {
      // unmatched: do not deep-clean
      $done({});
      return;
    }
  } catch (e) {
    log(opts.调试日志, "handle error", e);
    $done({});
    return;
  }

  try {
    $done({ body: JSON.stringify(body) });
  } catch (e) {
    log(opts.调试日志, "stringify fail", e);
    $done({});
  }
}
