#!/usr/bin/env python3
"""Set a constant manual fan speed on an ecovent_v2 device (Flexit Bodo Supreme / Vents Arc Smart).

The ecovent_v2 'arc' profile exposes no speed control, but the firmware accepts the classic
Vents v2 rows: 0x0002 speed mode = 255 (manual) and 0x0044 manual speed = 0..100 %.
Measured on Bodo Supreme fw 0.1: 20 %≈240 rpm, 30≈480, 45≈1200, 60≈1800, 80≈2520, 100≈2820, ≤10 = stopp.

Usage (inside the HA container, called by shell_command):  ecovent_speed.py <entry-slug> <percent> | read
Host / device id / password come from HA's own config entry – nothing is stored here. Prints JSON.
"""
import json, re, socket, sys

import os
STORE = os.environ.get("ECOVENT_STORE", "/config/.storage/core.config_entries")

def slug(s): return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")

def entry(name):
    for e in json.load(open(STORE))["data"]["entries"]:
        if e["domain"] == "ecovent_v2" and name in (slug(e["data"].get("name", "")), slug(e["title"]), e["entry_id"]):
            return {**e["data"], "device_id": e.get("unique_id") or e["title"].split()[-1]}
    raise SystemExit(json.dumps({"ok": False, "error": f"ingen ecovent_v2-oppføring {name}"}))

def packet(fid, pwd, func, data):
    body = bytes([0x02, len(fid)]) + fid.encode() + bytes([len(pwd)]) + pwd.encode() + bytes([func]) + data
    cs = sum(body) & 0xFFFF
    return b"\xfd\xfd" + body + bytes([cs & 0xFF, cs >> 8])

def parse(r):
    if r[:2] != b"\xfd\xfd": raise ValueError("ugyldig svar")
    i = 3; i += 1 + r[i]; i += 1 + r[i]; i += 1
    data, res, page, j = r[i:-2], {}, 0, 0
    while j < len(data):
        b = data[j]
        if b == 0xFF: page = data[j + 1]; j += 2; continue
        if b == 0xFD: res[(page << 8) | data[j + 1]] = None; j += 2; continue
        if b == 0xFE: n = data[j + 1]; res[(page << 8) | data[j + 2]] = int.from_bytes(data[j + 3:j + 3 + n], "little"); j += 3 + n; continue
        res[(page << 8) | b] = data[j + 1]; j += 2
    return res

def xfer(cfg, func, data, tries=3):
    for _ in range(tries):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(2)
        try:
            s.sendto(packet(cfg["device_id"], cfg["password"], func, data), (cfg["ip_address"], int(cfg.get("port", 4000))))
            return parse(s.recvfrom(4096)[0])
        except (OSError, ValueError):
            continue
        finally:
            s.close()
    raise SystemExit(json.dumps({"ok": False, "error": "ingen svar fra viften"}))

def main():
    if len(sys.argv) < 3: raise SystemExit("usage: ecovent_speed.py <entry> <percent|read>")
    cfg = entry(sys.argv[1])
    if sys.argv[2] == "read":
        r = xfer(cfg, 0x01, bytes([0x02, 0x44, 0x4B]))
        print(json.dumps({"ok": True, "mode": r.get(0x02), "speed": r.get(0x44), "rpm": r.get(0x4B)})); return
    pct = max(0, min(100, int(float(sys.argv[2]))))
    r = xfer(cfg, 0x03, bytes([0x02, 0xFF, 0x44, pct]))
    ok = r.get(0x02) == 255 and r.get(0x44) == pct
    print(json.dumps({"ok": ok, "speed": r.get(0x44), "mode": r.get(0x02)}))
    if not ok: sys.exit(1)

if __name__ == "__main__":
    main()
