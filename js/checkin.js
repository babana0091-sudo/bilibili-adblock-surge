// Bilibili daily check-in for Surge (network only)
// - type=http-request on fingerprint: capture Cookie / access_key
// - type=cron: hourly tick; only act at Beijing 00/10/19/21
//   Day key + slots use Asia/Shanghai (UTC+8), not device local TZ.
//   First success of that Beijing day marks lastRunOk; later slots no-op.
//
// Tasks (best-effort, API may change):
// 1) live DoSign  (GET /xlive/web-ucenter/v1/sign/DoSign)
// 2) VIP 大积分签到 (POST /pgc/activity/score/task/sign) — 大会员
// 3) exp/reward status
// 4) vip privilege receive (monthly B-coin coupon if eligible)
// 5) silver2coin (optional)
// Random delay before tasks to avoid整点风控
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
