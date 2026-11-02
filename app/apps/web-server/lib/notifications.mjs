// Notification center (home.db). Producers call notify({key, kind, title, body, severity, link}); key de-duplicates.
import { haRest } from "./ha.mjs";
import { readBody, sendJson } from "./util.mjs";
export function initNotifications(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, kind TEXT, severity TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL, body TEXT, link TEXT,
    created_at INTEGER NOT NULL, read_at INTEGER, dismissed_at INTEGER, resolved_at INTEGER)`);
  const q = {
    ins: db.prepare("INSERT INTO notifications (key, kind, severity, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET resolved_at = NULL, title = excluded.title, body = excluded.body WHERE notifications.resolved_at IS NOT NULL OR notifications.title <> excluded.title"),
    list: db.prepare("SELECT * FROM notifications WHERE dismissed_at IS NULL AND resolved_at IS NULL ORDER BY (severity = 'urgent') DESC, created_at DESC LIMIT 100"),
    read: db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL"), readAll: db.prepare("UPDATE notifications SET read_at = ? WHERE read_at IS NULL"),
    dismiss: db.prepare("UPDATE notifications SET dismissed_at = ? WHERE id = ?"),
    resolve: db.prepare("UPDATE notifications SET resolved_at = ? WHERE key = ? AND resolved_at IS NULL"),
    keys: db.prepare("SELECT key FROM notifications WHERE key LIKE ? AND resolved_at IS NULL AND dismissed_at IS NULL"),
  };
  const notify = ({ key, kind = "info", severity = "info", title, body = null, link = null }) => q.ins.run(key, kind, severity, title, body, link, Date.now());
  const resolve = (key) => q.resolve.run(Date.now(), key);

  // Home-state producers, every 2 min.
  async function scan() {
    const states = await haRest("/states"); const by = Object.fromEntries(states.map((s) => [s.entity_id, s]));
    const active = new Set();
    const put = (n) => { active.add(n.key); notify(n); };
    // offline devices (ignore helpers/updates/buttons)
    const off = states.filter((s) => s.state === "unavailable" && /^(light|switch|climate|fan|media_player|vacuum|lawn_mower|lock|sensor)\./.test(s.entity_id));
    const devs = [...new Set(off.map((s) => (s.attributes.friendly_name ?? s.entity_id).split(" ").slice(0, 2).join(" ")))];
    if (devs.length) put({ key: `ha:offline:${devs.slice(0, 5).join("|")}`, kind: "device", severity: "warn", title: `${devs.length} enhet${devs.length > 1 ? "er" : ""} offline`, body: devs.slice(0, 6).join(", "), link: "#/settings" });
    if (by["binary_sensor.flexit_fan_flexit_fan_filter_replacement_status"]?.state === "on") put({ key: "ha:filter:flexit", kind: "air", severity: "warn", title: "Flexit-filteret bør byttes", body: "Bytt filter og trykk «Filter byttet» i Luft-fanen.", link: "#/luft" });
    if (by["binary_sensor.flexit_fan_flexit_fan_alarm_status"]?.state === "on") put({ key: "ha:alarm:flexit", kind: "air", severity: "urgent", title: "Flexit-viften melder feil", link: "#/luft" });
    const w = by["sensor.laundry_room_washer_job_state"], m = by["sensor.laundry_room_washer_machine_state"];
    if (m && w && m.state === "stop" && w.state === "none" && Date.now() - new Date(m.last_changed).getTime() < 3 * 3600_000 && by["sensor.laundry_room_washer_power"]?.state === "0" && new Date(by["sensor.laundry_room_washer_completion_time"]?.state ?? 0).getTime() < Date.now() && new Date(by["sensor.laundry_room_washer_completion_time"]?.state ?? 0).getTime() > Date.now() - 3 * 3600_000)
      put({ key: `ha:washer:${m.last_changed.slice(0, 16)}`, kind: "appliance", title: "Vaskemaskinen er ferdig", body: "Husk å henge opp klærne.", link: "#/" });
    for (const s of states) if (/^sensor\.(dreame|navimow)_.*(filter|brush|borste|mop|blad|blade|consum)/i.test(s.entity_id) && Number(s.state) <= 10 && s.state !== "unknown")
      put({ key: `ha:consumable:${s.entity_id}`, kind: "robot", severity: "warn", title: `${s.attributes.friendly_name}: ${s.state}${s.attributes.unit_of_measurement ?? ""}`, body: "Bytt snart.", link: "#/robots" });
    for (const { key } of q.keys.all("ha:%")) if (!active.has(key)) resolve(key);
  }
  setTimeout(() => scan().catch(() => undefined), 10_000); setInterval(() => scan().catch(() => undefined), 120_000);

  async function routes(req, res, sub, trusted) {
    if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
    try {
      if (sub === "" && req.method === "GET") { const items = q.list.all(); return sendJson(res, 200, { items, unread: items.filter((i) => !i.read_at).length }); }
      if (sub === "read-all" && req.method === "POST") { q.readAll.run(Date.now()); return sendJson(res, 200, { ok: true }); }
      const m = /^(\d+)\/(read|dismiss)$/.exec(sub);
      if (m && req.method === "POST") { (m[2] === "read" ? q.read : q.dismiss).run(Date.now(), Number(m[1])); return sendJson(res, 200, { ok: true }); }
      if (sub === "" && req.method === "POST") { const b = await readBody(req); notify({ ...b, key: `api:${b.key ?? Date.now()}` }); return sendJson(res, 200, { ok: true }); }
      return sendJson(res, 404, { error: "not found" });
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  }
  return { notify, resolve, routes, scan };
}
