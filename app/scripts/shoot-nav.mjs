#!/usr/bin/env node
// Flyt-navigation screenshots + screen recording. Forces prefs.nav="flyt" in the headless browser only
// (prefs GET is patched, PUTs are swallowed) so the owner's real settings are never changed.
// Usage: node scripts/shoot-nav.mjs [baseUrl] [outDir]
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const [base = process.env.HOME_WEB_URL ?? "http://127.0.0.1:8124/", out = "screenshots/nav"] = process.argv.slice(2);
const port = 9800 + Math.floor(Math.random() * 90);
const proc = spawn(process.env.BROWSER_BIN ?? "brave", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/home-shootnav-${port}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tab; for (let i = 0; i < 50 && !tab; i++) { await sleep(200); try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* retry */ } }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); const frames = [];
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method === "Page.screencastFrame") { frames.push({ t: d.params.metadata.timestamp, data: d.params.data }); send("Page.screencastFrameAck", { sessionId: d.params.sessionId }); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.error("eval error", JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result ?? r; };
mkdirSync(out, { recursive: true });
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const f = window.fetch.bind(window);
  window.fetch = async (u, o) => { const url = String(u && u.url || u);
    if (url.includes('/api/prefs/dashboard')) { if (o && o.method === 'PUT') return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
      const r = await f(u, o); const j = await r.json().catch(() => ({ value: null })); j.value = { ...(j.value || {}), nav: 'flyt', sidebar: 'full', updatedAt: 9e12 };
      return new Response(JSON.stringify(j), { headers: { 'content-type': 'application/json' } }); }
    return f(u, o); };
  try { const p = JSON.parse(localStorage.getItem('home.prefs.v1') || '{}'); localStorage.setItem('home.prefs.v1', JSON.stringify({ ...p, nav: 'flyt', updatedAt: 9e12 })); } catch {}
})();` });
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); const f = `${out}/${name}.png`; writeFileSync(f, Buffer.from(r.result.data, "base64")); console.log(f); };
const nav = async (hash, wait = 4500) => { await send("Page.navigate", { url: "about:blank" }); await sleep(250); await send("Page.navigate", { url: base + hash }); await sleep(wait); };
const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
const touch = (type, x, y) => send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
const key = (k, mods = 0) => send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : { ArrowDown: 40, Enter: 13, Escape: 27 }[k], modifiers: mods }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: k, modifiers: mods }));
const typeText = async (t) => { for (const ch of t) { await send("Input.insertText", { text: ch }); await sleep(90); } };
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const want = (n) => !ONLY || ONLY.includes(n);

// ── desktop ──
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
if (want("desktop")) {
  await nav("#/"); await shot("desktop-flyt-dashboard");
  const dock = JSON.parse((await ev(`JSON.stringify([...document.querySelectorAll('.dock-item')].map(b=>{const r=b.getBoundingClientRect();return [r.left+r.width/2, r.top+r.height/2]}))`)).result.value);
  const [x, y] = dock[3]; await mouse("mouseMoved", x, y); await sleep(700); await shot("desktop-flyt-dock-magnify");
  await mouse("mouseMoved", 700, 300); await sleep(300);
  await key("k", 2); await sleep(700); await shot("desktop-flyt-palette");
  await typeText("kjok"); await sleep(500); await shot("desktop-flyt-palette-search");
  await key("Escape"); await sleep(300);
  await nav("#/settings"); await ev(`document.querySelector('.main')?.scrollTo(0,0)`); await shot("desktop-flyt-settings");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await nav("#/"); await mouse("mouseMoved", dock[5][0], dock[5][1]); await sleep(700); await shot("desktop-flyt-dock-light");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
}
if (want("ipad")) {
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 1024, deviceScaleFactor: 2, mobile: true });
  await nav("#/"); await shot("ipad-flyt-dashboard");
}
// ── phone ──
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
if (want("phone")) {
  await nav("#/"); await shot("phone-flyt-dashboard");
  const h = JSON.parse((await ev(`(()=>{const r=document.querySelector('.pill-home').getBoundingClientRect();return JSON.stringify([r.left+r.width/2,r.top+r.height/2])})()`)).result.value);
  await touch("touchStart", h[0], h[1]); await sleep(700);
  await touch("touchMove", h[0] - 40, h[1] - 100); await sleep(500); await shot("phone-flyt-radial");
  await touch("touchMove", h[0] + 200, h[1] + 40); await sleep(100); await touch("touchEnd"); await sleep(500);
  await nav("#/"); await key("k", 2); await sleep(600); await typeText("stue"); await sleep(500); await shot("phone-flyt-palette");
}
// ── recording (desktop): dock hover sweep → palette → room via view transition → swipe back ──
if (want("rec")) {
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await nav("#/");
  const dock = JSON.parse((await ev(`JSON.stringify([...document.querySelectorAll('.dock-item')].map(b=>{const r=b.getBoundingClientRect();return [r.left+r.width/2, r.top+r.height/2]}))`)).result.value);
  await send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
  await sleep(600);
  for (let x = dock[0][0] - 60; x <= dock[dock.length - 1][0] + 40; x += 14) { await mouse("mouseMoved", x, dock[0][1]); await sleep(28); }
  await sleep(300); await mouse("mouseMoved", 640, 300); await sleep(400);
  await key("k", 2); await sleep(600); await typeText("stue"); await sleep(700); await key("ArrowDown"); await sleep(350); await key("ArrowDown"); await sleep(350); await key("ArrowUp"); await sleep(350);
  await key("Enter"); await sleep(1600);
  await mouse("mouseMoved", dock[2][0], dock[2][1]); await sleep(400); await mouse("mousePressed", dock[2][0], dock[2][1]); await mouse("mouseReleased", dock[2][0], dock[2][1]); await sleep(1400);
  await mouse("mouseMoved", dock[0][0], dock[0][1]); await sleep(400); await mouse("mousePressed", dock[0][0], dock[0][1]); await mouse("mouseReleased", dock[0][0], dock[0][1]); await sleep(1500);
  await send("Page.stopScreencast"); await sleep(300);
  const dir = `/tmp/navrec-${port}`; mkdirSync(dir, { recursive: true });
  // re-time frames to a constant 30 fps using their real timestamps
  const t0 = frames[0].t, total = frames[frames.length - 1].t - t0; let k = 0;
  for (let i = 0, fi = 0; i <= total * 30; i++) { const t = t0 + i / 30; while (fi + 1 < frames.length && frames[fi + 1].t <= t) fi++; writeFileSync(`${dir}/f${String(k++).padStart(5, "0")}.jpg`, Buffer.from(frames[fi].data, "base64")); }
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "30", "-i", `${dir}/f%05d.jpg`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-movflags", "+faststart", `${out}/flyt-demo.mp4`]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${out}/flyt-demo.mp4`, "-vf", "fps=15,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", `${out}/flyt-demo.gif`]);
  rmSync(dir, { recursive: true, force: true }); console.log(`${out}/flyt-demo.mp4 (${frames.length} frames, ${total.toFixed(1)} s)`);
}
proc.kill(); process.exit(0);
