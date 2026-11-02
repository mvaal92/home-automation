import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { expand } from "./util.mjs";
const UP = new URL(process.env.HOME_HA_UPSTREAM ?? "http://127.0.0.1:8123");
const TOKEN_FILE = expand(process.env.HOME_HA_TOKEN_FILE ?? "~/home-automation/secrets/ha_token");
const token = () => readFileSync(TOKEN_FILE, "utf8").trim();

export async function haRest(path, body, method = body ? "POST" : "GET") {
  const r = await fetch(new URL(`/api${path}`, UP), { method, headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HA ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

/** Persistent WebSocket for commands that are WS-only (media browse, sonos favorites...). */
let ws = null, ready = null, seq = 1; const pending = new Map();
function connect() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    ws = new WebSocket(`${UP.protocol === "https:" ? "wss" : "ws"}://${UP.host}/api/websocket`);
    ws.on("message", (d) => {
      const m = JSON.parse(String(d));
      if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: token() }));
      else if (m.type === "auth_ok") resolve();
      else if (m.type === "auth_invalid") reject(new Error("auth invalid"));
      else if (m.type === "result" && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.success ? p.resolve(m.result) : p.reject(new Error(m.error?.message ?? "HA error")); }
    });
    const drop = () => { ready = null; for (const p of pending.values()) p.reject(new Error("HA ws closed")); pending.clear(); };
    ws.on("close", drop); ws.on("error", (e) => { drop(); reject(e); });
  });
  return ready;
}
export async function haWs(msg, timeout = 15000) {
  await connect();
  const id = seq++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ ...msg, id }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error("HA ws timeout")); }, timeout);
  });
}
