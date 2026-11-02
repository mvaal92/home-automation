// MyKid (mykid.no) – READ-ONLY kindergarten source. Never posts, replies, likes or marks anything.
// Transport: (1) server session cookies in secrets/mykid_session.json if present, else
// (2) the logged-in MyKid tab in the owner's Brave (CDP on 127.0.0.1:9222): we run same-origin GET/"show" fetches
// inside that page. No cookies are extracted. Photos are cached in data/mykid (0700) and served over Tailscale only.
import { existsSync, mkdirSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { parse } from "node-html-parser";
import { SECRETS, expand } from "./util.mjs";
import { KG } from "./family.mjs";
const BASE = "https://mykid.no";
const CDP = process.env.HOME_CDP ?? "http://127.0.0.1:9222";
export const DIR = expand(process.env.HOME_MYKID_DIR ?? "~/home-automation/data/mykid");
const PHOTOS = join(DIR, "photos");
mkdirSync(PHOTOS, { recursive: true, mode: 0o700 }); chmodSync(DIR, 0o700); chmodSync(PHOTOS, 0o700);
const STATE = join(DIR, "state.json");
const SESSION = join(SECRETS, "mykid_session.json");
// Allow-list: only read endpoints.
const READ_ONLY = /^\/(foreldre|foto|_ajax\/(calendar\/fetch_calendar_week|calendar\/fetch_calendar_data|dagenmin\/show_myday|admin_foto_rediger\/browse_all_photos|image\/fetchimage\/photo\/\d+\/(600|orig)))$/;

async function cdpEval(expr) {
  const tabs = await (await fetch(`${CDP}/json`, { signal: AbortSignal.timeout(3000) })).json();
  const tab = tabs.find((t) => t.type === "page" && /^https:\/\/mykid\.no\//.test(t.url) && !/logg_inn/.test(t.url));
  if (!tab) throw Object.assign(new Error("MyKid er ikke innlogget i Brave"), { status: 409, loginRequired: true });
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(tab.webSocketDebuggerUrl); const to = setTimeout(() => { ws.terminate(); reject(new Error("MyKid timeout")); }, 30000);
    ws.on("open", () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } })));
    ws.on("message", (m) => { const r = JSON.parse(m); if (r.id !== 1) return; clearTimeout(to); ws.close();
      if (r.result?.exceptionDetails) reject(new Error("MyKid: " + (r.result.exceptionDetails.exception?.description ?? "feil").slice(0, 120))); else resolve(r.result?.result?.value); });
    ws.on("error", (e) => { clearTimeout(to); reject(e); });
  });
}
function sessionCookies() { try { return JSON.parse(readFileSync(SESSION, "utf8")).cookie ?? null; } catch { return null; } }
/** GET or read-only POST (the "show"/"fetch" endpoints are POST in MyKid). Returns text or base64 (binary). */
async function req(path, form = null, binary = false) {
  if (!READ_ONLY.test(path)) throw new Error("blocked non-read endpoint " + path);
  const body = form ? new URLSearchParams(form).toString() : null;
  const cookie = sessionCookies();
  if (cookie) {
    const r = await fetch(BASE + path, { method: form ? "POST" : "GET", body, redirect: "manual", signal: AbortSignal.timeout(20000),
      headers: { cookie, "x-requested-with": "XMLHttpRequest", "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 HomeApp" } });
    if (r.status === 200) return binary ? Buffer.from(await r.arrayBuffer()) : r.text();
    if (r.status !== 302 && r.status !== 401 && r.status !== 403) throw new Error(`MyKid ${r.status}`);
    // session expired → fall back to browser
  }
  const js = `fetch(${JSON.stringify(path)},{method:${JSON.stringify(form ? "POST" : "GET")},headers:{"X-Requested-With":"XMLHttpRequest","Content-Type":"application/x-www-form-urlencoded"},body:${JSON.stringify(body)}})
    .then(async r=>{if(r.redirected&&/logg_inn/.test(r.url))throw new Error("utlogget");${binary ? `const b=new Uint8Array(await r.arrayBuffer());let s="";for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode.apply(null,b.subarray(i,i+32768));return btoa(s)` : "return r.text()"}})`;
  const v = await cdpEval(js);
  return binary ? Buffer.from(v, "base64") : v;
}
const txt = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
const nbDate = (s) => { const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(s ?? ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const iso = (d) => d.toISOString().slice(0, 10);
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, des: 12 };

function parseWeek(html, today) {
  const root = parse(html); const days = []; let cur = null;
  for (const el of root.querySelectorAll(".weekday, .linetable_wrapper")) {
    if (el.classList.contains("weekday")) {
      const h = el.querySelector("h4"); const label = txt(h).replace(/\s*Fr$/, ""); const m = /(\d+)\.\s*(\w{3})/.exec(label);
      let date = null; if (m) { const y = today.getFullYear(); date = `${y}-${String(MONTHS[m[2].toLowerCase()] ?? 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
      cur = { date, label, absent: txt(el.querySelector(".event-absent")) || null, items: [] }; days.push(cur);
    } else if (cur) {
      for (const tr of el.querySelectorAll("tr")) {
        const head = txt(tr.querySelector(".eventheading")); if (!head) continue;
        const t = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s+(.*)$/.exec(head);
        const icon = tr.querySelector("img")?.getAttribute("src")?.split("/").pop()?.replace(/\.png$/, "") ?? null;
        cur.items.push({ title: t ? t[3] : head, start: t?.[1] ?? null, end: t?.[2] ?? null, desc: tr.querySelector(".desc")?.innerHTML.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim() || null, icon });
      }
    }
  }
  return days;
}
function parseFront(html) {
  const root = parse(html);
  const section = (name) => root.querySelectorAll("h2").find((h) => txt(h).startsWith(name))?.parentNode;
  const list = (name) => (section(name)?.querySelectorAll(".artikellinje") ?? []).map((a) => ({ id: a.getAttribute("data-newsid"), title: txt(a.querySelector(".medium_font")), date: nbDate(txt(a.querySelector(".date"))) }));
  const birthdays = (section("Kommende bursdager")?.querySelectorAll(".birthday_parent") ?? []).map((b) => ({ name: txt(b.querySelector(".medium_font")), when: txt(b.querySelector(".date")) }));
  const staff = (section("Ansatte")?.querySelectorAll(".thickbox_employee, li, .employee") ?? []).map((e) => txt(e)).filter(Boolean);
  const albums = [...new Set(root.querySelectorAll(".browse_photos").map((a) => a.getAttribute("data-fotoid")).filter(Boolean))];
  const kid = txt(root.querySelector(".navbar .dropdown-toggle, #kid_name, .kidname")) || KG.name;
  const group = txt(root.querySelector(".mydaylabels")) || KG.group;
  return { newsletters: list("Nyhetsbrev"), notices: list("Faste oppslag"), birthdays, staff, frontAlbums: albums, kid, group };
}

export function load() { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return null; } }
function save(s) { writeFileSync(STATE, JSON.stringify(s), { mode: 0o600 }); }

let syncing = null;
let onLoginRequired = null; export const setOnLoginRequired = (fn) => { onLoginRequired = fn; };
export function sync({ days = 21 } = {}) {
  syncing ??= (async () => {
    try { await ping(); } catch (e) { onLoginRequired?.(); throw e; }   // never overwrite the cache with a logged-out (login page) response
    const now = new Date(); const prev = load() ?? {};
    const front = parseFront(await req("/foreldre"));
    const week = parseWeek(await req("/_ajax/calendar/fetch_calendar_week"), now);
    const from = new Date(now); from.setDate(1); const to = new Date(now.getFullYear(), now.getMonth() + 2, 1);
    let calendar = []; try { calendar = JSON.parse(await req("/_ajax/calendar/fetch_calendar_data", { from: iso(from), to: iso(to) }))
      .map((e) => ({ id: String(e.id), title: e.title, start: e.event_at, end: e.event_until, allDay: !!Number(e.is_all_day) || e.is_all_day === true, kind: e.class ?? null, desc: e.description ?? null })); } catch { /* */ }
    // Dagen min, newest first, weekdays only
    const posts = [];
    for (let i = 0; i < days; i++) { const d = new Date(now); d.setDate(d.getDate() - i); if ([0, 6].includes(d.getDay())) continue;
      const h = parse(await req("/_ajax/dagenmin/show_myday", { date: `${iso(d)} 00:00:00` }));
      const blocks = h.querySelectorAll(".todaycontent").map((b) => ({ group: txt(b.querySelector("h1")), text: (b.querySelector(".mrbread")?.innerHTML ?? "").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").trim() })).filter((b) => b.text);
      if (blocks.length) posts.push({ date: iso(d), blocks });
    }
    // Media: albums from /foto (each data-fotoid is a comma list) → JSON items
    const fotoRoot = parse(await req("/foto"));
    const albumIds = [...new Set([...front.frontAlbums, ...fotoRoot.querySelectorAll(".browse_photos").map((a) => a.getAttribute("data-fotoid"))].filter(Boolean))];
    const photos = new Map(); const albums = [];
    for (const ids of albumIds) {
      let items = []; try { items = JSON.parse(await req("/_ajax/admin_foto_rediger/browse_all_photos", { foto_ids: ids.replace(/,+$/, "") })); } catch { continue; }
      const a = { id: ids.split(",")[0], title: items[0]?.title ?? "Album", photoIds: [] };
      for (const it of items) { const id = String(it.foto_id); a.photoIds.push(id);
        photos.set(id, { id, album: a.title, date: nbDate(it.description), caption: it.foto_desc ?? null, video: /\.(mp4|mov)$/i.test(it.foto_name ?? ""), _src: it.src ?? null }); }
      albums.push(a);
    }
    let fetched = 0;
    for (const p of photos.values()) { const f = join(PHOTOS, `${p.id}.img`); if (existsSync(f) || p.video) continue;
      try { let buf = null;
        if (p._src?.startsWith("https://media1.intutor.no/")) { const r = await fetch(p._src, { signal: AbortSignal.timeout(20000) }); if (r.ok && /image/.test(r.headers.get("content-type") ?? "")) buf = Buffer.from(await r.arrayBuffer()); }
        buf ??= await req(`/_ajax/image/fetchimage/photo/${p.id}/600`, null, true);
        if (buf?.length > 500) { writeFileSync(f, buf, { mode: 0o600 }); fetched++; } } catch { /* keep going */ } }
    for (const p of photos.values()) delete p._src;
    const list = [...photos.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || Number(b.id) - Number(a.id));
    const state = { source: "mykid", syncedAt: Date.now(), transport: sessionCookies() ? "session" : "brave", child: { name: KG.name, fullName: KG.fullName, institution: KG.institution, group: front.group },
      week, calendar, posts, albums, photos: list, newsletters: front.newsletters, notices: front.notices, birthdays: front.birthdays, staff: front.staff, newPhotos: fetched,
      seen: prev.seen ?? null };
    save(state); return state;
  })().finally(() => { syncing = null; });
  return syncing;
}
export const photoFile = (id) => { const f = join(PHOTOS, `${String(id).replace(/\D/g, "")}.img`); return existsSync(f) ? f : null; };

/** Keep-alive: one allow-listed read (GET /foreldre). Throws when logged out. */
export async function ping() { const t = await req("/foreldre"); if (/logg_inn/.test(String(t).slice(0, 4000)) && !/logg_ut/.test(String(t))) throw Object.assign(new Error("MyKid utlogget"), { loginRequired: true }); return true; }
