/** Same-origin helpers for the web-server APIs (assistant, Oda, media). Tailscale-only on the server. */
export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await fetch(path, { ...init, method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"), headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body });
  const t = await r.text(); const j = t ? JSON.parse(t) : null;
  if (!r.ok) { const e = new Error(j?.error ?? `HTTP ${r.status}`) as Error & { status?: number; body?: unknown }; e.status = r.status; e.body = j; throw e; }
  return j as T;
}

export type AssistantEvent =
  | { type: "start"; conversationId: string }
  | { type: "status"; text: string; provider: string; reset?: boolean }
  | { type: "delta"; text: string }
  | { type: "action"; tool: string; input: Record<string, unknown>; state: "running" | "done" | "error" | "needs-confirm" }
  | { type: "confirm"; id: string; kind: "mcp" | "oda"; title: string; product?: OdaProduct }
  | { type: "done"; provider: string; ms?: number; text?: string }
  | { type: "prefs" }
  | { type: "code"; id: string }
  | { type: "error"; message: string };

export async function streamAssistant(path: string, body: unknown, onEvent: (e: AssistantEvent) => void, signal?: AbortSignal): Promise<void> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) { onEvent({ type: "error", message: r.status === 403 ? "Assistenten er bare tilgjengelig over Tailscale." : `HTTP ${r.status}` }); return; }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) { try { onEvent(JSON.parse(line)); } catch { /* */ } } }
  }
}

export interface OdaProduct { id: number; name: string; brand?: string; extra?: string; price: number; unitPrice?: string | null; image?: string | null; available?: boolean; url?: string }
export interface OdaCart { count: number; total: number; items: Array<OdaProduct & { quantity: number; total: number }> }
export interface OdaSlot { id: number; start: string; end: string; cutoff: string; price: string; selected: boolean; full: boolean; cheapest: boolean; group: string }

/** HA entity_picture paths are relative to HA; route them through the same-origin proxy. */
export const haImg = (p: unknown): string | undefined => typeof p === "string" && p ? (p.startsWith("/") ? `/ha${p}` : p) : undefined;

export interface BrowseItem { title: string; media_class: string; media_content_id: string; media_content_type: string; can_play: boolean; can_expand: boolean; thumbnail?: string | null; children?: BrowseItem[] }
