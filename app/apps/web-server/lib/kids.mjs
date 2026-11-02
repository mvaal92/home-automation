// "Barn" – multi-source kids hub. Sources: mykid (kindergarten, live), skole (Visma Flyt Foresattportal via logged-in Brave tab).
// All sources are READ-ONLY. Local state (to-dos, packing ticks) lives in home.db.
import { readFileSync } from "node:fs";
import * as mykid from "./mykid.mjs";
import * as skole from "./skole.mjs";
import { readBody, sendJson, SECURITY } from "./util.mjs";
import { KG, SCHOOL } from "./family.mjs";

const SOURCES = [
  { id: "mykid", kind: "barnehage", label: "Barnehage", app: "MyKid", status: () => (mykid.load() ? "ok" : "not-synced") },
  { id: "skole", kind: "skole", label: "Skole", app: "Visma Flyt Foresattportal (Kommunen)", status: () => (skole.load() ? (skoleErr ? "login-required" : "ok") : "login-required"),
    note: "Leses via innlogget Foresattportal i Brave (BankID). Når økten utløper må du logge inn på nytt med BankID; data vises fra siste synk til da." },
];
let skoleErr = null;
const iso = (d) => d.toISOString().slice(0, 10);
const PACK_RULES = [
  [/tur(dag)?|skog|utflukt/i, ["Sekk", "Klær etter vær", "Drikkeflaske"]],
  [/gym|idrett|gymsal/i, ["Gymtøy", "Innesko"]],
  [/svøm/i, ["Badetøy", "Håndkle"]],
  [/matpakke|niste/i, ["Matpakke"]],
];
function packingFor(items) {
  const set = new Set();
  for (const it of items) { const t = `${it.title} ${it.desc ?? ""}`;
    for (const [re, list] of PACK_RULES) if (re.test(t)) list.forEach((x) => set.add(x));
    for (const m of t.matchAll(/husk\s+([^.\n!]+)/gi)) m[1].split(/,| og /).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 40).forEach((s) => set.add(s[0].toUpperCase() + s.slice(1)));
  }
  return [...set];
}

export function initKids(db, notify) {
  db.exec(`CREATE TABLE IF NOT EXISTS kids_todos (id INTEGER PRIMARY KEY AUTOINCREMENT, child TEXT, title TEXT NOT NULL, due TEXT, source TEXT, ref TEXT UNIQUE, done INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS kids_pack (date TEXT, child TEXT, item TEXT, done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, child, item));
    UPDATE kids_todos SET child = '${SCHOOL.id}' WHERE child = 'skole'; UPDATE kids_pack SET child = '${SCHOOL.id}' WHERE child = 'skole';`);
  const q = {
    todos: db.prepare("SELECT * FROM kids_todos ORDER BY done, COALESCE(due,'9999'), id DESC"),
    addTodo: db.prepare("INSERT OR IGNORE INTO kids_todos (child, title, due, source, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)"),
    setTodo: db.prepare("UPDATE kids_todos SET done = ? WHERE id = ?"), delTodo: db.prepare("DELETE FROM kids_todos WHERE id = ?"),
    pack: db.prepare("SELECT item, done FROM kids_pack WHERE date = ? AND child = ?"),
    setPack: db.prepare("INSERT INTO kids_pack (date, child, item, done) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET done = excluded.done"),
  };

  function overview() {
    const s = mykid.load(); const today = iso(new Date());
    const children = [];
    if (s) {
      const days = s.week.map((d) => { const items = d.items; const pack = packingFor(items); const ticks = Object.fromEntries(q.pack.all(d.date, KG.id).map((r) => [r.item, !!r.done]));
        return { ...d, packing: pack.map((item) => ({ item, done: !!ticks[item] })) }; });
      children.push({ id: KG.id, name: s.child.name, fullName: s.child.fullName, kind: "barnehage", institution: s.child.institution, group: s.child.group, source: "mykid",
        today: days.find((d) => d.date === today) ?? null, week: days, latestPost: s.posts[0] ?? null, photoCount: s.photos.length, latestPhotos: s.photos.slice(0, 8).map((p) => p.id) });
    }
    const sk = skole.load();
    if (sk) children.push({ id: SCHOOL.id, name: SCHOOL.name, fullName: sk.child.fullName, kind: "skole", source: "skole", institution: sk.child.school, group: `${sk.child.level}. trinn · ${sk.child.contactTeacher ?? ""}`.trim(), today: null, week: [],
      school: { syncedAt: sk.syncedAt, loginRequired: !!skoleErr, unread: sk.messages.filter((m) => m.unread).length + sk.notices.filter((n) => n.unread).length, latest: sk.messages[0] ?? null, homework: sk.homework[0] ?? null, openForms: sk.forms.filter((f) => !f.answered && !f.closed).length, absenceDays: sk.absence.terms.reduce((a, t) => a + (t.totalDays ?? 0), 0) } });
    else children.push({ id: SCHOOL.id, name: SCHOOL.name, kind: "skole", source: "skole", pending: true, institution: SCHOOL.school, today: null, week: [] });
    return { sources: SOURCES.map(({ status, ...x }) => ({ ...x, status: status() })), syncedAt: s?.syncedAt ?? null, transport: s?.transport ?? null, children, todos: q.todos.all() };
  }
  function agenda() {
    const s = mykid.load(); if (!s) return [];
    const ev = s.calendar.filter((e) => e.kind !== "birthday").map((e) => ({ ...e, child: KG.id, source: "mykid" }));
    for (const d of s.week) for (const it of d.items) if (d.date && !ev.some((e) => e.start?.startsWith(d.date) && e.title === it.title))
      ev.push({ id: `w_${d.date}_${it.title}`, title: it.title, start: it.start ? `${d.date} ${it.start}:00` : d.date, end: it.end ? `${d.date} ${it.end}:00` : null, allDay: !it.start, desc: it.desc, child: KG.id, source: "mykid" });
    for (const e of skole.load()?.events ?? []) ev.push({ ...e, end: null, child: SCHOOL.id, source: "skole" });
    return ev.sort((a, b) => a.start.localeCompare(b.start));
  }
  function ics() {
    const esc = (t) => String(t ?? "").replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
    const dt = (s, allDay) => allDay ? `;VALUE=DATE:${s.slice(0, 10).replace(/-/g, "")}` : `;TZID=Europe/Oslo:${s.replace(/[-:]/g, "").replace(" ", "T").slice(0, 15)}`;
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Home//Barn//NO", "X-WR-CALNAME:Barn", "X-WR-TIMEZONE:Europe/Oslo"];
    for (const e of agenda()) { const allDay = e.allDay || e.start.length <= 10;
      L.push("BEGIN:VEVENT", `UID:${e.id}@home.barn`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`, `DTSTART${dt(e.start, allDay)}`);
      if (e.end && !allDay) L.push(`DTEND${dt(e.end, false)}`);
      L.push(`SUMMARY:${esc(`${e.child === KG.id ? `${KG.name}: ` : e.child === SCHOOL.id ? `${SCHOOL.name}: ` : ""}${e.title}`)}`); if (e.desc) L.push(`DESCRIPTION:${esc(e.desc)}`); L.push("END:VEVENT"); }
    L.push("END:VCALENDAR"); return L.join("\r\n");
  }
  async function syncSkole() {
    const before = skole.load();
    try { const s = await skole.sync(); skoleErr = null;
      const old = new Set([...(before?.messages ?? []), ...(before?.notices ?? [])].map((m) => m.id));
      if (before) for (const m of [...s.messages, ...s.notices]) if (!old.has(m.id) && m.from !== "Deg") notify({ key: `skole:${m.id}`, kind: "kids", title: `Melding fra skolen: ${m.title}`, body: `${m.from} – ${m.text.slice(0, 120)}`, link: "#/barn/skole", severity: /viktig|frist|husk/i.test(m.title) ? "urgent" : "info" });
      for (const f of s.forms) if (!f.answered && !f.closed) q.addTodo.run(SCHOOL.id, `Svar på skjema: ${f.title} (i Foresattportalen)`, f.deadline, "skole", `skole:form:${f.id}`, Date.now());
      return s;
    } catch (e) { if (e.loginRequired && !skoleErr) notify({ key: `skole:login:${new Date().toISOString().slice(0, 10)}`, kind: "kids", title: "Skoleportalen må logges inn igjen", body: "Logg inn med BankID i Brave på omarchy", link: "#/barn/skole" }); skoleErr = e.message; throw e; }
  }
  async function sync() {
    syncSkole().catch(() => undefined);
    const before = mykid.load(); const s = await mykid.sync();
    const oldPosts = new Set((before?.posts ?? []).map((p) => p.date)); const oldNews = new Set((before?.newsletters ?? []).map((n) => n.id));
    for (const p of s.posts) if (before && !oldPosts.has(p.date)) notify({ key: `mykid:post:${p.date}`, kind: "kids", title: "Nytt i Dagen min", body: p.blocks[0]?.text.slice(0, 140), link: "#/barn" });
    for (const n of s.newsletters) if (before && !oldNews.has(n.id)) notify({ key: `mykid:news:${n.id}`, kind: "kids", title: "Nytt nyhetsbrev fra barnehagen", body: n.title, link: "#/barn", severity: /viktig/i.test(n.title) ? "urgent" : "info" });
    if (before && s.newPhotos > 0) notify({ key: `mykid:photos:${s.syncedAt}`, kind: "kids", title: `${s.newPhotos} nye bilder fra barnehagen`, link: "#/barn/bilder" });
    // to-dos from "Husk …" lines in the week plan
    for (const d of s.week) for (const it of d.items) for (const m of `${it.desc ?? ""}`.matchAll(/(husk[^.\n!]*)/gi))
      q.addTodo.run(KG.id, m[1].trim(), d.date, "mykid", `mykid:${d.date}:${m[1].trim()}`, Date.now());
    return s;
  }
  let timer = null;
  const start = () => { const tick = () => { const h = new Date().getHours(); if (h >= 7 && h <= 20) sync().catch(() => undefined); };
    setTimeout(tick, 20_000); timer = setInterval(tick, 45 * 60_000); };

  function today(text = "") { // for assistant: "hva skjer i barnehagen i dag / i morgen"
    const o = overview(); const c = o.children.find((x) => x.id === KG.id); if (!c) return "Jeg har ikke hentet data fra MyKid ennå.";
    const tm = /i morgen/i.test(text); const d = new Date(); if (tm) d.setDate(d.getDate() + 1); const when = tm ? "I morgen" : "I dag";
    const t = c.week.find((x) => x.date === iso(d)); if (!t || !t.items.length) return `${when}: ingenting spesielt for ${KG.name} i barnehagen.`;
    const lines = t.items.map((i) => `- ${i.start ? `${i.start}–${i.end} ` : ""}${i.title}${i.desc ? `: ${i.desc.replace(/\n/g, " ")}` : ""}`);
    const pack = t.packing.length ? `\nHusk å pakke: ${t.packing.map((p) => p.item.toLowerCase()).join(", ")}.` : "";
    return `${when} i barnehagen (${c.group}):\n${lines.join("\n")}${pack}`;
  }

  async function routes(req, res, sub, trusted) {
    if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
    try {
      const url = new URL(req.url, "http://x");
      if (sub === "overview") return sendJson(res, 200, overview());
      if (sub === "agenda") return sendJson(res, 200, { events: agenda() });
      if (sub === "feed") { const s = mykid.load(); return sendJson(res, 200, s ? { posts: s.posts, albums: s.albums, photos: s.photos, newsletters: s.newsletters, notices: s.notices, birthdays: s.birthdays, staff: s.staff } : { posts: [], albums: [], photos: [] }); }
      if (sub === "skole") { const s = skole.load(); return sendJson(res, 200, s ? { ...s, loginRequired: !!skoleErr, error: skoleErr } : { loginRequired: true, error: skoleErr }); }
      const am = /^skole\/attachment\/([0-9a-f-]+)\/(\d+)$/i.exec(sub);
      if (am && req.method === "GET") { try { const a = await skole.attachment(am[1], am[2]);
          res.writeHead(200, { ...SECURITY, "content-type": a.ct, "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(a.name)}`, "cache-control": "private, max-age=3600" }); return res.end(a.buf); }
        catch (e) { res.writeHead(e.status ?? 502, { ...SECURITY, "content-type": "text/html; charset=utf-8" });
          return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;max-width:520px;margin:15vh auto;padding:0 20px;color:#222"><h2>Vedlegg</h2><p>${String(e.message).replace(/[<>&]/g, "")}</p><p><a href="https://foresatt.visma.no/kommunen" target="_blank" rel="noreferrer">Åpne Foresattportalen</a> · <a href="/#/barn/skole">Tilbake til Skole</a></p></body>`); } }
      if (sub === "skole/sync" && req.method === "POST") { const s = await syncSkole(); return sendJson(res, 200, { ok: true, syncedAt: s.syncedAt }); }
      if (sub === "sync" && req.method === "POST") { const s = await sync(); return sendJson(res, 200, { ok: true, syncedAt: s.syncedAt, newPhotos: s.newPhotos }); }
      if (sub === "barn.ics") { res.writeHead(200, { ...SECURITY, "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" }); return res.end(ics()); }
      if (sub.startsWith("photo/")) { const f = mykid.photoFile(sub.slice(6)); if (!f) return sendJson(res, 404, { error: "not cached" });
        res.writeHead(200, { ...SECURITY, "content-type": "image/jpeg", "cache-control": "private, max-age=86400" }); return res.end(readFileSync(f)); }
      if (sub === "todos" && req.method === "POST") { const b = await readBody(req); const t = String(b.title ?? "").trim().slice(0, 200); if (!t) return sendJson(res, 400, { error: "title" });
        q.addTodo.run(String(b.child ?? KG.id), t, b.due ?? null, "local", null, Date.now()); return sendJson(res, 200, { ok: true, todos: q.todos.all() }); }
      const tm = /^todos\/(\d+)$/.exec(sub);
      if (tm && req.method === "PATCH") { const b = await readBody(req); q.setTodo.run(b.done ? 1 : 0, Number(tm[1])); return sendJson(res, 200, { ok: true, todos: q.todos.all() }); }
      if (tm && req.method === "DELETE") { q.delTodo.run(Number(tm[1])); return sendJson(res, 200, { ok: true, todos: q.todos.all() }); }
      if (sub === "pack" && req.method === "POST") { const b = await readBody(req); q.setPack.run(String(b.date), String(b.child ?? KG.id), String(b.item).slice(0, 80), b.done ? 1 : 0); return sendJson(res, 200, { ok: true }); }
      return sendJson(res, 404, { error: "not found" });
    } catch (e) { return sendJson(res, e.status ?? 502, { error: e.message, loginRequired: !!e.loginRequired }); }
  }
  function school(text = "") { const s = skole.load(); if (!s) return "Jeg har ikke hentet data fra skolen ennå – logg inn i Foresattportalen med BankID.";
    const lines = [`${SCHOOL.name} – ${s.child.school} (${s.child.level}. trinn), kontaktlærer ${s.child.contactTeacher}.`];
    if (/lekse|ukeplan/i.test(text) || true) { const h = s.homework[0]; if (h) lines.push(`Siste ukeplan/lekser: «${h.title}» (${h.sent.slice(0, 10)}) fra ${h.teacher}${h.plan ? ` – vedlegg ${h.plan}, åpne i Foresattportalen` : ""}.`); }
    const m = s.messages.find((x) => x.from !== "Deg"); if (m) lines.push(`Siste melding: «${m.title}» fra ${m.from} (${m.sent.slice(0, 10)}).`);
    const open = s.forms.filter((f) => !f.answered && !f.closed); lines.push(open.length ? `Åpne skjema: ${open.map((f) => `${f.title} (frist ${f.deadline})`).join(", ")}.` : "Ingen åpne skjema.");
    const abs = s.absence.terms.reduce((a, t) => a + (t.totalDays ?? 0), 0); lines.push(`Fravær ${s.absence.year}: ${abs} dager.`);
    if (skoleErr) lines.push("(Økten er utløpt – dette er fra siste synk.)"); return lines.join("\n"); }
  return { routes, start, sync, today, overview, school, agenda };
}
