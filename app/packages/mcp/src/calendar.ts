import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Kalender tools: family calendar = iCloud (CalDAV) + shared webcal links + local "Hjem" + kids (read-only) + maintenance due dates.
 * Calls home-web /api/calendar (Tailscale-only). Apple credentials never pass through MCP. Deletes require confirm=true.
 * Times are Europe/Oslo wall time: "YYYY-MM-DD" (all-day; end exclusive) or "YYYY-MM-DDTHH:MM".
 */
const tsBind = (process.env.HOME_MCP_BIND ?? "").split(",").map((x) => x.trim()).find((x) => x && !/^(127\.|::1$|localhost$)/.test(x));
const BASE = process.env.HOME_WEB_URL ?? (tsBind ? `http://${tsBind}:8124` : "http://127.0.0.1:8124");
const RO = { readOnlyHint: true } as const;
async function call(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`${BASE}/api/calendar${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const t = await r.text(); let d: any; try { d = JSON.parse(t); } catch { d = { error: t.slice(0, 200) }; }
  if (!r.ok) throw new Error(`${r.status}: ${d?.error ?? "feil"}`); return d;
}
const tool = (fn: (a: any) => Promise<unknown>) => async (a: any): Promise<CallToolResult> => {
  try { return { content: [{ type: "text", text: JSON.stringify(await fn(a), null, 1) }] }; } catch (e) { return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] }; }
};
const when = z.string().regex(/^\d{4}-\d\d-\d\d(T\d\d:\d\d)?$/, "YYYY-MM-DD or YYYY-MM-DDTHH:MM (Europe/Oslo)");
const slim = (e: any) => ({ id: e.id, calendar: e.calendar, calendarName: e.calendarName, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location ?? undefined, desc: e.desc ? String(e.desc).slice(0, 300) : undefined, writable: e.writable, recurring: e.recurring || undefined });

export function registerCalendarTools(server: McpServer): void {
  server.registerTool("calendar_list", { title: "List calendars", description: "Kalender: all calendars (iCloud, shared webcal links, local 'Hjem', Barn (read-only), Vedlikehold (read-only)) with id, color, visible, writable, last sync, and the iCloud connection status. The default calendar for new events is defaultCalendar.", inputSchema: {}, annotations: RO },
    tool(async () => call("/calendars")));
  server.registerTool("calendar_events", { title: "Calendar events", description: "Events between from and to (dates, Europe/Oslo; to exclusive; default: last 7 days to +6 weeks). Only visible calendars unless include_hidden. Optionally filter by calendar ids.", inputSchema: { from: when.optional(), to: when.optional(), calendars: z.array(z.string()).optional(), include_hidden: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional() }, annotations: RO },
    tool(async ({ from, to, calendars, include_hidden, limit }) => { const q = new URLSearchParams(); if (from) q.set("from", from.slice(0, 10)); if (to) q.set("to", to.slice(0, 10)); if (calendars?.length) q.set("calendars", calendars.join(",")); if (include_hidden) q.set("all", "1");
      const d = await call(`/events?${q}`); const ev = (d.events ?? []).map(slim); return { count: ev.length, events: ev.slice(0, limit ?? 150) }; }));
  server.registerTool("calendar_create_event", { title: "Create calendar event", description: "Create an event. calendar = a writable calendar id from calendar_list (default: the default iCloud calendar, else local 'Hjem'). start/end Europe/Oslo; all_day events use dates and end is exclusive (defaults to 1 hour / 1 day).", inputSchema: { title: z.string().min(1).max(200), start: when, end: when.optional(), all_day: z.boolean().optional(), calendar: z.string().optional(), location: z.string().max(300).optional(), notes: z.string().max(2000).optional() } },
    tool(async ({ title, start, end, all_day, calendar, location, notes }) => call("/events", "POST", { title, start, end, allDay: all_day ?? start.length === 10, calendar, location, desc: notes })));
  server.registerTool("calendar_update_event", { title: "Update calendar event", description: "Change an event (id from calendar_events). Only writable calendars (iCloud/Hjem). Editing a recurring iCloud event changes the whole series.", inputSchema: { id: z.string().min(4), title: z.string().max(200).optional(), start: when.optional(), end: when.optional(), all_day: z.boolean().optional(), location: z.string().max(300).nullable().optional(), notes: z.string().max(2000).nullable().optional() } },
    tool(async ({ id, all_day, notes, ...b }) => call(`/events/${encodeURIComponent(id)}`, "PATCH", { ...b, ...(all_day !== undefined ? { allDay: all_day } : {}), ...(notes !== undefined ? { desc: notes } : {}) })));
  server.registerTool("calendar_delete_event", { title: "Delete calendar event", description: "Delete an event (whole series if recurring). Requires confirm=true – first tell the user exactly which event will be deleted and get their OK.", inputSchema: { id: z.string().min(4), confirm: z.boolean() }, annotations: { destructiveHint: true } },
    tool(async ({ id, confirm }) => { if (confirm !== true) throw new Error("Sletting krever confirm=true etter at brukeren har bekreftet."); return call(`/events/${encodeURIComponent(id)}`, "DELETE", { confirm: true }); }));
  server.registerTool("calendar_sync", { title: "Sync calendars", description: "Sync iCloud and shared calendars now (normally every 10 min).", inputSchema: {} },
    tool(async () => call("/sync", "POST", {})));
}
