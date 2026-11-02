#!/usr/bin/env node
/**
 * Home MCP server.
 *   home-mcp --stdio            stdio transport (for local clients that spawn the process)
 *   home-mcp                    streamable HTTP on HOME_MCP_BIND:HOME_MCP_PORT/mcp with bearer auth
 * Env: HOME_HA_URL, HOME_HA_TOKEN_FILE, HOME_MCP_TOKEN_FILE, HOME_MCP_BIND (comma list), HOME_MCP_PORT
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { timingSafeEqual, createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { HomeLink } from "./home.js";
import { registerTools } from "./tools.js";
import { registerDashboardTools, registerHvileTools } from "./dashboard.js";
import { registerAppTools } from "./app.js";
import { registerVentilationTools } from "./ventilation.js";

const VERSION = "0.1.0";
const INSTRUCTIONS = "Tools for the owner's home (Home Assistant) and the Home app (notes, Vedlikehold, varsler, Barn read-only, Oda cart without checkout, Lydbøker, media, logins, code mode, fuktstyrt ventilasjon via ventilation_*). Start with home_overview or search to find entity ids; areas are Norwegian/English names (e.g. Kjøkken, TV stue). Control tools return the entity's new state. Locks, alarm panels, valves and garage/gate covers refuse to act unless confirm=true: only set it after the user explicitly confirms.";

const home = new HomeLink();
function makeServer(): McpServer {
  const server = new McpServer({ name: "home", title: "Home (Home Assistant)", version: VERSION }, { instructions: INSTRUCTIONS });
  registerTools(server, home);
  registerDashboardTools(server);
  registerHvileTools(server);
  registerAppTools(server, home);
  registerVentilationTools(server, home);
  return server;
}

const expand = (p: string) => p.replace(/^~/, homedir());

async function stdio() {
  const server = makeServer();
  await server.connect(new StdioServerTransport());
  console.error("[home-mcp] stdio ready");
}

function httpServe() {
  const tokenFile = expand(process.env.HOME_MCP_TOKEN_FILE ?? "~/home-automation/secrets/mcp_token");
  const binds = (process.env.HOME_MCP_BIND ?? "127.0.0.1").split(",").map((s) => s.trim()).filter(Boolean);
  const port = Number(process.env.HOME_MCP_PORT ?? 8125);
  const digest = (s: string) => createHash("sha256").update(s).digest();
  const expected = () => digest(readFileSync(tokenFile, "utf8").trim()); // re-read: rotate without restart
  const authorized = (req: http.IncomingMessage) => {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    return !!m && timingSafeEqual(digest(m[1]!.trim()), expected());
  };
  expected(); // fail fast if the token file is missing

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/healthz") { res.writeHead(200, { "content-type": "text/plain" }).end("ok"); return; }
    if (path !== "/mcp") { res.writeHead(404, { "content-type": "text/plain" }).end("MCP endpoint is /mcp"); return; }
    if (!authorized(req)) {
      res.writeHead(401, { "content-type": "application/json", "www-authenticate": 'Bearer realm="home-mcp"' })
        .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: send Authorization: Bearer <token>" }, id: null }));
      return;
    }
    if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: POST only)" }, id: null })); return; }
    // Stateless: fresh server + transport per request, sharing the one HA connection.
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error("[home-mcp] request error", e);
      if (!res.headersSent) res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Bad request" }, id: null }));
    }
  };
  for (const host of binds) {
    const s = http.createServer((q, r) => void handler(q, r));
    s.on("error", (e) => { console.error(`[home-mcp] listen ${host}:${port} failed: ${e.message}`); process.exit(1); });
    s.listen(port, host, () => console.error(`[home-mcp] streamable HTTP on http://${host}:${port}/mcp`));
  }
  // Warm the HA connection so the first tool call is fast.
  home.states().catch((e) => console.error("[home-mcp] HA not reachable yet:", e instanceof Error ? e.message : e));
}

process.on("SIGTERM", () => { home.close(); process.exit(0); });
if (process.argv.includes("--stdio")) void stdio(); else httpServe();
