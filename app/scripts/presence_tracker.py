#!/usr/bin/env python3
"""Presence tracker: LAN (ARP/ping/mDNS) + Tailscale -> HA device_tracker.see.
Config (personal, not in git): $HOME_PRESENCE_CONFIG (default data/presence.json).
Home = any source seen within away_after_s (default 600 s)."""
import json, os, re, subprocess, time, urllib.request
BASE = os.environ.get("HOME_AUTOMATION_DIR", "/home/owner/home-automation")
CFG = os.environ.get("HOME_PRESENCE_CONFIG", f"{BASE}/data/presence.json")
STATE = f"{BASE}/data/presence_state.json"
HA = os.environ.get("HOME_HA_URL", "http://localhost:8123")
TOKEN = open(os.environ.get("HOME_HA_TOKEN_FILE", f"{BASE}/secrets/ha_token")).read().strip()

def sh(*a, t=5):
    try: return subprocess.run(a, capture_output=True, text=True, timeout=t).stdout
    except Exception: return ""

def neigh():
    out = {}
    for l in sh("ip", "neigh").splitlines():
        m = re.match(r"(\S+) .*lladdr (\S+) (\S+)", l)
        if m and m.group(3) not in ("FAILED", "INCOMPLETE"): out[m.group(2).lower()] = (m.group(1), m.group(3))
    return out

def lan_seen(t, st):
    ip = st.get("ip")
    if not ip and t.get("mdns"):
        r = sh("avahi-resolve", "-4", "-n", t["mdns"]).split()
        ip = r[1] if len(r) > 1 else None
    if ip:
        sh("ping", "-c", "2", "-W", "1", ip)
    n = neigh()
    hit = n.get(t["mac"].lower())
    if hit and hit[1] in ("REACHABLE", "DELAY", "PROBE"):
        st["ip"] = hit[0]; return True
    if t.get("mdns"):
        r = sh("avahi-resolve", "-4", "-n", t["mdns"]).split()
        if len(r) > 1:
            sh("ping", "-c", "1", "-W", "1", r[1])
            h = neigh().get(t["mac"].lower())
            if h and h[1] in ("REACHABLE", "DELAY", "PROBE"):
                st["ip"] = h[0]; return True
    return False

def ts_online(name):
    if not name: return False
    try:
        d = json.loads(sh("tailscale", "status", "--json"))
        return any(p.get("DNSName", "").startswith(name + ".") and p.get("Online") for p in d.get("Peer", {}).values())
    except Exception: return False

def see(t, home, src):
    body = json.dumps({"dev_id": t["dev_id"], "host_name": t["name"], "location_name": "home" if home else "not_home",
                       "source_type": "router", "attributes": {"presence_source": src}}).encode()
    req = urllib.request.Request(f"{HA}/api/services/device_tracker/see", body, {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=10).read()

def main():
    cfg = json.load(open(CFG)); away = cfg.get("away_after_s", 600)
    state = json.load(open(STATE)) if os.path.exists(STATE) else {}
    now = time.time()
    for t in cfg["trackers"]:
        st = state.setdefault(t["dev_id"], {})
        srcs = [s for s, ok in (("wifi", lan_seen(t, st)), ("tailscale", False)) if ok]
        if not srcs and ts_online(t.get("tailscale")):
            srcs = ["tailscale"]  # tailnet online is not proof of home; only refreshes if also recently on LAN
            if now - st.get("last_lan", 0) < away: st["last"] = now
        if "wifi" in srcs: st["last"] = st["last_lan"] = now
        home = now - st.get("last", 0) < away
        st["home"] = home
        see(t, home, ",".join(srcs) or "none")
    json.dump(state, open(STATE, "w"))

if __name__ == "__main__":
    main()
