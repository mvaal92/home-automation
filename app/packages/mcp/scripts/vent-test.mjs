#!/usr/bin/env node
// Live test of the ventilation_* MCP tools (zone "bad"). Actuates the fan briefly: boost 1 min -> resume auto.
// Curve test writes the current value back (no-op). Leaves the zone in automatic mode.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const TOKEN = readFileSync(process.env.HOME_MCP_TOKEN_FILE ?? "/home/owner/home-automation/secrets/mcp_token", "utf8").trim();
const client = new Client({ name: "vent-test", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_URL ?? "http://127.0.0.1:8125/mcp"), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); const t = r.content?.[0]?.text ?? ""; if (r.isError) throw new Error(`${name}: ${t}`); return JSON.parse(t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("tools:", tools.length, tools.filter((t) => t.startsWith("ventilation")));
const z0 = (await call("ventilation_zones")).zones.find((z) => z.zone === "bad");
console.log("zone:", { mode: z0.mode, humidity: z0.humidity, baseline: z0.baseline, target: z0.target_speed_pct, rpm: z0.rpm, curve: z0.curve });
const c = await call("ventilation_curve", { zone: "bad", min_speed: z0.curve.min_speed });
console.log("curve no-op:", c.changed);
const b = await call("ventilation_boost", { zone: "bad", minutes: 1 }); console.log("boost:", b.override, b.mode, b.target_speed_pct, b.override_ends);
await sleep(25000); console.log("boost rpm after 25 s:", (await call("ventilation_zones")).zones[0].rpm);
const p = await call("ventilation_pause", { zone: "bad", resume: true }); console.log("resume:", p.override, p.auto, p.mode, p.target_speed_pct);
try { await call("ventilation_boost", { zone: "finnesikke" }); console.log("unknown zone: NOT rejected"); } catch (e) { console.log("unknown zone rejected:", e.message.slice(0, 80)); }
await client.close();
