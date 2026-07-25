// http-response: empty pause-ad / cm commercial payloads when ad_pause on.
function parseArgs(raw) {
  const out = { 暂停广告: true, 常规广告: true, ad_pause: true, ad_normal: true, debug: false, 调试日志: false };
  if (raw == null || raw === "") return out;
  let src = raw;
  if (typeof raw === "string") {
    try {
      if (raw.trim().startsWith("{")) src = JSON.parse(raw);
      else {
        const obj = {};
        String(raw).split(/[&,]/).forEach((pair) => {
          const m = pair.match(/^\s*([^:=]+)\s*[:=]\s*(.*)\s*$/);
          if (!m) return;
          obj[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
        });
        src = obj;
      }
    } catch (e) { src = {}; }
  }
  if (typeof src === "object" && src) {
    for (const k of Object.keys(out)) {
      if (src[k] === undefined) continue;
      const v = src[k];
      if (typeof v === "boolean") out[k] = v;
      else if (typeof v === "string") out[k] = !/^(0|false|no|off|关闭|否|#|null|undefined|)$/i.test(v.trim());
      else out[k] = !!v;
    }
  }
  if (out.ad_pause !== undefined) out.暂停广告 = out.ad_pause;
  if (out.ad_normal !== undefined) out.常规广告 = out.ad_normal;
  if (out.debug !== undefined) out.调试日志 = out.debug;
  return out;
}

const opts = parseArgs(typeof $argument !== "undefined" ? $argument : "");
const url = ($request && $request.url) || "";
const on = !!(opts.暂停广告 || opts.常规广告);
if (!on) {
  $done({});
} else {
  if (opts.调试日志) console.log("[BiliAD][pause-resp] empty", url.slice(0, 160));
  const headers = Object.assign({}, ($response && $response.headers) || {});
  headers["Content-Type"] = "application/json; charset=utf-8";
  $done({
    response: {
      status: ($response && $response.status) || 200,
      headers: headers,
      body: '{"code":0,"message":"0","ttl":1,"data":null}',
    },
  });
}
