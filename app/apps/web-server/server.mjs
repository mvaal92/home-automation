#!/usr/bin/env node
/**
 * Home web server.
 *  - Serves the @home/ui production build (SPA).
 *  - /ha/*  -> same-origin reverse proxy to Home Assistant (HTTP + WebSocket).
 *    The HA token is injected server-side, read from HOME_HA_TOKEN_FILE, and ONLY
 *    for connections that arrive on a trusted local address (the Tailscale IP by
 *    default). The browser never sees the token.
 *  - /app-config.json tells the UI whether proxy mode is available for this request.
 *
 * Env: HOME_BIND (comma list, default "127.0.0.1"; set the Tailscale IP via env), HOME_PORT (8124),
 *      HOME_HA_UPSTREAM (http://127.0.0.1:8123), HOME_HA_TOKEN_FILE,
 *      HOME_PROXY_TRUSTED_LOCAL (comma list of local addrs that get injection; default = Tailscale IP),
 *      HOME_STATIC_DIR (default ../../packages/ui/dist)
 */
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { mkdirSync, chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assistantRoutes } from "./lib/assistant.mjs";
import { odaApi } from "./lib/odaApi.mjs";
import { mediaApi } from "./lib/media.mjs";
import { fabelApi } from "./lib/fabelApi.mjs";
import { initNotes, notesRoutes } from "./lib/notes.mjs";
import { initKids } from "./lib/kids.mjs";
import { initNotifications } from "./lib/notifications.mjs";
import { initMaintenance, maintenanceRoutes } from "./lib/maintenance.mjs";
import { initConnections } from "./lib/connections.mjs";
import { initAuth } from "./lib/auth/broker.mjs";
import https from "node:https";
import { existsSync } from "node:fs";
import { initDashEdit, dashEditRoutes } from "./lib/dashedit.mjs";
import { initCodeAgent, codeRoutes } from "./lib/codeagent.mjs";
import { initCalendar } from "./lib/calendar/index.mjs";
import { weatherRoute } from "./lib/calendar/weather.mjs";
import { initAmbient } from "./lib/ambient.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const BIND = (process.env.HOME_BIND ?? "127.0.0.1").split(",").map((s) => s.trim()).filter(Boolean);
const PORT = Number(process.env.HOME_PORT ?? 8124);
const UPSTREAM = new URL(process.env.HOME_HA_UPSTREAM ?? "http://127.0.0.1:8123");
const TOKEN_FILE = (process.env.HOME_HA_TOKEN_FILE ?? "~/home-automation/secrets/ha_token").replace(/^~/, homedir());
const TRUSTED = new Set((process.env.HOME_PROXY_TRUSTED_LOCAL ?? "").split(",").map((s) => s.trim()));
const STATIC = resolve(process.env.HOME_STATIC_DIR ?? join(here, "../../packages/ui/dist"));

const DATA_DIR = (process.env.HOME_DATA_DIR ?? "~/home-automation/data").replace(/^~/, homedir());
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 }); chmodSync(DATA_DIR, 0o700);
const db = new DatabaseSync(join(DATA_DIR, "home.db"));
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)");
try { chmodSync(join(DATA_DIR, "home.db"), 0o600); } catch { /* */ }
const getPref = db.prepare("SELECT value, rev, updated_at FROM prefs WHERE key = ?");
const putPref = db.prepare("INSERT INTO prefs (key, value, rev, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, rev = prefs.rev + 1, updated_at = excluded.updated_at");
const PREF_KEY = /^[a-z][a-z0-9_-]{0,31}$/;

function prefsApi(req, res, key) {
  const json = (code, body) => res.writeHead(code, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
  if (!trusted(req)) return json(403, { error: "Tailscale only" });
  if (!PREF_KEY.test(key)) return json(400, { error: "bad key" });
  if (req.method === "GET") {
    const row = getPref.get(key);
    return json(200, row ? { value: JSON.parse(row.value), rev: row.rev, updatedAt: row.updated_at } : { value: null, rev: 0 });
  }
  if (req.method !== "PUT") return json(405, { error: "method" });
  let size = 0; const chunks = [];
  req.on("data", (c) => { size += c.length; if (size > 128 * 1024) { req.destroy(); } else chunks.push(c); });
  req.on("end", () => {
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json(400, { error: "bad json" }); }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return json(400, { error: "object expected" });
    putPref.run(key, JSON.stringify(value), Date.now());
    const row = getPref.get(key);
    json(200, { ok: true, rev: row.rev, updatedAt: row.updated_at });
  });
}

const token = () => readFileSync(TOKEN_FILE, "utf8").trim(); // re-read so rotation needs no restart
const local = (sock) => (sock.localAddress ?? "").replace(/^::ffff:/, "");
const trusted = (req) => TRUSTED.has(local(req.socket));
const log = (...a) => console.log(new Date().toISOString(), ...a);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const SECURITY = { "x-content-type-options": "nosniff", "referrer-policy": "same-origin", "x-frame-options": "DENY" };

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  let file = normalize(join(STATIC, rel));
  if (!file.startsWith(STATIC)) { res.writeHead(403).end(); return; }
  try { if (!(await stat(file)).isFile()) throw new Error(); } catch {
    // a missing hashed asset must 404 (not fall back to index.html, which iOS would run as JS → black screen)
    if (rel.startsWith("/assets/") || /\.(js|css|png|woff2|json|webmanifest|ico|svg|jpg)$/.test(rel)) { res.writeHead(404, { ...SECURITY, "cache-control": "no-store" }).end(); return; }
    file = join(STATIC, "index.html");
  }
  const body = await readFile(file);
  const immutable = file.includes(`${STATIC}/assets/`);
  res.writeHead(200, { ...SECURITY, "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
  res.end(req.method === "HEAD" ? undefined : body);
}

function proxyHttp(req, res) {
  if (!trusted(req)) { res.writeHead(403, { "content-type": "text/plain" }).end("HA proxy is only available over Tailscale"); return; }
  const path = req.url.replace(/^\/ha/, "") || "/";
  const headers = { ...req.headers, host: UPSTREAM.host };
  delete headers.cookie; delete headers.origin; delete headers.referer;
  headers.authorization = `Bearer ${token()}`;
  const up = http.request({ hostname: UPSTREAM.hostname, port: UPSTREAM.port || 80, path, method: req.method, headers }, (ur) => {
    const h = { ...ur.headers };
    delete h["set-cookie"];
    res.writeHead(ur.statusCode ?? 502, h);
    ur.pipe(res);
  });
  up.on("error", (e) => { if (!res.headersSent) res.writeHead(502).end(`Upstream error: ${e.message}`); });
  req.pipe(up);
}

const notes = initNotes(db);
const notesApi = notesRoutes(notes, (req) => trusted(req));
const maintenance = initMaintenance(db);
const maintenanceApi = maintenanceRoutes(maintenance, (req) => trusted(req));
const notifications = initNotifications(db);
const connections = initConnections(notifications.notify, notifications.resolve);
const auth = initAuth({ onChange: () => connections.keepAlive().catch(() => {}) });
const kids = initKids(db, notifications.notify); kids.start();
const calendar = initCalendar(db, { kids, maintenance, notify: notifications.notify }); auth.providers.set(calendar.provider.id, calendar.provider);
const dashEdit = initDashEdit(db, notes);
const ambient = initAmbient(DATA_DIR, { getPref, putPref });
const dashEditApi = dashEditRoutes(dashEdit, (req) => trusted(req));
let code = null, codeApi = null; // initialised once the server exists (preview proxies back into it)
const assistant = assistantRoutes(db, (req) => trusted(req), notes, maintenance, kids, { dashEdit, code: () => code });
// Live sync: Server-Sent Events that fire when prefs rows change (any device, the assistant or edit mode).
const prefsRevQ = db.prepare("SELECT COALESCE(SUM(rev), 0) AS r FROM prefs");
const prefsClients = new Set(); let prefsRev = prefsRevQ.get().r;
setInterval(() => { if (!prefsClients.size) return; const r = prefsRevQ.get().r; if (r !== prefsRev) { prefsRev = r; for (const c of prefsClients) c.write(`data: ${r}\n\n`); } else for (const c of prefsClients) c.write(": ping\n\n"); }, 1000).unref();
function prefsEvents(req, res) {
  if (!trusted(req)) { res.writeHead(403).end(); return; }
  res.writeHead(200, { ...SECURITY, "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
  res.write(`retry: 3000\ndata: ${prefsRev}\n\n`); prefsClients.add(res);
  req.on("close", () => prefsClients.delete(res));
}
const server = http.createServer((req, res) => {
  const p = (req.url ?? "/").split("?")[0];
  if (p === "/healthz") { res.writeHead(200, { "content-type": "text/plain" }).end("ok"); return; }
  if (p === "/app-config.json") {
    res.writeHead(200, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ proxy: trusted(req), haPath: "/ha" }));
    return;
  }
  if (p === "/api/prefs/events") { prefsEvents(req, res); return; }
  if (p === "/api/prefs" || p.startsWith("/api/prefs/")) { prefsApi(req, res, p.slice("/api/prefs/".length) || "dashboard"); return; }
  if (p === "/api/dashedit" || p.startsWith("/api/dashedit/")) { dashEditApi(req, res, p.slice("/api/dashedit".length).replace(/^\//, "")); return; }
  if (p === "/api/code" || p.startsWith("/api/code/")) { if (!codeApi) { res.writeHead(503).end(); return; } codeApi(req, res, p.slice("/api/code".length).replace(/^\//, "")); return; }
  if (p === "/api/assistant" || p.startsWith("/api/assistant/")) { assistant(req, res, p.slice("/api/assistant/".length)); return; }
  if (p.startsWith("/api/oda/")) { odaApi(req, res, p.slice("/api/oda/".length), trusted); return; }
  if (p === "/api/maintenance" || p.startsWith("/api/maintenance/")) { maintenanceApi(req, res, p.slice("/api/maintenance".length).replace(/^\//, "")); return; }
  if (p === "/api/notes" || p.startsWith("/api/notes/")) { notesApi(req, res, p.slice("/api/notes".length).replace(/^\//, "")); return; }
  if (p === "/api/calendar" || p.startsWith("/api/calendar/")) { calendar.routes(req, res, p.slice("/api/calendar".length).replace(/^\//, ""), trusted); return; }
  if (p === "/api/ambient" || p.startsWith("/api/ambient/")) { ambient.routes(req, res, p.slice("/api/ambient".length).replace(/^\//, ""), trusted); return; }
  if (p === "/api/home/weather") { weatherRoute(req, res, trusted); return; }
  if (p.startsWith("/api/kids/")) { kids.routes(req, res, p.slice("/api/kids/".length), trusted); return; }
  if (p === "/api/notifications" || p.startsWith("/api/notifications/")) { notifications.routes(req, res, p.slice("/api/notifications".length).replace(/^\//, ""), trusted); return; }
  if (p === "/api/connections" || p.startsWith("/api/connections/")) { connections.routes(req, res, p.slice("/api/connections".length).replace(/^\//, ""), trusted); return; }
  if (p === "/api/auth" || p.startsWith("/api/auth/")) { auth.routes(req, res, p.slice("/api/auth".length).replace(/^\//, ""), trusted); return; }
  if (p.startsWith("/auth/callback/")) { auth.callback(req, res, p.slice("/auth/callback/".length), trusted); return; }
  if (p.startsWith("/api/fabel/")) { fabelApi(req, res, p.slice("/api/fabel/".length), trusted); return; }
  if (p.startsWith("/api/media/")) { mediaApi(req, res, p.slice("/api/media/".length), trusted); return; }
  if (p === "/ha" || p.startsWith("/ha/")) { proxyHttp(req, res); return; }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
  serveStatic(req, res).catch((e) => { res.writeHead(500).end(); log("static error", e.message); });
});

code = initCodeAgent(db, server.listeners("request")[0], server);
codeApi = codeRoutes(code, (req) => trusted(req));

/**
 * WebSocket relay. HA authenticates in-band, so the proxy performs the upstream
 * auth itself and answers the client's own auth message locally: the client may
 * send any placeholder token.
 */
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/ha/api/websocket") || !trusted(req)) { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
  wss.handleUpgrade(req, socket, head, (client) => relay(client, req));
});

function relay(client, req) {
  const peer = req.socket.remoteAddress;
  const up = new WebSocket(`${UPSTREAM.protocol === "https:" ? "wss" : "ws"}://${UPSTREAM.host}/api/websocket`, { maxPayload: 64 * 1024 * 1024 });
  let upReady = false, clientAuthed = false, upAuthOk = null;
  const queue = [];
  const maybeOk = () => { if (clientAuthed && upAuthOk) { client.send(upAuthOk); upReady = true; for (const [d, b] of queue.splice(0)) up.send(d, { binary: b }); } };
  client.send(JSON.stringify({ type: "auth_required", ha_version: "proxy" }));
  up.on("message", (data, isBinary) => {
    if (!upReady && !isBinary) {
      const msg = JSON.parse(String(data));
      if (msg.type === "auth_required") { up.send(JSON.stringify({ type: "auth", access_token: token() })); return; }
      if (msg.type === "auth_ok") { upAuthOk = String(data); maybeOk(); return; }
      if (msg.type === "auth_invalid") { log("upstream auth_invalid"); client.close(4001, "upstream auth failed"); up.close(); return; }
    }
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  client.on("message", (data, isBinary) => {
    if (!clientAuthed) {
      if (!isBinary) { try { if (JSON.parse(String(data)).type === "auth") { clientAuthed = true; maybeOk(); return; } } catch { /* fallthrough */ } }
      client.close(4000, "auth expected"); return;
    }
    if (!upReady) { queue.push([data, isBinary]); return; }
    up.send(data, { binary: isBinary });
  });
  const close = () => { try { client.close(); } catch { /* */ } try { up.close(); } catch { /* */ } };
  up.on("close", close); client.on("close", close);
  up.on("error", (e) => { log("upstream ws error", e.message); close(); });
  client.on("error", close);
  log("ws relay open", peer);
}

for (const host of BIND) {
  const s = host === BIND[0] ? server : http.createServer(server.listeners("request")[0]);
  if (s !== server) s.on("upgrade", (...a) => server.emit("upgrade", ...a));
  s.on("error", (e) => { console.error(`listen ${host}:${PORT} failed: ${e.message}`); process.exit(1); });
  s.listen(PORT, host, () => { log(`Home web on http://${host}:${PORT} (static ${STATIC}, proxy -> ${UPSTREAM.origin}, trusted ${[...TRUSTED].join(",")})`); });
}
// Tailscale HTTPS (tailscale cert for the MagicDNS name) – needed for OAuth redirect URIs. Bound only to the
// Tailscale address; no firewall changes, nothing public.
const TLS_DIR = process.env.HOME_TLS_DIR ?? join(homedir(), "home-automation/secrets/tls");
const HTTPS_PORT = Number(process.env.HOME_HTTPS_PORT ?? 8444);
if (existsSync(join(TLS_DIR, "omarchy.crt"))) {
  const hs = https.createServer({ cert: readFileSync(join(TLS_DIR, "omarchy.crt")), key: readFileSync(join(TLS_DIR, "omarchy.key")) }, server.listeners("request")[0]);
  hs.on("upgrade", (...a) => server.emit("upgrade", ...a));
  hs.on("error", (e) => console.error(`https listen failed: ${e.message}`));
  for (const host of BIND.filter((h) => TRUSTED.has(h))) hs.listen(HTTPS_PORT, host, () => log(`Home web (TLS) on https://${host}:${HTTPS_PORT}`));
}
process.on("SIGTERM", () => process.exit(0));
