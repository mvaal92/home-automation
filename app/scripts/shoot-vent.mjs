#!/usr/bin/env node
// Luft-tab ventilation-zone screenshots in headless Brave, real read-only data. Non-GET /api calls are blocked and
// HA call_service/execute_script websocket messages are dropped in the page (no devices touched).
// Usage: node scripts/shoot-vent.mjs [prefix] [baseUrl] [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [prefix = "vent", base = "http://127.0.0.1:8124/", out = "screenshots/ventilasjon"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const port = 9690 + Math.floor(Math.random() * 90);
const proc = spawn(process.env.BROWSER_BIN ?? "brave", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/home-shootst-${port}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tab; for (let i = 0; i < 60 && !tab; i++) { await sleep(200); try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* */ } }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); const blocked = [];
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const reply = (rid, code, body) => send("Fetch.fulfillRequest", { requestId: rid, responseCode: code, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
let navMode = "klassisk"; let theme = "dark";
ws.addEventListener("message", async (m) => {
  const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method !== "Fetch.requestPaused") return;
  const q = d.params.request; const p = new URL(q.url).pathname; const rid = d.params.requestId;
  try {
    if (q.method !== "GET" && q.method !== "HEAD") { blocked.push(`${q.method} ${p}`); return reply(rid, 200, { ok: true, test: "blocked" }); }
    if (p === "/api/prefs/events") return send("Fetch.fulfillRequest", { requestId: rid, responseCode: 204, responseHeaders: [], body: "" });
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
const check = (n, ok, i = "") => console.log(ok ? "PASS" : "FAIL", n, i);
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
for (const [dev, w, h, mob] of [["desktop", 1440, 1000, false], ["phone", 390, 844, true]]) {
  await size(w, h, mob); await nav("#/luft", 6000);
  const n = await ev(`document.querySelectorAll('.vent-zone').length`); check(`${dev}: zone cards`, n > 0, String(n));
  await ev(`document.querySelector('.vent-zones')?.scrollIntoView(); [...document.querySelectorAll('.vent-zone button')].find(b => b.textContent.includes('Kurve'))?.click(); true`);
  await sleep(800); await shot(`${dev}`);
  const txt = await ev(`document.querySelector('.vent-zone')?.innerText ?? ''`); check(`${dev}: Norwegian labels`, /Viftefart/.test(txt) && /Boost/.test(txt) && /Pause/.test(txt), txt.replace(/\s+/g, " ").slice(0, 160));
}
const dropped = await ev("window.__drop"); check("no device commands sent", (dropped ?? []).length === 0, JSON.stringify(dropped)); console.log("blocked writes:", blocked.join(", ") || "none");
ws.close(); proc.kill(); process.exit(0);
