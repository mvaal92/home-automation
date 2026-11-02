// Kalender: merges iCloud (CalDAV), shared/public webcal URLs, a local "Hjem" calendar, the kids feed (MyKid + skole)
// and maintenance due dates. Tailscale-only API under /api/calendar. Apple credentials live in the encrypted auth vault
// (namespace "icloud") and are never sent to the browser. Remote calendars are synced every 10 minutes into home.db.
import { randomBytes, createHash } from "node:crypto";
import { readBody, sendJson } from "../util.mjs";
import { vault } from "../auth/vault.mjs";
import { KG, SCHOOL } from "../family.mjs";
import { instances, buildEvent, localToMs, msToLocal, parseIcs } from "./ics.mjs";
import * as dav from "./caldav.mjs";
import { form, done, fail } from "../auth/providers/_base.mjs";

const DAY = 864e5;
const PALETTE = ["#5b8def", "#e5734a", "#3fb27f", "#b36ae2", "#e2b33c", "#e0567a", "#3cb7c4", "#8a8f98"];
const today = () => msToLocal(Date.now()).slice(0, 10);
const addDays = (d, n) => msToLocal(localToMs(d) + n * DAY + 3 * 3600e3).slice(0, 10);
const enc = (src, uid) => Buffer.from(JSON.stringify([src, uid])).toString("base64url");
const dec = (id) => { try { const [s, u] = JSON.parse(Buffer.from(id, "base64url").toString("utf8")); return typeof s === "string" && typeof u === "string" ? { source: s, uid: u } : null; } catch { return null; } };
const validDate = (s) => typeof s === "string" && /^\d{4}-\d\d-\d\d(T\d\d:\d\d)?$/.test(s) && !isNaN(localToMs(s));

export function initCalendar(db, { kids, maintenance, notify } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS cal_sources (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, url TEXT, color TEXT, visible INTEGER NOT NULL DEFAULT 1,
      writable INTEGER NOT NULL DEFAULT 0, ctag TEXT, synced_at INTEGER, error TEXT, sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cal_cache (source_id TEXT NOT NULL, uid TEXT NOT NULL, inst TEXT NOT NULL DEFAULT '', href TEXT, etag TEXT, start TEXT NOT NULL, end TEXT, all_day INTEGER NOT NULL,
      title TEXT NOT NULL, location TEXT, descr TEXT, url TEXT, recurring INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source_id, uid, inst));
    CREATE INDEX IF NOT EXISTS cal_cache_start ON cal_cache(start);
    CREATE TABLE IF NOT EXISTS cal_local (uid TEXT PRIMARY KEY, title TEXT NOT NULL, start TEXT NOT NULL, end TEXT, all_day INTEGER NOT NULL DEFAULT 0, location TEXT, descr TEXT, rrule TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`);
  const ins = db.prepare("INSERT OR IGNORE INTO cal_sources (id, kind, name, url, color, visible, writable, sort, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)");
  ins.run("local", "local", "Hjem", null, "#5b8def", 1, 0, Date.now());
  ins.run("kids", "kids", "Barn", null, "#e2b33c", 0, 1, Date.now());
  ins.run("maintenance", "maintenance", "Vedlikehold", null, "#8a8f98", 0, 2, Date.now());
  const q = {
    sources: db.prepare("SELECT * FROM cal_sources ORDER BY sort, name"), source: db.prepare("SELECT * FROM cal_sources WHERE id = ?"),
    setSource: db.prepare("UPDATE cal_sources SET name = COALESCE(?, name), color = COALESCE(?, color), visible = COALESCE(?, visible) WHERE id = ?"),
    synced: db.prepare("UPDATE cal_sources SET synced_at = ?, error = ?, ctag = COALESCE(?, ctag) WHERE id = ?"),
    delSource: db.prepare("DELETE FROM cal_sources WHERE id = ?"), clear: db.prepare("DELETE FROM cal_cache WHERE source_id = ?"),
    cacheIns: db.prepare("INSERT OR REPLACE INTO cal_cache (source_id, uid, inst, href, etag, start, end, all_day, title, location, descr, url, recurring) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"),
    range: db.prepare("SELECT * FROM cal_cache WHERE start < ? AND COALESCE(end, start) >= ? ORDER BY start"),
    byUid: db.prepare("SELECT * FROM cal_cache WHERE source_id = ? AND uid = ? LIMIT 1"),
    local: db.prepare("SELECT * FROM cal_local WHERE start < ? AND COALESCE(end, start) >= ? OR rrule IS NOT NULL"), localGet: db.prepare("SELECT * FROM cal_local WHERE uid = ?"),
    localIns: db.prepare("INSERT INTO cal_local (uid, title, start, end, all_day, location, descr, rrule, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)"),
    localUpd: db.prepare("UPDATE cal_local SET title=?, start=?, end=?, all_day=?, location=?, descr=?, rrule=?, updated_at=? WHERE uid=?"), localDel: db.prepare("DELETE FROM cal_local WHERE uid = ?"),
    maxSort: db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM cal_sources"),
  };
  const nextColor = () => PALETTE[q.sources.all().length % PALETTE.length];
  const WIN = () => [Date.now() - 120 * DAY, Date.now() + 400 * DAY];
  const cred = () => { const v = vault.get("icloud"); return v?.username && v?.password ? v : null; };
  const pub = (s) => ({ id: s.id, kind: s.kind, name: s.name, color: s.color, visible: !!s.visible, writable: !!s.writable, syncedAt: s.synced_at, error: s.error,
    url: s.kind === "webcal" ? String(s.url).replace(/^(https?:\/\/[^/]+\/).{6,}?(.{4})$/, "$1…$2") : undefined });

  // ---------- sync ----------
  function store(sourceId, list, meta = () => ({})) {
    db.exec("BEGIN"); try { q.clear.run(sourceId);
      for (const e of list) { const m = meta(e); q.cacheIns.run(sourceId, e.uid, e.instance != null ? String(e.instance) : "", m.href ?? null, m.etag ?? null, e.start, e.end, e.allDay ? 1 : 0, e.title, e.location, e.desc, e.url, e.recurring ? 1 : 0); }
      db.exec("COMMIT"); } catch (err) { db.exec("ROLLBACK"); throw err; }
  }
  async function syncWebcal(s) {
    const url = String(s.url).replace(/^webcals?:\/\//i, "https://");
    const r = await fetch(url, { headers: { "user-agent": "Home-Kalender/1.0", accept: "text/calendar" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text(); if (!/BEGIN:VCALENDAR/.test(text)) throw new Error("Ikke en kalender (ICS)");
    const [f, t] = WIN(); const res = instances(text, f, t); store(s.id, res.events);
    if (res.name && s.name === "Delt kalender") q.setSource.run(res.name, null, null, s.id);
    return res.events.length;
  }
  async function syncIcloud() {
    const c = cred(); if (!c) return { skipped: true };
    let home = c.home; if (!home) { const d = await dav.discover(c); home = d.home; vault.set("icloud", { ...c, ...d }); }
    const cals = await dav.listCalendars(c, home);
    const seen = new Set();
    for (const cal of cals) {
      const id = "icloud:" + createHash("sha1").update(cal.url).digest("hex").slice(0, 12); seen.add(id);
      const ex = q.source.get(id);
      if (!ex) db.prepare("INSERT INTO cal_sources (id, kind, name, url, color, visible, writable, sort, created_at) VALUES (?, 'icloud', ?, ?, ?, 1, ?, ?, ?)").run(id, cal.name, cal.url, cal.color ?? nextColor(), cal.writable ? 1 : 0, q.maxSort.get().s, Date.now());
      else db.prepare("UPDATE cal_sources SET url = ?, writable = ? WHERE id = ?").run(cal.url, cal.writable ? 1 : 0, id);
      if (ex && ex.ctag && ex.ctag === cal.ctag && ex.synced_at && !ex.error) { q.synced.run(Date.now(), null, null, id); continue; }
      try {
        const [f, t] = WIN(); const items = await dav.fetchEvents(c, cal.url, f, t); const all = []; const meta = new Map();
        for (const it of items) for (const e of instances(it.ics, f, t).events) { all.push(e); meta.set(e, it); }
        store(id, all, (e) => meta.get(e)); q.synced.run(Date.now(), null, cal.ctag, id);
      } catch (e) { q.synced.run(Date.now(), String(e.message).slice(0, 160), null, id); }
    }
    for (const s of q.sources.all()) if (s.kind === "icloud" && !seen.has(s.id)) { q.clear.run(s.id); q.delSource.run(s.id); }
    return { calendars: cals.length };
  }
  let lastSync = null, syncing = null, authError = null;
  async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      const out = {};
      for (const s of q.sources.all().filter((x) => x.kind === "webcal")) { try { out[s.id] = await syncWebcal(s); q.synced.run(Date.now(), null, null, s.id); } catch (e) { q.synced.run(Date.now(), String(e.message).slice(0, 160), null, s.id); out[s.id] = String(e.message); } }
      try { out.icloud = await syncIcloud(); authError = null; } catch (e) { out.icloud = { error: e.message }; if (e.authFailed) { if (!authError) notify?.({ key: `calendar:login:${today()}`, kind: "system", title: "iCloud-kalender må kobles til på nytt", body: "Apple avviste det app-spesifikke passordet.", link: "#/settings/login/icloud", severity: "warn" }); authError = e.message; } }
      lastSync = Date.now(); return out;
    })().finally(() => { syncing = null; });
    return syncing;
  }
  const timer = setInterval(() => sync().catch(() => {}), 10 * 60e3); timer.unref?.(); setTimeout(() => sync().catch(() => {}), 15e3).unref?.();

  // ---------- derived sources ----------
  let mCache = { at: 0, items: [] };
  async function maintenanceItems() { if (Date.now() - mCache.at > 5 * 60e3 && maintenance) { try { mCache = { at: Date.now(), items: await maintenance.list() }; } catch { /* keep */ } } return mCache.items; }
  function kidsEvents() {
    let list = []; try { list = kids?.agenda?.() ?? []; } catch { return []; }
    return list.map((e) => { const allDay = e.allDay || String(e.start).length <= 10; const st = String(e.start).replace(" ", "T").slice(0, allDay ? 10 : 16); const en = e.end ? String(e.end).replace(" ", "T").slice(0, allDay ? 10 : 16) : allDay ? addDays(st, 1) : st;
      const who = e.child === KG.id ? KG.name : e.child === SCHOOL.id ? SCHOOL.name : null;
      return { uid: String(e.id), title: who ? `${who}: ${e.title}` : e.title, start: st, end: allDay && en <= st ? addDays(st, 1) : en, allDay, location: null, desc: e.desc ?? null, url: e.child === SCHOOL.id ? "#/barn/skole" : "#/barn", recurring: false }; });
  }
  async function maintenanceEvents() {
    const t = today();
    return (await maintenanceItems()).filter((i) => i.nextDue || i.status === "overdue").map((i) => { const d = i.status === "overdue" || !i.nextDue ? t : msToLocal(Math.max(i.nextDue, localToMs(t))).slice(0, 10);
      return { uid: `m${i.id}`, title: `${i.name}${i.status === "overdue" ? " (forfalt)" : ""}`, start: d, end: addDays(d, 1), allDay: true, location: null, desc: i.notes || null, url: "#/vedlikehold", recurring: false }; });
  }
  function localEvents(from, to) {
    const out = [];
    for (const r of q.local.all(to, from)) {
      const ics = buildEvent({ uid: r.uid, title: r.title, start: r.start, end: r.end, allDay: !!r.all_day, location: r.location, desc: r.descr, rrule: r.rrule });
      out.push(...instances(ics, localToMs(from), localToMs(to)).events);
    }
    return out;
  }

  // ---------- queries ----------
  async function events({ from, to, all = false, sources } = {}) {
    from = validDate(from) ? from.slice(0, 10) : addDays(today(), -7); to = validDate(to) ? to.slice(0, 10) : addDays(from, 42);
    const srcs = Object.fromEntries(q.sources.all().map((s) => [s.id, s]));
    const want = (id) => srcs[id] && (all || srcs[id].visible) && (!sources || sources.includes(id));
    const out = [];
    const push = (sid, e, extra = {}) => { const s = srcs[sid]; out.push({ id: enc(sid, e.uid) + (e.instance != null && e.instance !== "" ? `.${e.instance}` : ""), calendar: sid, calendarName: s.name, color: s.color, writable: !!s.writable && s.kind !== "webcal",
      title: e.title, start: e.start, end: e.end, allDay: !!e.allDay, location: e.location ?? null, desc: e.desc ?? null, url: e.url ?? null, recurring: !!e.recurring, ...extra }); };
    for (const r of q.range.all(to + "T99", from)) if (want(r.source_id)) push(r.source_id, { uid: r.uid, instance: r.inst, title: r.title, start: r.start, end: r.end, allDay: r.all_day, location: r.location, desc: r.descr, url: r.url, recurring: r.recurring });
    if (want("local")) for (const e of localEvents(from, addDays(to, 1))) push("local", e);
    if (want("kids")) for (const e of kidsEvents()) if (e.start < to + "T99" && (e.end ?? e.start) >= from) push("kids", e, { writable: false, readOnly: "Fra skole/barnehage" });
    if (want("maintenance")) for (const e of await maintenanceEvents()) if (e.start < to + "T99" && e.end >= from) push("maintenance", e, { writable: false, kind: "maintenance" });
    return out.sort((a, b) => a.start.localeCompare(b.start) || Number(b.allDay) - Number(a.allDay));
  }
  async function upcoming(days = 7, limit = 8) {
    const t = today(); const now = msToLocal(Date.now());
    const list = (await events({ from: t, to: addDays(t, days) })).filter((e) => e.allDay ? e.end > t : (e.end ?? e.start) >= now);
    return { today: t, events: list.filter((e) => e.calendar !== "maintenance" || e.start === t).slice(0, limit), todayCount: list.filter((e) => e.start.slice(0, 10) <= t).length };
  }
  function calendars() { return { sources: q.sources.all().map(pub), icloud: { connected: !!cred(), account: cred()?.username?.replace(/^(.).*?(@.*)$/, "$1…$2") ?? null, error: authError }, lastSync, defaultCalendar: defaultCal()?.id ?? "local" }; }
  function defaultCal() { const s = q.sources.all(); return s.find((x) => x.kind === "icloud" && x.writable && x.visible) ?? s.find((x) => x.id === "local"); }

  // ---------- writes ----------
  function clean(b, partial = false) {
    const o = {}; if (b.title !== undefined || !partial) { o.title = String(b.title ?? "").trim().slice(0, 200); if (!o.title) throw Object.assign(new Error("Tittel mangler"), { status: 400 }); }
    if (b.start !== undefined || !partial) { if (!validDate(b.start)) throw Object.assign(new Error("Ugyldig start (YYYY-MM-DD eller YYYY-MM-DDTHH:MM)"), { status: 400 }); o.start = b.start; }
    if (b.allDay !== undefined || o.start) o.allDay = b.allDay !== undefined ? !!b.allDay : o.start.length === 10;
    if (b.end !== undefined && b.end !== null && b.end !== "") { if (!validDate(b.end)) throw Object.assign(new Error("Ugyldig slutt"), { status: 400 }); o.end = b.end; }
    for (const k of ["location", "desc"]) if (b[k] !== undefined) o[k] = b[k] ? String(b[k]).slice(0, 2000) : null;
    if (o.allDay && o.start) { o.start = o.start.slice(0, 10); if (o.end) o.end = o.end.slice(0, 10); }
    if (o.start && o.end && o.end < o.start) throw Object.assign(new Error("Slutt er før start"), { status: 400 });
    return o;
  }
  const writableSource = (id) => { const s = q.source.get(id); if (!s) throw Object.assign(new Error("Ukjent kalender"), { status: 404 }); if (!s.writable || s.kind === "webcal") throw Object.assign(new Error(`«${s.name}» er skrivebeskyttet`), { status: 403 }); return s; };
  async function create(b) {
    const s = writableSource(b.calendar ?? defaultCal()?.id ?? "local"); const e = clean(b);
    const uid = `${randomBytes(10).toString("hex")}@home.kalender`;
    if (s.kind === "local") { q.localIns.run(uid, e.title, e.start, e.end ?? null, e.allDay ? 1 : 0, e.location ?? null, e.desc ?? null, null, Date.now(), Date.now()); }
    else { const c = cred(); if (!c) throw Object.assign(new Error("iCloud er ikke koblet til"), { status: 409 }); await dav.putEvent(c, s.url, uid.replace("@", "-"), buildEvent({ uid, ...e })); await sync(); }
    return { ok: true, id: enc(s.id, uid), calendar: s.id };
  }
  function locate(id) { const base = String(id).split(".")[0]; const k = dec(base); if (!k) throw Object.assign(new Error("Ugyldig id"), { status: 400 }); return { ...k, s: writableSource(k.source) }; }
  async function update(id, b) {
    const { uid, s } = locate(id); const e = clean(b, true);
    if (s.kind === "local") { const r = q.localGet.get(uid); if (!r) throw Object.assign(new Error("Fant ikke avtalen"), { status: 404 });
      const allDay = e.allDay ?? !!r.all_day; const m = { title: e.title ?? r.title, start: e.start ?? r.start, end: e.end !== undefined ? e.end : r.end, location: e.location !== undefined ? e.location : r.location, desc: e.desc !== undefined ? e.desc : r.descr };
      q.localUpd.run(m.title, allDay ? m.start.slice(0, 10) : m.start, m.end ?? null, allDay ? 1 : 0, m.location, m.desc, r.rrule, Date.now(), uid); return { ok: true }; }
    const c = cred(); if (!c) throw Object.assign(new Error("iCloud er ikke koblet til"), { status: 409 });
    const row = q.byUid.get(s.id, uid); if (!row?.href) throw Object.assign(new Error("Fant ikke avtalen – synk og prøv igjen"), { status: 404 });
    const cur = await dav.getEvent(c, row.href); const base = parseIcs(cur.ics).events.find((x) => x.recurrenceId == null) ?? parseIcs(cur.ics).events[0];
    const allDay = e.allDay ?? base.allDay; const oldStart = base.allDay ? msToLocal(base.startMs).slice(0, 10) : msToLocal(base.startMs); const oldEnd = base.allDay ? msToLocal(base.endMs).slice(0, 10) : msToLocal(base.endMs);
    const ics = buildEvent({ uid, title: e.title ?? base.title, start: e.start ?? oldStart, end: e.end !== undefined ? e.end : (e.start ? null : oldEnd), allDay, location: e.location !== undefined ? e.location : base.location, desc: e.desc !== undefined ? e.desc : base.desc, rrule: base.rrule });
    await dav.putEvent(c, s.url, uid, ics, { href: row.href, etag: cur.etag ?? row.etag }); await sync(); return { ok: true, recurringSeries: !!base.rrule };
  }
  async function remove(id, confirm) {
    if (confirm !== true) throw Object.assign(new Error("Sletting krever confirm=true"), { status: 400 });
    const { uid, s } = locate(id);
    if (s.kind === "local") { q.localDel.run(uid); return { ok: true }; }
    const c = cred(); if (!c) throw Object.assign(new Error("iCloud er ikke koblet til"), { status: 409 });
    const row = q.byUid.get(s.id, uid); if (!row?.href) throw Object.assign(new Error("Fant ikke avtalen"), { status: 404 });
    await dav.deleteEvent(c, row.href, row.etag); db.prepare("DELETE FROM cal_cache WHERE source_id = ? AND uid = ?").run(s.id, uid); return { ok: true };
  }
  async function addWebcal(url, name) {
    const u = String(url ?? "").trim().replace(/^webcals?:\/\//i, "https://");
    if (!/^https:\/\/[^\s/]+\.[^\s/]+\/\S+$/.test(u) && !(process.env.HOME_CAL_ALLOW_HTTP === "1" && /^http:\/\/127\.0\.0\.1:\d+\//.test(u))) throw Object.assign(new Error("Lim inn en webcal://- eller https://-lenke til en kalender"), { status: 400 });
    const id = "webcal:" + createHash("sha1").update(u).digest("hex").slice(0, 10);
    if (!q.source.get(id)) db.prepare("INSERT INTO cal_sources (id, kind, name, url, color, visible, writable, sort, created_at) VALUES (?, 'webcal', ?, ?, ?, 1, 0, ?, ?)").run(id, String(name ?? "").trim().slice(0, 60) || "Delt kalender", u, nextColor(), q.maxSort.get().s, Date.now());
    try { const n = await syncWebcal(q.source.get(id)); q.synced.run(Date.now(), null, null, id); return { ok: true, id, events: n }; }
    catch (e) { q.delSource.run(id); q.clear.run(id); throw Object.assign(new Error(`Kunne ikke hente kalenderen: ${e.message}`), { status: 400 }); }
  }

  // ---------- auth provider (registered into the auth broker by server.mjs) ----------
  const APPLE_HELP = "Lag et app-spesifikt passord på account.apple.com → Logg på og sikkerhet → App-spesifikke passord. Lagres kryptert på serveren og sendes aldri til skjermen.";
  const provider = { id: "icloud", name: "iCloud-kalender", kind: "password", method: "Apple-ID + app-spesifikt passord (CalDAV)", password: true,
    status: async () => { const c = cred(); if (!c) return { status: "not-connected", detail: "Kalendere fra iCloud vises i Kalender-fanen" };
      if (authError) return { status: "login-required", detail: "Apple avviste passordet – lag et nytt app-spesifikt passord" };
      const n = q.sources.all().filter((s) => s.kind === "icloud").length; return { status: "ok", detail: `${n} kalender${n === 1 ? "" : "e"} · synk hvert 10. min` }; },
    start: async () => form("iCloud-kalender", [{ name: "email", label: "Apple-ID (e-post)", type: "email", autocomplete: "username" },
      { name: "password", label: "App-spesifikt passord", type: "password", autocomplete: "off", maxLength: 24 }], { submit: "Koble til", message: APPLE_HELP, url: "https://account.apple.com/account/manage" }),
    step: async (_ctx, v) => {
      const username = String(v.email ?? "").trim(); const password = String(v.password ?? "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(username)) return fail("Skriv inn Apple-ID-en (e-postadressen).");
      if (!/^[a-z]{4}-?[a-z]{4}-?[a-z]{4}-?[a-z]{4}$/.test(password)) return fail("Bruk et app-spesifikt passord (format xxxx-xxxx-xxxx-xxxx), ikke det vanlige Apple-passordet.");
      const c = { username, password: password.replace(/^(\w{4})-?(\w{4})-?(\w{4})-?(\w{4})$/, "$1-$2-$3-$4") };
      try { const d = await dav.discover(c); const cals = await dav.listCalendars(c, d.home); vault.set("icloud", { ...c, ...d }); authError = null; sync().catch(() => {}); return done(`Tilkoblet ✓ – ${cals.length} kalender${cals.length === 1 ? "" : "e"} funnet`); }
      catch (e) { return fail(e.authFailed ? "Apple avviste innloggingen. Sjekk Apple-ID og lag et nytt app-spesifikt passord." : `Kunne ikke nå iCloud: ${String(e.message).slice(0, 100)}`); }
    },
    refresh: async () => { await sync(); return { ok: !authError }; },
    logout: async () => { vault.del("icloud"); for (const s of q.sources.all()) if (s.kind === "icloud") { q.clear.run(s.id); q.delSource.run(s.id); } authError = null; return { ok: true }; },
  };

  // ---------- HTTP ----------
  async function routes(req, res, sub, trusted) {
    if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
    const url = new URL(req.url, "http://x"); const m = req.method;
    try {
      if (m === "GET" && (sub === "" || sub === "calendars" || sub === "sources")) return sendJson(res, 200, calendars());
      if (m === "GET" && sub === "events") return sendJson(res, 200, { events: await events({ from: url.searchParams.get("from"), to: url.searchParams.get("to"), all: url.searchParams.get("all") === "1", sources: url.searchParams.get("calendars")?.split(",").filter(Boolean) }) });
      if (m === "GET" && sub === "upcoming") return sendJson(res, 200, await upcoming(Number(url.searchParams.get("days") ?? 7), Number(url.searchParams.get("limit") ?? 8)));
      if (m === "POST" && sub === "sync") return sendJson(res, 200, { ok: true, result: await sync() });
      if (m === "POST" && sub === "sources") { const b = await readBody(req, 8192); return sendJson(res, 200, await addWebcal(b.url, b.name)); }
      const sm = /^sources\/([a-z0-9:_-]+)$/i.exec(sub);
      if (sm && m === "PATCH") { const b = await readBody(req, 4096); if (!q.source.get(sm[1])) return sendJson(res, 404, { error: "ukjent kalender" });
        q.setSource.run(b.name ? String(b.name).slice(0, 60) : null, /^#[0-9a-f]{6}$/i.test(b.color ?? "") ? b.color : null, b.visible === undefined ? null : b.visible ? 1 : 0, sm[1]); return sendJson(res, 200, { ok: true }); }
      if (sm && m === "DELETE") { const s = q.source.get(sm[1]); if (s?.kind !== "webcal") return sendJson(res, 400, { error: "Bare delte lenker kan fjernes her" }); q.clear.run(s.id); q.delSource.run(s.id); return sendJson(res, 200, { ok: true }); }
      if (m === "POST" && sub === "events") return sendJson(res, 200, await create(await readBody(req, 16384)));
      const em = /^events\/([A-Za-z0-9_.-]+)$/.exec(sub);
      if (em && m === "PATCH") return sendJson(res, 200, await update(em[1], await readBody(req, 16384)));
      if (em && m === "DELETE") { const b = await readBody(req, 1024).catch(() => ({})); return sendJson(res, 200, await remove(em[1], b.confirm === true || url.searchParams.get("confirm") === "true")); }
      return sendJson(res, 404, { error: "not found" });
    } catch (e) { return sendJson(res, e.status ?? 502, { error: String(e.message).slice(0, 200) }); }
  }
  return { routes, provider, sync, events, upcoming, calendars, create, update, remove, addWebcal };
}
