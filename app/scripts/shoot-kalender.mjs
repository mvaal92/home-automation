#!/usr/bin/env node
// Kalender + top bar screenshots in headless Brave with MOCK iCloud data (no Apple credentials, no devices, no writes):
// /api/calendar/* is answered from the real server's read-only data (Barn, Vedlikehold) merged with mock ICS calendars;
// every non-GET is blocked and HA call_service/execute_script websocket messages are dropped in the page.
// Usage: node scripts/shoot-kalender.mjs [baseUrl] [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { instances, localToMs, msToLocal } from "../apps/web-server/lib/calendar/ics.mjs";
const [base = "http://127.0.0.1:8124/", out = "screenshots/kalender"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const T = msToLocal(Date.now()).slice(0, 10).replace(/-/g, ""); const D = (n) => msToLocal(localToMs(msToLocal(Date.now()).slice(0, 10)) + n * 864e5 + 3 * 3600e3).slice(0, 10).replace(/-/g, "");
const V = (uid, s, e, t, x = "") => `BEGIN:VEVENT\r\nUID:${uid}\r\n${s.length === 8 ? `DTSTART;VALUE=DATE:${s}\r\nDTEND;VALUE=DATE:${e}` : `DTSTART;TZID=Europe/Oslo:${s}\r\nDTEND;TZID=Europe/Oslo:${e}`}\r\nSUMMARY:${t}\r\n${x}END:VEVENT\r\n`;
const FAM = `BEGIN:VCALENDAR\r\n${V("f1", `${T}T170000`, `${T}T183000`, "Fotballtrening", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\nLOCATION:Kunstgressbanen\r\n")}${V("f2", `${D(2)}T180000`, `${D(2)}T200000`, "Middag hos besteforeldre", "LOCATION:Sentrum\r\n")}${V("f3", D(5), D(7), "Hyttetur")}${V("f4", `${D(1)}T081500`, `${D(1)}T090000`, "Tannlege")}${V("f5", `${D(9)}T190000`, `${D(9)}T210000`, "Foreldremøte")}${V("f6", `${T}T193000`, `${T}T203000`, "Svømming", "RRULE:FREQ=WEEKLY;BYDAY=TH\r\n")}END:VCALENDAR`;
const JOB = `BEGIN:VCALENDAR\r\n${V("j1", `${T}T090000`, `${T}T100000`, "Standup", "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR\r\n")}${V("j2", `${D(3)}T130000`, `${D(3)}T150000`, "Workshop")}END:VCALENDAR`;
const MOCK = [{ id: "icloud:mockfamilie", name: "Familie", color: "#e0567a", ics: FAM }, { id: "icloud:mockjobb", name: "Jobb", color: "#3cb7c4", ics: JOB }];
const mockEvents = (from, to) => MOCK.flatMap((c) => instances(c.ics, localToMs(from), localToMs(to)).events.map((e) => ({ id: Buffer.from(JSON.stringify([c.id, e.uid])).toString("base64url") + (e.instance ? `.${e.instance}` : ""), calendar: c.id, calendarName: c.name, color: c.color, writable: true,
  title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, desc: e.desc, url: null, recurring: e.recurring })));
const real = async (p) => (await fetch(base + p.replace(/^\//, ""))).json();
const port = 9790 + Math.floor(Math.random() * 90);
const proc = spawn(process.env.BROWSER_BIN ?? "brave", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/home-shootkal-${port}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tab; for (let i = 0; i < 60 && !tab; i++) { await sleep(200); try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* */ } }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); const blocked = []; let navMode = "klassisk";
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const reply = (rid, code, body) => send("Fetch.fulfillRequest", { requestId: rid, responseCode: code, responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "cache-control", value: "no-store" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
ws.addEventListener("message", async (m) => {
  const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method !== "Fetch.requestPaused") return;
  const q = d.params.request; const u = new URL(q.url); const p = u.pathname; const rid = d.params.requestId;
  try {
    if (q.method !== "GET" && q.method !== "HEAD") { blocked.push(`${q.method} ${p}`); return reply(rid, 200, { ok: true, test: "blocked" }); }
    if (p === "/api/prefs/events") return send("Fetch.fulfillRequest", { requestId: rid, responseCode: 204, responseHeaders: [], body: "" });
    if (p === "/api/prefs/dashboard") { const r = await real(p); return reply(rid, 200, { ...r, value: { ...(r.value ?? {}), nav: navMode } }); }
    if (p === "/api/calendar/calendars") { const r = await real(p + u.search); return reply(rid, 200, { ...r, sources: [...r.sources, ...MOCK.map((c) => ({ id: c.id, kind: "icloud", name: c.name, color: c.color, visible: true, writable: true, syncedAt: Date.now(), error: null }))], icloud: { connected: true, account: "m…@icloud.com", error: null }, defaultCalendar: MOCK[0].id }); }
    if (p === "/api/calendar/events") { const r = await real(p + u.search); const ev = [...r.events, ...mockEvents(u.searchParams.get("from"), u.searchParams.get("to"))].sort((a, b) => a.start.localeCompare(b.start)); return reply(rid, 200, { events: ev }); }
    if (p === "/api/calendar/upcoming") { const r = await real(p + u.search); const t = r.today; const now = msToLocal(Date.now()); const to = msToLocal(localToMs(t) + 7 * 864e5).slice(0, 10);
      const ev = [...r.events, ...mockEvents(t, to)].filter((e) => e.allDay ? e.end > t : (e.end ?? e.start) >= now).sort((a, b) => a.start.localeCompare(b.start)); return reply(rid, 200, { ...r, events: ev.slice(0, Number(u.searchParams.get("limit") ?? 8)) }); }
    return send("Fetch.continueRequest", { requestId: rid });
  } catch (e) { console.error("intercept", e.message); return send("Fetch.continueRequest", { requestId: rid }); }
});
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Page.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { window.__drop = []; const S = WebSocket.prototype.send; WebSocket.prototype.send = function (m) { try { const j = JSON.parse(m); if (/call_service|execute_script|fire_event|play_media/.test(j.type ?? "")) { window.__drop.push(j.type); const w = this; setTimeout(() => w.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: j.id, type: "result", success: true, result: { context: {} } }) })), 10); return; } } catch {} return S.call(this, m); }; localStorage.removeItem('home.prefs.v1'); })();` });
const shot = async (name, full = false) => { await sleep(500); const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full }); const f = `${out}/${name}.png`; writeFileSync(f, Buffer.from(r.result.data, "base64")); console.log(f); };
const nav = async (hash, wait = 4500) => { await send("Page.navigate", { url: "about:blank" }); await sleep(200); await send("Page.navigate", { url: base + hash }); await sleep(wait); };
const click = (sel, text) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => !${JSON.stringify(text ?? "")} || x.textContent.trim().includes(${JSON.stringify(text ?? "")})); if (!e) return false; e.click(); return true; })()`);
const size = (width, height, mobile) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile });
const checks = []; const check = (n, ok, i = "") => { checks.push({ n, ok: !!ok }); console.log(ok ? "PASS" : "FAIL", n, i); };
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
for (const [dev, w, h, mob] of [["desktop", 1440, 900, false], ["ipad", 1024, 1366, true], ["phone", 390, 844, true]]) {
  navMode = "klassisk"; await size(w, h, mob);
  await nav("#/");
  const top = await ev(`document.querySelector('.tb')?.innerText ?? ''`);
  check(`${dev}: top bar has no personal name`, top && !/owner/i.test(top), top.replace(/\n/g, " | ").slice(0, 140));
  check(`${dev}: outdoor temperature shown`, await ev(`!!document.querySelector('.tb-wx-t')`));
  check(`${dev}: I dag card`, await ev(`!!document.querySelector('.kal-today')`));
  await shot(`${dev}-home`);
  await ev(`localStorage.setItem('kal.view','maned')`); await nav("#/kalender");
  check(`${dev}: month grid`, await ev(`document.querySelectorAll('.kal-day').length === 42 && !!document.querySelector('.kal-day.today')`));
  await shot(`${dev}-kalender-maned`);
  if (dev !== "ipad") { await click(".seg button", "Uke"); await sleep(1200); await shot(`${dev}-kalender-uke`); }
  await click(".seg button", "Agenda"); await sleep(1200); await shot(`${dev}-kalender-agenda`);
  if (dev === "desktop") {
    await click(".kal-row"); await sleep(700); await shot("desktop-event-sheet"); await ev(`document.querySelector('.sheet-backdrop')?.click()`); await sleep(500);
    await click(".btn.primary", "Ny avtale"); await sleep(700); check("new event form", await ev(`!!document.querySelector('.kal-form')`)); await shot("desktop-ny-avtale"); await ev(`document.querySelector('.sheet-backdrop')?.click()`); await sleep(500);
    await click('[aria-label="Kalendere"]'); await sleep(700); await shot("desktop-kalendere"); await ev(`document.querySelector('.sheet-backdrop')?.click()`);
    navMode = "flyt"; await nav("#/"); await shot("desktop-home-flyt"); await nav("#/kalender"); await shot("desktop-kalender-flyt");
  }
  if (dev === "phone") { navMode = "flyt"; await nav("#/"); await shot("phone-home-flyt"); }
}
const dropped = await ev("window.__drop");
check("no device commands sent", (dropped ?? []).length === 0, JSON.stringify(dropped)); check("no writes left the page", true, blocked.join(", ") || "none attempted");
console.log(`${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
ws.close(); proc.kill(); process.exit(0);
