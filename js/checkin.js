// Bilibili daily check-in for Surge (network only)
// - type=http-request: capture Cookie / bili_app_token (URL access_key)
// - type=cron: hourly tick; only act at Beijing 00/10/19/21/22/22
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
const SCRIPT_VERSION = "2.0.6";
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

/**
 * Random delay before sign APIs (anti 整点扎堆).
 * MUST stay well under Surge cron script timeout (module: 180s).
 * Old 45s–8min caused: Script timeout: bili-checkin-cron
 */
function randomCheckinDelayMs() {
  const min = 15 * 1000;  // 15s
  const max = 90 * 1000;  // 90s
  return min + Math.floor(Math.random() * (max - min + 1));
}

const CHECKIN_HOURS_BJ = [0, 10, 19, 21, 22]; // 北京时间 0/10/19/21/22/22

function isCheckinHourBeijing() {
  return CHECKIN_HOURS_BJ.indexOf(beijingParts().hour) >= 0;
}

async function captureCookie(opts) {
  opts = opts || parseArgs(typeof $argument !== "undefined" ? $argument : "");
  if (!opts.自动签到) {
    log("capture skip: checkin=false");
    $done({});
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
      sessionChanged = true;
      cookieChanged = true;
    } else if (cookie.includes("SESSDATA") && !store.cookie) {
      store.cookie = cookie;
      store.cookieUpdatedAt = new Date().toISOString();
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
    $done({});
    return;
  }

  const hasSession = !!(
    (store.cookie && String(store.cookie).includes("SESSDATA")) ||
    (store.bili_app_token && String(store.bili_app_token).length > 8)
  );
  if (!hasSession) {
    $done({});
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
    $done({});
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
  parts.push(
    store.cookie && String(store.cookie).includes("SESSDATA")
      ? "Cookie: 有"
      : "Cookie: 无"
  );
  parts.push(
    notifyKind === "token"
      ? "原因: access_token 更新"
      : "原因: Cookie 更新"
  );
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
  $done({});
}

async function doCheckin(opts) {
  const store = readStore();
  const hasCookie = !!(store.cookie && String(store.cookie).includes("SESSDATA"));
  const hasAK = !!(store.bili_app_token && String(store.bili_app_token).length > 8);
  if (!hasCookie && !hasAK) {
    // Throttle "no session" notifications: at most once per 6 hours
    const lastN = store.lastNoSessionNotifyAt
      ? Date.parse(store.lastNoSessionNotifyAt)
      : 0;
    if (!lastN || Date.now() - lastN > 6 * 3600 * 1000) {
      store.lastNoSessionNotifyAt = new Date().toISOString();
      writeStore(store);
      notify(
        NAME,
        "未捕获登录态",
        "请打开 B 站并浏览一下（含直播/动态等），以便抓取 Cookie(SESSDATA)。仅 access_key 无法完成 Web 签到（会 -663）"
      );
    } else {
      log("no session, notify throttled");
    }
    $done({});
    return;
  }
  if (!opts.自动签到) {
    log("auto checkin disabled");
    $done({});
    return;
  }

  log(
    "auth mode",
    hasCookie ? "cookie+SESSDATA" : "access_key-only",
    "token=" + (hasAK ? "yes" : "no")
  );
  // Session 存在 + cron 拉起：会员检测（仅日志，节流）— 不在 http-request 路径
  try {
    await probeVipIfSession(opts, "cron-start", false);
  } catch (e) {
    log("vip probe on cron-start err", e);
  }

  // Beijing calendar day + hour slots (not device local TZ).
  if (!isCheckinHourBeijing()) {
    log("skip: not Beijing check-in hour", beijingParts());
    $done({});
    return;
  }

  const day = today(); // Asia/Shanghai YYYY-MM-DD
  // Same Beijing day + already succeeded: skip remaining 0/10/19/21/22 slots.
  // Next Beijing midnight: day string changes => runs again (once per BJ day, not forever).
  if (store.lastRunDay === day && store.lastRunOk) {
    log("already succeeded Beijing day, skip slot", day);
    $done({});
    return;
  }

  // Avoid整点批量：北京时间时段内再随机延迟一段时间
  const delayMs = randomCheckinDelayMs();
  log("random delay ms", delayMs, "(cron timeout budget ~180s)", "bj", beijingParts());
  await sleep(delayMs);

  // Re-check after delay: day/hour may have changed; still only act in slot hours
  if (!isCheckinHourBeijing()) {
    log("after delay: left check-in hour, skip", beijingParts());
    $done({});
    return;
  }
  const dayAfter = today();
  if (store.lastRunDay === dayAfter && store.lastRunOk) {
    log("after delay: already succeeded", dayAfter);
    $done({});
    return;
  }

  const cookie = store.cookie || "";
  const csrf = store.csrf || cookieMap(cookie).bili_jct || "";
  const accessKey = store.bili_app_token || "";
  const baseHeaders = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BiliApp",
    Referer: "https://www.bilibili.com/",
    Origin: "https://www.bilibili.com",
  };
  if (cookie) baseHeaders.Cookie = cookie;

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
  if (!hasCookie) {
    lines.push(
      "提示: 当前只有 access_key、无 Cookie。App 请求带 appkey+sign，Web 签到接口需要 SESSDATA，故易出现 -663"
    );
  }

  // 1) Live sign — Web API DoSign expects Cookie(SESSDATA).
  // Bare access_key without appkey+sign → often code=-663 鉴权失败 (App 鉴权不完整).
  try {
    if (!cookie || !cookie.includes("SESSDATA")) {
      lines.push(
        "直播签到: 跳过（无 Cookie/SESSDATA；仅 access_key 调 Web 接口会 -663 鉴权失败）"
      );
      log("live sign skip: need SESSDATA cookie; app uses access_key+appkey+sign");
    } else {
      const signUrl =
        "https://api.live.bilibili.com/xlive/web-ucenter/v1/sign/DoSign";
      const r = await http("GET", signUrl, baseHeaders);
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
      } else if (j.code === -663 || j.code === -101) {
        lines.push(
          `直播签到: 失败 code=${j.code} ${j.message || j.msg || ""}（登录态无效或缺少 Cookie）`
        );
      } else {
        lines.push(`直播签到: 失败 code=${j.code} ${j.message || j.msg || ""}`);
      }
    }
  } catch (e) {
    lines.push("直播签到: 异常 " + e);
  }

    // 2) VIP 大积分签到 — Web POST，需要 Cookie + bili_jct(csrf)
  // 裸 access_key 会 -663 鉴权失败
  try {
    if (!store.isVip) {
      lines.push("大积分签到: 跳过（非大会员）");
    } else if (!cookie || !cookie.includes("SESSDATA")) {
      lines.push("大积分签到: 跳过（无 Cookie/SESSDATA）");
    } else {
      const headers = Object.assign({}, baseHeaders, {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://big.bilibili.com/",
        Origin: "https://www.bilibili.com",
      });
      let body = "";
      if (csrf) body = "csrf=" + encodeURIComponent(csrf);
      const r = await http(
        "POST",
        "https://api.bilibili.com/pgc/activity/score/task/sign",
        headers,
        body
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
        /已签|重复|already|今日已|签到过/i.test(msg) ||
        j.code === 71000 ||
        j.code === 6000002
      ) {
        okAny = true;
        lines.push("大积分签到: 今日已签 (" + (j.code != null ? j.code : "") + ")");
      } else if (
        j.code === -403 ||
        j.code === 6001001 ||
        /非大会员|不是大会员|权限不足|未开通/i.test(msg)
      ) {
        lines.push("大积分签到: 非会员/无权限，跳过");
      } else if (j.code === -663 || j.code === -101) {
        lines.push(
          "大积分签到: 失败 code=" +
            j.code +
            " " +
            msg +
            "（登录态无效或缺少 Cookie）"
        );
      } else {
        lines.push(
          "大积分签到: 失败 code=" +
            (j.code != null ? j.code : r.status) +
            " " +
            msg
        );
      }
    }
  } catch (e) {
    lines.push("大积分签到: 异常 " + e);
  }

  // 3) Exp reward status
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

  // 4) VIP privilege receive (type=1 B-coin coupon) - monthly, ignore if not eligible
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

  // 5) silver2coin optional
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
    (store0.access_key && String(store0.access_key).length > 8)
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

  // Surge: http-request = capture; event = network-changed; else cron/manual
  if (typeof $request !== "undefined" && $request && $request.url) {
    log("path=capture", String($request.url).slice(0, 120));
    await captureCookie(opts);
  } else if (stype === "event") {
    log("path=event network-changed, probe vip if session");
    if (!hasSession) {
      log("event: no session yet — open Bilibili app once to capture Cookie");
    }
    await probeVipIfSession(opts, "network-changed", false);
    $done({});
  } else {
    log("path=cron/manual doCheckin");
    await doCheckin(opts);
  }
})().catch((e) => {
  log("fatal", e);
  notify(NAME, "脚本异常", String(e));
  $done({});
});
