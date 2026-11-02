// Tiny CalDAV client (iCloud: https://caldav.icloud.com, Basic auth with Apple ID + app-specific password).
// Credentials come from the auth vault and never leave the server. No XML dependency: tolerant regex parsing of multistatus.
const ROOT = process.env.HOME_CALDAV_ROOT ?? "https://caldav.icloud.com/";
const UA = "Home-Kalender/1.0";
export class CalDavError extends Error { constructor(msg, status) { super(msg); this.status = status; this.authFailed = status === 401 || status === 403; } }
function hdr(cred, extra = {}) { return { authorization: "Basic " + Buffer.from(`${cred.username}:${cred.password}`).toString("base64"), "user-agent": UA, ...extra }; }
async function dav(cred, url, method, body, headers = {}) {
  const r = await fetch(url, { method, headers: hdr(cred, { ...(body ? { "content-type": headers["content-type"] ?? "application/xml; charset=utf-8" } : {}), ...headers }), body, redirect: "follow", signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  if (r.status === 401 || r.status === 403) throw new CalDavError("Apple ID eller app-spesifikt passord ble avvist", r.status);
  if (!r.ok && r.status !== 207) throw new CalDavError(`CalDAV ${method} ${r.status}`, r.status);
  return { status: r.status, text, etag: r.headers.get("etag"), url: r.url };
}
const unx = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml, name) => { const m = new RegExp(`<(?:[A-Za-z0-9]+:)?${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${name}>)`, "i").exec(xml); return m ? (m[1] ?? "") : null; };
const responses = (xml) => [...xml.matchAll(/<(?:[A-Za-z0-9]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?response>/gi)].map((m) => m[1]);
const href = (x) => { const h = tag(x, "href"); return h ? unx(h.trim()) : null; };
const abs = (base, h) => new URL(h, base).toString();

export async function discover(cred) {
  const p1 = await dav(cred, ROOT, "PROPFIND", `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`, { depth: "0" });
  const ph = href(tag(p1.text, "current-user-principal") ?? ""); if (!ph) throw new CalDavError("Fant ikke iCloud-konto (principal)", 500);
  const principal = abs(p1.url, ph);
  const p2 = await dav(cred, principal, "PROPFIND", `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`, { depth: "0" });
  const hh = href(tag(p2.text, "calendar-home-set") ?? ""); if (!hh) throw new CalDavError("Fant ikke kalender-hjem", 500);
  return { principal, home: abs(p2.url, hh) };
}
export async function listCalendars(cred, home) {
  const r = await dav(cred, home, "PROPFIND", `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:displayname/><d:resourcetype/><cs:getctag/><a:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>`, { depth: "1" });
  const out = [];
  for (const x of responses(r.text)) {
    const rt = tag(x, "resourcetype") ?? ""; if (!/calendar/i.test(rt)) continue;
    const comps = tag(x, "supported-calendar-component-set") ?? ""; if (comps && !/VEVENT/.test(comps)) continue;
    const privs = tag(x, "current-user-privilege-set") ?? "";
    out.push({ url: abs(r.url, href(x)), name: unx(tag(x, "displayname") ?? "").trim() || "Kalender", color: (unx(tag(x, "calendar-color") ?? "").trim().slice(0, 7) || null), ctag: unx(tag(x, "getctag") ?? "").trim() || null,
      writable: !privs || /<(?:[A-Za-z0-9]+:)?(write|all)\b/i.test(privs) });
  }
  return out;
}
const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
/** calendar-query REPORT for VEVENTs in a time range; returns [{ href, etag, ics }]. */
export async function fetchEvents(cred, calUrl, fromMs, toMs) {
  const r = await dav(cred, calUrl, "REPORT", `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${z(fromMs)}" end="${z(toMs)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`, { depth: "1" });
  return responses(r.text).map((x) => ({ href: abs(r.url, href(x)), etag: unx(tag(x, "getetag") ?? "").trim(), ics: unx(tag(x, "calendar-data") ?? "") })).filter((e) => e.ics.includes("VEVENT"));
}
export async function putEvent(cred, calUrl, uid, ics, { href: existing, etag } = {}) {
  const url = existing ?? abs(calUrl.endsWith("/") ? calUrl : calUrl + "/", `${encodeURIComponent(uid)}.ics`);
  const r = await dav(cred, url, "PUT", ics, { "content-type": "text/calendar; charset=utf-8", ...(existing ? (etag ? { "if-match": etag } : {}) : { "if-none-match": "*" }) });
  return { href: url, etag: r.etag };
}
export async function deleteEvent(cred, href, etag) { await dav(cred, href, "DELETE", undefined, etag ? { "if-match": etag } : {}); return { ok: true }; }
/** Raw GET of one resource (used before update to get the current etag/ics). */
export async function getEvent(cred, href) { const r = await dav(cred, href, "GET"); return { ics: r.text, etag: r.etag }; }
