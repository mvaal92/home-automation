// Recurring maintenance (Vedlikehold) in home.db. Tailscale-only API under /api/maintenance.
// Items can be linked to a Home Assistant entity (sensor % remaining or binary_sensor "needs service")
// and a "done" entity (script/button) that is triggered when the owner taps "Utført".
import { readBody, sendJson } from "./util.mjs";
import { haRest } from "./ha.mjs";
const oda = (q) => `https://oda.com/no/search/products/?q=${encodeURIComponent(q)}`;
const SEED = [
  ["Ventilasjon", "Flexit luftfilter (Flexit)", 90, "binary_sensor.flexit_fan_flexit_fan_filter_replacement_status", "script.flexit_filter_replaced", "", "Bytt begge filtrene. Nullstiller filtertimeren i viften."],
  ["Ventilasjon", "Bodø Supreme filter", 90, "", "", "", ""],
  ["Robotstøvsuger", "Dreame hovedbørste", 180, "sensor.dreame_x50_ultra_main_brush_left", "button.dreame_x50_ultra_reset_main_brush", "", ""],
  ["Robotstøvsuger", "Dreame sidebørste", 120, "sensor.dreame_x50_ultra_side_brush_left", "button.dreame_x50_ultra_reset_side_brush", "", ""],
  ["Robotstøvsuger", "Dreame filter", 90, "sensor.dreame_x50_ultra_filter_left", "button.dreame_x50_ultra_reset_filter", "", ""],
  ["Robotstøvsuger", "Dreame moppepads", 60, "sensor.dreame_x50_ultra_mop_pad_left", "button.dreame_x50_ultra_reset_mop_pad", "", ""],
  ["Robotstøvsuger", "Dreame støvpose i dokken", 60, "", "", "", ""],
  ["Robotstøvsuger", "Dreame: rengjør sensorer og vaskebrett", 30, "sensor.dreame_x50_ultra_sensor_dirty_left", "button.dreame_x50_ultra_reset_sensor", "", ""],
  ["Gressklipper", "Navimow kniver", 60, "", "", "", "Snu eller bytt knivbladene."],
  ["Kaffemaskin", "Kaffemaskin: avkalking", 60, "", "", oda("avkalking kaffemaskin"), ""],
  ["Kaffemaskin", "Kaffemaskin: rengjøring", 14, "", "", oda("rengjøringstabletter kaffemaskin"), ""],
  ["Kaffemaskin", "Kaffemaskin: vannfilter", 60, "", "", "", ""],
  ["Hvitevarer", "Oppvaskmaskin: rens filter", 30, "", "", "", ""],
  ["Hvitevarer", "Oppvaskmaskin: maskinrens", 90, "", "", oda("maskinrens oppvaskmaskin"), ""],
  ["Hvitevarer", "Vaskemaskin: trommelrens (90 °C)", 30, "", "", oda("maskinrens vaskemaskin"), ""],
  ["Hvitevarer", "Vaskemaskin: rens sludgefilter", 90, "", "", "", ""],
  ["Hvitevarer", "Tørketrommel: rens kondensator", 90, "", "", "", ""],
  ["Sikkerhet", "Røykvarslere: test", 90, "", "", "", "Trykk testknappen på alle røykvarslere."],
  ["Sikkerhet", "Røykvarslere: bytt batteri", 365, "", "", oda("9V batteri"), ""],
  ["Sikkerhet", "Brannslukker: sjekk trykk", 365, "", "", "", ""],
  ["Hus", "Rens sluk i dusj", 60, "", "", "", ""],
  ["Hus", "Kjøleskap: rens og avfrost", 180, "", "", "", ""],
];
export function initMaintenance(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS maintenance_items (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL DEFAULT 'Hus', name TEXT NOT NULL,
      interval_days INTEGER NOT NULL DEFAULT 90, last_done INTEGER, ha_entity TEXT NOT NULL DEFAULT '', done_entity TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS maintenance_log (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, done_at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '');`);
  if (db.prepare("SELECT COUNT(*) n FROM maintenance_items").get().n === 0) {
    const ins = db.prepare("INSERT INTO maintenance_items (category,name,interval_days,ha_entity,done_entity,link,notes,created_at) VALUES (?,?,?,?,?,?,?,?)");
    for (const s of SEED) ins.run(...s, Date.now());
  }
  const DAY = 864e5;
  async function haState(id) { if (!id) return null; try { return await haRest(`/states/${id}`); } catch { return null; } }
  async function compute(r) {
    const now = Date.now(); let next = r.last_done ? r.last_done + r.interval_days * DAY : null; let source = "manual"; let pct = null; let haFlag = false;
    const s = await haState(r.ha_entity);
    if (s && !["unknown", "unavailable"].includes(s.state)) {
      source = "ha";
      if (r.ha_entity.startsWith("binary_sensor.")) haFlag = s.state === "on";
      else if (!isNaN(Number(s.state))) { pct = Number(s.state); const daysLeft = Math.round(r.interval_days * pct / 100); next = now + daysLeft * DAY; }
    }
    const daysLeft = next == null ? null : Math.floor((next - now) / DAY);
    const status = haFlag || (daysLeft != null && daysLeft < 0) ? "overdue" : (daysLeft != null && daysLeft <= Math.max(7, Math.round(r.interval_days * 0.1))) ? "due" : daysLeft == null ? "unknown" : "ok";
    return { id: r.id, category: r.category, name: r.name, intervalDays: r.interval_days, lastDone: r.last_done, nextDue: next, daysLeft, status, source, percentLeft: pct, haFlag,
      haEntity: r.ha_entity, haLinked: Boolean(s), doneEntity: r.done_entity, link: r.link, notes: r.notes };
  }
  const get = db.prepare("SELECT * FROM maintenance_items WHERE id=?");
  const api = {
    async list() { const rows = db.prepare("SELECT * FROM maintenance_items WHERE archived=0 ORDER BY category, name").all(); const out = await Promise.all(rows.map(compute)); const rank = { overdue: 0, due: 1, unknown: 3, ok: 2 }; return out.sort((a, b) => rank[a.status] - rank[b.status] || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9)); },
    async attention() { return (await api.list()).filter((i) => i.status === "overdue" || i.status === "due"); },
    add(b) { const r = db.prepare("INSERT INTO maintenance_items (category,name,interval_days,last_done,link,notes,created_at) VALUES (?,?,?,?,?,?,?)").run(String(b.category || "Hus").slice(0, 60), String(b.name).slice(0, 120), Math.max(1, Number(b.intervalDays) || 90), b.lastDone ?? null, String(b.link ?? "").slice(0, 500), String(b.notes ?? "").slice(0, 2000), Date.now()); return compute(get.get(r.lastInsertRowid)); },
    update(id, b) { const c = get.get(id); if (!c) return null;
      db.prepare("UPDATE maintenance_items SET category=?, name=?, interval_days=?, last_done=?, link=?, notes=? WHERE id=?").run(b.category ?? c.category, b.name ?? c.name, b.intervalDays != null ? Math.max(1, Number(b.intervalDays)) : c.interval_days, b.lastDone !== undefined ? b.lastDone : c.last_done, b.link ?? c.link, b.notes ?? c.notes, id);
      return compute(get.get(id)); },
    archive(id) { db.prepare("UPDATE maintenance_items SET archived=1 WHERE id=?").run(id); },
    async done(id, note = "") { const c = get.get(id); if (!c) return null; const t = Date.now();
      db.prepare("UPDATE maintenance_items SET last_done=? WHERE id=?").run(t, id);
      db.prepare("INSERT INTO maintenance_log (item_id, done_at, note) VALUES (?,?,?)").run(id, t, String(note).slice(0, 500));
      let haReset = null;
      if (c.done_entity && await haState(c.done_entity)) { const [dom] = c.done_entity.split("."); try { await haRest(`/services/${dom}/${dom === "button" ? "press" : "turn_on"}`, { entity_id: c.done_entity }); haReset = c.done_entity; } catch { haReset = "failed"; } }
      return { ...(await compute(get.get(id))), haReset }; },
    history(id) { return db.prepare(`SELECT l.id, l.item_id itemId, i.name, l.done_at doneAt, l.note FROM maintenance_log l JOIN maintenance_items i ON i.id=l.item_id ${id ? "WHERE l.item_id=?" : ""} ORDER BY l.done_at DESC LIMIT 100`).all(...(id ? [id] : [])); },
  };
  return api;
}
export function maintenanceRoutes(m, trusted) {
  return async (req, res, sub) => {
    if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
    try {
      const [idS, act] = sub.split("/"); const id = Number(idS);
      if (!sub && req.method === "GET") return sendJson(res, 200, { items: await m.list() });
      if (sub === "attention") return sendJson(res, 200, { items: await m.attention() });
      if (sub === "history") return sendJson(res, 200, { history: m.history() });
      if (!sub && req.method === "POST") { const b = await readBody(req); if (!String(b.name ?? "").trim()) return sendJson(res, 400, { error: "navn mangler" }); return sendJson(res, 200, await m.add(b)); }
      if (!id) return sendJson(res, 404, { error: "not found" });
      if (act === "done" && req.method === "POST") { const b = await readBody(req); const r = await m.done(id, b.note); return r ? sendJson(res, 200, r) : sendJson(res, 404, { error: "not found" }); }
      if (act === "history") return sendJson(res, 200, { history: m.history(id) });
      if (req.method === "PATCH") { const r = await m.update(id, await readBody(req)); return r ? sendJson(res, 200, r) : sendJson(res, 404, { error: "not found" }); }
      if (req.method === "DELETE") { m.archive(id); return sendJson(res, 200, { ok: true }); }
      return sendJson(res, 405, { error: "method" });
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  };
}
