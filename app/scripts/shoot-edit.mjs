#!/usr/bin/env node
// Edit-mode («Rediger») screenshots + functional checks in headless Brave. NEVER touches the owner's real data or devices:
// prefs GET/PUT and /api/dashedit apply/undo are answered by this script from an in-memory copy (real dashedit.mjs logic),
// every other non-GET is blocked, and HA websocket call_service/execute_script messages are dropped in the page.
// Usage: node scripts/shoot-edit.mjs [baseUrl] [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { initDashEdit } from "../apps/web-server/lib/dashedit.mjs";
const [base = process.env.HOME_WEB_URL ?? "http://127.0.0.1:8124/", out = "screenshots/edit-mode"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const real = await (await fetch(base + "api/prefs/dashboard")).json().catch(() => ({ value: {} }));
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)");
const seed = { ...(real.value ?? {}), nav: "klassisk", updatedAt: Date.now() };
db.prepare("INSERT INTO prefs VALUES ('dashboard', ?, 1, ?)").run(JSON.stringify(seed), Date.now());
const de = initDashEdit(db, null);
const getP = () => JSON.parse(db.prepare("SELECT value FROM prefs WHERE key='dashboard'").get().value);
const setP = (v) => db.prepare("UPDATE prefs SET value=?, rev=rev+1 WHERE key='dashboard'").run(JSON.stringify(v));

const port = 9700 + Math.floor(Math.random() * 90);
const proc = spawn(process.env.BROWSER_BIN ?? "brave", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/home-shootedit-${port}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tab; for (let i = 0; i < 60 && !tab; i++) { await sleep(200); try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* retry */ } }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); const blocked = []; const checks = [];
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const reply = (rid, code, body, type = "application/json") => send("Fetch.fulfillRequest", { requestId: rid, responseCode: code, responseHeaders: [{ name: "content-type", value: type }, { name: "cache-control", value: "no-store" }], body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)).toString("base64") });
ws.addEventListener("message", async (m) => {
  const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method !== "Fetch.requestPaused") return;
  const q = d.params.request; const u = new URL(q.url); const p = u.pathname; const rid = d.params.requestId;
  try {
    if (p === "/api/prefs/events") return reply(rid, 204, "", "text/plain");
    if (p === "/api/prefs/dashboard") { if (q.method === "PUT") { setP(JSON.parse(q.postData ?? "{}")); return reply(rid, 200, { ok: true }); } return reply(rid, 200, { value: getP(), rev: 1 }); }
    if (p === "/api/dashedit/apply") { const b = JSON.parse(q.postData ?? "{}"); try { return reply(rid, 200, de.apply(b.ops, { source: b.source, summary: b.summary })); } catch (e) { return reply(rid, 400, { error: e.message }); } }
    if (p === "/api/dashedit/undo") { const r = de.undo(); return reply(rid, r.ok ? 200 : 409, r); }
    if (q.method !== "GET" && q.method !== "HEAD") { blocked.push(`${q.method} ${p}`); return reply(rid, 200, { ok: true, test: "blocked" }); }
    return send("Fetch.continueRequest", { requestId: rid });
  } catch (e) { console.error("intercept", e); return send("Fetch.continueRequest", { requestId: rid }); }
});
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.error("eval error", JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
await send("Page.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { window.__drop = [];
  const S = WebSocket.prototype.send; WebSocket.prototype.send = function (m) { try { const j = JSON.parse(m); if (/call_service|execute_script|fire_event|play_media/.test(j.type ?? "")) { window.__drop.push(j.type + " " + (j.domain ?? "") + "." + (j.service ?? "")); const w = this; setTimeout(() => w.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: j.id, type: "result", success: true, result: { context: {} } }) })), 10); return; } } catch {} return S.call(this, m); };
  localStorage.removeItem('home.prefs.v1'); window.confirm = () => true; })();` });
const shot = async (name) => { await sleep(450); const r = await send("Page.captureScreenshot", { format: "png" }); const f = `${out}/${name}.png`; writeFileSync(f, Buffer.from(r.result.data, "base64")); console.log(f); };
const nav = async (hash, wait = 4500) => { await send("Page.navigate", { url: "about:blank" }); await sleep(200); await send("Page.navigate", { url: base + hash }); await sleep(wait); };
const click = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
const clickText = (sel, text) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (!e) return false; e.click(); return true; })()`);
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, t: b.top }; })()`);
const order = () => ev(`[...document.querySelectorAll('.main .eg-grid > [data-eg]')].map((e) => e.dataset.eg)`);
const check = (name, ok, info = "") => { checks.push({ name, ok: !!ok, info }); console.log(ok ? "PASS" : "FAIL", name, info); };
const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
const touch = (type, x, y) => send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
const dragMouse = async (from, to) => { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y }); await mouse("mousePressed", from.x, from.y); for (let i = 1; i <= 14; i++) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + ((to.x - from.x) * i) / 14, y: from.y + ((to.y - from.y) * i) / 14, button: "left", buttons: 1 }); await sleep(40); } await sleep(150); await mouse("mouseReleased", to.x, to.y); await sleep(500); };
const dragTouch = async (from, to) => { await touch("touchStart", from.x, from.y); for (let i = 1; i <= 14; i++) { await touch("touchMove", from.x + ((to.x - from.x) * i) / 14, from.y + ((to.y - from.y) * i) / 14); await sleep(40); } await sleep(150); await touch("touchEnd"); await sleep(500); };

// ── desktop ──
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await nav("#/");
const o0 = await order();
check("home renders cards via EditGrid", o0?.length >= 5, o0?.join(","));
check("pencil button present", await click(".edit-btn"));
await sleep(600);
check("edit mode on", await ev(`document.documentElement.hasAttribute('data-editing') && !!document.querySelector('.edit-bar')`));
await shot("desktop-01-edit");
// pointer drag: 3rd card onto the 1st
const g3 = await rect(`.main [data-eg="${o0[2]}"] .eg-grip`), g1 = await rect(`.main [data-eg="${o0[0]}"]`);
await dragMouse(g3, { x: g1.x, y: g1.t + 12 });
const o1 = await order();
check("mouse drag reorders and saves", o1[0] === o0[2] && getP().homeOrder?.[0] === o0[2], o1.slice(0, 3).join(","));
// keyboard: focus grip of first card, ArrowDown
await ev(`document.querySelector('.main [data-eg="${o1[0]}"] .eg-grip').focus()`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 }); await sleep(600);
const o2 = await order();
check("keyboard ArrowDown moves card", o2[1] === o1[0], `${o2.slice(0, 3).join(",")} live="${await ev(`document.getElementById('eg-live')?.textContent`)}"`);
// resize two cards to M so they sit side by side
const two = o2.filter((k) => ["notes", "maintenance"].includes(k));
for (const k of two) await ev(`[...document.querySelectorAll('.main [data-eg="${k}"] .eg-sizes button')].find((b) => b.textContent === 'M')?.click()`), await sleep(400);
check("resize to M saved", two.every((k) => getP().cardSize?.[k] === "m"), JSON.stringify(getP().cardSize));
// rename a section title
await ev(`document.querySelector('.main [data-eg="scenes"] .eg-rename')?.click()`); await sleep(200);
await ev(`(() => { const i = document.querySelector('.eg-title-input'); if (!i) return; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Stemninger'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`); await sleep(500);
check("rename section title", getP().titles?.["home.scenes"] === "Stemninger", JSON.stringify(getP().titles));
// hide a card with the eye
await ev(`document.querySelector('.main [data-eg="automation"] .eg-eye')?.click()`); await sleep(500);
check("eye hides card", (getP().hiddenCards ?? []).includes("automation") && !(await order()).includes("automation"));
// clicking inside a card in edit mode must not reach device controls
await ev(`document.querySelector('.main .eg-item .tile-main, .main .eg-item .routine')?.click()`); await sleep(300);
check("taps on device controls are swallowed in edit mode", (await ev("window.__drop.length")) === 0);
await shot("desktop-02-reordered-resized");
await click(".edit-bar .eb-btn"); await sleep(500); // Legg til kort
await shot("desktop-03-legg-til-kort");
check("drawer lists hidden + optional cards", await ev(`[...document.querySelectorAll('.eg-add-row b')].map((b) => b.textContent).join('|')`), await ev(`[...document.querySelectorAll('.eg-add-row b')].map((b) => b.textContent).join('|')`));
await clickText(".eg-add-row", "Roboter"); await sleep(600);
check("add optional card (Roboter)", (getP().addedCards ?? []).includes("robots") && (await order()).includes("robots"));
await click(".eg-scrim"); await sleep(300);
await clickText(".edit-bar .eb-btn", "Faner"); await sleep(500);
await ev(`[...document.querySelectorAll('.eg-tabs li')].find((l) => l.textContent.includes('Oda'))?.querySelector('.eg-eye')?.click()`); await sleep(500);
await ev(`[...document.querySelectorAll('.eg-tabs li')].find((l) => l.textContent.includes('Luft'))?.querySelector('[aria-label^="Flytt Luft opp"]')?.click()`); await sleep(500);
check("tab hidden + reordered", (getP().hiddenTabs ?? []).includes("oda") && getP().tabOrder?.indexOf("luft") < getP().tabOrder?.indexOf("barn"), JSON.stringify(getP().tabOrder));
await shot("desktop-04-faner");
check("sidebar respects hidden tab", !(await ev(`[...document.querySelectorAll('.sidebar nav button')].some((b) => b.title === 'Oda')`)));
await click(".eg-scrim"); await sleep(300);
await clickText(".edit-bar .eb-btn", "Visninger"); await sleep(500);
await ev(`(() => { const i = document.querySelector('.eg-layout-new input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Morgen'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(200);
await click(".eg-layout-new button"); await sleep(600);
check("named layout saved", !!getP().layouts?.Morgen && getP().activeLayout === "Morgen");
await shot("desktop-05-visninger");
await click(".eg-scrim"); await sleep(300);
// undo + reset
const before = JSON.stringify(getP().layouts);
await ev(`document.querySelector('.edit-bar [aria-label="Angre"]').click()`); await sleep(600);
check("Angre undoes last change (layout save)", !getP().layouts?.Morgen && before !== JSON.stringify(getP().layouts));
await ev(`document.querySelector('.edit-bar [aria-label="Tilbakestill til standard"]').click()`); await sleep(700);
check("Tilbakestill clears layout", !getP().homeOrder && !getP().cardSize && !getP().hiddenTabs);
await ev(`document.querySelector('.edit-bar [aria-label="Angre"]').click()`); await sleep(700);
check("Angre after reset restores", !!getP().homeOrder && getP().cardSize?.notes === "m", JSON.stringify({ o: getP().homeOrder?.slice(0, 3), s: getP().cardSize }));
await click(".edit-bar .eb-btn.primary"); await sleep(600);
check("Ferdig leaves edit mode", !(await ev(`document.documentElement.hasAttribute('data-editing')`)));
await shot("desktop-06-result");
// Rom + Barn
await nav("#/rooms"); await click(".edit-btn"); await sleep(600);
const r0 = await order();
if (r0.length > 1) { await ev(`[...document.querySelectorAll('.main [data-eg="${r0[0]}"] .eg-sizes button')].find((b) => b.textContent === 'M')?.click()`); await sleep(400); }
check("Rom: per-tab size saved", getP().pages?.rooms?.size?.[r0[0]] === "m", r0.slice(0, 3).join(","));
await shot("desktop-07-rom-edit");
await nav("#/barn"); await click(".edit-btn"); await sleep(600);
await ev(`document.querySelector('.main [data-eg="kontakter"] .eg-eye')?.click()`); await sleep(500);
check("Barn: sub-tab hidden", (getP().pages?.barn?.hidden ?? []).includes("kontakter"));
await shot("desktop-08-barn-edit");
await click(".edit-bar .eb-btn.primary"); await sleep(300);
// Flyt dock respects hiddenTabs; palette has «Rediger visning»
setP({ ...getP(), nav: "flyt", updatedAt: Date.now() + 1e6 });
await nav("#/");
const dock = await ev(`[...document.querySelectorAll('.dock .dock-item')].map((b) => b.getAttribute('aria-label'))`);
check("Flyt dock hides hidden tab (Oda) and has Rediger", dock && !dock.includes("Oda") && dock.includes("Rediger visning"), dock?.join(","));
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "k", code: "KeyK", windowsVirtualKeyCode: 75, modifiers: 2 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "k", code: "KeyK", modifiers: 2 }); await sleep(500);
await send("Input.insertText", { text: "rediger" }); await sleep(500);
await shot("desktop-09-palette-rediger");
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); await sleep(800);
check("Ctrl+K «Rediger visning» enters edit mode", await ev(`document.documentElement.hasAttribute('data-editing')`));
await shot("desktop-10-flyt-edit");
setP({ ...getP(), nav: "klassisk", updatedAt: Date.now() + 2e6 });

// ── iPad (touch) ──
await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await nav("#/");
const lp = await rect(".topbar-text .status-line") ?? await rect(".hero-clock") ?? await rect(".topbar-text");
await touch("touchStart", lp.x, lp.y); await sleep(900); await touch("touchEnd"); await sleep(600);
check("iPad long-press enters edit mode", await ev(`document.documentElement.hasAttribute('data-editing')`));
const i0 = await order();
const tg = await rect(`.main [data-eg="${i0[1]}"] .eg-grip`), tt = await rect(`.main [data-eg="${i0[0]}"]`);
await dragTouch(tg, { x: tt.x, y: tt.t + 12 });
check("iPad touch drag reorders", (await order())[0] === i0[1], (await order()).slice(0, 3).join(","));
await ev(`document.querySelector('.main').scrollTo({ top: 0 })`);
await shot("ipad-01-edit");

// ── phone (separate layout) ──
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await nav("#/"); await click(".edit-btn"); await sleep(600);
await clickText(".edit-bar .eb-btn", "Visninger"); await sleep(500);
await clickText(".eg-layouts .seg button", "Egen for mobil"); await sleep(600);
check("per-device: phone gets its own copy", getP().perDevice === true && !!getP().phone);
await shot("phone-02-visninger-per-enhet");
await click(".eg-scrim"); await sleep(300);
const p0 = await order(); const desk = JSON.stringify(getP().homeOrder);
await ev(`document.querySelector('.main [data-eg="${p0[1]}"] .eg-grip').focus()`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 }); await sleep(700);
check("phone drag writes phone layout only", getP().phone?.homeOrder?.[0] === p0[1] && JSON.stringify(getP().homeOrder) === desk, `${getP().phone?.homeOrder?.slice(0, 3)}`);
await ev(`document.querySelector('.main').scrollTo({ top: 0 })`);
await shot("phone-01-edit");
await clickText(".edit-bar .eb-btn", "Legg til"); await sleep(500);
await shot("phone-03-legg-til-kort");
await click(".eg-scrim"); await click(".edit-bar .eb-btn.primary"); await sleep(500);
await shot("phone-04-result");
const dropped = await ev("window.__drop.length");
check("no device commands sent (ws drops)", dropped === 0, `dropped=${dropped}`);
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, blocked, history: db.prepare("SELECT id, summary, undone FROM prefs_history").all() }, null, 1));
console.log(`${checks.filter((c) => c.ok).length}/${checks.length} passed; blocked non-GET: ${blocked.length}`);
ws.close(); proc.kill();
process.exit(0);
