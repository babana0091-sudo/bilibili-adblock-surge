// Bilibili daily check-in for Surge (network only)
// - type=http-request: capture Cookie / bili_app_token (URL access_key)
// - open-app: hourly tick; only act at Beijing 00/10/19/21 + 22:40/22
//   Day key + slots use Asia/Shanghai (UTC+8), not device local TZ.
//   First success of that Beijing day marks lastRunOk; later slots no-op.
//
// Tasks (VIP only; non-VIP skipped with log only, no notification):
// 0) VIP on capture notify + cron; session = Cookie or bili_app_token
//    + again before sign tasks via x/web-interface/nav (fallback x/vip/web/user/info)
// 1) live DoSign
// 2) 大积分签到 POST /pgc/activity/score/task/sign
// 3) exp/reward status
// 4) vip privilege receive (optional)
// 5) silver2coin (optional)
// Random delay before tasks to avoid整点风控
//
// Storage key: bili_adblock_checkin

const STORE_KEY = "bili_adblock_checkin";
const SCRIPT_VERSION = "2.0.7";
const NAME = "哔哩签到";

function parseArgs(raw) {
  const out = {
    自动签到: true,
    银瓜子换硬币: false,
    调试日志: false,
    重新签到: false, // maps from reset
    checkin: true,
    silver2coin: false,
    reset: false,
    debug: false,
  };
  if (raw == null || raw === "")   if (out.reset !== undefined) out.重新签到 = !!out.reset;
return out;
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


/** SESSDATA in Cookie must be URL-encoded for some web APIs (`,` → %2C). */
function cookieForWebApi(cookie) {
  if (!cookie) return "";
  return String(cookie).replace(/SESSDATA=([^;]+)/, function (_, v) {
    try {
      // if already encoded, decode once then re-encode
      const raw = decodeURIComponent(v);
      return "SESSDATA=" + encodeURIComponent(raw);
    } catch (e) {
      return "SESSDATA=" + encodeURIComponent(v);
    }
  });
}

function webHeaders(store, referer) {
  const cookie = cookieForWebApi((store && store.cookie) || "");
  const h = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BiliApp/80000100 os/ios model/iPhone mobi_app/iphone build/80000100",
    Referer: referer || "https://www.bilibili.com/",
    Origin: "https://www.bilibili.com",
    Accept: "application/json, text/plain, */*",
  };
  if (cookie) h.Cookie = cookie;
  return h;
}

async function detectVipStatus(baseHeaders, accessKey) {
  // App 侧主鉴权是 access_key（URL query）；Web 才是 Cookie SESSDATA。
  // 官方多数接口：Cookie(SESSDATA) / access_key 二选一即可。
  // Returns { isVip: boolean, detail: string }
  accessKey = accessKey || "";
  function withKey(url) {
    if (!accessKey) return url;
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "access_key=" + encodeURIComponent(accessKey);
  }
  // 1) App/oauth style: passport oauth2 info often works with access_key
  try {
    const r = await http("GET", withKey("https://passport.bilibili.com/x/passport-login/oauth2/info"), baseHeaders, null, 3);
    const j = JSON.parse(r.data || "{}");
    if (j.code === 0 && j.data) {
      const d = j.data;
      // mid present => logged in; vip fields vary by version
      const status = d.vip_status != null ? d.vip_status : d.vipStatus;
      const type = d.vip_type != null ? d.vip_type : d.vipType;
      const mid = d.mid || d.userid || "";
      let isVip = status === 1 || status === true || (type > 0 && status !== 0);
      // some payloads nest vip
      if (d.vip && (d.vip.status === 1 || d.vip.type > 0)) isVip = true;
      const detail =
        "oauth2/info mid=" +
        mid +
        " vipStatus=" +
        status +
        " vipType=" +
        type +
        " via=" +
        (accessKey ? "access_key" : "cookie");
      // If login ok but vip fields missing, fall through to nav for vip only
      if (mid || d.isLogin) {
        if (status != null || type != null || (d.vip && d.vip.status != null)) {
          return { isVip: !!isVip, detail: detail };
        }
        log("oauth2 login ok, vip fields missing, try nav", detail);
      } else {
        log("oauth2 info code/data", j.code, JSON.stringify(d).slice(0, 120));
      }
    } else {
      log("oauth2 info code", j.code, j.message || j.msg || "");
    }
  } catch (e) {
    log("oauth2 info err", e);
  }
  // 2) nav (works with Cookie; often also access_key)
  try {
    const r = await http("GET", withKey("https://api.bilibili.com/x/web-interface/nav"), baseHeaders, null, 3);
    const j = JSON.parse(r.data || "{}");
    if (j.code === 0 && j.data) {
      const d = j.data;
      const vip = d.vip || {};
      const status = vip.status != null ? vip.status : d.vipStatus;
      const type = vip.type != null ? vip.type : d.vipType;
      const due = vip.due_date || vip.dueDate || d.vipDueDate || 0;
      const isVip = status === 1 || status === true || (type > 0 && status !== 0);
      const detail =
        "nav vipStatus=" +
        status +
        " vipType=" +
        type +
        " due=" +
        due +
        " isLogin=" +
        !!d.isLogin +
        " via=" +
        (accessKey ? "access_key" : "cookie");
      return { isVip: !!isVip, detail: detail };
    }
    log("nav vip code", j.code, j.message || j.msg || "");
  } catch (e) {
    log("nav vip err", e);
  }
  // 3) vip privilege my (docs: Cookie / access_key)
  try {
    const r = await http("GET", withKey("https://api.bilibili.com/x/vip/privilege/my"), baseHeaders, null, 3);
    const j = JSON.parse(r.data || "{}");
    // code 0 with data usually means VIP-capable account; non-vip may still 0 with empty list
    if (j.code === 0) {
      return {
        isVip: true,
        detail: "vip/privilege/my code=0 (likely VIP or privilege API ok) via=" + (accessKey ? "access_key" : "cookie"),
      };
    }
    // common non-vip / no auth codes — treat as not vip rather than crash
    log("vip privilege code", j.code, j.message || j.msg || "");
  } catch (e) {
    log("vip privilege err", e);
  }
  try {
    const r = await http("GET", withKey("https://api.bilibili.com/x/vip/web/user/info"), baseHeaders, null, 3);
    const j = JSON.parse(r.data || "{}");
    if (j.code === 0 && j.data) {
      const d = j.data;
      const status = d.vip_status != null ? d.vip_status : d.status;
      const type = d.vip_type != null ? d.vip_type : d.type;
      const isVip = status === 1 || (type > 0 && status !== 0);
      return {
        isVip: !!isVip,
        detail: "vip/web/user/info status=" + status + " type=" + type,
      };
    }
    log("vip info code", j.code, j.message || j.msg || "");
  } catch (e) {
    log("vip info err", e);
  }
  return { isVip: false, detail: "detect failed / not vip (need access_key or Cookie)" };
}

function buildAuthHeaders(store) {
  const cookie = (store && store.cookie) || "";
  const h = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BiliApp",
    Referer: "https://www.bilibili.com/",
    Origin: "https://www.bilibili.com",
  };
  if (cookie && cookie.includes("SESSDATA")) h.Cookie = cookie;
  return h;
}

/**
 * Extra VIP check when session (Cookie) exists.
 * reason: session-ready | network-changed | cron-start | manual
 * Only logs via console.log; never $notification.
 * Throttle: same Beijing day + checked within 30min → skip (unless force).
 */
async function probeVipIfSession(opts, reason, force) {
  opts = opts || parseArgs(typeof $argument !== "undefined" ? $argument : "");
  if (opts && opts.自动签到 === false) {
    log("vip probe skip: checkin disabled", reason || "");
    return null;
  }
  const store = readStore();
  const hasCookie = !!(store.cookie && String(store.cookie).includes("SESSDATA"));
  const hasAK = !!(store.bili_app_token && String(store.bili_app_token).length > 8);
  if (!hasCookie && !hasAK) {
    log("vip probe skip: no session (no Cookie SESSDATA and no access_key)", reason || "");
    return null;
  }
  const now = Date.now();
  const last = store.vipCheckedAt ? Date.parse(store.vipCheckedAt) : 0;
  const day = today();
  // Throttle noisy paths; force bypasses
  if (
    !force &&
    store.vipProbeDay === day &&
    last &&
    now - last < 30 * 60 * 1000 &&
    reason !== "session-ready"
  ) {
    log(
      "vip probe skip: throttled",
      reason || "",
      "last",
      store.vipCheckedAt,
      "isVip",
      store.isVip
    );
    return { isVip: !!store.isVip, detail: store.vipDetail || "cached", cached: true };
  }
  // session-ready: allow on cookie change or if never checked / >30min
  if (
    !force &&
    reason === "session-ready" &&
    last &&
    now - last < 30 * 60 * 1000 &&
    store.vipProbeDay === day
  ) {
    log("vip probe skip: session already probed recently", store.vipCheckedAt);
    return { isVip: !!store.isVip, detail: store.vipDetail || "cached", cached: true };
  }

  const hdrs = buildAuthHeaders(store);
  const vip = await detectVipStatus(hdrs, store.bili_app_token || "");
  store.vipCheckedAt = new Date().toISOString();
  store.vipProbeDay = day;
  store.vipProbeReason = reason || "";
  store.isVip = !!vip.isVip;
  store.vipDetail = vip.detail || "";
  writeStore(store);
  log(
    "vip probe (" + (reason || "?") + "):",
    vip.isVip ? "YES" : "NO",
    vip.detail || ""
  );
  return vip;
}

function http(method, url, headers, body, timeoutSec) {
  return new Promise((resolve) => {
    const opt = { url, headers: headers || {}, timeout: timeoutSec != null ? timeoutSec : 15 };
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

// Force Asia/Shanghai (UTC+8) for day key and hour slots.
function beijingParts(date) {
  const d = date || new Date();
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const map = {};
    fmt.formatToParts(d).forEach((x) => {
      if (x.type !== "literal") map[x.type] = x.value;
    });
    // hour "24" -> 0 on some engines at midnight
    let hour = parseInt(map.hour, 10);
    if (hour === 24) hour = 0;
    return {
      day: map.year + "-" + map.month + "-" + map.day,
      hour: hour,
      minute: parseInt(map.minute, 10) || 0,
    };
  } catch (e) {
    // Fallback: UTC + 8h wall clock
    const utc = d.getTime() + d.getTimezoneOffset() * 60000;
    const bj = new Date(utc + 8 * 3600000);
    const p = (n) => (n < 10 ? "0" + n : "" + n);
    return {
      day: bj.getFullYear() + "-" + p(bj.getMonth() + 1) + "-" + p(bj.getDate()),
      hour: bj.getHours(),
      minute: bj.getMinutes(),
    };
  }
}

function today() {
  return beijingParts().day;
}

/** Device/phone local calendar day YYYY-MM-DD (for session notify once/day). */
function deviceLocalDay(date) {
  const d = date || new Date();
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Short jitter when opening App (avoid burst; keep request path snappy). */
function randomCheckinDelayMs() {
  const min = 500;
  const max = 3000;
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Beijing check-in windows:
// - 0:00–0:59, 10:00–10:59, 19:00–19:59, 21:00–21:59
// - 22:40–22:59（晚间最后一档）
const CHECKIN_SLOTS_BJ = [
  { hour: 0, minuteMin: 0, minuteMax: 59 },
  { hour: 10, minuteMin: 0, minuteMax: 59 },
  { hour: 19, minuteMin: 0, minuteMax: 59 },
  { hour: 21, minuteMin: 0, minuteMax: 59 },
  { hour: 22, minuteMin: 40, minuteMax: 59 },
];

function isCheckinHourBeijing() {
  const p = beijingParts();
  for (const s of CHECKIN_SLOTS_BJ) {
    if (p.hour !== s.hour) continue;
    const mi = p.minute != null ? p.minute : 0;
    if (mi >= s.minuteMin && mi <= s.minuteMax) return true;
  }
  return false;
}


/** Short label of the request that carried Cookie (for notify / later MITM narrowing). */
function shortRequestLabel(rawUrl) {
  try {
    const u = new URL(rawUrl);
    let path = u.pathname || "/";
    if (path.length > 60) path = path.slice(0, 57) + "...";
    return u.hostname + path;
  } catch (e) {
    const s = String(rawUrl || "");
    return s.length > 80 ? s.slice(0, 77) + "..." : s || "?";
  }
}


/** Only run sign-in on bootstrap-ish App requests (not feed scroll). */
function isCheckinTriggerUrl(rawUrl) {
  const u = String(rawUrl || "");
  return /app\.bilibili\.com\/x\/(?:resource\/(?:fingerprint|show\/(?:tab|skin))|v2\/(?:account\/(?:myinfo|mine)|splash\/)|v2\/splash)/i.test(
    u
  ) || /api\.bilibili\.com\/x\/web-interface\/nav/i.test(u) || /passport\.bilibili\.com\/x\/passport-login/i.test(u);
}

async function captureCookie(opts) {
  opts = opts || parseArgs(typeof $argument !== "undefined" ? $argument : "");
  if (!opts.自动签到) {
    log("capture skip: checkin=false");
    /* done by entry */
    return;
  }
  const url = ($request && $request.url) || "";
  const headers = ($request && $request.headers) || {};
  const cookie = getHeader(headers, "Cookie") || getHeader(headers, "cookie");
  const auth = getHeader(headers, "Authorization") || "";
  const store = readStore();
  let sessionChanged = false;
  let tokenChanged = false;
  let cookieChanged = false;
  let gotCookie = false;
  let gotToken = false;
  let tokenFromReq = "";

  // Web/App mixed: some hosts send full Cookie (SESSDATA); app.bilibili.com often does not
  if (cookie && (cookie.includes("SESSDATA") || cookie.includes("DedeUserID"))) {
    gotCookie = !!(cookie.includes("SESSDATA"));
    if (cookie.includes("SESSDATA") && store.cookie !== cookie) {
      store.cookie = cookie;
      store.cookieUpdatedAt = new Date().toISOString();
      store.cookieCaptureFrom = shortRequestLabel(url);
      store.cookieCaptureUrl = String(url).slice(0, 300);
      sessionChanged = true;
      cookieChanged = true;
    } else if (cookie.includes("SESSDATA") && !store.cookie) {
      store.cookie = cookie;
      store.cookieUpdatedAt = new Date().toISOString();
      store.cookieCaptureFrom = shortRequestLabel(url);
      store.cookieCaptureUrl = String(url).slice(0, 300);
      sessionChanged = true;
      cookieChanged = true;
    }
    const m = cookieMap(cookie);
    if (m.bili_jct) store.csrf = m.bili_jct;
    if (m.DedeUserID && store.uid !== String(m.DedeUserID)) {
      store.uid = String(m.DedeUserID);
      if (gotCookie) sessionChanged = true;
    }
    // Merge SESSDATA-bearing cookie pieces if store empty
    if (!store.cookie && m.SESSDATA) {
      store.cookie = cookie;
      store.cookieCaptureFrom = shortRequestLabel(url);
      store.cookieCaptureUrl = String(url).slice(0, 300);
      sessionChanged = true;
      cookieChanged = true;
      gotCookie = true;
    }
  }

  // App token: URL access_key → store.bili_app_token
  try {
    const u = new URL(url);
    const ak = u.searchParams.get("access_key");
    if (ak && ak.length > 8) {
      tokenFromReq = ak;
      gotToken = true;
      if (store.bili_app_token !== ak) {
        store.bili_app_token = ak;
        store.biliAppTokenUpdatedAt = new Date().toISOString();
        sessionChanged = true;
      }
    }
  } catch (e) {}

  // Snapshot App signed-query companions (for diagnostics / future app-signed APIs)
  try {
    const u = new URL(url);
    if (u.searchParams.get("access_key") || u.searchParams.get("appkey")) {
      const snap = {};
      for (const k of [
        "appkey",
        "mobi_app",
        "platform",
        "build",
        "device",
        "ts",
        "actionKey",
        "statistics",
      ]) {
        const v = u.searchParams.get(k);
        if (v) snap[k] = v;
      }
      if (Object.keys(snap).length) {
        store.app_query_snap = snap;
        store.appQuerySnapAt = new Date().toISOString();
      }
    }
  } catch (e) {}

  try {
    const body = ($request && $request.body) || "";
    if (typeof body === "string" && body.includes("access_key=")) {
      const m = body.match(/access_key=([^&]+)/);
      if (m && m[1]) {
        const ak = decodeURIComponent(m[1]);
        if (ak.length > 8) {
          tokenFromReq = ak;
          gotToken = true;
          if (store.bili_app_token !== ak) {
            store.bili_app_token = ak;
            store.biliAppTokenUpdatedAt = new Date().toISOString();
            sessionChanged = true;
            tokenChanged = true;
          }
        }
      }
    }
  } catch (e) {}

  if (auth && auth.length > 10 && store.authorization !== auth) {
    store.authorization = auth;
  }
  const mid = getHeader(headers, "x-bili-mid") || getHeader(headers, "X-Bili-Mid");
  if (mid && String(store.uid || "") !== String(mid)) {
    store.uid = String(mid);
    // mid alone does not count as session change for notify spam
  }

  // Always persist silent token/cookie refresh without notify when unchanged
  if (gotCookie || gotToken || sessionChanged) writeStore(store);

  log(
    "capture done",
    "cookie=" + (gotCookie ? "yes" : "no"),
    "bili_app_token=" + (store.bili_app_token ? "yes" : "no"),
    "sessionChanged=" + sessionChanged,
    "url=" + String(url).slice(0, 90)
  );

  // Notify policy (device/phone local calendar day):
  // - token 更新通知：本地自然日最多 1 次
  // - cookie 更新通知：本地自然日最多 1 次
  // - 同一天最多 2 次（token 一次 + cookie 一次）
  // - 次日：对应类型在凭证再次变化时才可再通知
  if (!sessionChanged || (!tokenChanged && !cookieChanged)) {
    /* done by entry */
    return;
  }

  const hasSession = !!(
    (store.cookie && String(store.cookie).includes("SESSDATA")) ||
    (store.bili_app_token && String(store.bili_app_token).length > 8)
  );
  if (!hasSession) {
    /* done by entry */
    return;
  }

  const localDay = deviceLocalDay();
  const tokenNotifiedToday = store.tokenNotifyLocalDay === localDay;
  const cookieNotifiedToday = store.cookieNotifyLocalDay === localDay;
  let notifyKind = "";
  if (tokenChanged && cookieChanged && !tokenNotifiedToday && !cookieNotifiedToday) {
    notifyKind = "token"; // one combined popup; both daily caps set below
  } else if (tokenChanged && !tokenNotifiedToday) {
    notifyKind = "token";
  } else if (cookieChanged && !cookieNotifiedToday) {
    notifyKind = "cookie";
  }
  if (!notifyKind) {
    log(
      "capture notify skip: daily cap",
      "localDay=" + localDay,
      "tokenChanged=" + tokenChanged,
      "cookieChanged=" + cookieChanged,
      "tokenNotifiedToday=" + tokenNotifiedToday,
      "cookieNotifiedToday=" + cookieNotifiedToday
    );
    /* done by entry */
    return;
  }

  // VIP only when we will notify
  let vipLine = "会员: 查询失败";
  try {
    const hdrs = buildAuthHeaders(store);
    const vipPromise = detectVipStatus(hdrs, store.bili_app_token || tokenFromReq || "");
    const timeoutPromise = new Promise((resolve) =>
      setTimeout(() => resolve({ isVip: false, detail: "timeout", timedOut: true }), 4000)
    );
    const vip = await Promise.race([vipPromise, timeoutPromise]);
    store.vipCheckedAt = new Date().toISOString();
    store.vipProbeReason = "capture";
    if (vip && vip.timedOut) {
      vipLine = "会员: 查询失败";
      store.vipDetail = "timeout";
    } else if (vip && vip.detail && /detect failed/i.test(String(vip.detail))) {
      vipLine = "会员: 查询失败";
      store.isVip = false;
      store.vipDetail = vip.detail || "";
    } else if (vip && vip.isVip === true) {
      vipLine = "会员: 大会员";
      store.isVip = true;
      store.vipDetail = vip.detail || "";
    } else if (vip && vip.isVip === false) {
      store.isVip = false;
      store.vipDetail = (vip && vip.detail) || "";
      if (
        vip.detail &&
        (/isLogin=true/i.test(vip.detail) ||
          /mid=\d+/i.test(vip.detail) ||
          /vipStatus=/i.test(vip.detail) ||
          /oauth2/i.test(vip.detail) ||
          /nav /i.test(vip.detail))
      ) {
        vipLine = "会员: 非大会员";
      } else if (vip.detail && /failed|timeout|未登录|-101/i.test(vip.detail)) {
        vipLine = "会员: 查询失败";
      } else {
        vipLine = "会员: 非大会员";
      }
    } else {
      vipLine = "会员: 查询失败";
    }
    log("capture vip", vipLine, vip && vip.detail);
  } catch (e) {
    vipLine = "会员: 查询失败";
    log("capture vip err", e);
  }

  store.sessionNotifyAt = new Date().toISOString();
  if (notifyKind === "token") {
    store.tokenNotifyLocalDay = localDay;
    // both changed together → one popup is enough for both types today
    if (cookieChanged) store.cookieNotifyLocalDay = localDay;
  }
  if (notifyKind === "cookie") {
    store.cookieNotifyLocalDay = localDay;
    if (tokenChanged && store.tokenNotifyLocalDay !== localDay) {
      // cookie-only path; leave token slot free if token also changed but token was already notified
    }
  }
  writeStore(store);

  // Order: 会员 → access_token → UID → Cookie last
  const parts = [];
  parts.push(vipLine);
  parts.push(store.bili_app_token ? "access_token: 有" : "access_token: 无");
  if (store.uid) parts.push("UID " + store.uid);
  if (store.cookie && String(store.cookie).includes("SESSDATA")) {
    const src = store.cookieCaptureFrom || shortRequestLabel(url) || "?";
    parts.push("Cookie: 有 (" + src + ")");
  } else {
    parts.push("Cookie: 无");
  }
  parts.push(
    notifyKind === "token"
      ? "原因: access_token 更新"
      : "原因: Cookie 更新"
  );
  if (notifyKind === "cookie" && (store.cookieCaptureFrom || url)) {
    log(
      "cookie capture source (record for later narrow MITM)",
      store.cookieCaptureFrom || shortRequestLabel(url),
      store.cookieCaptureUrl || String(url).slice(0, 200)
    );
  }
  parts.push("登录态已保存");
  const title =
    notifyKind === "token" ? "登录态已捕获 (Token)" : "登录态已捕获 (Cookie)";
  notify(NAME, title, parts.join("\n"));
  log(
    "session notify",
    "kind=" + notifyKind,
    "localDay=" + localDay,
    parts.join(" | ")
  );
  /* done by entry */
}

async function doCheckin(opts, flags) {
  flags = flags || {};
  const fromOpen = !!flags.fromOpen;
  const store = readStore();
  const hasCookie = !!(store.cookie && String(store.cookie).includes("SESSDATA"));
  const hasAK = !!(store.bili_app_token && String(store.bili_app_token).length > 8);
  if (!opts.自动签到) {
    log("auto checkin disabled");
    if (!fromOpen) $done({});
    return { ok: false, skipped: true };
  }
  if (!hasCookie && !hasAK) {
    const msg =
      "未捕获登录态：请打开 B 站浏览（直播/动态等）以抓取 Cookie(SESSDATA)。仅 access_key 无法 Web 签到";
    log(msg);
    // 失败立刻通知（节流：同一本地日最多 1 次无会话提示）
    const localDay = deviceLocalDay();
    if (store.noSessionFailNotifyDay !== localDay) {
      store.noSessionFailNotifyDay = localDay;
      writeStore(store);
      notify(NAME, "签到失败", msg);
    }
    if (!fromOpen) $done({});
    return { ok: false, failed: true };
  }

  const day = today(); // Asia/Shanghai YYYY-MM-DD
  // reset=true：强制重签。脚本无法改写模块参数 UI，用本地存储做「只生效一次」：
  // - 检测到 reset=true 且尚未消费 → 清 lastRunOk 并签一次，标记已消费
  // - 保持 true 不会反复强制；改回 false 会清除消费标记，下次再 true 可再强制
  const resetOn = !!(opts.重新签到 || opts.reset);
  let forceResign = false;
  if (!resetOn) {
    if (store.resetConsumed) {
      store.resetConsumed = false;
      writeStore(store);
      log("reset=false: clear one-shot consume flag");
    }
  } else if (resetOn && !store.resetConsumed) {
    forceResign = true;
    store.resetConsumed = true; // one-shot; 等同「自动用掉」这次 true
    store.lastRunOk = false;
    store.lastRunDay = "";
    store.lastAttemptAt = "";
    writeStore(store);
    log("reset=true one-shot: force re-checkin (param UI cannot auto-set false; leave true is OK, will not re-force until toggled)");
  } else if (resetOn && store.resetConsumed) {
    log("reset=true already consumed this toggle; normal skip rules apply");
  }

  if (!forceResign && store.lastRunDay === day && store.lastRunOk) {
    log("already succeeded Beijing day, skip", day);
    if (!fromOpen) $done({});
    return { ok: true, skipped: true };
  }

  // 打开 App 时：失败后 15 分钟内不重复打接口（仍可当天再试）
  if (fromOpen && store.lastAttemptAt) {
    const lastA = Date.parse(store.lastAttemptAt);
    if (lastA && Date.now() - lastA < 15 * 60 * 1000 && store.lastRunDay === day) {
      log("checkin throttle 15m after attempt", store.lastAttemptAt);
      if (!fromOpen) $done({});
      return { ok: false, skipped: true };
    }
  }

  log(
    "auth mode",
    hasCookie ? "cookie+SESSDATA" : "access_key-only",
    "token=" + (hasAK ? "yes" : "no"),
    "fromOpen=" + fromOpen
  );
  // 打开 App 后台任务：有缓存会员状态则跳过重复探测，加快
  try {
    if (!(fromOpen && store.vipCheckedAt && store.isVip != null && Date.now() - Date.parse(store.vipCheckedAt) < 6 * 3600 * 1000)) {
      await probeVipIfSession(opts, fromOpen ? "open-app" : "manual", false);
    } else {
      log("vip cache hit", store.isVip, store.vipDetail);
    }
  } catch (e) {
    log("vip probe err", e);
  }

  // 极短抖动（后台执行，不挡请求）
  const delayMs = fromOpen ? 200 + Math.floor(Math.random() * 800) : randomCheckinDelayMs();
  log("checkin jitter ms", delayMs, "fromOpen=" + fromOpen, "bj", beijingParts());
  await sleep(delayMs);

  store.lastAttemptAt = new Date().toISOString();
  writeStore(store);

  const cookie = store.cookie || "";
  const csrf = store.csrf || cookieMap(cookie).bili_jct || "";
  const accessKey = store.bili_app_token || "";
  const baseHeaders = webHeaders(store, "https://www.bilibili.com/");

  // 大会员判断：只写日志，不弹窗；非会员整次签到跳过
  // Prefer cookie; if only access_key, still try nav with access_key query via detect
  const vip = await detectVipStatus(baseHeaders, accessKey);
  store.vipCheckedAt = new Date().toISOString();
  store.isVip = !!vip.isVip;
  store.vipDetail = vip.detail || "";
  writeStore(store);
  log("vip detect:", vip.isVip ? "YES" : "NO", vip.detail || "");
  // 直播签到不要求大会员；大积分才要求。无 Cookie 时下面各任务会明确跳过/失败说明。

  const lines = [];
  let okAny = false;
  let hardFail = false; // true if a required task failed (not skip)

  if (!hasCookie) {
    lines.push(
      "提示: 无 Cookie/SESSDATA，大积分/分享等 Web 接口无法鉴权"
    );
    hardFail = true;
  }

  // 1) 直播签到已下线（code=1 签到活动已下线）— 已移除

  // 2) 大会员大积分签到
  // POST https://api.bilibili.com/pgc/activity/score/task/sign
  // 文档: Cookie(SESSDATA 需 URL 编码) + Referer *.bilibili.com + csrf；APP 可用 access_key
  // App 页面: big.bilibili.com/mobile/bigPoint
  try {
    if (!store.isVip && store.isVip !== true) {
      // re-read: isVip may be from detect above
    }
    const isVip = !!store.isVip;
    if (!isVip) {
      lines.push("大积分签到: 跳过（非大会员）");
    } else if (!cookie || !cookie.includes("SESSDATA")) {
      lines.push("大积分签到: 跳过（无 Cookie/SESSDATA）");
      hardFail = true;
    } else {
      const headers = webHeaders(store, "https://big.bilibili.com/mobile/bigPoint/task");
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers.Origin = "https://big.bilibili.com";
      headers.Referer = "https://big.bilibili.com/mobile/bigPoint/task";
      let body = "";
      if (csrf) body = "csrf=" + encodeURIComponent(csrf) + "&csrf_token=" + encodeURIComponent(csrf);
      // APP 方式可附带 access_key（文档）；有则带上
      if (accessKey) {
        body = (body ? body + "&" : "") + "access_key=" + encodeURIComponent(accessKey);
      }
      const r = await http(
        "POST",
        "https://api.bilibili.com/pgc/activity/score/task/sign",
        headers,
        body || "csrf=",
        8
      );
      let j = {};
      try {
        j = JSON.parse(r.data || "{}");
      } catch (e) {
        j = {};
      }
      const msg = String(j.message || j.msg || "");
      if (j.code === 0) {
        okAny = true;
        lines.push("大积分签到: 成功");
      } else if (
        /已签|重复|already|今日已|签到过|已完成/i.test(msg) ||
        j.code === 71000 ||
        j.code === 6000002 ||
        j.code === 710001
      ) {
        okAny = true;
        lines.push("大积分签到: 今日已签 (" + (j.code != null ? j.code : "") + ")");
      } else if (
        j.code === -403 ||
        j.code === 6001001 ||
        /非大会员|不是大会员|权限不足|未开通/i.test(msg)
      ) {
        lines.push("大积分签到: 非会员/无权限，跳过");
      } else if (j.code === 6007000) {
        // 常见：参数/Referer/Cookie 编码问题
        hardFail = true;
        lines.push(
          "大积分签到: 失败 code=6007000 请求错误（检查 Cookie 编码/Referer/csrf；与 App big.bilibili.com 不一致时常见）"
        );
        log("bigpoint raw", String(r.data || "").slice(0, 200));
      } else {
        hardFail = true;
        lines.push(
          "大积分签到: 失败 code=" +
            (j.code != null ? j.code : r.status) +
            " " +
            msg
        );
        log("bigpoint raw", String(r.data || "").slice(0, 200));
      }
    }
  } catch (e) {
    hardFail = true;
    lines.push("大积分签到: 异常 " + e);
  }

  // 3) 经验任务：查询 + 尝试自动分享（share/add）
  // 分享: POST https://api.bilibili.com/x/web-interface/share/add  body: aid + csrf
  // 先拉排行榜取一个 aid（无需登录）
  try {
    let exp = null;
    const r0 = await http(
      "GET",
      "https://api.bilibili.com/x/member/web/exp/reward",
      webHeaders(store, "https://www.bilibili.com/"),
      null,
      8
    );
    try {
      const j0 = JSON.parse(r0.data || "{}");
      if (j0.code === 0) exp = j0.data;
      else lines.push("经验任务: 查询 code=" + j0.code);
    } catch (e) {
      lines.push("经验任务: 查询解析失败");
    }

    if (exp && exp.share) {
      lines.push(
        "经验任务: 登录" +
          (exp.login ? "✓" : "✗") +
          " 观看" +
          (exp.watch ? "✓" : "✗") +
          " 分享✓ 投币" +
          (exp.coins || 0) +
          "（分享已完成）"
      );
      // 仅登录/观看不能算签到成功（否则失败后被 lastRunOk 卡住）
    } else if (exp && cookie && csrf) {
      // auto share
      let aid = null;
      try {
        const rr = await http(
          "GET",
          "https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all",
          webHeaders(store, "https://www.bilibili.com/"),
          null,
          8
        );
        const jr = JSON.parse(rr.data || "{}");
        const list = (jr.data && jr.data.list) || [];
        if (list.length) {
          const pick = list[Math.floor(Math.random() * Math.min(list.length, 10))];
          aid = pick.aid || (pick.stat && pick.stat.aid);
        }
      } catch (e) {
        log("ranking for share err", e);
      }
      if (!aid) {
        lines.push(
          "经验任务: 登录" +
            (exp.login ? "✓" : "✗") +
            " 观看" +
            (exp.watch ? "✓" : "✗") +
            " 分享✗ 投币" +
            (exp.coins || 0) +
            "（未取到 aid，分享跳过）"
        );
      } else {
        const sh = webHeaders(store, "https://www.bilibili.com/video/");
        sh["Content-Type"] = "application/x-www-form-urlencoded";
        const body =
          "aid=" +
          encodeURIComponent(String(aid)) +
          "&eab_x=2&ramval=0&source=web_normal&ga=1&csrf=" +
          encodeURIComponent(csrf);
        const rs = await http(
          "POST",
          "https://api.bilibili.com/x/web-interface/share/add",
          sh,
          body,
          8
        );
        let js = {};
        try {
          js = JSON.parse(rs.data || "{}");
        } catch (e) {}
        // 0 ok; 71000 already shared etc.
        if (js.code === 0 || js.code === 71000 || /已分享|重复/i.test(String(js.message || ""))) {
          okAny = true;
          lines.push(
            "经验任务: 分享成功 aid=" +
              aid +
              "；登录" +
              (exp.login ? "✓" : "✗") +
              " 观看" +
              (exp.watch ? "✓" : "✗") +
              " 投币" +
              (exp.coins || 0)
          );
        } else {
          hardFail = true;
          lines.push(
            "经验任务: 分享失败 code=" +
              js.code +
              " " +
              (js.message || js.msg || "") +
              "；登录" +
              (exp.login ? "✓" : "✗") +
              " 观看" +
              (exp.watch ? "✓" : "✗")
          );
        }
      }
    } else if (exp) {
      lines.push(
        "经验任务: 登录" +
          (exp.login ? "✓" : "✗") +
          " 观看" +
          (exp.watch ? "✓" : "✗") +
          " 分享" +
          (exp.share ? "✓" : "✗") +
          " 投币" +
          (exp.coins || 0)
      );
    }
  } catch (e) {
    lines.push("经验任务: 异常 " + e);
  }

  // 4) VIP privilege receive - ignore already claimed
  if (csrf && cookie) {
    try {
      const body = "type=1&csrf=" + encodeURIComponent(csrf);
      const headers = webHeaders(store, "https://account.bilibili.com/");
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      const r = await http(
        "POST",
        "https://api.bilibili.com/x/vip/privilege/receive",
        headers,
        body,
        8
      );
      const j = JSON.parse(r.data || "{}");
      if (j.code === 0) {
        okAny = true;
        lines.push("大会员福利: 领取成功");
      } else if (/已领取|已经领取|领取过/i.test(String(j.message || j.msg || ""))) {
        lines.push("大会员福利: 已领取过（忽略）");
      } else {
        lines.push("大会员福利: " + (j.message || j.msg || j.code));
      }
    } catch (e) {
      lines.push("大会员福利: 异常 " + e);
    }
  }

  // 5) silver2coin optional
  if (opts.银瓜子换硬币 && csrf && cookie) {
    try {
      const body =
        "csrf_token=" +
        encodeURIComponent(csrf) +
        "&csrf=" +
        encodeURIComponent(csrf);
      const headers = webHeaders(store, "https://live.bilibili.com/");
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      const r = await http(
        "POST",
        "https://api.live.bilibili.com/xlive/revenue/v1/wallet/silver2coin",
        headers,
        body,
        8
      );
      const j = JSON.parse(r.data || "{}");
      if (j.code === 0) {
        okAny = true;
        lines.push("银瓜子换硬币: 成功");
      } else {
        lines.push("银瓜子换硬币: " + (j.message || j.msg || j.code));
      }
    } catch (e) {
      lines.push("银瓜子换硬币: 异常 " + e);
    }
  }

  // treat already-done privilege as non-failure; success if any okAny
  // hardFail only forces failure notify if nothing ok

  store.lastRunDay = day;
  store.lastRunOk = !!okAny; // 只有真正成功才 true；失败必须 false，否则不再自动签
  if (!okAny) store.lastRunOk = false;
  store.lastResult = lines.join(" | ");
  store.lastHardFail = !!hardFail && !okAny;
  writeStore(store);

  // 失败立刻通知；成功通知一次
  if (!okAny) {
    // 明确失败：绝不能 lastRunOk（已在上面按 okAny 写入）
    notify(NAME, "签到失败", lines.join("\n") || "未知错误");
  } else {
    let extra = "";
    if (forceResign) {
      extra =
        "\n\n已强制重签一次（reset 一次性生效）。脚本无法自动改模块参数，请把 reset 改回 false；若一直 true 也不会重复强制。";
    }
    notify(NAME, "签到完成", lines.join("\n") + extra);
  }
  log("checkin done", okAny ? "ok" : "fail", lines.join(" | "));
  if (!fromOpen) $done({});
  return { ok: okAny, lines: lines };
}

(async () => {
  const opts = parseArgs(typeof $argument !== "undefined" ? $argument : "");
  const stype =
    typeof $script !== "undefined" && $script && $script.type
      ? String($script.type)
      : "";
  const sname =
    typeof $script !== "undefined" && $script && $script.name
      ? String($script.name)
      : "";
  const store0 = readStore();
  const hasSession = !!(
    (store0.cookie && String(store0.cookie).includes("SESSDATA")) ||
    (store0.bili_app_token && String(store0.bili_app_token).length > 8)
  );
  // 任何触发都必须先打这条，方便在 Surge 日志里确认脚本真的跑了
  log(
    "boot",
    "v=" + SCRIPT_VERSION,
    "type=" + (stype || (typeof $request !== "undefined" && $request ? "http-request" : "cron?")),
    "name=" + sname,
    "checkin=" + !!opts.自动签到,
    "session=" + (hasSession ? "yes" : "no"),
    "bj=" + JSON.stringify(beijingParts())
  );

  // 无定时任务：打开 B 站只做 trigger
  // capture 同步、立刻 $done，不阻塞业务请求；签到延后异步执行（类似后台任务）
  if (typeof $request !== "undefined" && $request && $request.url) {
    const reqUrl = String($request.url);
    log("path=open-app capture", reqUrl.slice(0, 120));
    try {
      await captureCookie(opts);
    } catch (e) {
      log("capture err", e);
    }
    const should =
      opts.自动签到 && typeof isCheckinTriggerUrl === "function" && isCheckinTriggerUrl(reqUrl);
    // 先放行请求，再后台签到（Surge 对 $done 后定时器/Promise 支持因版本而异；用 setTimeout 尽量不挡用户）
    if (should) {
      log("schedule background checkin after $done");
      try {
        setTimeout(function () {
          doCheckin(opts, { fromOpen: true }).catch(function (e) {
            log("bg checkin err", e);
            notify(NAME, "签到失败", String(e));
          });
        }, 50);
      } catch (e) {
        // 无 setTimeout 时退化为不 await 的 Promise（仍可能被提前回收）
        doCheckin(opts, { fromOpen: true }).catch(function (err) {
          log("bg checkin err", err);
          notify(NAME, "签到失败", String(err));
        });
      }
    }
    $done({});
  } else if (stype === "event") {
    log("path=event network-changed");
    // 网络变化：后台尝试签到（不阻塞）
    try {
      setTimeout(function () {
        if (opts.自动签到) {
          doCheckin(opts, { fromOpen: true }).catch(function (e) {
            log("event checkin err", e);
          });
        }
      }, 100);
    } catch (e) {
      probeVipIfSession(opts, "network-changed", false).finally(function () {
        $done({});
      });
      return;
    }
    $done({});
  } else {
    log("path=manual doCheckin");
    await doCheckin(opts, { fromOpen: false });
  }
})().catch((e) => {
  log("fatal", e);
  notify(NAME, "脚本异常", String(e));
  $done({});
});
