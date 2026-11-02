#!/usr/bin/env node
// Read-only screenshot of one page in headless Brave (fresh profile). Usage:
//   node scripts/shoot-one.mjs <url> <out.png> [width=1440] [height=900] [js to eval after load] [waitMs=5000]
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
const [url, out, w = "1440", h = "900", js = "", wait = "5000"] = process.argv.slice(2);
const port = 9700 + Math.floor(Math.random() * 90);
const proc = spawn(process.env.BROWSER_BIN ?? "brave", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/home-shot1-${port}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tab; for (let i = 0; i < 50 && !tab; i++) { await sleep(200); try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* */ } }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
// Never write prefs from the headless browser; optionally show collapsed sections (EXPAND=1) for the shot only.
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const f = window.fetch.bind(window); const expand = ${process.env.EXPAND === "1"};
  window.fetch = async (u, o) => { const url = String(u && u.url || u);
    if (url.includes('/api/prefs/')) { if (o && o.method === 'PUT') return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
      if (expand && url.includes('/api/prefs/dashboard')) { const r = await f(u, o); const j = await r.json().catch(() => ({ value: null })); if (j.value) j.value.collapsed = []; return new Response(JSON.stringify(j), { headers: { 'content-type': 'application/json' } }); } }
    return f(u, o); }; })();` });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await send("Emulation.setDeviceMetricsOverride", { width: Number(w), height: Number(h), deviceScaleFactor: 2, mobile: Number(w) < 700 });
await send("Page.navigate", { url }); await sleep(Number(wait));
if (js) { const r = await send("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.error("eval", JSON.stringify(r.result.exceptionDetails).slice(0, 300)); await sleep(1500); }
const r = await send("Page.captureScreenshot", { format: "png" });
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, Buffer.from(r.result.data, "base64")); console.log(out);
ws.close(); proc.kill();
