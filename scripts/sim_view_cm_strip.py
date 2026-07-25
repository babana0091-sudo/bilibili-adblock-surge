#!/usr/bin/env python3
"""Offline simulate View/View CM strip strategies on a Surge response.dump.

Usage:
  python3 scripts/sim_view_cm_strip.py /path/to/View/response.dump

Reports which strategy keeps field5 (intro) byte-identical and removes under-player ads.
"""
from __future__ import annotations
import struct, gzip, sys
from pathlib import Path

def read_varint(buf, i):
    x = 0
    s = 0
    while i < len(buf):
        b = buf[i]
        i += 1
        x |= (b & 0x7F) << s
        if not (b & 0x80):
            return x, i
        s += 7
        if s > 70:
            raise ValueError("varint")
    raise ValueError("eof")

def write_varint(v: int) -> bytes:
    v &= 0xFFFFFFFF
    out = bytearray()
    while v >= 0x80:
        out.append((v & 0x7F) | 0x80)
        v >>= 7
    out.append(v)
    return bytes(out)

def skip(buf, i, wt):
    if wt == 0:
        return read_varint(buf, i)[1]
    if wt == 1:
        return i + 8
    if wt == 2:
        ln, i = read_varint(buf, i)
        return i + ln
    if wt == 5:
        return i + 4
    raise ValueError(wt)

def iter_fields(buf: bytes):
    i = 0
    n = len(buf)
    while i < n:
        start = i
        key, i = read_varint(buf, i)
        fn, wt = key >> 3, key & 7
        end = skip(buf, i, wt)
        payload = None
        if wt == 2:
            ln, j = read_varint(buf, i)
            payload = buf[j : j + ln]
        yield fn, wt, payload, buf[start:end]
        i = end

def field_payload(buf, want):
    for fn, wt, payload, raw in iter_fields(buf):
        if fn == want and payload is not None:
            return payload
    return None

def stats(label, buf, orig=None):
    fs = {}
    for fn, wt, payload, raw in iter_fields(buf):
        fs[fn] = fs.get(fn, 0) + (len(payload) if payload is not None else len(raw))
    ads = buf.count(b"type.googleapis.com/bilibili.ad.v1.")
    ugc = buf.count(b"ViewUgcAny")
    same5 = True
    if orig is not None:
        same5 = field_payload(buf, 5) == field_payload(orig, 5)
    print(
        f"{label}: len={len(buf)} ads={ads} ugc={ugc} f5={fs.get(5)} f7={fs.get(7)} f5_identical={same5}"
    )

def strategy_delete_f7(buf):
    return b"".join(raw for fn, wt, payload, raw in iter_fields(buf) if fn != 7)

def strategy_empty_f7(buf):
    """Keep field 7 present as empty message (tag 0x3a len 0)."""
    parts = []
    seen = False
    for fn, wt, payload, raw in iter_fields(buf):
        if fn == 7:
            parts.append(b"\x3a\x00")  # field7, len-delim, length=0
            seen = True
        else:
            parts.append(raw)
    if not seen:
        parts.append(b"\x3a\x00")
    return b"".join(parts)

def strategy_clear_f7_cards(buf):
    """Keep f7 shell; drop f7.field5 cards and f7.field2 ads_control."""
    parts = []
    for fn, wt, payload, raw in iter_fields(buf):
        if fn == 7 and payload is not None:
            inner = []
            for fn2, wt2, p2, r2 in iter_fields(payload):
                if fn2 in (2, 5):
                    continue
                inner.append(r2)
            newp = b"".join(inner)
            parts.append(write_varint((7 << 3) | 2) + write_varint(len(newp)) + newp)
        else:
            parts.append(raw)
    return b"".join(parts)

def load_grpc_dump(path: Path) -> bytes:
    raw = path.read_bytes()
    if len(raw) >= 5 and raw[0] in (0, 1):
        ln = struct.unpack(">I", raw[1:5])[0]
        payload = raw[5 : 5 + ln]
        if raw[0] == 1:
            return gzip.decompress(payload)
        return payload
    # maybe raw protobuf
    if raw[:2] == b"\x1f\x8b":
        return gzip.decompress(raw)
    return raw

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    path = Path(sys.argv[1])
    body = load_grpc_dump(path)
    print("file", path, "body", len(body))
    stats("ORIG", body)
    for name, fn in [
        ("A_delete_f7", strategy_delete_f7),
        ("B_empty_f7", strategy_empty_f7),
        ("C_clear_cards", strategy_clear_f7_cards),
    ]:
        out = fn(body)
        stats(name, out, body)
        Path(f"/tmp/view-sim-{name}.bin").write_bytes(out)

if __name__ == "__main__":
    main()
