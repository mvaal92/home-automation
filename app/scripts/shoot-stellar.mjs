#!/usr/bin/env node
// Hjem design-pass screenshots in headless Brave, real read-only data. Every non-GET /api call is blocked and
// HA call_service/execute_script/fire_event/play_media websocket messages are dropped in the page (no devices touched).
// Usage: node scripts/shoot-stellar.mjs <prefix> [baseUrl] [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [prefix = "shot", base = "http://127.0.0.1:8124/", out = "screenshots/stellar"] = process.argv.slice(2);
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
const checks = []; const check = (n, ok, i = "") => { checks.push(!!ok); console.log(ok ? "PASS" : "FAIL", n, i); };
for (const scheme of ["dark", "light"]) {
  theme = scheme;
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  for (const [dev, w, h, mob] of [["desktop", 1440, 900, false], ["ipad", 1024, 1366, true], ["ipad-land", 1366, 1024, true], ["phone", 390, 844, true]]) {
    if (scheme === "light" && dev === "ipad-land") continue;
    await size(w, h, mob); await nav("#/");
    const top = await ev(`document.querySelector('.topbar')?.innerText ?? ''`);
    check(`${scheme} ${dev}: no personal name`, !/owner/i.test(top));
    const overlap = await ev(`(() => { const b = [...document.querySelectorAll('.topbar button, .topbar .tb-wx')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect()); for (let i=0;i<b.length;i++) for (let j=i+1;j<b.length;j++) { const a=b[i], c=b[j]; if (a.left < c.right-1 && c.left < a.right-1 && a.top < c.bottom-1 && c.top < a.bottom-1) return true; } return false; })()`);
    check(`${scheme} ${dev}: header buttons do not overlap`, !overlap);
    const eng = await ev(`(() => { const t = document.querySelector('main')?.innerText ?? ''; return (t.match(/\\b(lights? on|All lights off|Loading|need[s]? attention|Show less|Active now|Not active|empty areas?|other devices|paused|idle|offline|Connected|Settings)\\b/g) || []).join(','); })()`);
    check(`${scheme} ${dev}: no English leftovers on Hjem`, !eng, eng);
    await shot(`${scheme}-${dev}`); if (scheme === "dark") await shot(`${scheme}-${dev}-full`, true);
  }
}
theme = "dark"; navMode = "flyt"; await size(390, 844, true); await nav("#/"); await shot("dark-phone-flyt");
const dropped = await ev("window.__drop");
check("no device commands sent", (dropped ?? []).length === 0, JSON.stringify(dropped)); console.log("blocked writes:", blocked.join(", ") || "none");
console.log(`${checks.filter(Boolean).length}/${checks.length} checks passed`);
ws.close(); proc.kill(); process.exit(0);
