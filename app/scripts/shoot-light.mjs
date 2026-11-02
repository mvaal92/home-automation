#!/usr/bin/env node
// Visual QA: every tab, Settings and Hvileskjerm at iPad portrait/landscape, phone, desktop in headless Brave, real read-only data. Every non-GET /api call is blocked and
// HA call_service/execute_script/fire_event/play_media websocket messages are dropped in the page (no devices touched).
// Usage: node scripts/qa-shots.mjs <prefix> [baseUrl] [outDir] [sizes] [routes]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [prefix = "shot", base = "http://127.0.0.1:8124/", out = "screenshots/hvile"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const port = 9690 + Math.floor(Math.random() * 90);
const proc = spawn(process.env.BROWSER_BIN ?? "brave", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/home-qa-${port}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tab; for (let i = 0; i < 60 && !tab; i++) { await sleep(200); try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* */ } }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); const blocked = [];
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const reply = (rid, code, body) => send("Fetch.fulfillRequest", { requestId: rid, responseCode: code, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
let navMode = "flyt"; let theme = process.env.THEME ?? "system"; let hvile = { timeoutMin: 0 };
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
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { window.__drop = []; const S = WebSocket.prototype.send; WebSocket.prototype.send = function (m) { try { const j = JSON.parse(m); if (/call_service|execute_script|fire_event|play_media/.test(j.type ?? "")) { window.__drop.push(j.type); const w = this; setTimeout(() => w.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: j.id, type: "result", success: true, result: { context: {} } }) })), 10); return; } } catch {} return S.call(this, m); }; localStorage.removeItem('home.prefs.v1'); ${process.env.THEME ? `localStorage.setItem("home.theme", ${JSON.stringify(process.env.THEME)});` : ""} })();` });
const shot = async (name, full) => { await sleep(600); const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!full }); const f = `${out}/${prefix}-${name}.png`; writeFileSync(f, Buffer.from(r.result.data, "base64")); console.log(f); };
const nav = async (hash, wait = 5000) => { await send("Page.navigate", { url: "about:blank" }); await sleep(200); await send("Page.navigate", { url: base + hash }); await sleep(wait); };
const size = (width, height, mobile) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
const checks = []; const check = (n, ok, i = "") => { checks.push(!!ok); console.log(ok ? "PASS" : "FAIL", n, i); };
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: process.env.SCHEME ?? "dark" }] });
const SIZES = { ipad: [1024, 1366, true], "ipad-land": [1366, 1024, true], phone: [390, 844, true], "phone-max": [430, 932, true], desktop: [1440, 900, false] };
const ROUTES = ["home", "rooms", "kalender", "luft", "barn", "energy", "chat", "notater", "robots", "vedlikehold", "sonos", "spotify", "lydboker", "oda", "settings", "hvile"];
const sizes = (process.argv[5] ?? Object.keys(SIZES).join(",")).split(","); const routes = (process.argv[6] ?? ROUTES.join(",")).split(",");
const AUDIT = `(() => {
  const W = innerWidth, out = { overflowX: document.scrollingElement.scrollWidth - W, offRight: [], clipped: [], broken: [], english: [], overlaps: [] };
  const sel = (e) => (e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')).slice(0, 60);
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0'; };
  for (const e of document.querySelectorAll('body *')) {
    if (!vis(e) || e.closest('.hvile,svg')) continue; const r = e.getBoundingClientRect();
    if (r.right > W + 2 && !e.closest('[class*=scroll],[class*=carousel],.chips,.seg,.tabbar,.h-scroll') && getComputedStyle(e).position !== 'fixed') out.offRight.push(sel(e) + ' r=' + Math.round(r.right));
    const s = getComputedStyle(e);
    if (e.children.length === 0 && e.textContent.trim() && (e.scrollWidth > e.clientWidth + 1) && s.overflow !== 'visible' && s.textOverflow !== 'ellipsis' && e.clientWidth > 0) out.clipped.push(sel(e) + ' «' + e.textContent.trim().slice(0, 40) + '»');
  }
  for (const i of document.querySelectorAll('img')) if (vis(i) && i.complete && i.naturalWidth === 0) out.broken.push(i.src.slice(-60));
  const EN = /\\b(the|and|Settings|Loading|Turn (on|off)|Open|Close|Filter (due|OK|replaced)|replace|Whole home|Use demo|Can't|rejected|Voice|Add|Remove|Save|Cancel|Error|Unknown|unavailable|Speed|Humidity|Temperature|Battery|Living room|Kitchen|Bedroom|Bathroom|Office|No [a-z]+ found|Show (more|less)|Back|Search|Today|Tomorrow|Playing|Paused|Idle|Docked|Cleaning|Charging|Returning|Mowing|not connected|coming soon|Climate|Media|Lights?|Scenes?|Rooms?|Energy|Power|Home Assistant rejected)\\b/;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = walker.nextNode())) { const t = n.textContent.trim(); const p = n.parentElement; if (!t || !p || !vis(p) || p.closest('.hvile,code,pre,.chat-msg,.msg,[data-raw],.hv-cap,.kal-ev-title')) continue; const m = t.match(EN); if (m) out.english.push(m[0] + ' ← «' + t.slice(0, 60) + '»'); }
  const fixed = [...document.querySelectorAll('body *')].filter((e) => vis(e) && ['fixed', 'sticky'].includes(getComputedStyle(e).position) && !e.closest('.hvile'));
  for (const f of fixed) for (const b of document.querySelectorAll('button,a,input')) { if (f.contains(b) || b.contains(f) || !vis(b)) continue; const a = f.getBoundingClientRect(), c = b.getBoundingClientRect(); const ix = Math.min(a.right, c.right) - Math.max(a.left, c.left), iy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top); if (ix > 8 && iy > 8 && getComputedStyle(f).zIndex !== 'auto') out.overlaps.push(sel(f) + ' ⟂ ' + sel(b) + ' «' + (b.innerText || b.ariaLabel || '').trim().slice(0, 24) + '»'); }
  const tr = document.querySelector('.topbar.slim .topbar-right'); if (tr && vis(tr)) for (const b of document.querySelectorAll('.page button,.page a,.page h1,.page input')) { if (!vis(b)) continue; for (const x of tr.querySelectorAll('button')) { if (!vis(x)) continue; const a = x.getBoundingClientRect(), c = b.getBoundingClientRect(); const ix = Math.min(a.right, c.right) - Math.max(a.left, c.left), iy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top); if (ix > 2 && iy > 2) out.overlaps.push('topbar ⟂ ' + sel(b) + ' «' + (b.innerText || '').trim().slice(0, 24) + '»'); } }
  for (const k of ['offRight', 'clipped', 'english', 'overlaps']) out[k] = [...new Set(out[k])].slice(0, 12);
  return out; })()`;

const LIGHT = `(() => {
  const out = { contrast: [], small: [], meta: document.querySelector('meta[name=theme-color]:not([media])')?.content ?? [...document.querySelectorAll('meta[name=theme-color]')].map(m=>m.media+'='+m.content).join(' '), scheme: getComputedStyle(document.documentElement).colorScheme, bg: getComputedStyle(document.body).backgroundColor };
  const P = (c) => { const m = c.match(/[\\d.]+/g); return m ? m.map(Number) : null; };
  const L = ([r,g,b]) => { const f = (v) => { v /= 255; return v <= .03928 ? v/12.92 : ((v+.055)/1.055)**2.4; }; return .2126*f(r)+.7152*f(g)+.0722*f(b); };
  const mix = (top, bot) => { const a = top[3] ?? 1; return [0,1,2].map(i => top[i]*a + bot[i]*(1-a)); };
  const bgOf = (e) => { const stack = []; for (let n = e; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.backgroundImage !== 'none' && !/gradient/.test(s.backgroundImage)) return null; const c = P(s.backgroundColor); if (c && (c[3] ?? 1) > 0) { stack.push(c); if ((c[3] ?? 1) >= 1) break; } } let b = [255,255,255]; if (!stack.length || (stack[stack.length-1][3] ?? 1) < 1) b = P(getComputedStyle(document.body).backgroundColor).slice(0,3); for (let i = stack.length-1; i >= 0; i--) b = mix(stack[i], b); return b; };
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && +s.opacity > 0.05; };
  const sel = (e) => (e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')).slice(0, 50);
  for (const e of document.querySelectorAll('body *')) {
    if (!vis(e) || e.closest('.hvile,[aria-hidden=true],.hero-art,.hv')) continue;
    const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); const icon = e.tagName === 'svg' && !e.closest('button svg svg');
    if (!own && !icon) continue;
    const s = getComputedStyle(e); let fg = P(icon ? (s.stroke !== 'none' && s.stroke ? s.stroke : s.color) : s.color); if (!fg) continue;
    let op = 1; for (let n = e; n; n = n.parentElement) op *= +getComputedStyle(n).opacity;
    const b = bgOf(e); if (!b) continue; const f = mix([...fg.slice(0,3), (fg[3] ?? 1) * op], b);
    const l1 = L(f), l2 = L(b); const cr = (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
    const big = parseFloat(s.fontSize) >= 18.6 || (parseFloat(s.fontSize) >= 14 && +s.fontWeight >= 700);
    const need = icon ? 3 : big ? 3 : 4.5; const dis = e.closest('button:disabled,[aria-disabled=true]');
    if (cr < need && !dis) out.contrast.push(sel(e) + ' ' + cr.toFixed(2) + ' «' + (e.textContent || '').trim().slice(0, 24) + '»');
  }
  for (const b of document.querySelectorAll('button,a[href],[role=button],input,select,[role=tab],[role=radio]')) { if (!vis(b) || b.closest('.hvile')) continue; const r = b.getBoundingClientRect(); if (r.width < 44 && r.height < 44 || r.height < 32 || r.width < 32) out.small.push(sel(b) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' «' + ((b.innerText || b.ariaLabel || b.title || '').trim().slice(0,18)) + '»'); }
  out.contrast = [...new Set(out.contrast)].slice(0, 40); out.small = [...new Set(out.small)].slice(0, 40); return out; })()`;
const report = {};
for (const s of sizes) {
  const [w, h, mob] = SIZES[s]; await size(w, h, mob); await send("Emulation.setTouchEmulationEnabled", { enabled: !!mob, maxTouchPoints: mob ? 5 : 0 });
  for (const r of routes) {
    const hash = r === "hvile" ? "?hvile=1&hviletime=14:20&hvileart=a00#/" : r === "home" ? "#/" : `#/${r}`;
    await nav(hash, r === "hvile" ? 7000 : 5500);
    report[`${s}/${r}`] = { ...(await ev(AUDIT)), ...(await ev(LIGHT)) };
    const full = r !== "hvile"; const f = `${out}/${prefix}-${s}-${r}.png`;
    if (full) { const H = Math.min(6000, Math.ceil(await ev(`(() => { const m = document.querySelector(".main"); return Math.max(document.scrollingElement.scrollHeight, m ? m.scrollHeight + m.getBoundingClientRect().top : 0); })()`) ?? h)); await send("Emulation.setDeviceMetricsOverride", { width: w, height: Math.max(h, H), deviceScaleFactor: 1, mobile: mob }); await sleep(500); }
    const shotR = await send("Page.captureScreenshot", { format: "jpeg", quality: 70 }); writeFileSync(f.replace(/png$/, "jpg"), Buffer.from(shotR.result.data, "base64"));
    if (full) await size(w, h, mob);
    console.log(s, r, JSON.stringify(report[`${s}/${r}`]));
  }
}
writeFileSync(`${out}/${prefix}-report.json`, JSON.stringify(report, null, 1));
const dropped = await ev("window.__drop"); console.log("dropped device commands:", JSON.stringify(dropped), "blocked writes:", blocked.join(", ") || "none");
ws.close(); proc.kill(); process.exit(0);
