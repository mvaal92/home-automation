// Skole (Visma Flyt Foresattportal, Kommunen) – READ-ONLY school source (child configured in data/family.json).
// Transport: the logged-in foresatt.visma.no tab in the owner's Brave (CDP 127.0.0.1:9222). We run GET fetches
// inside that page against an allow-list of read endpoints. No cookies/tokens are extracted. Nothing is sent,
// signed, answered, registered or marked as read (all POST endpoints are blocked by the allow-list + GET-only).
// Personal ID numbers (nin / guardianIdentityNumber) are stripped before anything is stored.
import { mkdirSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { expand } from "./util.mjs";
import { SCHOOL } from "./family.mjs";
const API = "https://api.foresatt.visma.no/";
const CDP = process.env.HOME_CDP ?? "http://127.0.0.1:9222";
export const DIR = expand(process.env.HOME_SKOLE_DIR ?? "~/home-automation/data/skole");
mkdirSync(DIR, { recursive: true, mode: 0o700 }); chmodSync(DIR, 0o700);
const STATE = join(DIR, "state.json");
export const CHILD = { id: SCHOOL.id, name: SCHOOL.name };
const P = String.raw`vfs\/v1\/pupils\/\d+`;
const READ_ONLY = new RegExp(String.raw`^(v1\/session|v2\/children|${P}\/(portal-areas|pupil-info|timetable|absences\/years|absences\/[0-9a-f-]+(\/summary)?|digital-forms|consents|notifications\/\d+|messages\/direct|messages\/group)|vfs\/v2\/pupils\/\d+\/messages\/direct\/\d+|${P}\/messages\/group\/[0-9a-f-]+|vfs\/v[12]\/pupils\/\d+\/messages\/(direct|group)\/[0-9a-f-]+\/attachment\/[0-9a-zA-Z-]+|${P}\/notifications\/attachment\/[0-9a-zA-Z-]+)$`);

async function cdpEval(expr) {
  const tabs = await (await fetch(`${CDP}/json`, { signal: AbortSignal.timeout(3000) })).json();
  const tab = tabs.find((t) => t.type === "page" && /^https:\/\/foresatt\.visma\.no\/(?!kommunen\/?$)/.test(t.url) && !/login|error/.test(t.url));
  if (!tab) throw Object.assign(new Error("Skoleportalen er ikke innlogget i Brave (logg inn med BankID)"), { status: 409, loginRequired: true });
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(tab.webSocketDebuggerUrl); const to = setTimeout(() => { ws.terminate(); reject(new Error("Skole timeout")); }, 30000);
    ws.on("open", () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } })));
    ws.on("message", (m) => { const r = JSON.parse(m); if (r.id !== 1) return; clearTimeout(to); ws.close();
      if (r.result?.exceptionDetails) reject(new Error("Skole: " + (r.result.exceptionDetails.exception?.description ?? "feil").slice(0, 120))); else resolve(r.result?.result?.value); });
    ws.on("error", (e) => { clearTimeout(to); reject(e); });
  });
}
async function get(path, query = null) {
  if (!READ_ONLY.test(path)) throw new Error("blocked non-read endpoint " + path);
  const url = API + path + (query ? "?" + new URLSearchParams(query) : "");
  const v = await cdpEval(`fetch(${JSON.stringify(url)},{method:"GET",credentials:"include"}).then(async r=>({s:r.status,t:await r.text()}))`);
  if (v.s === 401) throw Object.assign(new Error("Skole-økten er utløpt – logg inn på nytt med BankID"), { status: 409, loginRequired: true });
  if (v.s !== 200) throw new Error(`Skole ${v.s} ${path}`);
  return JSON.parse(v.t || "null");
}
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (/^(nin|guardianIdentityNumber|ssn)$/i.test(k) ? undefined : v)));
const d10 = (s) => (s ? String(s).slice(0, 10) : null);
const iso = (d) => d.toLocaleDateString("sv-SE");
export function load() { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return null; } }
function save(s) { writeFileSync(STATE, JSON.stringify(s), { mode: 0o600 }); }

let syncing = null;
export function sync() {
  syncing ??= (async () => {
    const session = strip(await get("v1/session"));
    const kid = (await get("v2/children")).children.find((c) => c.school) ?? null;
    if (!kid) throw new Error("Fant ikke elev i skoleportalen");
    const id = kid.school.pupilId; const base = `vfs/v1/pupils/${id}`;
    const info = strip(await get(`${base}/pupil-info`));
    // Timetable: this week + next (school may not publish one; then empty)
    const timetable = []; const mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    for (const w of [0, 7]) { const d = new Date(mon); d.setDate(d.getDate() + w);
      try { for (const l of await get(`${base}/timetable`, { selectedDate: iso(d) })) timetable.push(l); } catch { /* */ } }
    // Direct messages: summary per teacher, then full threads (GET only; never mark-as-read)
    const summaries = await get(`${base}/messages/direct`);
    const messages = [];
    for (const s of summaries) {
      let thread = []; try { thread = (await get(`vfs/v2/pupils/${id}/messages/direct/${s.employeeId}`)).messages ?? []; } catch { /* */ }
      for (const m of thread) messages.push({ id: m.idMessage, from: m.participantType === 1 ? s.sender : "Deg", teacher: s.sender, title: m.title, text: m.messageText, sent: m.sentDate, unread: !m.readDate && m.participantType === 1,
        employeeId: s.employeeId, attachments: (m.attachments ?? []).map((a) => ({ name: a.fileName, size: a.contentLength, ref: String(a.id ?? a.idAttachment ?? a.attachmentId ?? a.fileId ?? a.blobId ?? "") || null })) });
    }
    messages.sort((a, b) => b.sent.localeCompare(a.sent));
    let groups = []; try { groups = await get(`${base}/messages/group`); } catch { /* */ }
    const notices = [];
    for (const t of [0, 1]) { try { for (const n of await get(`${base}/notifications/${t}`)) notices.push({ id: n.idMessage, title: n.title.trim(), from: n.sender, text: n.messageText.replace(/\r/g, "").replace(/https?:\/\/\S*token=\S*/g, "[lenke i Foresattportalen]").trim(), sent: n.sentDate, unread: n.isUnread, type: t }); } catch { /* */ } }
    notices.sort((a, b) => b.sent.localeCompare(a.sent));
    // Homework: from messages that mention lekser/ukeplan (plans are PDF attachments – open in portal)
    const homework = messages.filter((m) => /lekse|ukeplan/i.test(`${m.title} ${m.text}`)).slice(0, 12)
      .map((m) => ({ id: m.id, title: m.title, text: m.text, sent: m.sent, teacher: m.teacher, plan: m.attachments.find((a) => /ukeplan|plan/i.test(a.name))?.name ?? null }));
    // Absence (current school year, both terms)
    const years = await get(`${base}/absences/years`); const cur = years.find((y) => y.isCurrent);
    const absence = { year: cur ? `${cur.fromYear}/${cur.toYear}` : null, terms: [], items: [] };
    if (cur) for (const term of [1, 2]) { try { absence.terms.push({ term, ...(await get(`${base}/absences/${cur.municipalityYearId}/summary`, { term })) });
      for (const a of await get(`${base}/absences/${cur.municipalityYearId}`, { term })) absence.items.push(a); } catch { /* */ } }
    const forms = (await get(`${base}/digital-forms`)).map((f) => ({ id: f.id, title: f.title, deadline: d10(f.deadline), published: d10(f.publishedOn), answered: f.isAnswered, closed: f.isDeadlinePassed, by: f.lastModifiedBy }))
      .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
    let consents = []; try { consents = (await get(`${base}/consents`)).consents.map((c) => ({ id: c.id, title: c.title, status: c.status, modified: d10(c.modifiedOn), by: c.modifiedBy })); } catch { /* */ }
    // Events: form deadlines + "Svarfrist dd.mm.yyyy" in notices
    const events = [];
    for (const f of forms) if (f.deadline) events.push({ id: `form_${f.id}`, title: `Frist: ${f.title}`, start: f.deadline, allDay: true, desc: f.answered ? "Besvart" : "Ikke besvart – svar i Foresattportalen" });
    for (const n of notices) { const m = /Svarfrist:\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(n.text); if (m) events.push({ id: `n_${n.id}`, title: `Svarfrist: ${n.title.replace(/,.*$/, "")}`, start: `${m[3]}-${m[2]}-${m[1]}`, allDay: true, desc: null }); }
    for (const l of timetable) if (l.day) events.push({ id: `tt_${l.day}_${l.startTime ?? ""}_${l.subject ?? ""}`, title: l.subject ?? l.name ?? "Time", start: `${d10(l.day)}${l.startTime ? " " + l.startTime : ""}`, allDay: !l.startTime, desc: l.room ?? null });
    const uniq = [...new Map(events.map((e) => [e.title + e.start, e])).values()];
    const state = { source: "skole", syncedAt: Date.now(), transport: "brave",
      portal: "Visma Flyt Foresattportal", municipality: session.municipality?.name ?? null,
      child: { ...CHILD, fullName: `${kid.firstName} ${kid.lastName}`, school: kid.school.organizationName, level: kid.school.level, pupilId: id, contactTeacher: info.contactTeacher ?? null, sfo: info.sfoStay ?? null },
      timetable, messages, groups, notices, homework, absence, forms, consents, events: uniq };
    save(state); return state;
  })().finally(() => { syncing = null; });
  return syncing;
}

/** Keep-alive: one allow-listed read (GET v1/session) inside the logged-in tab. Throws loginRequired when expired. */
export async function ping() { await get("v1/session"); return true; }

/** Read-only attachment proxy: GET an allow-listed attachment path inside the logged-in tab, cache it (0600). */
const ATT = join(DIR, "att"); mkdirSync(ATT, { recursive: true, mode: 0o700 });
export async function attachment(msgId, idx) {
  const st = load(); const m = st?.messages.find((x) => x.id === msgId); const a = m?.attachments[Number(idx)];
  if (!a) throw Object.assign(new Error("Fant ikke vedlegget"), { status: 404 });
  const safe = `${String(msgId).replace(/[^0-9a-f-]/gi, "")}_${Number(idx)}`; const f = join(ATT, safe);
  const ct = /\.pdf$/i.test(a.name) ? "application/pdf" : /\.png$/i.test(a.name) ? "image/png" : /\.jpe?g$/i.test(a.name) ? "image/jpeg" : "application/octet-stream";
  try { return { name: a.name, ct, buf: readFileSync(f) }; } catch { /* not cached */ }
  if (!a.ref) throw Object.assign(new Error("Vedlegget er ikke hentet ennå – logg inn i Foresattportalen og oppdater Skole"), { status: 409, loginRequired: true });
  const pid = st.child.pupilId; const cands = [`vfs/v2/pupils/${pid}/messages/direct/${m.employeeId}/attachment/${a.ref}`, `vfs/v1/pupils/${pid}/messages/direct/${m.employeeId}/attachment/${a.ref}`, `vfs/v1/pupils/${pid}/messages/direct/${msgId}/attachment/${a.ref}`];
  for (const path of cands) { if (!READ_ONLY.test(path)) continue;
    const v = await cdpEval(`fetch(${JSON.stringify(API + path)},{method:"GET",credentials:"include"}).then(async r=>{const u=new Uint8Array(await r.arrayBuffer());let s="";for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return {s:r.status,ct:r.headers.get("content-type"),b:btoa(s)}})`);
    if (v.s === 401) throw Object.assign(new Error("Skole-økten er utløpt – logg inn på nytt med BankID"), { status: 409, loginRequired: true });
    if (v.s === 200) { const buf = Buffer.from(v.b, "base64"); writeFileSync(f, buf, { mode: 0o600 }); return { name: a.name, ct: v.ct || ct, buf }; } }
  throw Object.assign(new Error("Klarte ikke å hente vedlegget fra Foresattportalen"), { status: 502 });
}
