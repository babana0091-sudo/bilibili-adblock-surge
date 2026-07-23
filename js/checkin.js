// Bilibili daily check-in for Surge (network only)
// - type=http-request on fingerprint: capture Cookie / access_key
// - type=cron: try at 00:00 / 10:00 / 19:00 / 21:00 (device local time)
//   First success of the day marks lastRunOk; later slots no-op.
//
// Tasks (best-effort, API may change):
// 1) live DoSign  (GET /xlive/web-ucenter/v1/sign/DoSign)
// 2) exp/reward status
// 3) vip privilege receive (monthly B-coin coupon if eligible)
// 4) silver2coin (optional)
//
// Storage key: bili_adblock_checkin

const STORE_KEY = "bili_adblock_checkin";
const NAME = "哔哩签到";

function parseArgs(raw) {
  const out = {
    自动签到: true,
    银瓜子换硬币: false,
    调试日志: false,
    checkin: true,
    silver2coin: false,
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
      else if (typeof v === "string")
        out[k] = !/^(0|false|no|off|关闭|否|#|null|undefined|)$/i.test(String(v).trim());
      else out[k] = !!v;
    }
  }
  if (out.checkin !== undefined) out.自动签到 = out.checkin;
  if (out.silver2coin !== undefined) out.银瓜子换硬币 = out.silver2coin;
  if (out.debug !== undefined) out.调试日志 = out.debug;
  return out;
}

function log(...a) {
  console.log("[BiliCheckin]", ...a);
}

function notify(title, sub, body) {
  try {
    $notification.post(title, sub || "", body || "");
  } catch (e) {}
}

function readStore() {
  try {
    const raw = $persistentStore.read(STORE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function writeStore(obj) {
  try {
    $persistentStore.write(JSON.stringify(obj), STORE_KEY);
  } catch (e) {
    log("store write fail", e);
  }
}

function getHeader(headers, name) {
  if (!headers) return "";
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return "";
}

function cookieMap(cookie) {
  const o = {};
  String(cookie || "")
    .split(";")
    .forEach((p) => {
      const i = p.indexOf("=");
      if (i < 0) return;
      const k = p.slice(0, i).trim();
      const v = p.slice(i + 1).trim();
      if (k) o[k] = v;
    });
  return o;
}

function http(method, url, headers, body) {
  return new Promise((resolve) => {
    const opt = { url, headers: headers || {}, timeout: 15 };
    if (body != null) opt.body = body;
    const cb = (err, resp, data) => {
      if (err) {
        resolve({ ok: false, err: String(err), status: 0, data: "" });
        return;
      }
      resolve({
        ok: true,
        status: (resp && (resp.status || resp.statusCode)) || 0,
        data: data || "",
        headers: (resp && resp.headers) || {},
      });
    };
    if (method === "POST") $httpClient.post(opt, cb);
    else $httpClient.get(opt, cb);
  });
}

function today() {
  const d = new Date();
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

async function captureCookie(opts) {
  opts = opts || parseArgs(typeof $argument !== "undefined" ? $argument : "");
  if (!opts.自动签到) {
    $done({});
    return;
  }
  const url = ($request && $request.url) || "";
  const headers = ($request && $request.headers) || {};
  const cookie = getHeader(headers, "Cookie") || getHeader(headers, "cookie");
  const auth = getHeader(headers, "Authorization") || "";
  const store = readStore();
  let changed = false;

  if (cookie && cookie.includes("SESSDATA")) {
    if (store.cookie !== cookie) {
      store.cookie = cookie;
      store.cookieUpdatedAt = new Date().toISOString();
      changed = true;
    }
    const m = cookieMap(cookie);
    if (m.bili_jct) store.csrf = m.bili_jct;
    if (m.DedeUserID) store.uid = m.DedeUserID;
  }

  // access_key sometimes appears in query
  try {
    const u = new URL(url);
    const ak = u.searchParams.get("access_key");
    if (ak && store.access_key !== ak) {
      store.access_key = ak;
      changed = true;
    }
  } catch (e) {}

  if (auth && auth.length > 10) {
    store.authorization = auth;
  }

  if (changed) {
    writeStore(store);
    notify(NAME, "Cookie 已更新", "将用于每日自动签到");
    log("cookie updated", store.uid || "");
  }
  $done({});
}

async function doCheckin(opts) {
  const store = readStore();
  if (!store.cookie) {
    notify(NAME, "未捕获 Cookie", "请打开哔哩哔哩 App 首页一次以自动抓取");
    $done({});
    return;
  }
  if (!opts.自动签到) {
    log("auto checkin disabled");
    $done({});
    return;
  }

  const day = today(); // local YYYY-MM-DD; new day => lastRunDay mismatch => runs again
  // Same local day + already succeeded: skip remaining 0/10/19/21 slots.
  // Cross midnight: day string changes, so this is once-per-day, not once-forever.
  if (store.lastRunDay === day && store.lastRunOk) {
    log("already succeeded today, skip slot");
    $done({});
    return;
  }

  const cookie = store.cookie;
  const csrf = store.csrf || cookieMap(cookie).bili_jct || "";
  const baseHeaders = {
    Cookie: cookie,
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BiliApp",
    Referer: "https://www.bilibili.com/",
    Origin: "https://www.bilibili.com",
  };

  const lines = [];
  let okAny = false;

  // 1) Live sign
  try {
    const r = await http(
      "GET",
      "https://api.live.bilibili.com/xlive/web-ucenter/v1/sign/DoSign",
      baseHeaders
    );
    const j = JSON.parse(r.data || "{}");
    if (j.code === 0) {
      okAny = true;
      const d = j.data || {};
      lines.push(
        `直播签到: 成功 (${d.hadSignDays || "?"}/${d.allDays || "?"}天) ${
          d.text || ""
        }`
      );
    } else if (j.code === 1011040) {
      okAny = true;
      lines.push("直播签到: 今日已签");
    } else {
      lines.push(`直播签到: 失败 code=${j.code} ${j.message || j.msg || ""}`);
    }
  } catch (e) {
    lines.push("直播签到: 异常 " + e);
  }

  // 2) Exp reward status
  try {
    const r = await http(
      "GET",
      "https://api.bilibili.com/x/member/web/exp/reward",
      baseHeaders
    );
    const j = JSON.parse(r.data || "{}");
    if (j.code === 0 && j.data) {
      const d = j.data;
      lines.push(
        `经验任务: 登录${d.login ? "✓" : "✗"} 观看${d.watch ? "✓" : "✗"} 分享${
          d.share ? "✓" : "✗"
        } 投币${d.coins || 0}`
      );
    } else {
      lines.push(`经验任务: code=${j.code}`);
    }
  } catch (e) {
    lines.push("经验任务: 异常 " + e);
  }

  // 3) VIP privilege receive (type=1 B-coin coupon) - monthly, ignore if not eligible
  if (csrf) {
    try {
      const body = `type=1&csrf=${encodeURIComponent(csrf)}`;
      const headers = Object.assign({}, baseHeaders, {
        "Content-Type": "application/x-www-form-urlencoded",
      });
      const r = await http(
        "POST",
        "https://api.bilibili.com/x/vip/privilege/receive",
        headers,
        body
      );
      const j = JSON.parse(r.data || "{}");
      if (j.code === 0) {
        okAny = true;
        lines.push("大会员福利: 领取成功");
      } else {
        lines.push(`大会员福利: ${j.message || j.msg || j.code}`);
      }
    } catch (e) {
      lines.push("大会员福利: 异常 " + e);
    }
  }

  // 4) silver2coin optional
  if (opts.银瓜子换硬币 && csrf) {
    try {
      const body = `csrf_token=${encodeURIComponent(
        csrf
      )}&csrf=${encodeURIComponent(csrf)}`;
      const headers = Object.assign({}, baseHeaders, {
        "Content-Type": "application/x-www-form-urlencoded",
      });
      const r = await http(
        "POST",
        "https://api.live.bilibili.com/xlive/revenue/v1/wallet/silver2coin",
        headers,
        body
      );
      const j = JSON.parse(r.data || "{}");
      if (j.code === 0) {
        okAny = true;
        lines.push("银瓜子换硬币: 成功");
      } else {
        lines.push(`银瓜子换硬币: ${j.message || j.msg || j.code}`);
      }
    } catch (e) {
      lines.push("银瓜子换硬币: 异常 " + e);
    }
  }

  store.lastRunDay = day;
  store.lastRunOk = okAny;
  store.lastResult = lines.join(" | ");
  writeStore(store);

  notify(NAME, okAny ? "完成" : "部分失败", lines.join("\n"));
  log(lines.join(" | "));
  $done({});
}

(async () => {
  const opts = parseArgs(typeof $argument !== "undefined" ? $argument : "");
  // Surge distinguishes request vs cron by $request
  if (typeof $request !== "undefined" && $request && $request.url) {
    await captureCookie(parseArgs(typeof $argument !== "undefined" ? $argument : ""));
  } else {
    await doCheckin(opts);
  }
})().catch((e) => {
  log("fatal", e);
  notify(NAME, "脚本异常", String(e));
  $done({});
});
