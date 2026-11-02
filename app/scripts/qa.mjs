#!/usr/bin/env node
// Read-only QA crawl in headless Brave. NEVER actuates devices: HA websocket call_service/execute_script are
// dropped (fake success), every non-GET request is blocked except notes/maintenance test items + read-only chat;
// prefs PUTs are swallowed. Usage: node scripts/qa.mjs [base] [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [base = "http://100.64.0.1:8124/", out = "screenshots/qa"] = process.argv.slice(2);
const only = process.env.QA_ONLY;
const port = 9700 + Math.floor(Math.random() * 90);
const proc = spawn(process.env.BROWSER_BIN ?? "brave", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/home-qa-${port}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tab; for (let i = 0; i < 50 && !tab; i++) { await sleep(200); try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); const errors = []; const blocked = []; const bad = []; let cur = "";
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const SAFE_WRITE = /\/api\/(notes|maintenance)(\/|$)|\/api\/assistant$|\/api\/prefs\//;
ws.addEventListener("message", async (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errors.push(`${cur} EXC ${d.params.exceptionDetails.exception?.description?.slice(0, 200) ?? d.params.exceptionDetails.text}`);
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(`${cur} console.error ${d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200)}`);
  if (d.method === "Log.entryAdded" && d.params.entry.level === "error") errors.push(`${cur} log ${d.params.entry.text.slice(0, 120)} ${d.params.entry.url ?? ""}`);
  if (d.method === "Network.responseReceived") { const r = d.params.response; if (r.status >= 400 && !/attachment|favicon/.test(r.url)) bad.push(`${cur} ${r.status} ${r.url.replace(base, "/")}`); }
  if (d.method === "Fetch.requestPaused") { const q = d.params.request; const u = q.url;
    if (q.method === "GET" || q.method === "HEAD" || q.method === "OPTIONS" || (SAFE_WRITE.test(u) && !(/\/api\/prefs\//.test(u) && q.method === "PUT"))) return send("Fetch.continueRequest", { requestId: d.params.requestId });
    blocked.push(`${cur} ${q.method} ${u.replace(base, "/")}`);
    return send("Fetch.fulfillRequest", { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from('{"ok":true,"qa":"blocked"}').toString("base64") }); } });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };
await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
const navMode = (mode) => `(() => { window.__qaCalls = [];
  const S = WebSocket.prototype.send; WebSocket.prototype.send = function (m) { try { const j = JSON.parse(m); if (/call_service|execute_script|fire_event|media_player|play_media/.test(j.type ?? "")) { window.__qaCalls.push(j.type + " " + (j.domain ?? "") + "." + (j.service ?? "")); const ws = this; setTimeout(() => ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: j.id, type: "result", success: true, result: { context: {} } }) })), 10); return; } } catch {} return S.call(this, m); };
  const f = window.fetch.bind(window); window.fetch = async (u, o) => { const url = String(u && u.url || u);
    if (url.includes('/api/prefs/dashboard') && !(o && o.method === 'PUT')) { const r = await f(u, o); const j = await r.json().catch(() => ({ value: null })); j.value = { ...(j.value || {}), nav: '${mode}', updatedAt: 9e12 }; return new Response(JSON.stringify(j), { headers: { 'content-type': 'application/json' } }); }
    return f(u, o); };
  try { const p = JSON.parse(localStorage.getItem('home.prefs.v1') || '{}'); localStorage.setItem('home.prefs.v1', JSON.stringify({ ...p, nav: '${mode}', updatedAt: 9e12 })); } catch {} })();`;
mkdirSync(out, { recursive: true });
const shot = async (n) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${out}/${n}.png`, Buffer.from(r.result.data, "base64")); };
const go = async (hash, wait = 3500) => { cur = hash; await send("Page.navigate", { url: base + hash }); await sleep(wait); };
const ROUTES = ["#/", "#/rooms", "#/energy", "#/chat", "#/sonos", "#/spotify", "#/oda", "#/lydboker", "#/notater", "#/robots", "#/vedlikehold", "#/barn", "#/barn/skole", "#/barn/uke", "#/barn/oppgaver", "#/barn/bilder", "#/barn/dagenmin", "#/barn/meldinger", "#/barn/kontakter", "#/luft", "#/settings"];
const SIZES = { desktop: [1440, 900, 1, false], ipad: [1180, 820, 2, true], phone: [390, 844, 3, true] };
const report = { pages: [], checks: [] };
const chk = (name, ok, info = "") => { report.checks.push({ name, ok, info }); console.log(ok ? "PASS" : "FAIL", name, info); };
for (const mode of only ? [only.split(":")[0]] : ["klassisk", "flyt"]) {
  const scriptId = (await send("Page.addScriptToEvaluateOnNewDocument", { source: navMode(mode) })).result.identifier;
  for (const [sz, [w, h, dpr, mob]] of Object.entries(SIZES)) { if (only && only.split(":")[1] && only.split(":")[1] !== sz) continue;
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr > 2 ? 2 : dpr, mobile: mob }); await send("Emulation.setTouchEmulationEnabled", { enabled: mob });
    const routes = process.env.QA_ROUTES ? process.env.QA_ROUTES.split(",") : ROUTES;
    // first route needs a room id
    await go("#/rooms"); const room = await ev(`(() => { const a = [...document.querySelectorAll('[href^="#/room/"],[data-room]')][0]; return a ? (a.getAttribute('href') || '#/room/' + a.dataset.room) : null })()`);
    for (const r of [...routes, ...(room ? [room] : [])]) { const before = errors.length; await go(r);
      const txt = await ev(`document.body.innerText.length`); const name = `${mode}-${sz}-${r.replace(/[#/]+/g, "_").replace(/^_|_$/g, "") || "home"}`;
      await shot(name); report.pages.push({ name, textLen: txt, newErrors: errors.length - before }); if (!txt || txt < 30) chk(`${name} renders`, false, `textLen=${txt}`); }
  }
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
}
const calls = await ev("window.__qaCalls"); 
writeFileSync(`${out}/report.json`, JSON.stringify({ ...report, errors: [...new Set(errors)], bad: [...new Set(bad)], blocked: [...new Set(blocked)], wsDropped: calls }, null, 1));
console.log("errors", [...new Set(errors)].length, "bad", [...new Set(bad)].length, "blocked", blocked.length);
proc.kill(); process.exit(0);
