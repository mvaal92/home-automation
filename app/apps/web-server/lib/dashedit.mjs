// Assistant-driven dashboard edits: validated ops on prefs["dashboard"] (+ notes), applied instantly,
// with an undo history in home.db (prefs_history). Exposed as /api/dashedit/* (Tailscale-only) and used
// by the home MCP tools dashboard_get / dashboard_apply / dashboard_undo.
import { readBody, sendJson } from "./util.mjs";

export const HOME_CARDS = ["pinned", "barnluft", "notes", "maintenance", "mode", "health", "scenes", "widgets", "cameras", "rooms", "active", "automation", "kids", "air", "robots", "music", "hvile"];
export const OPTIONAL_CARDS = ["kids", "air", "robots", "music", "hvile"]; // shown only when added (addedCards)
export const TABS = ["barn", "luft", "energy", "chat", "notater", "robots", "vedlikehold", "sonos", "spotify", "lydboker", "oda"];
const ENTITY = /^(light|script|scene)\.[a-z0-9_]{1,80}$/;
const uniq = (a) => [...new Set(a)];

// In-view edit mode ("Rediger"): whole layout fields, per-device (phone) overrides and named layouts.
export const LAYOUT_KEYS = ["homeOrder", "hiddenCards", "addedCards", "cardSize", "titles", "tabOrder", "hiddenTabs", "pages"];
const SIZES = ["s", "m", "l", "full"];
const KEY = /^[a-z0-9_.:-]{1,80}$/i;
const strList = (v, k) => { if (!Array.isArray(v) || v.length > 80 || !v.every((x) => typeof x === "string" && KEY.test(x))) throw new Error(`${k}: liste med nøkler`); return uniq(v); };
const sizeMap = (v, k) => { if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${k}: objekt`); const o = {}; for (const [a, b] of Object.entries(v).slice(0, 120)) { if (!KEY.test(a) || !SIZES.includes(b)) throw new Error(`${k}: ugyldig størrelse ${a}`); o[a] = b; } return o; };
function cleanField(k, v) {
  if (v === null) return null;
  switch (k) {
    case "cardSize": return sizeMap(v, k);
    case "titles": { if (typeof v !== "object" || Array.isArray(v)) throw new Error("titles: objekt"); const o = {}; for (const [a, b] of Object.entries(v).slice(0, 120)) { if (!KEY.test(a) || typeof b !== "string") throw new Error("titles: ugyldig"); const t = b.trim().slice(0, 40); if (t) o[a] = t; } return o; }
    case "pages": { if (typeof v !== "object" || Array.isArray(v)) throw new Error("pages: objekt"); const o = {}; for (const [tab, pg] of Object.entries(v).slice(0, 20)) { if (!KEY.test(tab) || typeof pg !== "object" || !pg) throw new Error("pages: ugyldig"); o[tab] = {}; if (pg.order) o[tab].order = strList(pg.order, "order"); if (pg.hidden) o[tab].hidden = strList(pg.hidden, "hidden"); if (pg.size) o[tab].size = sizeMap(pg.size, "size"); if (typeof pg.start === "string" && KEY.test(pg.start)) o[tab].start = pg.start; } return o; }
    default: return strList(v, k);
  }
}
function setFields(target, fields) {
  if (typeof fields !== "object" || !fields) throw new Error("fields: objekt");
  const keys = Object.keys(fields); if (!keys.length) throw new Error("fields: tomt");
  for (const k of keys) { if (!LAYOUT_KEYS.includes(k)) throw new Error(`ukjent layoutfelt ${k}`); const v = cleanField(k, fields[k]); if (v === null) delete target[k]; else target[k] = v; }
  return keys;
}
const pickLayout = (p) => Object.fromEntries(LAYOUT_KEYS.filter((k) => p?.[k] !== undefined).map((k) => [k, structuredClone(p[k])]));
const NAME = /^[\p{L}\p{N} _-]{1,24}$/u;

export function initDashEdit(db, notes) {
  db.exec(`CREATE TABLE IF NOT EXISTS prefs_history (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, before TEXT, after TEXT NOT NULL,
    source TEXT, summary TEXT, undone INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
  const q = {
    get: db.prepare("SELECT value FROM prefs WHERE key = 'dashboard'"),
    put: db.prepare("INSERT INTO prefs (key, value, rev, updated_at) VALUES ('dashboard', ?, 1, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, rev = prefs.rev + 1, updated_at = excluded.updated_at"),
    hist: db.prepare("INSERT INTO prefs_history (key, before, after, source, summary, created_at) VALUES ('dashboard', ?, ?, ?, ?, ?)"),
    list: db.prepare("SELECT id, source, summary, undone, created_at FROM prefs_history ORDER BY id DESC LIMIT ?"),
    last: db.prepare("SELECT * FROM prefs_history WHERE undone = 0 ORDER BY id DESC LIMIT 1"),
    markUndone: db.prepare("UPDATE prefs_history SET undone = 1 WHERE id = ?"),
  };
  const read = () => { try { return JSON.parse(q.get.get()?.value ?? "{}"); } catch { return {}; } };

  function applyOp(p, op, notesDone) {
    const t = op?.op;
    const ent = () => { const id = String(op.entity_id ?? ""); if (!ENTITY.test(id)) throw new Error(`ugyldig entity_id ${id} (light./script./scene.)`); return id; };
    const listKey = (id) => (id.startsWith("light.") ? "pinnedLights" : "pinnedRoutines");
    switch (t) {
      case "pin": { const id = ent(), k = listKey(id); const l = (p[k] ?? []).filter((x) => x !== id); const at = Number.isInteger(op.position) ? Math.max(0, Math.min(l.length, op.position)) : l.length; l.splice(at, 0, id); p[k] = l; return `festet ${id}`; }
      case "unpin": { const id = ent(), k = listKey(id); p[k] = (p[k] ?? []).filter((x) => x !== id); return `fjernet ${id}`; }
      case "set_pinned": { const k = op.kind === "lights" ? "pinnedLights" : "pinnedRoutines"; const l = (op.entity_ids ?? []).map(String); if (!l.every((x) => ENTITY.test(x))) throw new Error("ugyldig entity_ids"); p[k] = uniq(l); return `satte ${k}`; }
      case "card_order": { const o = uniq((op.order ?? []).map(String)).filter((c) => HOME_CARDS.includes(c)); p.homeOrder = [...o, ...HOME_CARDS.filter((c) => !o.includes(c))]; return `kortrekkefølge: ${o.join(", ")}`; }
      case "card_visible": { const c = String(op.card); if (!HOME_CARDS.includes(c)) throw new Error(`ukjent kort ${c}`); const h = new Set(p.hiddenCards ?? []); op.visible === false ? h.add(c) : h.delete(c); p.hiddenCards = [...h]; if (OPTIONAL_CARDS.includes(c) && op.visible !== false) p.addedCards = uniq([...(p.addedCards ?? []), c]); return `${op.visible === false ? "skjulte" : "viste"} kort ${c}`; }
      case "collapse": { const c = String(op.section); const s = new Set(p.collapsed ?? []); op.collapsed === false ? s.delete(c) : s.add(c); p.collapsed = [...s]; return `${op.collapsed === false ? "åpnet" : "lukket"} ${c}`; }
      case "tab_visible": { const k = String(op.tab); if (!TABS.includes(k)) throw new Error(`ukjent fane ${k}`); const h = new Set(p.hiddenTabs ?? []); op.visible === false ? h.add(k) : h.delete(k); p.hiddenTabs = [...h]; return `${op.visible === false ? "skjulte" : "viste"} fane ${k}`; }
      case "nav": { if (!["klassisk", "flyt"].includes(op.mode)) throw new Error("nav må være klassisk|flyt"); p.nav = op.mode; return `navigasjon ${op.mode}`; }
      case "theme": { if (!["system", "dark", "light"].includes(op.theme)) throw new Error("theme må være system|dark|light"); p.theme = op.theme; return `tema ${op.theme}`; }
      case "sidebar": { if (!["full", "rail"].includes(op.sidebar)) throw new Error("sidebar må være full|rail"); p.sidebar = op.sidebar; return `sidemeny ${op.sidebar}`; }
      case "luft_pinned": { p.luftPinned = op.pinned !== false; return `Luft på Hjem: ${p.luftPinned}`; }
      case "layout": { const phone = op.target === "phone"; if (phone) p.phone = p.phone ?? {}; const keys = setFields(phone ? p.phone : p, op.fields); return `${phone ? "mobil" : "visning"}: ${keys.join(", ")}`; }
      case "layout_mode": { p.perDevice = op.perDevice === true; if (p.perDevice && !p.phone) p.phone = pickLayout(p); return p.perDevice ? "egen mobilvisning" : "samme visning overalt"; }
      case "layout_reset": { if (op.target === "phone") { if (p.perDevice) p.phone = {}; } else { for (const k of LAYOUT_KEYS) delete p[k]; if (op.all) { delete p.phone; delete p.perDevice; } } delete p.activeLayout; return `tilbakestilt ${op.target === "phone" ? "mobilvisning" : "visning"}`; }
      case "layout_save": { const n = String(op.name ?? "").trim(); if (!NAME.test(n)) throw new Error("navn: 1–24 bokstaver/tall"); const l = { ...(p.layouts ?? {}) }; if (!l[n] && Object.keys(l).length >= 12) throw new Error("maks 12 visninger"); l[n] = { ...pickLayout(p), perDevice: !!p.perDevice, ...(p.phone ? { phone: structuredClone(p.phone) } : {}) }; p.layouts = l; p.activeLayout = n; return `lagret visning «${n}»`; }
      case "layout_use": { const n = String(op.name ?? ""); const l = p.layouts?.[n]; if (!l) throw new Error(`ukjent visning ${n}`); for (const k of LAYOUT_KEYS) delete p[k]; Object.assign(p, pickLayout(l)); p.perDevice = !!l.perDevice; if (l.phone) p.phone = structuredClone(l.phone); else delete p.phone; p.activeLayout = n; return `byttet til «${n}»`; }
      case "layout_delete": { const n = String(op.name ?? ""); if (!p.layouts?.[n]) throw new Error(`ukjent visning ${n}`); const l = { ...p.layouts }; delete l[n]; p.layouts = l; if (p.activeLayout === n) delete p.activeLayout; return `slettet visning «${n}»`; }
      case "note_add": { if (!notes) throw new Error("notater utilgjengelig"); const n = notes.add(String(op.text ?? "").slice(0, 2000), { pinned: !!op.pinned }); notesDone.push(n.id); return `notat lagt til (#${n.id})`; }
      default: throw new Error(`ukjent op ${t}`);
    }
  }

  return {
    get: () => ({ prefs: read(), cards: HOME_CARDS, tabs: TABS, history: q.list.all(10) }),
    apply(ops, { source = "assistant", summary } = {}) {
      if (!Array.isArray(ops) || !ops.length || ops.length > 20) throw new Error("ops: 1–20 operasjoner");
      const before = read(); const p = structuredClone(before); const done = []; const notesDone = [];
      for (const op of ops) done.push(applyOp(p, op, notesDone));
      p.updatedAt = Date.now();
      const changedPrefs = JSON.stringify({ ...before, updatedAt: 0 }) !== JSON.stringify({ ...p, updatedAt: 0 });
      if (changedPrefs) q.put.run(JSON.stringify(p), p.updatedAt);
      const s = String(summary ?? done.join("; ")).slice(0, 300);
      const r = q.hist.run(JSON.stringify(before), JSON.stringify({ prefs: changedPrefs ? p : null, notes: notesDone }), source, s, Date.now());
      return { ok: true, historyId: Number(r.lastInsertRowid), changes: done, prefs: p };
    },
    undo() {
      const h = q.last.get(); if (!h) return { ok: false, error: "Ingenting å angre" };
      const after = JSON.parse(h.after);
      const a = after.prefs ? after : { prefs: after, notes: [] }; // tolerate plain rows
      if (a.prefs && h.before != null) { const b = JSON.parse(h.before); b.updatedAt = Date.now(); q.put.run(JSON.stringify(b), b.updatedAt); }
      for (const id of a.notes ?? []) { try { notes?.remove(id); } catch { /* */ } }
      q.markUndone.run(h.id);
      return { ok: true, undone: h.summary, historyId: h.id, prefs: read() };
    },
  };
}

export function dashEditRoutes(de, trusted) {
  return async (req, res, sub) => {
    if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
    try {
      if (!sub && req.method === "GET") return sendJson(res, 200, de.get());
      if (sub === "apply" && req.method === "POST") { const b = await readBody(req); return sendJson(res, 200, de.apply(b.ops, { source: String(b.source ?? "assistant").slice(0, 32), summary: b.summary })); }
      if (sub === "undo" && req.method === "POST") { const r = de.undo(); return sendJson(res, r.ok ? 200 : 409, r); }
      return sendJson(res, 404, { error: "not found" });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  };
}
