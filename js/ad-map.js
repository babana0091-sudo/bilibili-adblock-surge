// Empty-response for pure ad endpoints.
// ad_normal / ad_game / ad_pause control which classes are blocked.

function parseArgs(raw) {
  const out = {
    常规广告: true,
    小游戏广告: true,
    暂停广告: true,
    调试日志: false,
    ad_normal: true,
    ad_game: true,
    ad_pause: true,
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
        out[k] = !/^(0|false|no|off|关闭|否|#|null|undefined|)$/i.test(s);
      } else out[k] = !!v;
    }
  }
  if (out.ad_normal !== undefined) out.常规广告 = out.ad_normal;
  if (out.ad_game !== undefined) out.小游戏广告 = out.ad_game;
  if (out.ad_pause !== undefined) out.暂停广告 = out.ad_pause;
  if (out.debug !== undefined) out.调试日志 = out.debug;
  return out;
}

const opts = parseArgs(typeof $argument !== "undefined" ? $argument : "");
const url = ($request && $request.url) || "";

// 2026 播放页暂停广告（BBAdUGCPauseAdPage / requestPauseAdData / CountdownToast）
// 素材与商业接口多在 cm.bilibili.com；另有 vip/ads materials、view/ad
const isCmBiz =
  /(?:^https?:\/\/)?(?:[\w-]+\.)?cm\.bilibili\.com\//i.test(url) ||
  /cm\.bilibili\.com/i.test(url);
const isPauseHint =
  /pause_?ad|paused_?page|under_?player|underframe|PauseAd|pauseAd|brand_?pause|videodetail_paused/i.test(
    url
  );
const isVipMaterials = /vip\/ads\/materials|x\/v2\/view\/ad|x\/v2\/dm\/ad/i.test(url);
const isPauseAd = isCmBiz || isPauseHint || isVipMaterials;

const isGameAd =
  /biligame\.com|miniapp\.bilibili\.com|game-attribute\.biligame\.com|adLiveGame|advertising_position|iaa_ad_style|mini_game_exit/i.test(
    url
  );

let enabled = false;
if (isPauseAd) enabled = !!(opts.暂停广告 || opts.常规广告);
else if (isGameAd) enabled = !!(opts.小游戏广告 || opts.常规广告);
else enabled = !!opts.常规广告;

if (!enabled) {
  if (opts.调试日志) console.log("[BiliAD][map] pass", url.slice(0, 180));
  $done({});
} else {
  if (opts.调试日志)
    console.log(
      "[BiliAD][map] block",
      isPauseAd ? "pause/cm" : isGameAd ? "game" : "normal",
      url.slice(0, 180)
    );
  $done({
    response: {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Connection: "close",
      },
      // 无素材 → 不出现「1秒后将展示广告」倒计时
      body: '{"code":0,"message":"0","ttl":1,"data":null}',
    },
  });
}
