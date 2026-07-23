// Bilibili daily check-in for Surge (network only)
// - type=http-request on fingerprint: capture Cookie / access_key
// - type=cron: hourly tick; only act at Beijing 00/10/19/21
//   Day key + slots use Asia/Shanghai (UTC+8), not device local TZ.
//   First success of that Beijing day marks lastRunOk; later slots no-op.
//
// Tasks (VIP only; non-VIP skipped with log only, no notification):
// 0) VIP probe when session exists: cookie capture / network-changed / cron-start
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
const SCRIPT_VERSION = "2.0.5";
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
  // Prefer nav (vipStatus/vipType); fallback vip/web/user/info
  // Returns { isVip: boolean, detail: string }
  accessKey = accessKey || "";
  const navUrl =
    "https://api.bilibili.com/x/web-interface/nav" +
    (accessKey && !(baseHeaders && baseHeaders.Cookie)
      ? "?access_key=" + encodeURIComponent(accessKey)
      : "");
  try {
    const r = await http("GET", navUrl, baseHeaders);
    const j = JSON.parse(r.data || "{}");
    if (j.code === 0 && j.data) {
      const d = j.data;
      const vip = d.vip || {};
      const status = vip.status != null ? vip.status : d.vipStatus;
      const type = vip.type != null ? vip.type : d.vipType;
      const due = vip.due_date || vip.dueDate || d.vipDueDate || 0;
      // status===1 大会员有效；type 1/2 月度/年度等
      const isVip = status === 1 || status === true || (type > 0 && status !== 0);
      const detail =
        "nav vipStatus=" +
        status +
        " vipType=" +
        type +
        " due=" +
        due +
        " isLogin=" +
        !!d.isLogin;
      return { isVip: !!isVip, detail: detail };
    }
    log("nav vip code", j.code, j.message || j.msg || "");
  } catch (e) {
    log("nav vip err", e);
  }
  try {
    const r = await http(
      "GET",
      "https://api.bilibili.com/x/vip/web/user/info",
      baseHeaders
    );
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
  return { isVip: false, detail: "detect failed / not vip" };
}

function buildAuthHeaders(store) {
  const cookie = (store && store.cookie) || "";
  return {
    Cookie: cookie,
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BiliApp",
    Referer: "https://www.bilibili.com/",
    Origin: "https://www.bilibili.com",
  };
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
  if (!store.cookie || !String(store.cookie).includes("SESSDATA")) {
    log("vip probe skip: no session cookie", reason || "");
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
  const vip = await detectVipStatus(hdrs, store.access_key || "");
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random delay 45s–8min to avoid on-the-hour bursts. */
function randomCheckinDelayMs() {
  const min = 45 * 1000;
  const max = 8 * 60 * 1000;
  return min + Math.floor(Math.random() * (max - min + 1));
}

const CHECKIN_HOURS_BJ = [0, 10, 19, 21];

function isCheckinHourBeijing() {
  return CHECKIN_HOURS_BJ.indexOf(beijingParts().hour) >= 0;
}

async function captureCookie(opts) {
  opts = opts || parseArgs(typeof $argument !== "undefined" ? $argument : "");
  // CRITICAL: http-request on app.bilibili.com must return ASAP.
  // Never await VIP/network here — it can stall the shared H2 connection
  // and contribute to feed/index empty responses (inBytes=0).
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
  let changed = false;
  let gotCookie = false;
  let gotAccessKey = false;

  if (cookie && cookie.includes("SESSDATA")) {
    gotCookie = true;
    if (store.cookie !== cookie) {
      store.cookie = cookie;
      store.cookieUpdatedAt = new Date().toISOString();
      changed = true;
    }
    const m = cookieMap(cookie);
    if (m.bili_jct) store.csrf = m.bili_jct;
    if (m.DedeUserID) store.uid = m.DedeUserID;
  }

  // App requests often have NO Cookie header; session is access_key in query.
  try {
    const u = new URL(url);
    const ak = u.searchParams.get("access_key");
    if (ak && ak.length > 8) {
      gotAccessKey = true;
      if (store.access_key !== ak) {
        store.access_key = ak;
        store.accessKeyUpdatedAt = new Date().toISOString();
        changed = true;
      }
    }
  } catch (e) {}

  // Also accept access_key from body if present (rare)
  try {
    const body = ($request && $request.body) || "";
    if (typeof body === "string" && body.includes("access_key=")) {
      const m = body.match(/access_key=([^&]+)/);
      if (m && m[1] && store.access_key !== m[1]) {
        store.access_key = decodeURIComponent(m[1]);
        gotAccessKey = true;
        changed = true;
      }
    }
  } catch (e) {}

  if (auth && auth.length > 10) {
    store.authorization = auth;
  }

  // mid header as weak uid hint
  const mid = getHeader(headers, "x-bili-mid") || getHeader(headers, "X-Bili-Mid");
  if (mid && !store.uid) store.uid = String(mid);

  if (changed || gotCookie || gotAccessKey) {
    writeStore(store);
  }

  log(
    "capture done",
    "cookie=" + (gotCookie ? "yes" : "no"),
    "access_key=" + (store.access_key ? "yes" : "no"),
    "changed=" + changed,
    "url=" + url.slice(0, 80)
  );

  // Notify only when we first get a usable session token (cookie OR access_key).
  // VIP probe is NOT done here (async elsewhere) so we don't block app traffic.
  if (changed && (gotCookie || gotAccessKey)) {
    const kind = gotCookie ? "Cookie" : "access_key";
    const uid = store.uid ? "UID " + store.uid : "";
    const vipHint =
      store.isVip === true
        ? "会员状态: 大会员(缓存)"
        : store.isVip === false
          ? "会员状态: 非大会员(缓存)"
          : "会员状态: 待检测(定时任务)";
    notify(
      NAME,
      kind + " / Session 已更新",
      [uid, vipHint, "签到将用 access_key 或 Cookie"].filter(Boolean).join("\n")
    );
  }

  // Always release the request immediately
  $done({});
}

async function doCheckin(opts) {
  const store = readStore();
  const hasCookie = !!(store.cookie && String(store.cookie).includes("SESSDATA"));
  const hasAK = !!(store.access_key && String(store.access_key).length > 8);
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
        "App 请求常无 Cookie，请打开 B 站首页一次以抓取 access_key；或登录态失效请重新登录"
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
  // Same Beijing day + already succeeded: skip remaining 0/10/19/21 slots.
  // Next Beijing midnight: day string changes => runs again (once per BJ day, not forever).
  if (store.lastRunDay === day && store.lastRunOk) {
    log("already succeeded Beijing day, skip slot", day);
    $done({});
    return;
  }

  // Avoid整点批量：北京时间时段内再随机延迟一段时间
  const delayMs = randomCheckinDelayMs();
  log("random delay ms", delayMs, "bj", beijingParts());
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
  const accessKey = store.access_key || "";
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
  if (!vip.isVip) {
    log("skip checkin: not VIP (no notification)");
    $done({});
    return;
  }

  const lines = [];
  let okAny = false;

  // 1) Live sign
  try {
    let signUrl =
      "https://api.live.bilibili.com/xlive/web-ucenter/v1/sign/DoSign";
    if (accessKey) {
      signUrl +=
        (signUrl.indexOf("?") >= 0 ? "&" : "?") +
        "access_key=" +
        encodeURIComponent(accessKey);
    }
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
    } else {
      lines.push(`直播签到: 失败 code=${j.code} ${j.message || j.msg || ""}`);
    }
  } catch (e) {
    lines.push("直播签到: 异常 " + e);
  }

  // 2) VIP 大积分签到（大会员；非会员会失败，忽略）
  // POST https://api.bilibili.com/pgc/activity/score/task/sign
  try {
    const headers = Object.assign({}, baseHeaders, {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://big.bilibili.com/",
      Origin: "https://www.bilibili.com",
    });
    let body = "";
    if (csrf) body = "csrf=" + encodeURIComponent(csrf);
    if (store.access_key) {
      body = (body ? body + "&" : "") + "access_key=" + encodeURIComponent(store.access_key);
    }
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
    // 0 success; common already-signed codes vary — treat message hints as ok
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
    } else if (j.code === -403 || j.code === 6001001 || /非大会员|不是大会员|权限不足|未开通/i.test(msg)) {
      lines.push("大积分签到: 非会员/无权限，跳过");
    } else {
      lines.push(
        "大积分签到: 失败 code=" +
          (j.code != null ? j.code : r.status) +
          " " +
          msg
      );
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
