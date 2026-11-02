// Calendar test with a mock CalDAV server + local webcal (no real iCloud, no devices). Run: node test/calendar.test.mjs
import http from "node:http"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path"; import assert from "node:assert/strict";
const dir = mkdtempSync(join(tmpdir(), "cal-"));
process.env.HOME_VAULT_FILE = join(dir, "vault.bin"); process.env.HOME_VAULT_KEY = join(dir, "vault.key"); process.env.HOME_CAL_ALLOW_HTTP = "1"; process.env.HOME_FAMILY_FILE = join(dir, "none.json");
const store = new Map(); let etagN = 1;
const ICS = (uid, s, e, t, rr = "") => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;TZID=Europe/Oslo:${s}\r\nDTEND;TZID=Europe/Oslo:${e}\r\nSUMMARY:${t}\r\n${rr}END:VEVENT\r\nEND:VCALENDAR\r\n`;
store.set("/1/calendars/home/a.ics", { ics: ICS("a", "20261012T170000", "20261012T180000", "Fotball", "RRULE:FREQ=WEEKLY\r\n"), etag: '"e0"' });
const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
  if (req.url === "/shared.ics") return res.writeHead(200, { "content-type": "text/calendar" }).end(`BEGIN:VCALENDAR\r\nX-WR-CALNAME:Skoleruta\r\nBEGIN:VEVENT\r\nUID:h1\r\nDTSTART;VALUE=DATE:20261013\r\nDTEND;VALUE=DATE:20261014\r\nSUMMARY:Planleggingsdag\r\nEND:VEVENT\r\nEND:VCALENDAR`);
  if (req.headers.authorization !== "Basic " + Buffer.from("m@example.com:abcd-efgh-ijkl-mnop").toString("base64")) { res.writeHead(401).end(); return; }
  const ms = (x) => { res.writeHead(207, { "content-type": "application/xml" }).end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/">${x}</d:multistatus>`); };
  if (req.method === "PROPFIND" && req.url === "/") return ms(`<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/1/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`);
  if (req.method === "PROPFIND" && req.url === "/1/principal/") return ms(`<d:response><d:href>/1/principal/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>/1/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>`);
  if (req.method === "PROPFIND" && req.url === "/1/calendars/") return ms(`<d:response><d:href>/1/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/1/calendars/home/</d:href><d:propstat><d:prop><d:displayname>Familie</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><cs:getctag>c${etagN}</cs:getctag><a:calendar-color>#FF2968FF</a:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:all/></d:privilege></d:current-user-privilege-set></d:prop></d:propstat></d:response>`);
  if (req.method === "REPORT") return ms([...store].map(([h, v]) => `<d:response><d:href>${h}</d:href><d:propstat><d:prop><d:getetag>${v.etag}</d:getetag><c:calendar-data>${v.ics.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</c:calendar-data></d:prop></d:propstat></d:response>`).join(""));
  if (req.method === "PUT") { if (req.headers["if-none-match"] === "*" && store.has(req.url)) { res.writeHead(412).end(); return; } const et = `"e${etagN++}"`; store.set(req.url, { ics: b, etag: et }); res.writeHead(201, { etag: et }).end(); return; }
  if (req.method === "GET" && store.has(req.url)) { const v = store.get(req.url); res.writeHead(200, { etag: v.etag }).end(v.ics); return; }
  if (req.method === "DELETE") { store.delete(req.url); etagN++; res.writeHead(204).end(); return; }
  res.writeHead(404).end(); }); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const port = srv.address().port;
process.env.HOME_CALDAV_ROOT = `http://127.0.0.1:${port}/`;
const { DatabaseSync } = await import("node:sqlite"); const { initCalendar } = await import("../lib/calendar/index.mjs");
const db = new DatabaseSync(":memory:");
const kids = { agenda: () => [{ id: "k1", title: "Tur i skogen", start: "2026-10-12", allDay: true, child: "x" }] };
const maintenance = { list: async () => [{ id: 1, name: "Flexit luftfilter", nextDue: Date.now() + 3 * 864e5, status: "due", notes: "" }] };
const cal = initCalendar(db, { kids, maintenance, notify: () => {} });
// wrong password -> rejected, nothing stored
let r = await cal.provider.step({}, { email: "m@example.com", password: "zzzz-zzzz-zzzz-zzzz" }); assert.equal(r.state, "error");
r = await cal.provider.step({}, { email: "m@example.com", password: "hunter2" }); assert.equal(r.state, "error");
r = await cal.provider.step({}, { email: "m@example.com", password: "ABCD-EFGH-IJKL-MNOP" }); assert.equal(r.state, "done", JSON.stringify(r));
await cal.sync();
const c = cal.calendars(); const fam = c.sources.find((s) => s.kind === "icloud"); assert.ok(fam && fam.name === "Familie" && fam.writable && fam.color === "#FF2968"); assert.equal(c.defaultCalendar, fam.id);
assert.ok(!JSON.stringify(c).includes("abcd"), "password leaked");
let ev = await cal.events({ from: "2026-10-01", to: "2026-10-31" });
assert.equal(ev.filter((e) => e.title === "Fotball").length, 3); assert.ok(ev.some((e) => e.calendar === "kids")); assert.ok(ev.some((e) => e.calendar === "maintenance"));
// create / update / delete on iCloud (mock)
const cr = await cal.create({ title: "Tannlege", start: "2026-10-20T09:00", end: "2026-10-20T09:30" }); assert.equal(cr.calendar, fam.id);
ev = await cal.events({ from: "2026-10-20", to: "2026-10-21" }); const t = ev.find((e) => e.title === "Tannlege"); assert.ok(t && t.start === "2026-10-20T09:00");
await cal.update(t.id, { title: "Tannlege (flyttet)", start: "2026-10-20T10:00", end: "2026-10-20T10:30" });
ev = await cal.events({ from: "2026-10-20", to: "2026-10-21" }); const t2 = ev.find((e) => e.title.startsWith("Tannlege")); assert.equal(t2.title, "Tannlege (flyttet)"); assert.equal(t2.start, "2026-10-20T10:00");
await assert.rejects(cal.remove(t2.id, false), /confirm/);
await cal.remove(t2.id, true); ev = await cal.events({ from: "2026-10-20", to: "2026-10-21" }); assert.ok(!ev.some((e) => e.title.startsWith("Tannlege")));
// local calendar
const lc = await cal.create({ calendar: "local", title: "Middag hos mormor", start: "2026-10-18", allDay: true }); ev = await cal.events({ from: "2026-10-18", to: "2026-10-19" }); assert.ok(ev.some((e) => e.title === "Middag hos mormor" && e.allDay));
await cal.remove(lc.id, true);
// read-only kids
const k = (await cal.events({ from: "2026-10-12", to: "2026-10-13" })).find((e) => e.calendar === "kids"); await assert.rejects(cal.update(k.id, { title: "x" }), /skrivebeskyttet/);
// webcal import
const w = await cal.addWebcal(`http://127.0.0.1:${port}/shared.ics`); assert.equal(w.events, 1); assert.ok(cal.calendars().sources.some((s) => s.name === "Skoleruta"));
await assert.rejects(cal.create({ calendar: w.id, title: "x", start: "2026-10-13" }), /skrivebeskyttet/);
// hide a calendar
db.prepare("UPDATE cal_sources SET visible = 0 WHERE id = ?").run(fam.id); ev = await cal.events({ from: "2026-10-01", to: "2026-10-31" }); assert.ok(!ev.some((e) => e.title === "Fotball"));
const up = await cal.upcoming(); assert.ok(Array.isArray(up.events));
await cal.provider.logout(); assert.ok(!cal.calendars().sources.some((s) => s.kind === "icloud"));
console.log("calendar tests: all passed"); srv.close(); process.exit(0);
