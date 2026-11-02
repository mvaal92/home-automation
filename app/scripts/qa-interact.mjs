#!/usr/bin/env node
// Interactive read-only QA (notes, maintenance, palette, chat, links) in headless Brave. NEVER actuates devices: HA websocket call_service/execute_script are
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
const go = async (hash, wait = 3500) => { cur = hash; await send("Page.navigate", { url: "about:blank" }); await sleep(200); await send("Page.navigate", { url: base + hash }); await sleep(wait); };
const chk = (name, ok, info = "") => console.log(ok ? "PASS" : "FAIL", name, info ?? "");
const click = (sel, txt) => ev(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => ${txt ? `e.innerText.includes(${JSON.stringify(txt)})` : "true"}); if (!els[0]) return false; els[0].scrollIntoView({block:"center"}); els[0].click(); return true; })()`);
const has = (t) => ev(`document.body.innerText.includes(${JSON.stringify(t)})`);
const status = (u) => ev(`fetch(${JSON.stringify(u)}).then(r => r.status)`);
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
let sid = (await send("Page.addScriptToEvaluateOnNewDocument", { source: navMode("klassisk") })).result.identifier;
// --- Barn links
await go("#/barn/skole");
chk("homework item opens message", await click(".plain-list li[role=button]") && (await sleep(600), await has("Tilbake")));
const att = await ev(`[...document.querySelectorAll('a.chip.att')].map(a => a.getAttribute('href'))`);
chk("attachment links present", att?.length > 0, att?.[0]);
if (att?.[0]) { const s = await status(att[0]); chk("attachment endpoint answers (200 or 409 login page)", s === 200 || s === 409, `status ${s}`); }
await shot("fix-skole-message-attachments");
chk("forms link to portal", await ev(`[...document.querySelectorAll('a.ext-link')].some(a => a.href.startsWith('https://foresatt.visma.no'))`));
chk("beskjed expands", await click(".card li[role=button]", "Høstferie") && (await sleep(400), await ev(`!!document.querySelector('.note-body')`)));
await shot("fix-skole-beskjed");
await go("#/barn/oversikt"); // hash change while on Barn → tab switch
cur = "hash-subtab"; await ev(`location.hash = "#/barn/bilder"`); await sleep(1200); chk("hashchange switches Barn subtab (notification links)", await ev(`!!document.querySelector('.gallery')`));
cur="hash-root"; await ev(`location.hash = "#/barn"`); await sleep(1200); chk("hash #/barn returns to Oversikt", await has("Å gjøre"));
chk("ICS webcal link", await ev(`!!document.querySelector('a[href^="webcal://"]')`));
chk("ICS copy fallback", await click("button", "Kopier lenke") && (await sleep(300), await ev(`document.body.innerText.includes('Lenke kopiert') || document.body.innerText.includes('/api/kids/barn.ics')`)));
chk("barn.ics 200", (await status("/api/kids/barn.ics")) === 200);
await shot("fix-barn-ics");
await go("#/barn/bilder"); chk("photo lightbox", await click(".photo-grid .ph") && (await sleep(500), await ev(`!!document.querySelector('.lightbox img')`)));
chk("photos load", await ev(`Promise.all([...document.querySelectorAll('.photo-grid img')].slice(0,6).map(i => fetch(i.src).then(r => r.status))).then(a => a.every(s => s === 200))`)); await shot("barn-lightbox");
await go("#/barn/meldinger"); chk("MyKid notices link to mykid.no", await ev(`[...document.querySelectorAll('a.ext-link')].some(a => a.href.startsWith('https://mykid.no'))`));
// --- Notes create/delete
await go("#/notater");
const nn = await ev(`fetch('/api/notes').then(r=>r.json()).then(j => (j.notes ?? j).length)`);
const created = await ev(`fetch('/api/notes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'QA testnotat – slettes', title:'QA testnotat'})}).then(r=>r.json())`);
const nid = created?.note?.id ?? created?.id ?? (created?.notes ?? []).find?.((n) => /QA testnotat/.test(JSON.stringify(n)))?.id;
await go("#/notater"); chk("note create visible", await has("QA testnotat"), JSON.stringify(created).slice(0, 80));
if (nid != null) { const d = await ev(`fetch('/api/notes/${nid}',{method:'DELETE'}).then(r=>r.status)`); chk("note delete", d === 200, `status ${d}`); }
chk("notes count restored", (await ev(`fetch('/api/notes').then(r=>r.json()).then(j => (j.notes ?? j).length)`)) === nn);
// --- Maintenance read
await go("#/vedlikehold"); chk("maintenance renders", (await ev(`document.body.innerText.length`)) > 200);
// --- Settings / Tilkoblinger
await go("#/settings"); chk("Tilkoblinger card", await has("Tilkoblinger")); await shot("settings-tilkoblinger");
// --- Notifications bell
await go("#/"); chk("notification panel opens", await click("button[aria-label*='arsl'],button[aria-label*='otif'],.notif-btn") && (await sleep(500), true)); await shot("home-notifications");
// --- Rooms → room view
await go("#/rooms"); const roomClicked = await click(".room-card-main"); await sleep(1500);
chk("room view opens", roomClicked && (await ev(`location.hash`)).startsWith("#/room/"), await ev(`location.hash`)); await shot("room-view");
// --- Chat read-only question
await go("#/chat"); await ev(`(() => { const t = document.querySelector('.chat textarea, .chat input'); const s = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(t), 'value').set; s.call(t, 'Hvor mange grader er det i stua?'); t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
await sleep(30000); chk("chat answered", (await ev(`document.querySelector('.chat')?.innerText.length`)) > 80); await shot("chat-readonly");
// --- Flyt palette
await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: sid }); sid = (await send("Page.addScriptToEvaluateOnNewDocument", { source: navMode("flyt") })).result.identifier;
await go("#/"); await send("Input.dispatchKeyEvent", { type: "keyDown", key: "k", code: "KeyK", modifiers: 2, windowsVirtualKeyCode: 75 }); await sleep(600);
await send("Input.insertText", { text: "kjok" }); await sleep(600); chk("palette finds Kjøkken via 'kjok'", await has("Kjøkken")); await shot("flyt-palette");
const calls = await ev("window.__qaCalls");
console.log("blocked", JSON.stringify([...new Set(blocked)])); console.log("ws dropped", JSON.stringify(calls)); console.log("errors", JSON.stringify([...new Set(errors)])); console.log("bad", JSON.stringify([...new Set(bad)]));
proc.kill(); process.exit(0);
