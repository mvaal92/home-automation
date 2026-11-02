// Minimal, dependency-free iCalendar (RFC 5545) parser/expander + writer.
// Events are normalised to Europe/Oslo wall time: { uid, title, start: "YYYY-MM-DD" | "YYYY-MM-DDTHH:MM", end, allDay, location, desc, rrule? }.
export const TZ = "Europe/Oslo";
const pad = (n) => String(n).padStart(2, "0");
const fmtParts = new Map();
function partsIn(tz, ms) {
  let f = fmtParts.get(tz);
  if (!f) { try { f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return partsIn(TZ, ms); } fmtParts.set(tz, f); }
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}
/** wall-clock time in tz -> epoch ms */
export function wallToMs(y, m, d, h = 0, mi = 0, s = 0, tz = TZ) {
  const guess = Date.UTC(y, m - 1, d, h, mi, s); let t = guess;
  for (let i = 0; i < 2; i++) { const p = partsIn(tz, t); const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s); t += guess - asUtc; }
  return t;
}
export function msToLocal(ms) { const p = partsIn(TZ, ms); return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`; }
export const localToMs = (s) => { const m = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d))?/.exec(s); if (!m) return NaN; return wallToMs(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0)); };

function unfold(text) { return String(text).replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n"); }
function parseLine(line) {
  const i = line.search(/[:]/); if (i < 0) return null;
  const head = line.slice(0, i); const value = line.slice(i + 1);
  const [name, ...ps] = head.split(";"); const params = {};
  for (const p of ps) { const j = p.indexOf("="); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ""); }
  return { name: name.toUpperCase(), params, value };
}
const unesc = (v) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
/** ICS date value -> { ms, allDay } */
function parseDt(value, params, defTz) {
  const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/.exec(value.trim()); if (!m) return null;
  if (!m[4] || params.VALUE === "DATE") return { allDay: true, date: `${m[1]}-${m[2]}-${m[3]}`, ms: wallToMs(+m[1], +m[2], +m[3]) };
  if (m[7]) return { allDay: false, ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) };
  return { allDay: false, ms: wallToMs(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0), params.TZID ?? defTz ?? TZ) };
}
function parseDuration(v) { const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim()); if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 + +(m[4] ?? 0)) * 3600e3 + +(m[5] ?? 0) * 60e3 + +(m[6] ?? 0) * 1e3); }

/** Parse VCALENDAR text into raw VEVENTs and the calendar name. */
export function parseIcs(text) {
  const out = []; let cur = null; let depth = 0; let name = null; let calTz = null; let color = null;
  for (const raw of unfold(text)) {
    const l = parseLine(raw); if (!l) continue;
    if (l.name === "BEGIN") { if (l.value === "VEVENT" && depth === 0) cur = { props: {}, exdates: [] }; else if (cur) depth++; continue; }
    if (l.name === "END") { if (l.value === "VEVENT" && depth === 0 && cur) { out.push(cur); cur = null; } else if (cur) depth--; continue; }
    if (!cur) { if (l.name === "X-WR-CALNAME") name = unesc(l.value); if (l.name === "X-WR-TIMEZONE") calTz = l.value; if (l.name === "X-APPLE-CALENDAR-COLOR") color = l.value.slice(0, 7); continue; }
    if (depth) continue;
    if (l.name === "EXDATE") { for (const v of l.value.split(",")) { const d = parseDt(v, l.params, calTz); if (d) cur.exdates.push(d.ms); } continue; }
    cur.props[l.name] = l;
  }
  const events = [];
  for (const e of out) {
    const P = e.props; const s = P.DTSTART && parseDt(P.DTSTART.value, P.DTSTART.params, calTz); if (!s) continue;
    if (P.STATUS?.value === "CANCELLED") continue;
    let endMs = P.DTEND ? parseDt(P.DTEND.value, P.DTEND.params, calTz)?.ms : null;
    if (endMs == null && P.DURATION) endMs = s.ms + parseDuration(P.DURATION.value);
    if (endMs == null) endMs = s.allDay ? s.ms + 864e5 : s.ms;
    const rec = P["RECURRENCE-ID"] ? parseDt(P["RECURRENCE-ID"].value, P["RECURRENCE-ID"].params, calTz)?.ms : null;
    events.push({ uid: P.UID?.value ?? `${s.ms}-${P.SUMMARY?.value ?? ""}`, title: unesc(P.SUMMARY?.value ?? "(uten tittel)"), location: P.LOCATION ? unesc(P.LOCATION.value) : null,
      desc: P.DESCRIPTION ? unesc(P.DESCRIPTION.value).slice(0, 2000) : null, url: P.URL?.value ?? null, allDay: s.allDay, startMs: s.ms, endMs, rrule: P.RRULE?.value ?? null, exdates: e.exdates, recurrenceId: rec, tzid: P.DTSTART.params.TZID ?? calTz ?? TZ });
  }
  return { name, color, events };
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
/** Expand one parsed event into instances overlapping [from, to) (epoch ms). Supports FREQ/INTERVAL/COUNT/UNTIL/BYDAY/BYMONTHDAY/BYMONTH. */
export function expand(ev, from, to, max = 500) {
  const dur = ev.endMs - ev.startMs;
  if (!ev.rrule) return ev.endMs > from && ev.startMs < to || (dur === 0 && ev.startMs >= from && ev.startMs < to) ? [ev.startMs] : [];
  const r = Object.fromEntries(ev.rrule.split(";").map((kv) => kv.split("=")).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = r.FREQ; const interval = Math.max(1, +(r.INTERVAL ?? 1)); const count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseDt(r.UNTIL, {}, ev.tzid)?.ms ?? Infinity : Infinity;
  const tz = ev.allDay ? TZ : ev.tzid; const s = partsIn(tz, ev.startMs);
  const byday = r.BYDAY ? r.BYDAY.split(",").map((x) => { const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x); return m ? { n: m[1] ? +m[1] : 0, wd: DAYS.indexOf(m[2]) } : null; }).filter(Boolean) : null;
  const bymd = r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : null; const bym = r.BYMONTH ? r.BYMONTH.split(",").map(Number) : null;
  const at = (y, m, d) => wallToMs(y, m, d, s.h, s.mi, s.s, tz);
  const out = []; let n = 0; const ex = new Set(ev.exdates);
  const emit = (ms) => { if (ms < ev.startMs || ms > until || n >= count) return false; n++; if (!ex.has(ms) && ms + Math.max(dur, 1) > from && ms < to) out.push(ms); return true; };
  const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let i = 0, guard = 0; guard < 5000 && n < count && out.length < max; i += interval, guard++) {
    let cands = [];
    if (freq === "DAILY") { const d = new Date(Date.UTC(s.y, s.m - 1, s.d + i)); cands = [[d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]];
      if (byday) cands = cands.filter(([y, m, dd]) => byday.some((b) => b.wd === new Date(Date.UTC(y, m - 1, dd)).getUTCDay())); }
    else if (freq === "WEEKLY") { const base = new Date(Date.UTC(s.y, s.m - 1, s.d + i * 7)); const wd0 = (base.getUTCDay() + 6) % 7; // monday-based
      const wds = byday ? byday.map((b) => b.wd) : [base.getUTCDay()];
      cands = wds.map((wd) => { const off = ((wd + 6) % 7) - wd0; const d = new Date(base.getTime() + off * 864e5); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; }).sort((a, b) => a[2] - b[2] + (a[1] - b[1]) * 40 + (a[0] - b[0]) * 500); }
    else if (freq === "MONTHLY" || freq === "YEARLY") {
      const months = freq === "MONTHLY" ? (() => { const t = s.m - 1 + i; return [[s.y + Math.floor(t / 12), (t % 12) + 1]]; })() : (bym ?? [s.m]).map((m) => [s.y + i, m]);
      for (const [y, m] of months) {
        if (bym && freq === "MONTHLY" && !bym.includes(m)) continue;
        const last = dim(y, m);
        if (byday) for (const b of byday) { const all = []; for (let d = 1; d <= last; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === b.wd) all.push(d);
          const pick = b.n === 0 ? all : [b.n > 0 ? all[b.n - 1] : all[all.length + b.n]].filter(Boolean); for (const d of pick) cands.push([y, m, d]); }
        else if (bymd) for (const d of bymd) { const dd = d < 0 ? last + d + 1 : d; if (dd >= 1 && dd <= last) cands.push([y, m, dd]); }
        else if (s.d <= last) cands.push([y, m, s.d]);
      }
      cands.sort((a, b) => (a[0] - b[0]) * 500 + (a[1] - b[1]) * 40 + (a[2] - b[2]));
    } else return expand({ ...ev, rrule: null }, from, to);
    let stop = false;
    for (const [y, m, d] of cands) { const ms = at(y, m, d); if (ms > until || ms > to) { stop = true; break; } emit(ms); }
    if (stop) break;
  }
  return out;
}

/** Parse + expand a whole calendar into normalised instances. */
export function instances(text, from, to) {
  const { name, color, events } = parseIcs(text);
  const overrides = new Map(); for (const e of events) if (e.recurrenceId != null) overrides.set(`${e.uid}|${e.recurrenceId}`, e);
  const out = [];
  for (const e of events) {
    if (e.recurrenceId != null) { if (e.endMs > from && e.startMs < to) out.push(norm(e, e.startMs, e.recurrenceId)); continue; }
    for (const ms of expand(e, from, to)) { if (overrides.has(`${e.uid}|${ms}`)) continue; out.push(norm(e, ms, e.rrule ? ms : null)); }
  }
  return { name, color, events: out };
}
function norm(e, startMs, rid) {
  const endMs = startMs + (e.endMs - e.startMs);
  const loc = (ms) => msToLocal(ms);
  return { uid: e.uid, instance: rid, title: e.title, location: e.location, desc: e.desc, url: e.url, allDay: e.allDay, recurring: !!e.rrule || rid != null,
    start: e.allDay ? loc(startMs).slice(0, 10) : loc(startMs), end: e.allDay ? loc(endMs).slice(0, 10) : loc(endMs), startMs, endMs };
}

const esc = (t) => String(t ?? "").replace(/[\\;,]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n");
const utc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
function fold(line) { const out = []; let s = line; while (Buffer.byteLength(s) > 74) { let i = 74; while (Buffer.byteLength(s.slice(0, i)) > 74) i--; out.push(s.slice(0, i)); s = " " + s.slice(i); } out.push(s); return out.join("\r\n"); }
/** Build a single-VEVENT VCALENDAR for CalDAV PUT. start/end are Oslo wall time ("YYYY-MM-DD" for all-day, end exclusive). */
export function buildEvent({ uid, title, start, end, allDay, location, desc, rrule }) {
  const d8 = (s) => s.slice(0, 10).replace(/-/g, "");
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Home//Kalender//NO", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${utc(Date.now())}`, `SUMMARY:${esc(title)}`];
  if (allDay) { const e = end && end > start ? end : msToLocal(localToMs(start) + 864e5 + 3600e3).slice(0, 10); L.push(`DTSTART;VALUE=DATE:${d8(start)}`, `DTEND;VALUE=DATE:${d8(e)}`); }
  else { const s = localToMs(start); const e = end ? localToMs(end) : s + 3600e3; L.push(`DTSTART:${utc(s)}`, `DTEND:${utc(e)}`); }
  if (location) L.push(`LOCATION:${esc(location)}`); if (desc) L.push(`DESCRIPTION:${esc(desc)}`); if (rrule) L.push(`RRULE:${rrule.replace(/[^A-Z0-9=;,+-]/gi, "")}`);
  L.push("END:VEVENT", "END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}
