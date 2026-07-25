// View/View under-player ad: replace ViewReply field 7 with EMPTY message only.
// Why not delete field 7? App may require the field key present (empty CM vs absent).
// Why not recursive ad Any wipe? Earlier versions nuked intro parents -> blank 简介.
// Offline sim (scripts/sim_view_cm_strip.py): empty f7 keeps field5 byte-identical.
//
// ONLY matches bilibili.app.viewunite.v1.View/View
// binary-body-mode=true required.

function parseArgs(raw) {
  const out = { ad_normal: true, ad_pause: true, debug: false };
  if (raw == null || raw === '') return out;
  let src = raw;
  if (typeof raw === 'string') {
    try {
      if (raw.trim().startsWith('{')) src = JSON.parse(raw);
      else {
        const obj = {};
        String(raw).split(/[&,]/).forEach((pair) => {
          const m = pair.match(/^\s*([^:=]+)\s*[:=]\s*(.*)\s*$/);
          if (!m) return;
          obj[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
        });
        src = obj;
      }
    } catch (e) {
      src = {};
    }
  }
  if (src && typeof src === 'object') {
    for (const k of Object.keys(out)) {
      if (src[k] === undefined) continue;
      const v = src[k];
      if (typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'string')
        out[k] = !/^(0|false|no|off|关闭|否)$/i.test(v.trim());
      else out[k] = !!v;
    }
  }
  return out;
}

function log() {
  if (!opts.debug) return;
  try {
    console.log.apply(console, ['[BiliAD][empty-f7]'].concat([].slice.call(arguments)));
  } catch (e) {}
}

const opts = parseArgs(typeof $argument !== 'undefined' ? $argument : '');
const url = ($request && $request.url) || '';
const enabled = !!(opts.ad_normal || opts.ad_pause);
const isView =
  /bilibili\.app\.viewunite\.v1\.View\/View(?:\?|$)/i.test(url);

if (!enabled || !isView) {
  $done({});
} else {
  try {
    const body = toU8($response && $response.body);
    if (!body || body.length < 6) {
      $done({});
    } else {
      const headers = cloneHeaders(($response && $response.headers) || {});
      const encKey = findHeaderKey(headers, 'grpc-encoding') || 'grpc-encoding';
      const enc = String(headers[encKey] || '').toLowerCase();
      const frames = parseFrames(body);
      if (!frames.length) {
        $done({});
      } else {
        let changed = false;
        const outFrames = [];
        for (let fi = 0; fi < frames.length; fi++) {
          const fr = frames[fi];
          let msg = fr.payload;
          const wasGzip = fr.comp === 1 || (fi === 0 && enc === 'gzip' && fr.comp !== 0);
          if (fr.comp === 1) {
            msg = ungzip(msg);
          } else if (enc === 'gzip' && fr.comp === 0) {
            // unusual; try ungzip whole payload
            try {
              msg = ungzip(msg);
            } catch (e) {}
          }
          const before = msg.length;
          const afterMsg = replaceField7Empty(msg);
          if (afterMsg.length !== before || !u8eq(afterMsg, msg)) {
            changed = true;
            // Prefer identity frame to avoid re-gzip dependency
            outFrames.push({ comp: 0, payload: afterMsg });
            log('frame', fi, before, '->', afterMsg.length);
          } else {
            outFrames.push(fr);
          }
        }
        if (!changed) {
          $done({});
        } else {
          const outBody = buildFrames(outFrames);
          // Body is uncompressed gRPC frames now
          setHeader(headers, 'grpc-encoding', 'identity');
          // prevent double decode
          deleteHeader(headers, 'content-encoding');
          $done({ body: outBody, headers: headers });
        }
      }
    }
  } catch (e) {
    log('error', String(e && e.message ? e.message : e));
    // fail open — never blank the page on script error
    $done({});
  }
}

function toU8(b) {
  if (!b) return null;
  if (b instanceof Uint8Array) return b;
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (typeof b === 'string') {
    const a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i) & 0xff;
    return a;
  }
  try {
    return new Uint8Array(b);
  } catch (e) {
    return null;
  }
}

function u8eq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function cloneHeaders(h) {
  const o = {};
  const keys = Object.keys(h || {});
  for (let i = 0; i < keys.length; i++) o[keys[i]] = h[keys[i]];
  return o;
}

function findHeaderKey(h, name) {
  const keys = Object.keys(h || {});
  const low = name.toLowerCase();
  for (let i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === low) return keys[i];
  return null;
}

function setHeader(h, name, val) {
  const k = findHeaderKey(h, name);
  if (k) h[k] = val;
  else h[name] = val;
}

function deleteHeader(h, name) {
  const k = findHeaderKey(h, name);
  if (k) delete h[k];
}

function parseFrames(data) {
  const frames = [];
  let i = 0;
  while (i + 5 <= data.length) {
    const comp = data[i];
    const len =
      ((data[i + 1] << 24) | (data[i + 2] << 16) | (data[i + 3] << 8) | data[i + 4]) >>> 0;
    if (i + 5 + len > data.length) break;
    frames.push({ comp: comp, payload: data.subarray(i + 5, i + 5 + len) });
    i += 5 + len;
  }
  return frames;
}

function buildFrames(frames) {
  let n = 0;
  for (let i = 0; i < frames.length; i++) n += 5 + frames[i].payload.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < frames.length; i++) {
    const p = frames[i].payload;
    out[o++] = frames[i].comp & 0xff;
    const len = p.length >>> 0;
    out[o++] = (len >>> 24) & 0xff;
    out[o++] = (len >>> 16) & 0xff;
    out[o++] = (len >>> 8) & 0xff;
    out[o++] = len & 0xff;
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Replace all top-level field 7 with empty length-delimited message. Other fields copied raw. */
function replaceField7Empty(buf) {
  let i = 0;
  const parts = [];
  let seen = false;
  while (i < buf.length) {
    const start = i;
    let key;
    try {
      const r = readVarint(buf, i);
      key = r[0];
      i = r[1];
    } catch (e) {
      parts.push(buf.subarray(start));
      break;
    }
    const fn = key >>> 3;
    const wt = key & 7;
    let end;
    try {
      end = skipField(buf, i, wt);
    } catch (e) {
      parts.push(buf.subarray(start));
      break;
    }
    if (fn === 7) {
      // empty message field 7: key=(7<<3)|2 = 0x3a, len=0
      parts.push(Uint8Array.of(0x3a, 0x00));
      seen = true;
    } else {
      parts.push(buf.subarray(start, end));
    }
    i = end;
  }
  if (!seen) {
    // no field7 in response — nothing to do for under-player CM
    return buf;
  }
  return concat(parts);
}

function readVarint(buf, i) {
  let x = 0;
  let s = 0;
  while (i < buf.length) {
    const b = buf[i++];
    x |= (b & 0x7f) << s;
    if ((b & 0x80) === 0) return [x >>> 0, i];
    s += 7;
    if (s > 35) throw new Error('varint');
  }
  throw new Error('eof');
}

function skipField(buf, i, wt) {
  if (wt === 0) return readVarint(buf, i)[1];
  if (wt === 1) {
    if (i + 8 > buf.length) throw new Error('64');
    return i + 8;
  }
  if (wt === 2) {
    const r = readVarint(buf, i);
    const j = r[1] + r[0];
    if (j > buf.length) throw new Error('len');
    return j;
  }
  if (wt === 5) {
    if (i + 4 > buf.length) throw new Error('32');
    return i + 4;
  }
  throw new Error('wt');
}

function concat(parts) {
  let n = 0;
  for (let i = 0; i < parts.length; i++) n += parts[i].length;
  const o = new Uint8Array(n);
  let p = 0;
  for (let i = 0; i < parts.length; i++) {
    o.set(parts[i], p);
    p += parts[i].length;
  }
  return o;
}

function ungzip(data) {
  if (typeof $utils !== 'undefined' && typeof $utils.ungzip === 'function') {
    const r = $utils.ungzip(data);
    return r instanceof Uint8Array ? r : new Uint8Array(r);
  }
  // pako may exist if other scripts loaded — usually not shared.
  if (typeof pako !== 'undefined' && pako.ungzip) {
    return pako.ungzip(data);
  }
  throw new Error('no-ungzip');
}
