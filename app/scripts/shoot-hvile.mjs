#!/usr/bin/env node
// Hvileskjerm screenshots + behaviour checks in headless Brave, real read-only data. Every non-GET /api call is blocked and
// HA call_service/execute_script/fire_event/play_media websocket messages are dropped in the page (no devices touched).
// Usage: node scripts/shoot-stellar.mjs <prefix> [baseUrl] [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [prefix = "shot", base = "http://127.0.0.1:8124/", out = "screenshots/hvile"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const port = 9690 + Math.floor(Math.random() * 90);
const proc = spawn(process.env.BROWSER_BIN ?? "brave", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/home-shoothv-${port}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
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
for (const [dev, w, h, mob] of [["desktop", 1440, 900, false], ["ipad", 1024, 1366, true], ["ipad-land", 1366, 1024, true]]) {
  await size(w, h, mob);
  for (const [tod, t, art] of [["day", "14:20", "a00"], ["evening", "19:40", "a10"], ["night", "01:30", "a00"]]) {
    await nav(`?hvile=1&hviletime=${t}&hvileart=${art}#/`, 7000);
    check(`${dev} ${tod}: overlay visible`, await on());
    if (tod === "night") check(`${dev} night: clock only`, await ev(`!document.querySelector('.hv-date') && !document.querySelector('.hv-cap') && !document.querySelector('.hv-slide')`));
    else check(`${dev} ${tod}: caption + art`, await ev(`!!document.querySelector('.hv-cap')?.innerText && !!document.querySelector('.hv-slide.show img')?.naturalWidth`), await ev(`document.querySelector('.hv-cap')?.innerText`));
    await shot(`${dev}-${tod}`);
  }
}
await size(1440, 900, false);
await nav(`?hvile=1&hvilemode=gradient&hviletime=07:30#/`, 4000); await shot("desktop-gradient-dawn");
// idle: settings mocked to 3 s timeout
await nav("#/", 3000); check("idle: not shown at once", !(await on()));
await sleep(9000); check("idle: appears after timeout", await on());
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a" }); await sleep(1200); check("key returns to Home", !(await on()));
await sleep(9000); check("idle again", await on());
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 400, y: 400, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 400, y: 400, button: "left", clickCount: 1 });
await sleep(1200); check("tap returns to Home", !(await on())); check("tap did not navigate", (await ev("location.hash")) === "#/" || (await ev("location.hash")) === "");
hvile = { timeoutMin: 0 };
await nav("#/settings", 5000); check("settings card present", await ev(`[...document.querySelectorAll('.hv-settings h3')].some(h => /Hvileskjerm/.test(h.innerText))`));
await ev(`document.querySelector('.hv-settings')?.scrollIntoView({ block: 'center' })`); await shot("settings-card");
await ev(`[...document.querySelectorAll('.hv-settings button')].find(b => /Vis nå/.test(b.innerText))?.click()`); await sleep(2500); check("Vis nå starts it", await on());
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" }); await sleep(1200);
await nav("#/", 4000); check("dock has Hvileskjerm", await ev(`!!document.querySelector('.dock [aria-label="Hvileskjerm"]')`));
await ev(`document.querySelector('.dock [aria-label="Hvileskjerm"]')?.click()`); await sleep(2500); check("dock starts it", await on());
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" }); await sleep(1200);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "k", code: "KeyK", modifiers: 2, windowsVirtualKeyCode: 75 }); await sleep(800);
await send("Input.insertText", { text: "hvile" }); await sleep(700); await shot("palette");
check("Ctrl+K lists Hvileskjerm", await ev(`[...document.querySelectorAll('.palette *')].some(e => e.children.length === 0 && /Hvileskjerm/.test(e.textContent))`));
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); await sleep(2500); check("palette starts it", await on());
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await nav(`?hvile=1&hviletime=14:20&hvileart=a17#/`, 6000); check("reduced motion: no Ken Burns", (await ev(`getComputedStyle(document.querySelector('.hv-slide img')).animationName`)) === "none");
const dropped = await ev("window.__drop");
check("no device commands sent", (dropped ?? []).length === 0, JSON.stringify(dropped)); console.log("blocked writes:", blocked.join(", ") || "none");
console.log(`${checks.filter(Boolean).length}/${checks.length} checks passed`);
ws.close(); proc.kill(); process.exit(0);
