// Notes stored in home.db. Tailscale-only API: GET /api/notes, POST /api/notes, PATCH/DELETE /api/notes/:id, POST /api/notes/:id/restore
import { readBody, sendJson } from "./util.mjs";
const COLORS = new Set(["", "amber", "green", "blue", "rose", "violet"]);
export function initNotes(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  const row = (r) => r && ({ id: r.id, text: r.text, pinned: !!r.pinned, done: !!r.done, color: r.color, createdAt: r.created_at, updatedAt: r.updated_at });
  const q = {
    list: db.prepare("SELECT * FROM notes WHERE deleted = 0 ORDER BY pinned DESC, done ASC, updated_at DESC LIMIT 500"),
    get: db.prepare("SELECT * FROM notes WHERE id = ?"),
    add: db.prepare("INSERT INTO notes (text, pinned, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"),
    del: db.prepare("UPDATE notes SET deleted = 1, updated_at = ? WHERE id = ?"),
    restore: db.prepare("UPDATE notes SET deleted = 0, updated_at = ? WHERE id = ?"),
    purge: db.prepare("DELETE FROM notes WHERE deleted = 1 AND updated_at < ?"),
  };
  const api = {
    list: () => q.list.all().map(row),
    add: (text, { pinned = false, color = "" } = {}) => { const t = Date.now(); const r = q.add.run(String(text).slice(0, 5000), pinned ? 1 : 0, COLORS.has(color) ? color : "", t, t); return row(q.get.get(r.lastInsertRowid)); },
    update: (id, p) => {
      const cur = q.get.get(id); if (!cur || cur.deleted) return null;
      const n = { text: p.text != null ? String(p.text).slice(0, 5000) : cur.text, pinned: p.pinned != null ? (p.pinned ? 1 : 0) : cur.pinned, done: p.done != null ? (p.done ? 1 : 0) : cur.done, color: p.color != null && COLORS.has(p.color) ? p.color : cur.color };
      db.prepare("UPDATE notes SET text=?, pinned=?, done=?, color=?, updated_at=? WHERE id=?").run(n.text, n.pinned, n.done, n.color, Date.now(), id);
      return row(q.get.get(id));
    },
    remove: (id) => { q.del.run(Date.now(), id); q.purge.run(Date.now() - 7 * 864e5); },
    restore: (id) => { q.restore.run(Date.now(), id); return row(q.get.get(id)); },
  };
  return api;
}
export function notesRoutes(notes, trusted) {
  return async (req, res, sub) => {
    if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
    try {
      const [idS, act] = sub.split("/"); const id = Number(idS);
      if (!sub && req.method === "GET") return sendJson(res, 200, { notes: notes.list() });
      if (!sub && req.method === "POST") { const b = await readBody(req); if (!String(b.text ?? "").trim()) return sendJson(res, 400, { error: "tom" }); return sendJson(res, 200, notes.add(b.text, b)); }
      if (!id) return sendJson(res, 404, { error: "not found" });
      if (act === "restore" && req.method === "POST") return sendJson(res, 200, notes.restore(id));
      if (req.method === "PATCH") { const n = notes.update(id, await readBody(req)); return n ? sendJson(res, 200, n) : sendJson(res, 404, { error: "not found" }); }
      if (req.method === "DELETE") { notes.remove(id); return sendJson(res, 200, { ok: true }); }
      return sendJson(res, 405, { error: "method" });
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  };
}
