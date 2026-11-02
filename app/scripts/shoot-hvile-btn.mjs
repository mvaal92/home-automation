#!/usr/bin/env node
// Hvilemodus top-bar button + Home tile checks in headless Brave, real read-only data. Every non-GET /api call is blocked and
// HA call_service/execute_script/fire_event/play_media websocket messages are dropped in the page (no devices touched).
// Usage: node scripts/shoot-hvile-btn.mjs <prefix> [baseUrl] [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [prefix = "shot", base = "http://127.0.0.1:8124/", out = "screenshots/hvile"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const port = 9690 + Math.floor(Math.random() * 90);
const proc = spawn(process.env.BROWSER_BIN ?? "brave", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/home-shoothvb-${port}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tab; for (let i = 0; i < 60 && !tab; i++) { await sleep(200); try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* */ } }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); const blocked = [];
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const reply = (rid, code, body) => send("Fetch.fulfillRequest", { requestId: rid, responseCode: code, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
let extraAdded = []; let navMode = "flyt"; let theme = "dark"; let hvile = { timeoutMin: 0 };
ws.addEventListener("message", async (m) => {
  const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method !== "Fetch.requestPaused") return;
  const q = d.params.request; const p = new URL(q.url).pathname; const rid = d.params.requestId;
  try {
    if (q.method !== "GET" && q.method !== "HEAD") { blocked.push(`${q.method} ${p}`); return reply(rid, 200, { ok: true, test: "blocked" }); }
    if (p === "/api/prefs/events") return send("Fetch.fulfillRequest", { requestId: rid, responseCode: 204, responseHeaders: [], body: "" });
    if (p === "/api/ambient/settings") return reply(rid, 200, hvile);
    if (p === "/api/prefs/dashboard") { const r = await (await fetch(base + "api/prefs/dashboard")).json(); return reply(rid, 200, { ...r, value: { ...(r.value ?? {}), nav: navMode, theme, addedCards: [...((r.value ?? {}).addedCards ?? []), ...extraAdded] } }); }
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
const tap = async (x, y) => { await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] }); await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); };
const exitHv = async () => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" }); await sleep(1300); };
const GEO = `(() => { const b = document.querySelector('.hvile-btn'); if (!b) return { missing: true }; const r = b.getBoundingClientRect(); const s = getComputedStyle(b); const tr = b.closest('.topbar-right'); const trr = tr.getBoundingClientRect();
  const sibs = [...tr.children].filter((e) => e.getBoundingClientRect().width > 0); const rows = new Set(sibs.map((e) => Math.round(e.getBoundingClientRect().top / 6))).size;
  const hit = (a, c) => Math.min(a.right, c.right) - Math.max(a.left, c.left) > 1 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 1;
  const clash = []; for (const x of sibs) for (const y of sibs) if (x !== y && x.compareDocumentPosition(y) & 4 && hit(x.getBoundingClientRect(), y.getBoundingClientRect())) clash.push((x.ariaLabel || x.className) + '×' + (y.ariaLabel || y.className));
  const page = document.querySelector('.page, .chat-page'); const under = [];
  if (page) { for (const e of page.querySelectorAll('button, a, input, .seg, .cart-pill')) { const q = e.getBoundingClientRect(); if (q.width && hit(q, trr) && getComputedStyle(e).visibility !== 'hidden') under.push((e.innerText || e.ariaLabel || e.className).trim().slice(0, 24)); }
    for (const h of page.querySelectorAll('h1')) { const rg = document.createRange(); rg.selectNodeContents(h); for (const q of rg.getClientRects()) if (hit(q, trr)) under.push('h1 «' + h.innerText.slice(0, 20) + '»'); } }
  const nb = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { vis: r.width > 20 && s.display !== 'none' && s.visibility !== 'hidden', inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0, label: b.getAttribute('aria-label'), title: b.title, size: [Math.round(r.width), Math.round(r.height)],
    sameStyle: (() => { const o = [...tr.querySelectorAll('.icon-btn')].find((e) => e !== b && getComputedStyle(e).display !== 'none' && !e.classList.contains('ask-btn')) || tr.querySelector('.ask-btn'); if (!o) return true; const q = o.getBoundingClientRect(); return Math.abs(q.height - r.height) <= 1 && Math.abs(Math.round(q.top + q.height / 2) - Math.round(r.top + r.height / 2)) <= 1; })(),
    rows, clash, under, topmost: nb === b || b.contains(nb) }; })()`;
const ROUTES = ["home", "rooms", "kalender", "luft", "barn", "energy", "chat", "notater", "robots", "vedlikehold", "sonos", "spotify", "lydboker", "oda", "settings"];
for (const [dev, w, h, mob] of [["ipad", 1024, 1366, true], ["ipad-land", 1366, 1024, true], ["phone", 390, 844, true], ["desktop", 1440, 900, false]]) {
  await size(w, h, mob); await send("Emulation.setTouchEmulationEnabled", { enabled: mob, maxTouchPoints: mob ? 5 : 0 });
  const bad = [];
  for (const r of ROUTES) {
    await nav(r === "home" ? "#/" : `#/${r}`, 4500); const g = await ev(GEO);
    const ok = g && !g.missing && g.vis && g.inView && g.label === "Hvilemodus" && g.title === "Hvilemodus" && g.rows === 1 && !g.clash.length && !g.under.length && g.topmost && g.sameStyle;
    if (!ok) bad.push(`${r}: ${JSON.stringify(g)}`);
    if (r === "kalender" || r === "oda") { /* busiest headers */ }
    if (r === "home" || r === "oda") { const rr = await ev(`(() => { const r = document.querySelector('.topbar-right').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`); if (dev !== "desktop" && dev !== "ipad-land") { const clip = { x: 0, y: 0, width: w, height: Math.min(h, Math.max(120, Math.ceil(rr[1] + rr[3] + 70))), scale: 1 }; const sh = await send("Page.captureScreenshot", { format: "jpeg", quality: 85, clip }); writeFileSync(`${out}/${prefix}-${dev}-${r}.jpg`, Buffer.from(sh.result.data, "base64")); } }
  }
  check(`${dev}: button visible, labelled, aligned, no overlap/wrap on all ${ROUTES.length} views`, bad.length === 0, bad.join("\n   "));
  // click opens Hvileskjerm immediately, from a non-Home tab
  await nav("#/luft", 4000);
  const c = await ev(`(() => { const r = document.querySelector('.hvile-btn').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  if (mob) await tap(c[0], c[1]); else { await send("Input.dispatchMouseEvent", { type: "mousePressed", x: c[0], y: c[1], button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c[0], y: c[1], button: "left", clickCount: 1 }); }
  await sleep(900); check(`${dev}: tap opens Hvileskjerm`, await on()); await exitHv(); check(`${dev}: back on Luft`, (await ev("location.hash")) === "#/luft");
}
// Home tile: offered under «Legg til kort», not in the layout by default
await size(1024, 1366, true); await nav("#/", 4500);
check("tile not on Home by default", !(await ev(`!!document.querySelector('.hvile-tile')`)));
await ev(`document.querySelector('.edit-btn')?.click(), true`); await sleep(800);
await ev(`[...document.querySelectorAll('.eb-btn')].find(b => /Legg til kort/.test(b.innerText))?.click(), true`); await sleep(900);
check("«Legg til kort» lists Hvilemodus", await ev(`[...document.querySelectorAll('body *')].some(e => e.children.length === 0 && /^Hvilemodus$/.test(e.textContent.trim()))`));
await ev(`[...document.querySelectorAll('.eb-btn')].find(b => /Ferdig/.test(b.innerText))?.click(), true`); await sleep(600);
// the real «add» writes prefs (stubbed here so the live layout is untouched) – emulate the saved result instead
extraAdded = ["hvile"]; await nav("#/", 4500);
check("tile renders when added (emulated prefs, live layout untouched)", await ev(`!!document.querySelector('.hvile-tile')`));
await ev(`document.querySelector('.hvile-tile')?.scrollIntoView({ block: 'center' }), true`); await sleep(400);
await ev(`document.querySelector('.hvile-tile')?.click(), true`); await sleep(900); check("tile opens Hvileskjerm", await on()); await exitHv();
// existing entries still work
await nav("#/settings", 4500); await ev(`[...document.querySelectorAll('.hv-settings button')].find(b => /Vis nå/.test(b.innerText))?.click(), true`); await sleep(1200); check("Settings «Vis nå» still works", await on()); await exitHv();
await size(1440, 900, false); await nav("#/", 4500);
await ev(`document.querySelector('.dock [aria-label="Hvileskjerm"]')?.click(), true`); await sleep(1200); check("dock entry still works", await on()); await exitHv();
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "k", code: "KeyK", modifiers: 2, windowsVirtualKeyCode: 75 }); await sleep(700); await send("Input.insertText", { text: "hvile" }); await sleep(700);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); await sleep(1300); check("Ctrl+K entry still works", await on());
const dropped = await ev("window.__drop"); check("no device commands sent", (dropped ?? []).length === 0, JSON.stringify(dropped)); console.log("stubbed writes:", blocked.join(", ") || "none");
console.log(`${checks.filter(Boolean).length}/${checks.length} checks passed`); ws.close(); proc.kill(); process.exit(checks.every(Boolean) ? 0 : 1);
