import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HomeLink } from "./home.js";
import { registerCalendarTools } from "./calendar.js";

/**
 * App tools: everything in the Home app beyond Home Assistant devices. They call home-web's existing
 * Tailscale-only APIs (HOME_WEB_URL). Hard limits enforced here, not just described:
 *  - Kids/school/MyKid: READ ONLY. No send/reply/sign/absence tools exist.
 *  - Oda: cart read/add/remove, search, slots read. NO checkout/order/payment tool exists.
 *  - Code mode: request/status/diff/apply/rollback/discard. Server-side guards stay: only 'ready' changes (protected files + device-safety
 *    check, typecheck, build passed) can be applied; rollback tag; auto-revert on failed build. safety.ts is a protected file.
 *  - Logins: status + deep link to the app's login sheet. Never returns or accepts secrets.
 *  - Media playback (media_play / audiobook_cast) is device actuation.
 */
const tsBind = (process.env.HOME_MCP_BIND ?? "").split(",").map((x) => x.trim()).find((x) => x && !/^(127\.|::1$|localhost$)/.test(x));
const BASE = process.env.HOME_WEB_URL ?? (tsBind ? `http://${tsBind}:8124` : "http://127.0.0.1:8124");
const ok = (data: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }] });
const fail = (msg: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: msg }] });
const RO = { readOnlyHint: true } as const;

async function web(path: string, method = "GET", body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const t = await r.text(); let data: any; try { data = JSON.parse(t); } catch { data = { error: t.slice(0, 200) }; }
  return { ok: r.ok, status: r.status, data };
}
const tool = (fn: (a: any) => Promise<unknown>) => async (a: any): Promise<CallToolResult> => {
  try { return ok(await fn(a)); } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
};
async function get(path: string, method = "GET", body?: unknown) {
  const r = await web(path, method, body);
  if (!r.ok) throw new Error(`${r.status}: ${r.data?.error ?? "feil"}${r.data?.loginRequired ? " (innlogging kreves – bruk login_start)" : ""}`);
  return r.data;
}
const take = <T>(a: T[] | undefined, n: number) => (Array.isArray(a) ? a.slice(0, n) : []);

export function registerAppTools(server: McpServer, home: HomeLink): void {
  registerCalendarTools(server);
  // ---------- notes ----------
  server.registerTool("notes_list", { title: "List notes", description: "Notes on the Home screen (Notater): id, text, pinned, done, timestamps.", inputSchema: {}, annotations: RO },
    tool(async () => get("/api/notes")));
  server.registerTool("notes_create", { title: "Create note", description: "Add a note to the Home screen.", inputSchema: { text: z.string().min(1).max(2000), pinned: z.boolean().optional() } },
    tool(async ({ text, pinned }) => get("/api/notes", "POST", { text, pinned })));
  server.registerTool("notes_update", { title: "Update note", description: "Edit a note: text, pinned, done.", inputSchema: { id: z.number().int(), text: z.string().max(2000).optional(), pinned: z.boolean().optional(), done: z.boolean().optional() } },
    tool(async ({ id, ...b }) => get(`/api/notes/${id}`, "PATCH", b)));
  server.registerTool("notes_delete", { title: "Delete note", description: "Delete a note (can be restored with notes_restore).", inputSchema: { id: z.number().int() }, annotations: { destructiveHint: true } },
    tool(async ({ id }) => get(`/api/notes/${id}`, "DELETE")));
  server.registerTool("notes_restore", { title: "Restore note", description: "Restore a deleted note.", inputSchema: { id: z.number().int() } },
    tool(async ({ id }) => get(`/api/notes/${id}/restore`, "POST", {})));

  // ---------- maintenance (Vedlikehold) ----------
  server.registerTool("maintenance_list", { title: "Maintenance items", description: "Vedlikehold: all tracked items (air filters, coffee machine, ...) with interval, last done, next due and status. due_only=true returns only items due soon/overdue.", inputSchema: { due_only: z.boolean().optional() }, annotations: RO },
    tool(async ({ due_only }) => get(due_only ? "/api/maintenance/attention" : "/api/maintenance")));
  server.registerTool("maintenance_history", { title: "Maintenance history", description: "Done-history, for one item (id) or all.", inputSchema: { id: z.number().int().optional() }, annotations: RO },
    tool(async ({ id }) => get(id ? `/api/maintenance/${id}/history` : "/api/maintenance/history")));
  server.registerTool("maintenance_mark_done", { title: "Mark maintenance done", description: "Record that a maintenance item was done now (resets its due date).", inputSchema: { id: z.number().int(), note: z.string().max(300).optional() } },
    tool(async ({ id, note }) => get(`/api/maintenance/${id}/done`, "POST", { note })));
  const mfields = { name: z.string().max(120).optional(), interval_days: z.number().int().min(1).max(3650).optional(), category: z.string().max(60).optional().describe("e.g. Hus, Kjøkken"), last_done: z.string().optional().describe("ISO date or ms; null via edit not supported"), link: z.string().max(500).optional(), notes: z.string().max(2000).optional() };
  server.registerTool("maintenance_upsert", { title: "Add/edit maintenance item", description: "Without id: add a new item (name required; interval default 90 days). With id: edit fields. archive=true archives (removes) the item.", inputSchema: { id: z.number().int().optional(), archive: z.boolean().optional(), ...mfields } },
    tool(async ({ id, archive, interval_days, last_done, ...f }) => {
      const body: Record<string, unknown> = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
      if (interval_days !== undefined) body.intervalDays = interval_days; if (last_done !== undefined) body.lastDone = /^\d+$/.test(last_done) ? Number(last_done) : Date.parse(last_done);
      if (!id) return get("/api/maintenance", "POST", body);
      if (archive) return get(`/api/maintenance/${id}`, "DELETE");
      return get(`/api/maintenance/${id}`, "PATCH", body);
    }));

  // ---------- notifications ----------
  server.registerTool("notifications_list", { title: "Notifications", description: "Home-screen notifications (varsler) with unread count.", inputSchema: { unread_only: z.boolean().optional() }, annotations: RO },
    tool(async ({ unread_only }) => { const d = await get("/api/notifications"); return unread_only ? { unread: d.unread, items: (d.items ?? []).filter((i: any) => !i.read_at) } : d; }));
  server.registerTool("notifications_update", { title: "Mark notification read/dismissed", description: "action read|dismiss for one id, or read_all.", inputSchema: { action: z.enum(["read", "dismiss", "read_all"]), id: z.number().int().optional() } },
    tool(async ({ action, id }) => { if (action === "read_all") return get("/api/notifications/read-all", "POST", {}); if (!id) throw new Error("id mangler"); return get(`/api/notifications/${id}/${action}`, "POST", {}); }));

  // ---------- kids (READ ONLY) ----------
  server.registerTool("kids_overview", { title: "Kids overview", description: "READ ONLY. Barn: each child (kindergarten via MyKid, school via Visma Flyt) with today, week plan, packing list, latest post, school unread/homework/open forms/absence.", inputSchema: {}, annotations: RO },
    tool(async () => get("/api/kids/overview")));
  server.registerTool("kids_calendar", { title: "Kids calendar", description: "READ ONLY. Upcoming kids events (agenda) plus the subscribable .ics feed URL.", inputSchema: {}, annotations: RO },
    tool(async () => ({ ...(await get("/api/kids/agenda")), ics: `${BASE}/api/kids/barn.ics` })));
  server.registerTool("kids_mykid_feed", { title: "MyKid feed", description: "READ ONLY. Kindergarten (MyKid): posts, albums, newsletters, notices, birthdays and the photo list (ids + photo URLs). limit caps each list (default 20).", inputSchema: { limit: z.number().int().min(1).max(200).optional() }, annotations: RO },
    tool(async ({ limit = 20 }) => { const d = await get("/api/kids/feed"); const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(d)) out[k] = Array.isArray(v) ? v.slice(0, limit) : v;
      out.photoTotal = (d.photos ?? []).length; out.photoUrls = take(d.photos, limit).map((p: any) => `${BASE}/api/kids/photo/${p.id}`); return out; }));
  server.registerTool("kids_school", { title: "School (Visma Flyt)", description: "READ ONLY. School data for Kid2: section = messages | notices (beskjeder) | homework (lekser/ukeplan) | absence | forms (skjema/samtykker, view only) | all. Never sends, replies, signs or registers absence.", inputSchema: { section: z.enum(["messages", "notices", "homework", "absence", "forms", "all"]).default("all"), limit: z.number().int().min(1).max(100).optional() }, annotations: RO },
    tool(async ({ section = "all", limit = 15 }) => { const d = await get("/api/kids/skole");
      const base = { child: d.child, syncedAt: d.syncedAt, loginRequired: d.loginRequired, error: d.error };
      const lists: Record<string, string[]> = { messages: ["messages"], notices: ["notices"], homework: ["homework"], absence: ["absence"], forms: ["forms", "consents"] };
      const keys = section === "all" ? Object.keys(d).filter((k) => !(k in base)) : lists[section]!;
      const out: Record<string, unknown> = { ...base };
      for (const k of keys) out[k] = Array.isArray(d[k]) ? d[k].slice(0, limit) : d[k];
      return out; }));

  // ---------- Oda (NO checkout tool exists) ----------
  server.registerTool("oda_cart", { title: "Oda cart", description: "Read the Oda grocery cart (items, quantities, total). Ordering/checkout is impossible via MCP; the owner does it himself in the app.", inputSchema: {}, annotations: RO },
    tool(async () => ({ status: await get("/api/oda/status"), cart: await get("/api/oda/cart") })));
  server.registerTool("oda_search", { title: "Oda product search", description: "Search Oda products (id, name, price, availability).", inputSchema: { query: z.string().min(1).max(100), limit: z.number().int().min(1).max(30).optional() }, annotations: RO },
    tool(async ({ query, limit = 10 }) => ({ products: take((await get(`/api/oda/search?q=${encodeURIComponent(query)}`)).products, limit) })));
  server.registerTool("oda_cart_change", { title: "Add/remove Oda cart item", description: "Add (positive quantity) or remove (negative quantity) a product in the Oda cart. Does NOT order or pay.", inputSchema: { product_id: z.number().int(), quantity: z.number().int().min(-20).max(20).refine((q) => q !== 0) } },
    tool(async ({ product_id, quantity }) => get("/api/oda/cart/items", "POST", { productId: product_id, quantity })));
  server.registerTool("oda_delivery", { title: "Oda delivery slots & orders", description: "READ ONLY. Available delivery slots and recent orders. Slot selection and ordering happen in the app/oda.com.", inputSchema: {}, annotations: RO },
    tool(async () => ({ slots: (await get("/api/oda/slots")).slots, orders: (await get("/api/oda/orders").catch((e) => ({ orders: String(e) }))).orders })));

  // ---------- Lydbøker (Fabel) ----------
  server.registerTool("audiobooks", { title: "Lydbøker (Fabel)", description: "Fabel audiobooks: view = kids (kids series in order + popular kids books) | recent (latest listens, needs Fabel login) | search (query) | book (isbn details) | status.", inputSchema: { view: z.enum(["kids", "recent", "search", "book", "status"]), query: z.string().max(100).optional(), isbn: z.string().max(20).optional(), limit: z.number().int().min(1).max(48).optional() }, annotations: RO },
    tool(async ({ view, query, isbn, limit = 24 }) => {
      if (view === "search") { if (!query) throw new Error("query mangler"); return get(`/api/fabel/search?q=${encodeURIComponent(query)}&n=${limit}`); }
      if (view === "book") { if (!isbn) throw new Error("isbn mangler"); return get(`/api/fabel/book/${isbn.replace(/\D/g, "")}`); }
      return get(`/api/fabel/${view}`);
    }));

  // ---------- Spotify / Sonos ----------
  server.registerTool("media_state", { title: "Playback state", description: "READ ONLY. Spotify/Sonos/TV media players: state, title, artist, volume, source, group members; plus whether Spotify is connected.", inputSchema: {}, annotations: RO },
    tool(async () => { const st = await home.states();
      const players = Object.values(st).filter((e) => e.entity_id.startsWith("media_player.")).map((e) => { const a = e.attributes as Record<string, unknown>;
        return { entity_id: e.entity_id, name: a.friendly_name, state: e.state, title: a.media_title, artist: a.media_artist, album: a.media_album_name, volume: a.volume_level, muted: a.is_volume_muted, source: a.source, app: a.app_name, group: a.group_members }; });
      return { spotify: await get("/api/media/spotify").catch((e) => String(e)), players }; }));
  server.registerTool("media_search", { title: "Search/browse media", description: "READ ONLY. Search (query) or browse (no query; optional media_content_id/type to drill in, e.g. Sonos favorites) on a media player. Returns playable ids for media_play.", inputSchema: { entity_id: z.string().regex(/^media_player\.[a-z0-9_]+$/), query: z.string().max(100).optional(), media_content_id: z.string().optional(), media_content_type: z.string().optional() }, annotations: RO },
    tool(async ({ entity_id, query, media_content_id, media_content_type }) => query
      ? get("/api/media/search", "POST", { entity_id, query, media_content_type })
      : get("/api/media/browse", "POST", { entity_id, media_content_id, media_content_type })));
  server.registerTool("media_play", { title: "Play media (DEVICE ACTUATION)", description: "DEVICE ACTUATION: starts playback on a speaker/TV (audible in the home). Only when the user explicitly asks to play something. Plays a media_content_id from media_search/browse. For pause/next/volume use media_control.", inputSchema: { entity_id: z.string().regex(/^media_player\.[a-z0-9_]+$/), media_content_id: z.string().min(1), media_content_type: z.string().min(1), enqueue: z.enum(["play", "next", "add", "replace"]).optional() }, annotations: { destructiveHint: false, openWorldHint: true } },
    tool(async ({ entity_id, media_content_id, media_content_type, enqueue }) => { const be = await home.backend();
      await be.send({ type: "call_service", domain: "media_player", service: "play_media", service_data: { media_content_id, media_content_type, ...(enqueue ? { enqueue } : {}) }, target: { entity_id } });
      return { called: "media_player.play_media", entity_id, media_content_id }; }));
  server.registerTool("audiobook_cast", { title: "Play audiobook sample (DEVICE ACTUATION)", description: "DEVICE ACTUATION: plays the public Fabel sample of a book (isbn) on a speaker. Only on explicit request.", inputSchema: { entity_id: z.string().regex(/^media_player\.[a-z0-9_]+$/), isbn: z.string().max(20) } },
    tool(async ({ entity_id, isbn }) => get("/api/fabel/cast", "POST", { entity_id, isbn })));

  // ---------- connections / logins (no secrets) ----------
  server.registerTool("logins_status", { title: "Login/connection status", description: "READ ONLY. Every connected service (SmartThings, Spotify, Skole, MyKid, Oda, Fabel, Navimow, ...) with status, expiry and how it renews. Never returns secrets.", inputSchema: {}, annotations: RO },
    tool(async () => { const a = await web("/api/auth/providers"); const c = await get("/api/connections");
      return { connections: c.connections, pending: c.pending, authProviders: a.ok && a.data?.providers ? a.data.providers : undefined }; }));
  server.registerTool("login_start", { title: "Start a login", description: "Returns a deep link that opens the app's login sheet for a service on the owner's device; he completes it there (BankID/SMS/password/OAuth). The MCP never handles credentials.", inputSchema: { id: z.string().regex(/^[a-z]+$/).describe("connection id from logins_status, e.g. skole, mykid, spotify, fabel, navimow") }, annotations: RO },
    tool(async ({ id }) => { const c = await get("/api/connections"); const conn = (c.connections ?? []).find((x: any) => x.id === id);
      if (!conn) throw new Error(`ukjent tilkobling ${id}`);
      return { id, name: conn.name, status: conn.status, link: `${BASE}/#/settings/login/${id}`, message: "Send lenken til eieren – innloggingen fullføres i appen på enheten hans." }; }));

  // ---------- code mode ----------
  server.registerTool("code_changes", { title: "Code changes", description: "READ ONLY. List recent assistant code changes (id omitted) or one change with status, summary, files, diffstat, warnings, diff and log.", inputSchema: { id: z.string().max(40).optional(), diff_max_chars: z.number().int().min(200).max(60000).optional() }, annotations: RO },
    tool(async ({ id, diff_max_chars = 12000 }) => { if (!id) return get("/api/code"); const r = await get(`/api/code/${encodeURIComponent(id)}`);
      if (typeof r.diff === "string" && r.diff.length > diff_max_chars) r.diff = r.diff.slice(0, diff_max_chars) + "\n…(avkortet)"; return r; }));
  server.registerTool("code_request", { title: "Request code change", description: "Ask the code agent to change the Home app's code (Norwegian description). Builds on a separate branch with a preview; Poll with code_changes until status 'ready', then code_apply (or let the owner tap «Ta i bruk»).", inputSchema: { text: z.string().min(5).max(2000) } },
    tool(async ({ text }) => ({ ...(await get("/api/code/request", "POST", { text })), note: "Når status er «ready» kan den tas i bruk med code_apply." })));
  server.registerTool("code_apply", { title: "Apply code change", description: "Take a code change live (status must be 'ready', i.e. passed the protected-file/safety guard, typecheck and build). Merges to main with an automatic rollback tag, rebuilds and restarts; reverts automatically if the build on main fails. Use when the owner asks to apply.", inputSchema: { id: z.string().max(40) } },
    tool(async ({ id }) => get(`/api/code/${encodeURIComponent(id)}/apply`, "POST", {})));
  server.registerTool("code_rollback", { title: "Roll back last code change", description: "Revert the most recently applied code change (git revert of its merge), rebuild and restart.", inputSchema: {}, annotations: { destructiveHint: true } },
    tool(async () => get("/api/code/undo-last", "POST", {})));
  server.registerTool("code_discard", { title: "Discard code change", description: "Throw away a not-yet-applied code change (removes its worktree/preview).", inputSchema: { id: z.string().max(40) }, annotations: { destructiveHint: true } },
    tool(async ({ id }) => get(`/api/code/${encodeURIComponent(id)}/discard`, "POST", {})));

  // ---------- layouts / edit mode ----------
  server.registerTool("dashboard_layouts", { title: "Named layouts & edit-mode", description: "Edit-mode layout ops (recorded with undo via dashboard_undo): save {name} current view as named layout, use {name}, delete {name}, reset {target: main|phone, all}, per_device {enabled} (separate phone layout), set_fields {target: main|phone, fields} (whole layout fields as in dashboard_get). Read current layouts with dashboard_get.", inputSchema: { op: z.enum(["save", "use", "delete", "reset", "per_device", "set_fields"]), name: z.string().max(24).optional(), target: z.enum(["main", "phone"]).optional(), all: z.boolean().optional(), enabled: z.boolean().optional(), fields: z.record(z.unknown()).optional(), summary: z.string().max(300).optional() } },
    tool(async ({ op, name, target, all, enabled, fields, summary }) => {
      const t = target === "phone" ? "phone" : undefined;
      const o = op === "save" ? { op: "layout_save", name } : op === "use" ? { op: "layout_use", name } : op === "delete" ? { op: "layout_delete", name }
        : op === "reset" ? { op: "layout_reset", target: t, all } : op === "per_device" ? { op: "layout_mode", perDevice: enabled === true } : { op: "layout", target: t, fields };
      return get("/api/dashedit/apply", "POST", { ops: [o], summary, source: "assistant" });
    }));
}
