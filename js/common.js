// Bilibili ADBlock Surge - shared helpers
// Compatible with Surge / Loon script runtime

function parseArgs(raw) {
  const out = {
    常规广告: true,
    暂停广告: true,
    小游戏广告: true,
    短剧广告: true,
    调试日志: false,
  };
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
  if (enabled) console.log("[BiliAD]", ...args);
}

function isTruthyAdCard(item) {
  if (!item || typeof item !== "object") return false;
  if (item.ad_info || item.ad_cb || item.cm || item.cm_info) return true;
  const goto = String(
    item.card_goto || item.goto || item.type || ""
  ).toLowerCase();
  const cardType = String(item.card_type || item.cardType || "").toLowerCase();
  if (
    goto.startsWith("ad") ||
    goto.includes("ad_") ||
    goto === "game" ||
    goto.includes("ad_av") ||
    goto.includes("ad_web")
  )
    return true;
  if (cardType.startsWith("cm") || cardType.includes("ad")) return true;
  if (
    Array.isArray(item.banner_item) &&
    item.banner_item.some(
      (b) => String(b.type || "").toLowerCase() === "ad" || b.is_ad || b.ad_cb
    )
  )
    return true;
  const uri = String(item.uri || item.link || item.jump_url || item.blink || "");
  if (
    /playlet|comic_drama|bilibili:\/\/(pgc\/)?drama|bilibili:\/\/comic/i.test(
      uri
    )
  )
    return "playlet";
  if (
    /biligame|mini_game|minigame|gamecenter|game_center|applet\/game/i.test(
      uri
    )
  )
    return "game";
  return false;
}

function deepCleanAds(node, opts) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node
      .map((x) => deepCleanAds(x, opts))
      .filter((x) => {
        if (x == null) return false;
        if (typeof x !== "object") return true;
        const kind = isTruthyAdCard(x);
        if (!kind) return true;
        if (kind === true && opts.常规广告) return false;
        if (kind === "game" && (opts.小游戏广告 || opts.常规广告)) return false;
        if (kind === "playlet" && (opts.短剧广告 || opts.常规广告)) return false;
        return true;
      });
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (
      opts.常规广告 &&
      /^(ad_info|ad_cb|ads|advertisement|cm_info|source_content|sourcecontent)$/i.test(
        k
      )
    ) {
      continue;
    }
    if (
      opts.暂停广告 &&
      /^(pause_ad|pausead|paused_page|pausedpage|under_player|underplayer|underframe|player_ad|playerad)$/i.test(
        k
      )
    ) {
      continue;
    }
    if (
      opts.小游戏广告 &&
      /^(mini_game|minigame|game_ad|gamead|small_game|ad_live_game)$/i.test(k)
    ) {
      continue;
    }
    if (
      opts.短剧广告 &&
      /^(playlet|short_play|shortplay|drama_ad|comic_drama)$/i.test(k)
    ) {
      continue;
    }
    out[k] = deepCleanAds(v, opts);
  }
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { parseArgs, log, isTruthyAdCard, deepCleanAds };
}
