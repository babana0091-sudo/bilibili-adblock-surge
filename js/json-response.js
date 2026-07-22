// Bilibili ADBlock - JSON response rewriter
// Handles splash / feed / story / search / live / pgc / banner / vip ads / mini-game

const DEFAULTS = {
  常规广告: true,
  暂停广告: true,
  小游戏广告: true,
  短剧广告: true,
  调试日志: false,
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
        out[k] = !/^(0|false|no|off|关闭|否)$/i.test(v);
      else out[k] = !!v;
    }
  }
  return out;
}

function log(enabled, ...args) {
  if (enabled) console.log("[BiliAD][json]", ...args);
}

function isAdItem(item, opts) {
  if (!item || typeof item !== "object") return false;
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

  // short drama / playlet promo
  if (
    /playlet|comic_drama|short_play|shortplay|bilibili:\/\/(pgc\/)?drama|bilibili:\/\/comic/i.test(
      uri
    ) ||
    /playlet|drama|short_play/.test(goto) ||
    /playlet|drama/.test(cardType)
  ) {
    if (
      item.ad_info ||
      item.badge === "广告" ||
      item.badge_text === "广告" ||
      item.is_ad ||
      goto.startsWith("ad") ||
      cardType.startsWith("cm")
    ) {
      return opts.短剧广告 || opts.常规广告;
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
  if (!body.data) return body;
  const isStory = /feed\/index\/story/i.test(url);
  if (Array.isArray(body.data.items)) {
    body.data.items = body.data.items.filter((item) => {
      if (isAdItem(item, opts)) return false;
      if (isStory) {
        const goto = String(item.card_goto || item.goto || "").toLowerCase();
        if ((opts.短剧广告 || opts.常规广告) && (goto.startsWith("ad") || item.ad_info))
          return false;
        if (item.story_cart_icon && opts.常规广告) delete item.story_cart_icon;
      }
      if (opts.小游戏广告) {
        const goto = String(item.card_goto || item.goto || "").toLowerCase();
        if (goto === "game" || String(item.card_type || "").includes("game"))
          return false;
      }
      return true;
    });
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

if (!$response || $response.body == null) {
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
    return;
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
    else if (
      /x\/vip\/ads\/materials/i.test(url) ||
      /x\/resource\/(top\/activity|patch\/tab)/i.test(url)
    )
      body = handleVipMaterials(body, opts);
    else if (/x\/v2\/banner/i.test(url)) body = handleBanner(body, opts);
    else if (/x\/web-interface\/wbi\/index\/top\/feed\/rcmd/i.test(url))
      body = handleFeed(body, opts, url);
    else {
      // 未识别接口：直接放行，避免 deep clean 拖慢评论区/播放页附属请求
      $done({});
      return;
    }
  } catch (e) {
    // fail-open：改写异常时不阻断原响应
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
