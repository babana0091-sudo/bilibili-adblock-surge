// Gaia risk-report interceptor for Surge
// type=http-request on gaia-gateway/*
// - 拦截风控上报=true  : short-circuit, DO NOT hit backend
// - 拦截风控上报=false : pass-through ($done({}))

function parseArgs(raw) {
  const out = {
    拦截风控上报: true,
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

const opts = parseArgs(typeof $argument !== "undefined" ? $argument : "");
const url = ($request && $request.url) || "";

if (!opts.拦截风控上报) {
  if (opts.调试日志) console.log("[BiliAD][gaia] pass-through", url);
  $done({});
} else {
  // Short-circuit: request never reaches api.bilibili.com backend.
  // Prefer non-200 so client does not treat report as accepted success.
  if (opts.调试日志) console.log("[BiliAD][gaia] blocked (no upstream)", url);
  $done({
    response: {
      status: 404,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Connection: "close",
      },
      body: "",
    },
  });
}
