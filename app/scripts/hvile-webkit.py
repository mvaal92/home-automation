#!/usr/bin/env python3
"""Hvileskjerm edge-to-edge check in real WebKit (WebKitGTK, same engine family as iPad Safari), offscreen.
Read-only: user script stubs non-GET fetches and drops HA call_service/execute_script/fire_event/play_media.
Usage: hvile-webkit.py <baseUrl> <outDir> [legacy]"""
import json, sys, subprocess, gi
gi.require_version('Gtk', '3.0'); gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib
base, out = sys.argv[1], sys.argv[2]; legacy = len(sys.argv) > 3
GUARD = """(() => { const S = WebSocket.prototype.send; window.__drop = []; WebSocket.prototype.send = function (m) { try { const j = JSON.parse(m); if (/call_service|execute_script|fire_event|play_media/.test(j.type || '')) { window.__drop.push(j.type); return; } } catch (e) {} return S.call(this, m); };
 const F = window.fetch; window.fetch = (u, o) => { const m = ((o && o.method) || 'GET').toUpperCase(); if (m !== 'GET' && m !== 'HEAD') return Promise.resolve(new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })); return F(u, o); }; })();"""
STANDALONE = """(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /display-mode:\\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); try { Object.defineProperty(navigator, 'standalone', { get: () => true }); } catch (e) {} })();"""
LEGACY_CSS = ".hv-slide{display:grid!important;place-items:center!important}.hv-slide img{position:static!important}"
PROBE = """(() => { const v = document.querySelector('.hvile'); if (!v) return JSON.stringify({ none: true }); const r = v.getBoundingClientRect(); const im = document.querySelector('.hv-slide.show img');
 const bad = []; for (const i of document.querySelectorAll('.hv-slide img')) { const a = i.getAnimations()[0]; const d = a ? a.effect.getComputedTiming().duration : 0; const was = a ? a.currentTime : 0;
  for (const f of [0, .1, .25, .5, .75, .9, 1]) { if (a) a.currentTime = Math.min(d - 1, d * f); const q = i.getBoundingClientRect(); if (q.left > .5 || q.top > .5 || q.right < innerWidth - .5 || q.bottom < innerHeight - .5) bad.push(f + ':' + [q.left, q.top, q.right, q.bottom].map(Math.round)); if (!a) break; } if (a) a.currentTime = was; }
 const ir = im && im.getBoundingClientRect();
 return JSON.stringify({ W: innerWidth, H: innerHeight, r: [r.left, r.top, r.right, r.bottom], img: ir && [ir.left, ir.top, ir.right, ir.bottom].map(Math.round), fit: im && getComputedStyle(im).objectFit, nat: im && [im.naturalWidth, im.naturalHeight], bg: getComputedStyle(v).backgroundColor, pan: bad,
  under: [...document.querySelectorAll('.hv-slide.under')].map((e) => getComputedStyle(e).opacity), n: document.querySelectorAll('.hv-slide').length, drop: window.__drop, ua: navigator.userAgent.slice(0, 60) }); })()"""
results = []; ok_all = True
def strips_of(surf):
    """stddev of grey level in the top and bottom 4 rows (a flat bar ≈ 0)."""
    w, h, st = surf.get_width(), surf.get_height(), surf.get_stride(); d = surf.get_data()
    def sd(y0):
        vals = [(d[y * st + x * 4] + d[y * st + x * 4 + 1] + d[y * st + x * 4 + 2]) / 3 for y in range(y0, y0 + 4) for x in range(0, w, 2)]
        m = sum(vals) / len(vals); return round((sum((v - m) ** 2 for v in vals) / len(vals)) ** .5, 1)
    return [sd(0), sd(h - 4)]
def run(cases):
    if not cases: Gtk.main_quit(); return
    (orient, w, h, mode) = cases[0]; tag = f"webkit{'-legacy' if legacy else ''}-{orient}-{mode}"
    wv = WebKit2.WebView(); ucm = wv.get_user_content_manager()
    ucm.add_script(WebKit2.UserScript(GUARD + (STANDALONE if mode == "standalone" else ""), WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
    if legacy: ucm.add_style_sheet(WebKit2.UserStyleSheet(LEGACY_CSS, WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserStyleLevel.USER, None, None))
    s = wv.get_settings(); s.set_user_agent("Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"); 
    win = Gtk.OffscreenWindow(); win.set_default_size(w, h); win.add(wv); win.show_all()
    wv.load_uri(f"{base}?hvile=1&hviletime=14:20&hvileart=a00&hvilestep=8#/")
    def snap(name, then):
        def done(v, res):
            try: surf = v.get_snapshot_finish(res); f = f"{out}/{name}.png"; surf.write_to_png(f); st = strips_of(surf)
            except Exception as e: print("snapshot failed", e, flush=True); st = []
            then(st)
        wv.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, done)
    def probe(then):
        def done(v, res):
            try: g = json.loads(v.evaluate_javascript_finish(res).to_string())
            except Exception as e: g = {"err": str(e)}
            then(g)
        wv.evaluate_javascript(PROBE, -1, None, None, None, done)
    def step1():
        def got(g):
            def shot(st):
                g["strips"] = st
                def later():
                    def got2(g2):
                        g["under_after_step"] = g2.get("under"); g["n_after_step"] = g2.get("n")
                        report(tag, g); win.destroy(); GLib.idle_add(lambda: run(cases[1:]) and False)
                    if orient == "portrait" and mode == "safari" and not legacy: snap(f"fill-{tag}-crossfade", lambda _s: probe(got2))
                    else: probe(got2)
                    return False
                GLib.timeout_add(4500, later)
            snap(f"fill-{tag}", shot)
        probe(got); return False
    GLib.timeout_add(7000, step1)
def report(tag, g):
    global ok_all
    W, H = g.get("W"), g.get("H"); r = g.get("r") or [9, 9, 0, 0]
    C = [("overlay covers viewport", r[0] <= 0 and r[1] <= 0 and r[2] >= W and r[3] >= H, f"{r} vs {W}x{H}"),
         ("painting box covers viewport (no letterbox)", bool(g.get("img")) and g["img"][0] <= 0 and g["img"][1] <= 0 and g["img"][2] >= W and g["img"][3] >= H, f"img={g.get('img')} fit={g.get('fit')} nat={g.get('nat')}"),
         ("pan never uncovers an edge", not g.get("pan"), " ".join(g.get("pan") or [])),
         ("no flat bars top/bottom (strip stddev>2)", all(float(x) > 2 for x in g.get("strips", [])) and len(g.get("strips", [])) == 2, str(g.get("strips"))),
         ("background = painting colour", g.get("bg") not in (None, "rgb(7, 8, 10)"), str(g.get("bg"))),
         ("crossfade: previous painting opaque underneath", (g.get("n_after_step") or 0) < 2 or all(o == "1" for o in g.get("under_after_step") or []), f"n={g.get('n_after_step')} under={g.get('under_after_step')}"),
         ("no device commands", not g.get("drop"), str(g.get("drop")))]
    for n, ok, i in C:
        ok_all &= bool(ok); print("PASS" if ok else "FAIL", f"{tag}: {n}", i, flush=True)
GLib.idle_add(lambda: run([(o, w, h, m) for (o, w, h) in [("portrait", 1024, 1366), ("landscape", 1366, 1024)] for m in ["safari", "standalone"]]) and False)
GLib.timeout_add(240000, lambda: (print("TIMEOUT"), Gtk.main_quit()))
Gtk.main(); sys.exit(0 if ok_all else 1)
