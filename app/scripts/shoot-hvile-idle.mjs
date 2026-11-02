#!/usr/bin/env node
// Hvileskjerm idle-timer checks on every tab (headless iPad) in headless Brave, real read-only data. Every non-GET /api call is blocked and
// HA call_service/execute_script/fire_event/play_media websocket messages are dropped in the page (no devices touched).
// Usage: node scripts/shoot-hvile-idle.mjs <prefix> [baseUrl] [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [prefix = "shot", base = "http://127.0.0.1:8124/", out = "screenshots/hvile"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const port = 9690 + Math.floor(Math.random() * 90);
const proc = spawn(process.env.BROWSER_BIN ?? "brave", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/home-shoothvi-${port}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tab; for (let i = 0; i < 60 && !tab; i++) { await sleep(200); try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* */ } }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); const blocked = [];
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const reply = (rid, code, body) => send("Fetch.fulfillRequest", { requestId: rid, responseCode: code, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
let navMode = "flyt"; let theme = "dark"; let hvile = { timeoutMin: 0.05 };
ws.addEventListener("message", async (m) => {
  const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method !== "Fetch.requestPaused") return;
  const q = d.params.request; const p = new URL(q.url).pathname; const rid = d.params.requestId;
  try {
    if (q.method !== "GET" && q.method !== "HEAD") { blocked.push(`${q.method} ${p}`); return reply(rid, 200, { ok: true, test: "blocked" }); }
    if (p === "/api/prefs/events") return send("Fetch.fulfillRequest", { requestId: rid, responseCode: 204, responseHeaders: [], body: "" });
    if (p === "/api/ambient/settings") return reply(rid, 200, hvile);
    if (p === "/api/prefs/dashboard") { const r = await (await fetch(base + "api/prefs/dashboard")).json(); return reply(rid, 200, { ...r, value: { ...(r.value ?? {}), nav: navMode, theme } }); }
    return send("Fetch.continueRequest", { requestId: rid });
  } catch (e) { return send("Fetch.continueRequest", { requestId: rid }); }
});
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Page.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { window.__drop = []; const S = WebSocket.prototype.send; WebSocket.prototype.send = function (m) { try { const j = JSON.parse(m); if (/call_service|execute_script|fire_event|play_media/.test(j.type ?? "")) { window.__drop.push(j.type); const w = this; setTimeout(() => w.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: j.id, type: "result", success: true, result: { context: {} } }) })), 10); return; } } catch {} return S.call(this, m); }; localStorage.removeItem('home.prefs.v1'); })();` });
const shot = async (name, full) => { await sleep(600); const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!full }); const f = `${out}/${prefix}-${name}.png`; writeFileSync(f, Buffer.from(r.result.data, "base64")); console.log(f); };
const nav = async (hash, wait = 5000) => { await send("Page.navigate", { url: "about:blank" }); await sleep(200); await send("Page.navigate", { url: base + hash }); await sleep(wait); };
const size = (width, height, mobile) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
const checks = []; const check = (n, ok, i = "") => { checks.push(!!ok); console.log(ok ? "PASS" : "FAIL", n, i); };
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
const on = () => ev(`!!document.querySelector('.hvile')`);
const route = () => ev(`document.querySelector('[data-route]')?.dataset.route ?? ''`);
const T = 3000; // hvile.timeoutMin 0.05 = 3 s (mocked settings, never saved)
const tap = async (x = 300, y = 500) => { await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] }); await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); };
// load a tab while keeping the idle clock fresh (page load itself takes longer than the 3 s test timeout)
const open = async (hash) => { await nav(hash, 1500); await tap(20, 20); await sleep(1500); await tap(20, 20); await sleep(1200); await tap(20, 20); };
await send("Browser.grantPermissions", { permissions: ["wakeLockScreen"] }).catch(() => undefined);
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1", platform: "iPad" });
await size(1024, 1366, true); await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
// manifest / iOS meta
await nav("#/", 3000);
check("manifest linked + standalone 'Hjem'", await ev(`fetch(document.querySelector('link[rel=manifest]').href).then(r=>r.json()).then(m=>m.display==='standalone'&&m.name==='Hjem'&&m.short_name==='Hjem')`));
check("apple meta (capable, status bar, title, touch icon)", await ev(`!!document.querySelector('meta[name=apple-mobile-web-app-capable][content=yes]') && !!document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]') && document.querySelector('meta[name=apple-mobile-web-app-title]')?.content==='Hjem' && !!document.querySelector('link[rel=apple-touch-icon]') && document.title==='Hjem'`));
check("apple-touch-icon loads", await ev(`fetch(document.querySelector('link[rel=apple-touch-icon]').href).then(r=>r.ok && r.headers.get('content-type')==='image/png')`));
// idle on every tab
for (const tab of ["luft", "kalender", "energy", "rooms", "lydboker", "notater", "vedlikehold", "settings", "chat"]) {
  await open(`#/${tab}`); await sleep(300);
  const r0 = await route(); check(`${tab}: not shown right away`, !(await on()));
  await sleep(T + 1800); check(`${tab}: idle -> Hvileskjerm`, await on(), r0);
  if (tab === "luft") await shot("ipad-idle-from-luft");
  if (tab === "luft") check("wake lock requested while resting", ["on", "denied", "unsupported"].includes(await ev(`document.documentElement.dataset.wakelock`)), await ev(`document.documentElement.dataset.wakelock`));
  await tap(); await sleep(1200); check(`${tab}: tap exits, same tab`, !(await on()) && (await route()) === r0, await route());
}
check("wake lock released after exit", !(await ev(`document.documentElement.dataset.wakelock`)));
// resets: touch / key / scroll / pointer keep it away
await open("#/settings");
for (const [name, fn] of [
  ["touch", () => tap(20, 20)],
  ["key", () => send("Input.dispatchKeyEvent", { type: "keyDown", key: "Shift" })],
  ["scroll", () => ev(`(document.querySelector('.main') ?? document.scrollingElement).scrollBy(0, 40), true`)],
  ["pointer", () => send("Input.dispatchMouseEvent", { type: "mousePressed", x: 5, y: 1300, button: "left", clickCount: 1 }).then(() => send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 1300, button: "left", clickCount: 1 }))],
]) { for (let i = 0; i < 5; i++) { await sleep(1000); await fn(); } check(`${name} activity resets the timer (5 s > 3 s timeout)`, !(await on())); }
await sleep(T + 1800); check("idle after activity stops", await on()); await tap(); await sleep(1200);
// hidden -> visible
await ev(`(() => { window.__vis = 'visible'; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__vis }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__vis !== 'visible' }); return true; })()`);
await tap(20, 20); await ev(`window.__vis='hidden'; document.dispatchEvent(new Event('visibilitychange')); true`);
await sleep(T + 2000); check("hidden: not shown", !(await on()));
await ev(`window.__vis='visible'; document.dispatchEvent(new Event('visibilitychange')); true`); await sleep(800);
check("visible again: idle clock restarted (not instant)", !(await on()));
await sleep(T + 1500); check("visible again: idle -> Hvileskjerm", await on()); await tap(); await sleep(1200);
// overlays don't block: chat panel + device sheet
await open("#/kalender"); await ev(`document.querySelector('.ask-btn')?.click(), true`); await sleep(500);
check("chat panel open", await ev(`!!document.querySelector('.chat-panel')`)); await sleep(T + 1800); check("chat panel open: still goes idle", await on());
await tap(); await sleep(1200); check("chat panel still there after tap", await ev(`!!document.querySelector('.chat-panel')`));
// night mode keeps black screen + wake lock
await open(`?hviletime=01:30#/luft`); await sleep(T + 1800);
check("night: black clock-only", await ev(`!!document.querySelector('.hvile.night') && !document.querySelector('.hv-slide')`)); await shot("ipad-idle-night");
check("night: wake lock still requested", ["on", "denied", "unsupported"].includes(await ev(`document.documentElement.dataset.wakelock`)), await ev(`document.documentElement.dataset.wakelock`));
const dropped = await ev("window.__drop");
check("no device commands sent", (dropped ?? []).length === 0, JSON.stringify(dropped)); console.log("blocked writes:", blocked.join(", ") || "none");
console.log(`${checks.filter(Boolean).length}/${checks.length} checks passed`);
ws.close(); proc.kill(); process.exit(checks.every(Boolean) ? 0 : 1);
