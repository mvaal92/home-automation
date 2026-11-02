// Fabel (fabel.no) – Norwegian audiobook service.
// Public catalog search goes through fabel.no's own search (Next.js server action, same as the website).
// Account features (bookshelf/progress) require login with phone + SMS code; Fabel has no web player
// and no public API, so listening happens in the Fabel app (deep link). We only use the public
// 5-minute samples (sr.bokbasen.io/audiosample/<isbn>.mp3) for in-app/Sonos preview. No DRM touched.
import { existsSync } from "node:fs";
import { SECRETS } from "./util.mjs";
const BASE = "https://fabel.no";
const UA = "Mozilla/5.0 (X11; Linux x86_64) HomeApp/1.0";
let actionId = "dc817e6cb2608fb5460e85fdcdecf1a2bc77f860";
const cache = new Map(); // isbn -> book

async function discoverAction() {
  const html = await (await fetch(`${BASE}/sok`, { headers: { "user-agent": UA } })).text();
  const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[^"\\]+\.js/g) ?? [])];
  for (const c of chunks) {
    const js = await (await fetch(BASE + c, { headers: { "user-agent": UA } })).text();
    const m = js.match(/cy:function\(\)\{return (\w)\}[\s\S]{0,800}?/);
    if (!m) continue;
    const re = new RegExp(`[,;\\s]${m[1]}=\\(0,\\w\\.\\$\\)\\("([a-f0-9]{30,})"\\)`);
    const h = js.slice(m.index, m.index + 1500).match(re);
    if (h) { actionId = h[1]; return true; }
  }
  return false;
}

async function action(query, opts, retry = true) {
  const r = await fetch(`${BASE}/sok?searchQuery=${encodeURIComponent(query)}`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "user-agent": UA, "next-action": actionId, accept: "text/x-component", "content-type": "text/plain;charset=UTF-8" },
    body: JSON.stringify([query, opts]),
  });
  const t = await r.text();
  const line = t.split("\n").find((l) => l.startsWith("1:{"));
  if (!r.ok || !line) { if (retry && await discoverAction().catch(() => false)) return action(query, opts, false); throw new Error("Fabel-søk utilgjengelig"); }
  return JSON.parse(line.slice(2));
}

const book = (h) => ({
  isbn: h.isbn ?? h.objectID, title: h.bookTitle ?? h.name, authors: h.authors ?? [], readers: h.readers ?? [],
  cover: h.imageUrl ?? null, coverSmall: h.imageUrlSmall ?? h.imageUrl ?? null, minutes: h.durationInMinutes ?? null,
  series: h.seriesTitle ?? null, seriesPart: h.seriesPart ?? null, category: h.categoryName ?? null, publisher: h.publisher ?? null,
  released: h.releaseDate ?? null, inSubscription: h.subscriptionStatus === "Aktiv" && !h.releaseDateSubscriptionInFuture,
  subscriptionFrom: h.releaseDateSubscriptionInFuture ? h.releaseDateSubscription : null, price: h.priceNok ?? null,
  themes: (h.themaCategories ?? []).map((t) => t.name), url: h.paths?.[0] ? BASE + h.paths[0] : `${BASE}/sok?searchQuery=${encodeURIComponent(h.bookTitle ?? "")}`,
  sample: `https://sr.bokbasen.io/audiosample/${h.isbn ?? h.objectID}.mp3`,
});

export async function search(q, n = 24) {
  const res = await action(String(q).slice(0, 100), { hitsPerPage: n });
  const books = (res.hits ?? []).filter((h) => h.shapeIdentifier === "bok" || h.isbn).map(book);
  for (const b of books) cache.set(b.isbn, b);
  return { total: res.numberOfhits ?? books.length, books };
}
export async function details(isbn) {
  if (cache.has(isbn)) return cache.get(isbn);
  const { books } = await search(isbn, 5);
  const b = books.find((x) => x.isbn === isbn); if (!b) throw Object.assign(new Error("Fant ikke boka"), { status: 404 });
  return b;
}
export const status = () => ({ catalog: true, account: existsSync(`${SECRETS}/fabel_session.json`), accountNote: "Fabel-innlogging krever mobilnummer + SMS-kode. Lytting skjer i Fabel-appen." });

// --- Kids catalogue (public search only): popular Norwegian children's series grouped + in order, plus single titles.
const KID_SERIES = ["Kaptein Sabeltann", "LasseMajas detektivbyrå", "Albert Åberg", "Pippi Langstrømpe", "Emil fra Lønneberget", "Mummitrollet", "Doktor Proktor", "Dagbok for Lurvehoder", "Detektivbyrå nr. 2", "Skrekkelig jul", "Harry Potter", "Karsten og Petra", "Bobla", "Rasmus Klump", "Gruffalo", "Peppa Gris", "Brødrene Dal", "Agent Johnny", "Dino-detektivene", "Ninjago", "Pokémon", "Teodor", "Elefantbrødrene", "Ronja Røverdatter", "Fantorangen", "Thorbjørn Egner", "Pelle og Proffen"];
const KID_SINGLES = ["Astrid Lindgren", "Maria Parr", "Roald Dahl", "eventyr", "bildebok", "Erlend Loe barn", "Jo Nesbø barn", "Arne Svingen", "Tor Åge Bringsværd", "dyr barn"];
const OLDER = /Harry Potter|pingles dagbok|Pelle og Proffen|Doktor Proktor|Lurvehoder|Ronja|Brødrene/i;
const isKid = (b) => /^(Barn|Ungdom)$/i.test(b.category ?? "");
let kidsCache = null;
export async function kids() {
  if (kidsCache && Date.now() - kidsCache.at < 6 * 3600e3) return kidsCache.data;
  const series = new Map(); const singles = new Map();
  const res = await Promise.allSettled([...KID_SERIES, ...KID_SINGLES].map((q) => search(q, 48).then((r) => [q, r.books])));
  for (const r of res) { if (r.status !== "fulfilled") continue; const [q, books] = r.value;
    for (const b of books.filter(isKid)) {
      if (b.series) { const k = KID_SERIES.find((x) => b.series.toLowerCase().includes(x.toLowerCase())) ?? b.series.split(",")[0].replace(/-univers(e|et)$/i, "").trim();
        const g = series.get(k) ?? { title: k, age: OLDER.test(k) || b.category === "Ungdom" ? "9+" : "3–9", books: new Map(), titles: new Set() };
        const tk = b.title.toLowerCase(); if (!g.titles.has(tk)) { g.titles.add(tk); g.books.set(b.isbn, b); } series.set(k, g); }
      else if (b.category === "Barn") singles.set(b.isbn, b); } }
  const order = (a, b) => (a.seriesPart ?? 999) - (b.seriesPart ?? 999) || String(a.released ?? "").localeCompare(String(b.released ?? ""));
  const rank = (t) => { const i = KID_SERIES.findIndex((s) => t.toLowerCase().includes(s.toLowerCase())); return i < 0 ? 99 : i; };
  const grouped = [...series.values()].map((g) => ({ title: g.title, age: g.age, books: [...g.books.values()].sort(order) }))
    .filter((g) => g.books.length >= 2).sort((a, b) => rank(a.title) - rank(b.title) || b.books.length - a.books.length).slice(0, 30);
  const data = { series: grouped, popular: (() => { const per = new Map(); return [...singles.values()].filter((b) => b.cover && !series.has(b.title)).filter((b) => { const a = b.authors[0] ?? ""; per.set(a, (per.get(a) ?? 0) + 1); return per.get(a) <= 3; }).slice(0, 36); })(), at: Date.now() };
  kidsCache = { at: Date.now(), data }; return data;
}
/** «Sist lyttet» needs the personal Fabel library (SMS login). Until a session exists we return loggedIn:false. */
export function recent() { return { loggedIn: status().account, items: [] }; }
