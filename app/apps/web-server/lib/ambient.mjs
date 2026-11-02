// Hvileskjerm (resting/ambient screen): curated public-domain art, cached locally under DATA_DIR/art so the
// screen works offline. Sources: Wikimedia Commons file search (mostly Nasjonalmuseet / Google Art Project scans).
// Settings + remote trigger live in the prefs row "hvile" (home.db), so all devices pick changes up via the
// prefs SSE. Never touches devices. Routes (Tailscale only): GET /api/ambient/art, GET /api/ambient/img/<file>,
// GET|PUT /api/ambient/settings, POST /api/ambient/start {device?, mode?}, POST /api/ambient/stop, POST /api/ambient/refresh
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync, renameSync } from "node:fs";
import { join, basename } from "node:path";
import { sendJson, readBody, SECURITY } from "./util.mjs";

const UA = "HomeApp-Hvileskjerm/1.0 (private family dashboard; owner@example.com)";
// title (Norwegian), artist, year, collection, Commons search query, group
export const CURATED = [
  ["Vinternatt i Rondane", "Harald Sohlberg", "1914", "Nasjonalmuseet", "Harald Sohlberg Winter Night in the Mountains", "nordisk"],
  ["Sommernatt", "Harald Sohlberg", "1899", "Nasjonalmuseet", "Harald Sohlberg Summer Night 1899", "nordisk"],
  ["Fiskerhytte", "Harald Sohlberg", "1906", "Nasjonalmuseet", "Harald Sohlberg Fisherman's Cottage", "nordisk"],
  ["Fra Stalheim", "J.C. Dahl", "1842", "Nasjonalmuseet", "Johan Christian Dahl View from Stalheim", "nordisk"],
  ["Bjørk i storm", "J.C. Dahl", "1849", "KODE Bergen", "Johan Christian Dahl Birch Tree in a Storm", "nordisk"],
  ["Vinter ved Sognefjorden", "J.C. Dahl", "1827", "Nasjonalmuseet", "Johan Christian Dahl Winter at the Sognefjord", "nordisk"],
  ["Stjernenatt", "Edvard Munch", "1893", "J. Paul Getty Museum", "Edvard Munch Starry Night Google Art Project", "munch"],
  ["Månelys", "Edvard Munch", "1895", "Nasjonalmuseet", "Edvard Munch Moonlight 1895 Nasjonalmuseet", "munch"],
  ["Sommernatt. Inger på stranden", "Edvard Munch", "1889", "KODE Bergen", "Edvard Munch Summer night Inger on the beach", "munch"],
  ["Soria Moria", "Theodor Kittelsen", "1900", "Nasjonalmuseet", "Theodor Kittelsen Soria Moria", "nordisk"],
  ["Nordkapp", "Peder Balke", "1845", "Nasjonalmuseet", "Peder Balke North Cape", "nordisk"],
  ["Labrofossen ved Kongsberg", "Thomas Fearnley", "1837", "Nasjonalmuseet", "Thomas Fearnley Labro Falls at Kongsberg", "nordisk"],
  ["Brudeferden i Hardanger", "Adolph Tidemand og Hans Gude", "1848", "Nasjonalmuseet", "Tidemand Gude Bridal Procession on the Hardangerfjord Google Art Project", "nordisk"],
  ["Sommernatt", "Kitty Kielland", "1886", "Nasjonalmuseet", "Kitty Kielland Summer Night 1886", "nordisk"],
  ["Sommernatt", "Eilif Peterssen", "1886", "Nasjonalmuseet", "Eilif Peterssen Summer Night 1886", "nordisk"],
  ["Torvmyr på Jæren", "Kitty Kielland", "1880", "Stavanger kunstmuseum", "Kitty Kielland Peat Bog Jæren", "nordisk"],
  ["Revebjeller", "Nikolai Astrup", "1927", "Privat", "Nikolai Astrup Foxgloves", "nordisk"],
  ["Keitele-sjøen", "Akseli Gallen-Kallela", "1905", "National Gallery, London", "Akseli Gallen-Kallela Lake Keitele", "nordisk"],
  ["Skyen", "Prins Eugen", "1895", "Göteborgs konstmuseum", "Prins Eugen The Cloud Molnet", "nordisk"],
  ["Solskinn i stuen", "Vilhelm Hammershøi", "1901", "Nationalmuseum, Stockholm", "Hammershoi Sunshine in the Drawing Room 1910", "rolig"],
  ["Vinter i Vestre Aker", "Frits Thaulow", "1883", "Nasjonalmuseet", "Frits Thaulow Winter in Vestre Aker", "nordisk"],
  ["Morgen i Riesengebirge", "Caspar David Friedrich", "1810–11", "Alte Nationalgalerie", "Caspar David Friedrich Morning in the Riesengebirge", "rolig"],
  ["Skjæra", "Claude Monet", "1868–69", "Musée d'Orsay", "Claude Monet The Magpie Orsay", "rolig"],
  ["Vannliljer", "Claude Monet", "1906", "Art Institute of Chicago", "Claude Monet Water Lilies 1906 Art Institute of Chicago", "rolig"],
].map(([title, artist, year, collection, q, group], i) => ({ id: `a${String(i).padStart(2, "0")}`, title, artist, year, collection, q, group }));

export function initAmbient(dataDir, { getPref, putPref }) {
  const DIR = join(dataDir, "art"); mkdirSync(DIR, { recursive: true });
  const MAN = join(DIR, "manifest.json");
  const load = () => { try { return JSON.parse(readFileSync(MAN, "utf8")); } catch { return { items: [], refreshedAt: 0 }; } };
  let busy = null;

  const norm = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ø/g, "o").replace(/æ/g, "ae").toLowerCase();
  async function findOne(c) {
    const u = new URL("https://commons.wikimedia.org/w/api.php");
    Object.entries({ action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrlimit: "6", gsrsearch: c.q, prop: "imageinfo", iiprop: "url|size|mime", iiurlwidth: "2400" }).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) }); const j = await r.json();
    const pages = Object.values(j.query?.pages ?? {}).sort((a, b) => a.index - b.index);
    return pages.map((p) => ({ p, ii: p.imageinfo?.[0] })).find(({ p, ii }) => ii && /jpe?g|png/.test(ii.mime) && ii.width >= 1500 && !/detail|frame|sketch|study|reverse|verso/i.test(p.title) && norm(p.title).includes(norm(c.artist.split(" ").pop()))) ?? null;
  }
  async function refresh({ force = false } = {}) {
    if (busy) return busy;
    busy = (async () => {
      const man = load(); const have = new Map(man.items.map((x) => [x.id, x])); const out = []; const errors = [];
      for (const c of CURATED) {
        const prev = have.get(c.id);
        if (prev && !force && existsSync(join(DIR, prev.file))) { out.push({ ...prev, title: c.title, artist: c.artist, year: c.year, collection: c.collection, group: c.group }); continue; }
        try {
          const hit = await findOne(c); if (!hit) { errors.push(`${c.id}: ingen treff`); continue; }
          const src = hit.ii.thumburl ?? hit.ii.url; const ext = /\.png/i.test(src) ? "png" : "jpg"; const file = `${c.id}.${ext}`;
          const r = await fetch(src, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60000) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const buf = Buffer.from(await r.arrayBuffer()); writeFileSync(join(DIR, file + ".tmp"), buf); renameSync(join(DIR, file + ".tmp"), join(DIR, file));
          const w = hit.ii.thumbwidth ?? hit.ii.width, h = hit.ii.thumbheight ?? hit.ii.height;
          out.push({ id: c.id, file, title: c.title, artist: c.artist, year: c.year, collection: c.collection, group: c.group, w, h, source: hit.ii.descriptionurl, license: "Public domain" });
          await new Promise((res) => setTimeout(res, 400));
        } catch (e) { errors.push(`${c.id}: ${e.message}`); if (prev && existsSync(join(DIR, prev.file))) out.push(prev); }
      }
      const blocked = new Set(load().blocked ?? []);
      const next = { items: out.filter((x) => !blocked.has(x.id)), blocked: [...blocked], refreshedAt: Date.now(), errors };
      writeFileSync(MAN, JSON.stringify(next, null, 1)); return next;
    })().finally(() => { busy = null; });
    return busy;
  }
  // first run fills the cache in the background; afterwards only missing files are fetched (weekly)
  setTimeout(() => refresh().catch(() => {}), 20_000).unref?.();
  setInterval(() => refresh().catch(() => {}), 7 * 864e5).unref?.();

  const readHvile = () => { const r = getPref.get("hvile"); return r ? JSON.parse(r.value) : {}; };
  const writeHvile = (v) => { putPref.run("hvile", JSON.stringify({ ...v, updatedAt: Date.now() }), Date.now()); return readHvile(); };
  const MODES = ["art", "gradient", "photos"];

  async function routes(req, res, sub, trusted) {
    if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
    const m = req.method;
    try {
      if (m === "GET" && sub === "art") { const man = load(); return sendJson(res, 200, { items: man.items.map(({ source, ...x }) => ({ ...x, source, url: `/api/ambient/img/${x.file}` })), refreshedAt: man.refreshedAt, refreshing: !!busy }); }
      if ((m === "GET" || m === "HEAD") && sub.startsWith("img/")) {
        const f = basename(sub.slice(4)); const p = join(DIR, f);
        if (!/^[a-z0-9]+\.(jpg|png)$/.test(f) || !existsSync(p)) return sendJson(res, 404, { error: "not cached" });
        res.writeHead(200, { ...SECURITY, "content-type": f.endsWith(".png") ? "image/png" : "image/jpeg", "content-length": statSync(p).size, "cache-control": "public, max-age=604800" });
        return res.end(m === "HEAD" ? undefined : readFileSync(p));
      }
      if (m === "POST" && sub === "refresh") { const b = await readBody(req, 1024).catch(() => ({})); refresh({ force: !!b.force }).catch(() => {}); return sendJson(res, 202, { ok: true, refreshing: true }); }
      if (m === "GET" && sub === "settings") return sendJson(res, 200, readHvile());
      if (m === "PUT" && sub === "settings") {
        const b = await readBody(req, 16384); const cur = readHvile(); const next = { ...cur };
        for (const k of ["timeoutMin", "mode", "collections", "nightDim", "phone", "nightFrom", "nightTo", "intervalMin"]) if (k in b) next[k] = b[k];
        if (b.devices && typeof b.devices === "object") next.devices = { ...(cur.devices ?? {}), ...b.devices };
        if (next.mode && !MODES.includes(next.mode)) return sendJson(res, 400, { error: `mode: ${MODES.join("|")}` });
        if (next.timeoutMin != null && !(Number(next.timeoutMin) >= 0 && Number(next.timeoutMin) <= 240)) return sendJson(res, 400, { error: "timeoutMin 0–240 (0 = av)" });
        return sendJson(res, 200, writeHvile(next));
      }
      if (m === "POST" && (sub === "start" || sub === "stop")) {
        const b = await readBody(req, 2048).catch(() => ({}));
        const trig = { action: sub, at: Date.now(), device: typeof b.device === "string" ? b.device : "all", mode: MODES.includes(b.mode) ? b.mode : undefined };
        return sendJson(res, 200, { ok: true, trigger: writeHvile({ ...readHvile(), trigger: trig }).trigger });
      }
      return sendJson(res, 404, { error: "unknown" });
    } catch (e) { return sendJson(res, 500, { error: String(e.message).slice(0, 160) }); }
  }
  return { routes, refresh, load, readHvile };
}
