#!/usr/bin/env node
// Live test of the app tools (read paths + note/maintenance write paths with cleanup). No device actuation, no Oda cart changes, no code apply.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const TOKEN = readFileSync("/home/owner/home-automation/secrets/mcp_token", "utf8").trim();
const c = new Client({ name: "app-test", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_URL ?? "http://127.0.0.1:8125/mcp"), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
const tools = (await c.listTools()).tools.map((t) => t.name); console.log("TOOLS", tools.length, tools.join(" "));
const R = [];
async function t(label, name, args = {}, chk = () => true) { try { const r = await c.callTool({ name, arguments: args }); const txt = r.content?.[0]?.text ?? ""; let d; try { d = JSON.parse(txt); } catch { d = txt; }
  const pass = !r.isError && chk(d); R.push([label, pass ? "PASS" : (r.isError ? "ERR" : "FAIL"), (r.isError ? txt : JSON.stringify(d)).slice(0, 140)]); return d; } catch (e) { R.push([label, "EXC", e.message]); } }
await t("notes_list", "notes_list", {}, (d) => Array.isArray(d.notes));
const n = await t("notes_create", "notes_create", { text: "MCP-test (slettes)" }, (d) => d.id);
if (n?.id) { await t("notes_update", "notes_update", { id: n.id, text: "MCP-test 2", pinned: true }, (d) => d.text === "MCP-test 2"); await t("notes_delete", "notes_delete", { id: n.id }, (d) => d.ok); }
await t("maintenance_list", "maintenance_list", {}, (d) => Array.isArray(d.items));
await t("maintenance_due", "maintenance_list", { due_only: true }, (d) => Array.isArray(d.items));
await t("maintenance_history", "maintenance_history", {}, (d) => Array.isArray(d.history));
const m = await t("maintenance_add", "maintenance_upsert", { name: "MCP-test (slettes)", interval_days: 30, category: "Test" }, (d) => d.id);
if (m?.id) { await t("maintenance_edit", "maintenance_upsert", { id: m.id, interval_days: 45 }, (d) => d.intervalDays === 45);
  await t("maintenance_mark_done", "maintenance_mark_done", { id: m.id, note: "test" }, (d) => !!d.lastDone);
  await t("maintenance_archive", "maintenance_upsert", { id: m.id, archive: true }, (d) => d.ok); }
await t("notifications_list", "notifications_list", { unread_only: true }, (d) => typeof d.unread === "number");
await t("kids_overview", "kids_overview", {}, (d) => Array.isArray(d.children));
await t("kids_calendar", "kids_calendar", {}, (d) => Array.isArray(d.events));
await t("kids_mykid_feed", "kids_mykid_feed", { limit: 3 }, (d) => Array.isArray(d.posts));
for (const s of ["messages", "notices", "homework", "absence", "forms"]) await t(`kids_school ${s}`, "kids_school", { section: s, limit: 2 }, (d) => d.child || d.loginRequired);
await t("oda_cart", "oda_cart", {}, (d) => d.cart);
await t("oda_search", "oda_search", { query: "melk", limit: 3 }, (d) => d.products?.length > 0);
await t("oda_delivery", "oda_delivery", {}, (d) => Array.isArray(d.slots));
for (const v of ["status", "kids", "recent"]) await t(`audiobooks ${v}`, "audiobooks", { view: v });
await t("audiobooks search", "audiobooks", { view: "search", query: "Pondus", limit: 3 });
await t("media_state", "media_state", {}, (d) => Array.isArray(d.players));
const st = await c.callTool({ name: "media_state", arguments: {} }); const sonos = JSON.parse(st.content[0].text).players.find((p) => /kjokken_kjokken|sonos/.test(p.entity_id))?.entity_id;
if (sonos) await t(`media_search browse ${sonos}`, "media_search", { entity_id: sonos });
await t("logins_status", "logins_status", {}, (d) => Array.isArray(d.connections));
await t("login_start skole", "login_start", { id: "skole" }, (d) => /#\/settings\/login\/skole$/.test(d.link));
await t("code_changes list", "code_changes", {}, (d) => Array.isArray(d.changes));
await t("dashboard_get", "dashboard_get", {}, (d) => !!d);
for (const r of R) console.log(r.join(" | "));
await c.close();
