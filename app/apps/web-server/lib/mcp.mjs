// Minimal streamable-HTTP JSON-RPC client for the home MCP server (stateless calls).
import { secret } from "./util.mjs";
const URL_ = process.env.HOME_MCP_URL ?? "http://127.0.0.1:8125/mcp";
let session = null, nextId = 1;
async function rpc(method, params, notify = false) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${secret("mcp_token")}` };
  if (session) headers["mcp-session-id"] = session;
  const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: nextId++, method, params };
  const r = await fetch(URL_, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const sid = r.headers.get("mcp-session-id"); if (sid) session = sid;
  if (notify) return null;
  const text = await r.text();
  if (!r.ok) throw new Error(`MCP ${r.status}: ${text.slice(0, 200)}`);
  const json = text.trim().startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5));
  if (json.error) throw new Error(json.error.message);
  return json.result;
}
let inited = null;
async function init() {
  if (!inited) inited = (async () => {
    session = null;
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "home-web", version: "1" } });
    await rpc("notifications/initialized", {}, true);
  })().catch((e) => { inited = null; throw e; });
  return inited;
}
export async function mcpCall(name, args) {
  await init();
  try { return await rpc("tools/call", { name, arguments: args }); }
  catch (e) { inited = null; await init(); return rpc("tools/call", { name, arguments: args }); }
}
export async function mcpTools() { await init(); return (await rpc("tools/list", {})).tools; }
