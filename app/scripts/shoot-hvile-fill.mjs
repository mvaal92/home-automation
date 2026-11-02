#!/usr/bin/env node
// Hvileskjerm edge-to-edge check: iPad portrait + landscape, "Safari" and "standalone" (display-mode + safe-area insets),
// in WebKit (Safari engine) and Chromium. Read-only: non-GET /api calls are stubbed, HA service calls dropped in-page.
// Usage: PW=<path to playwright> node scripts/shoot-hvile-fill.mjs <baseUrl> <outDir> [engines]
import { mkdirSync } from "node:fs";
const [base = "http://127.0.0.1:8124/", out = "screenshots/hvile", engines = "webkit,chromium"] = process.argv.slice(2);
const pw = await import(process.env.PW ?? "playwright"); mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = []; const check = (n, ok, i = "") => { checks.push(!!ok); console.log(ok ? "PASS" : "FAIL", n, i); };
const DROP = `(() => { window.__drop = []; const S = WebSocket.prototype.send; WebSocket.prototype.send = function (m) { try { const j = JSON.parse(m); if (/call_service|execute_script|fire_event|play_media/.test(j.type ?? "")) { window.__drop.push(j.type); return; } } catch {} return S.call(this, m); }; })();`;
const SA = { top: 24, bottom: 20, left: 0, right: 0 };
for (const eng of engines.split(",")) {
  let browser; try { browser = await pw[eng].launch(); } catch (e) { console.log("SKIP", eng, String(e.message).split("\n")[0]); continue; }
  for (const [orient, w, h] of [["portrait", 1024, 1366], ["landscape", 1366, 1024]]) for (const mode of ["safari", "standalone"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng !== "firefox" && eng !== "webkit" ? true : undefined, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1" });
    const page = await ctx.newPage(); await page.addInitScript(DROP);
    if (mode === "standalone") await page.addInitScript(`(() => { const sa = ${JSON.stringify(SA)}; const st = document.createElement('style'); st.textContent = ':root{--sat:'+sa.top+'px}'; document.documentElement.appendChild(st); const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /display-mode:\\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); Object.defineProperty(navigator, 'standalone', { get: () => true }); })();`);
    await page.route("**/api/**", (r) => { const q = r.request(); const p = new URL(q.url()).pathname; if (q.method() !== "GET" && q.method() !== "HEAD") return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); if (p === "/api/ambient/settings") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ timeoutMin: 0, nightDim: true }) }); if (p === "/api/prefs/events") return r.fulfill({ status: 204, body: "" }); return r.continue(); });
    if (mode === "standalone" && eng === "chromium") { const cdp = await ctx.newCDPSession(page); await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: SA }).catch(() => undefined); await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "display-mode", value: "standalone" }] }).catch(() => undefined); }
    const tag = `${eng}-${orient}-${mode}`;
    // a portrait-ish and a very wide painting, so both letterbox directions are exercised; hvilestep=8 → crossfade after 8 s
    await page.goto(`${base}?hvile=1&hviletime=14:20&hvileart=a00&hvilestep=8#/`); await sleep(6000);
    const geo = await page.evaluate(() => { const v = document.querySelector(".hvile"); const r = v?.getBoundingClientRect(); const im = document.querySelector(".hv-slide.show img"); return { W: innerWidth, H: innerHeight, r: r && [r.left, r.top, r.right, r.bottom], fit: im && getComputedStyle(im).objectFit, nat: im && [im.naturalWidth, im.naturalHeight], bg: v && getComputedStyle(v).backgroundColor }; });
    check(`${tag}: overlay covers viewport`, geo.r && geo.r[0] <= 0 && geo.r[1] <= 0 && geo.r[2] >= geo.W && geo.r[3] >= geo.H, JSON.stringify(geo.r) + ` vs ${geo.W}x${geo.H}`);
    check(`${tag}: painting loaded, object-fit cover`, geo.fit === "cover" && geo.nat?.[0] > 0, `${geo.fit} ${geo.nat}`);
    check(`${tag}: background matches painting (not default black)`, geo.bg && geo.bg !== "rgb(7, 8, 10)", geo.bg);
    // Ken Burns: scrub every image animation 0→100 % and verify the painted box always covers the viewport
    const pan = await page.evaluate(() => { const bad = []; for (const im of document.querySelectorAll(".hv-slide img")) { const a = im.getAnimations()[0]; if (!a) { bad.push("no-anim"); continue; } const d = a.effect.getComputedTiming().duration; const was = a.currentTime; for (const f of [0, .1, .25, .5, .75, .9, 1]) { a.currentTime = Math.min(d - 1, d * f); const r = im.getBoundingClientRect(); if (r.left > 0.5 || r.top > 0.5 || r.right < innerWidth - 0.5 || r.bottom < innerHeight - 0.5) bad.push(`${f}:${[r.left, r.top, r.right, r.bottom].map(Math.round)}`); } a.currentTime = was; } return bad; });
    check(`${tag}: pan animation never uncovers an edge`, pan.length === 0, pan.join(" "));
    // edge pixels must be painting, not a flat bar: compare top/bottom/left/right strips in the screenshot
    const shot = await page.screenshot({ path: `${out}/fill-${tag}.png` });
    const strips = await page.evaluate(async (b64) => { const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0); const sd = (sx, sy, sw, sh) => { const d = x.getImageData(sx, sy, sw, sh).data; let m = 0, s = 0, n = d.length / 4; for (let i = 0; i < d.length; i += 4) m += (d[i] + d[i + 1] + d[i + 2]) / 3; m /= n; for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3 - m; s += v * v; } return Math.sqrt(s / n); }; const W = img.width, H = img.height; return { top: sd(0, 0, W, 4), bottom: sd(0, H - 4, W, 4), left: sd(0, 0, 4, H), right: sd(W - 4, 0, 4, H) }; }, shot.toString("base64"));
    check(`${tag}: no flat bars at the edges`, Object.values(strips).every((v) => v > 2), JSON.stringify(Object.fromEntries(Object.entries(strips).map(([k, v]) => [k, Math.round(v * 10) / 10]))));
    // crossfade: previous painting stays opaque underneath while the next fades in
    await sleep(3200); const fade = await page.evaluate(() => ({ under: [...document.querySelectorAll(".hv-slide.under")].map((e) => getComputedStyle(e).opacity), show: [...document.querySelectorAll(".hv-slide.show")].map((e) => getComputedStyle(e).opacity), n: document.querySelectorAll(".hv-slide").length }));
    if (orient === "portrait" && mode === "safari") await page.screenshot({ path: `${out}/fill-${tag}-crossfade.png` });
    check(`${tag}: crossfade keeps previous painting opaque underneath`, fade.n >= 2 ? fade.under.every((o) => o === "1") : true, JSON.stringify(fade));
    const drop = await page.evaluate(() => window.__drop); check(`${tag}: no device commands`, !drop?.length, JSON.stringify(drop));
    await ctx.close();
  }
  await browser.close();
}
console.log(`${checks.filter(Boolean).length}/${checks.length} checks passed`); process.exit(checks.every(Boolean) ? 0 : 1);
