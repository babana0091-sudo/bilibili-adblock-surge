// Optional empty-response for pure ad endpoints (replaces always-on Map Local).
// Only active when 常规广告 / 小游戏广告 is true. Otherwise true pass-through.

function parseArgs(raw) {
  const out = {
    常规广告: true,
    小游戏广告: true,
    调试日志: false,
    ad_normal: true,
    ad_game: true,
    debug: false,
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
      else if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        // Surge sometimes uses # / 0 / false for off
        out[k] = !/^(0|false|no|off|关闭|否|#|null|undefined|)$/i.test(s);
      } else out[k] = !!v;
    }
  }
  if (out.ad_normal !== undefined) out.常规广告 = out.ad_normal;
  if (out.ad_game !== undefined) out.小游戏广告 = out.ad_game;
  if (out.debug !== undefined) out.调试日志 = out.debug;
  return out;
}

const opts = parseArgs(typeof $argument !== "undefined" ? $argument : "");
const url = ($request && $request.url) || "";

const isGameAd =
  /biligame\.com|miniapp\.bilibili\.com|game-attribute\.biligame\.com|adLiveGame|advertising_position|iaa_ad_style|mini_game_exit/i.test(
    url
  );
const enabled = isGameAd ? opts.小游戏广告 || opts.常规广告 : opts.常规广告;

if (!enabled) {
  if (opts.调试日志) console.log("[BiliAD][map] pass-through", url);
  $done({});
} else {
  if (opts.调试日志) console.log("[BiliAD][map] empty", url);
  $done({
    response: {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Connection: "close",
      },
      body: "{}",
    },
  });
}
