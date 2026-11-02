import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Dashboard-layout tools. They call the Home web server's /api/dashedit (Tailscale-only; reached on the
 * Tailscale address so the server's trusted-local check passes). Every apply is recorded in home.db
 * (prefs_history) and can be undone. These tools never touch devices.
 */
const tsBind = (process.env.HOME_MCP_BIND ?? "").split(",").map((x) => x.trim()).find((x) => x && !/^(127\.|::1$|localhost$)/.test(x));
const BASE = process.env.HOME_WEB_URL ?? (tsBind ? `http://${tsBind}:8124` : "http://127.0.0.1:8124");
const ok = (data: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }] });
const fail = (msg: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: msg }] });

async function call(path: string, body?: unknown): Promise<CallToolResult> {
  try {
    const r = await fetch(`${BASE}/api/dashedit${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return r.ok ? ok(j) : fail(String((j as { error?: string }).error ?? r.status));
  } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
}

const op = z.object({
  op: z.enum(["pin", "unpin", "set_pinned", "card_order", "card_visible", "collapse", "tab_visible", "nav", "theme", "sidebar", "luft_pinned", "note_add"]),
  entity_id: z.string().optional().describe("pin/unpin: light.*, script.* or scene.*"),
  position: z.number().int().optional().describe("pin: 0-based position (default last)"),
  kind: z.enum(["lights", "routines"]).optional().describe("set_pinned"),
  entity_ids: z.array(z.string()).optional().describe("set_pinned: full ordered list"),
  order: z.array(z.string()).optional().describe("card_order: Home card ids in order; missing cards keep their default order after"),
  card: z.string().optional().describe("card_visible: Home card id"),
  visible: z.boolean().optional(),
  section: z.string().optional().describe("collapse: section id (scenes, widgets, cameras, rooms, active, pinned)"),
  collapsed: z.boolean().optional(),
  tab: z.string().optional().describe("tab_visible: navigation tab id"),
  mode: z.enum(["klassisk", "flyt"]).optional().describe("nav"),
  theme: z.enum(["system", "dark", "light"]).optional(),
  sidebar: z.enum(["full", "rail"]).optional(),
  pinned: z.boolean().optional().describe("luft_pinned / note_add"),
  text: z.string().optional().describe("note_add"),
});

export function registerDashboardTools(server: McpServer): void {
  server.registerTool("dashboard_get", {
    title: "Read dashboard layout",
    description: "Current Home-app dashboard prefs: pinnedRoutines, pinnedLights, homeOrder (card order), hiddenCards, hiddenTabs, collapsed, nav (klassisk|flyt), theme, sidebar, plus the valid card ids, tab ids and the last 10 layout changes. Read before changing the layout.",
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, async () => call(""));

  server.registerTool("dashboard_apply", {
    title: "Change dashboard layout",
    description: "Change the Home-app dashboard instantly (all devices pick it up). Ops: pin/unpin {entity_id} (light/script/scene to the pinned row at the top), set_pinned {kind, entity_ids}, card_order {order}, card_visible {card, visible}, collapse {section, collapsed}, tab_visible {tab, visible}, nav {mode}, theme {theme}, sidebar {sidebar}, luft_pinned {pinned}, note_add {text, pinned}. Recorded with undo (dashboard_undo). Never controls devices.",
    inputSchema: { ops: z.array(op).min(1).max(20), summary: z.string().max(300).optional().describe("Short Norwegian description, shown in the undo history") },
  }, async ({ ops, summary }) => call("/apply", { ops, summary, source: "assistant" }));

  server.registerTool("dashboard_undo", {
    title: "Undo last dashboard change",
    description: "Revert the most recent dashboard layout change (from the history in home.db).",
    inputSchema: {},
  }, async () => call("/undo", {}));
}

async function ambient(path: string, method: "GET" | "PUT" | "POST", body?: unknown): Promise<CallToolResult> {
  try {
    const r = await fetch(`${BASE}/api/ambient${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return r.ok ? ok(j) : fail(String((j as { error?: string }).error ?? r.status));
  } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
}

/** Hvileskjerm (resting/ambient art screen) – display only, never touches devices. */
export function registerHvileTools(server: McpServer): void {
  server.registerTool("hvileskjerm_get", {
    title: "Hvileskjerm settings",
    description: "Read the Home-app resting screen (Hvileskjerm) settings: timeoutMin (0 = off), mode art|gradient|photos, collections (nordisk, munch, rolig), nightDim (23–06 clock only), phone, per-device overrides (devices{id:{timeoutMin,mode,label}}), and the cached artwork list.",
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, async () => {
    const [s, a] = await Promise.all([ambient("/settings", "GET"), ambient("/art", "GET")]);
    if (s.isError) return s;
    const art = a.isError ? null : JSON.parse((a.content[0] as { text: string }).text) as { items: { id: string; title: string; artist: string; year: string; group: string }[] };
    return ok({ settings: JSON.parse((s.content[0] as { text: string }).text), artworks: art?.items.map((x) => `${x.id} ${x.title} – ${x.artist} ${x.year} [${x.group}]`) });
  });
  server.registerTool("hvileskjerm_set", {
    title: "Change Hvileskjerm settings",
    description: "Change the resting screen settings for all devices (or one device via devices{<deviceId>:{timeoutMin, mode}}). Applies live on every open Home app.",
    inputSchema: {
      timeoutMin: z.number().int().min(0).max(240).optional().describe("Minutes idle before it starts; 0 = off"),
      mode: z.enum(["art", "gradient", "photos"]).optional().describe("art = public-domain paintings, gradient = time-of-day colours only, photos = MyKid kindergarten photos"),
      collections: z.array(z.enum(["nordisk", "munch", "rolig"])).min(1).optional(),
      nightDim: z.boolean().optional(), phone: z.boolean().optional().describe("also use on phones"),
      intervalMin: z.number().int().min(1).max(60).optional().describe("minutes per artwork (default 5)"),
      devices: z.record(z.string(), z.object({ timeoutMin: z.number().int().min(0).max(240).nullable().optional(), mode: z.enum(["art", "gradient", "photos"]).nullable().optional() })).optional(),
    },
  }, async (args) => ambient("/settings", "PUT", args));
  server.registerTool("hvileskjerm_start", {
    title: "Start/stop Hvileskjerm",
    description: "Show (action start) or dismiss (action stop) the resting screen now on all open Home apps, or one device id. Optional mode for this session. Display only.",
    inputSchema: { action: z.enum(["start", "stop"]).default("start"), device: z.string().max(40).optional(), mode: z.enum(["art", "gradient", "photos"]).optional() },
  }, async ({ action, device, mode }) => ambient(`/${action}`, "POST", { device, mode }));
}
