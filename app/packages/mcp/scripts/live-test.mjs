#!/usr/bin/env node
// Live end-to-end test of every MCP tool against the real Home Assistant, over the
// real HTTP endpoint with bearer auth. Leaves devices as found:
//  - lights: one OFF WiZ bulb is turned on briefly and turned off again
//  - other tools use no-op values (same state as current) or temporary HA objects
//    (automation/script/scene) that are deleted at the end.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ = process.env.MCP_URL ?? "http://127.0.0.1:8125/mcp";
const TOKEN = readFileSync(process.env.HOME_MCP_TOKEN_FILE ?? "/home/owner/home-automation/secrets/mcp_token", "utf8").trim();
const HA = "http://127.0.0.1:8123";
const HA_TOKEN = readFileSync("/home/owner/home-automation/secrets/ha_token", "utf8").trim();
const ha = (p, init = {}) => fetch(HA + p, { ...init, headers: { authorization: `Bearer ${HA_TOKEN}`, "content-type": "application/json" } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let client;
async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { error: !!r.isError, data, text };
}
async function check(label, fn) {
  try { const note = await fn(); results.push([label, "PASS", note ?? ""]); }
  catch (e) { results.push([label, "FAIL", e.message]); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// 0) auth is enforced
const unauth = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
results.push(["auth: no token -> 401", unauth.status === 401 ? "PASS" : "FAIL", String(unauth.status)]);
const bad = await fetch(URL_, { method: "POST", headers: { authorization: "Bearer nope", "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
results.push(["auth: wrong token -> 401", bad.status === 401 ? "PASS" : "FAIL", String(bad.status)]);

client = new Client({ name: "live-test", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
const tools = (await client.listTools()).tools.map((t) => t.name);
results.push(["tools/list", "PASS", `${tools.length} tools: ${tools.join(", ")}`]);

// Temporary HA objects for automation / script / scene tests
const TMP = `mcp_live_test_${Date.now()}`;
await ha(`/api/config/automation/config/${TMP}`, { method: "POST", body: JSON.stringify({ alias: "MCP live test (temporary)", triggers: [], conditions: [], actions: [{ delay: 0 }], mode: "single" }) });
await ha(`/api/config/script/config/${TMP}`, { method: "POST", body: JSON.stringify({ alias: "MCP live test (temporary)", sequence: [{ delay: 0 }], mode: "single" }) });
await sleep(1500);

try {
  await check("home_overview", async () => { const r = await call("home_overview"); assert(!r.error && r.data.entity_count > 0, r.text); return `${r.data.entity_count} entities, ${r.data.rooms.length} rooms, ${r.data.active.length} active, ${r.data.health_issues.length} health issues`; });
  await check("list_areas", async () => { const r = await call("list_areas"); assert(!r.error && r.data.length > 0, r.text); return `${r.data.length} areas: ${r.data.map((a) => a.name).join(", ")}`; });
  await check("list_devices", async () => { const r = await call("list_devices", { query: "wiz" }); assert(!r.error && r.data.count > 0, r.text); return `${r.data.count} WiZ devices`; });
  await check("list_entities (domain)", async () => { const r = await call("list_entities", { domain: "light" }); assert(!r.error && r.data.count === 9, r.text); return `${r.data.count} lights`; });
  await check("list_entities (area)", async () => { const r = await call("list_entities", { area: "kjokken" }); assert(!r.error, r.text); return `${r.data.count} entities in Kjøkken`; });
  await check("search", async () => { const r = await call("search", { query: "flexit" }); assert(!r.error && r.data.entities.length > 0, r.text); return `${r.data.total_entities} entities, ${r.data.devices.length} devices`; });
  await check("get_state", async () => { const r = await call("get_state", { entity_id: "fan.flexit_fan" }); assert(!r.error && r.data[0].state, r.text); return `fan.flexit_fan=${r.data[0].state}`; });
  const sensor = (await call("list_entities", { domain: "sensor", limit: 50 })).data.entities.find((e) => e.unit && !Number.isNaN(Number(e.state)));
  await check("get_history", async () => { const r = await call("get_history", { entity_id: sensor.entity_id, hours: 24 }); assert(!r.error && r.data[sensor.entity_id], r.text); return `${sensor.entity_id}: ${r.data[sensor.entity_id].changes} changes`; });

  // set_light: pick an OFF WiZ bulb, turn it on briefly, then restore off
  const lights = (await call("list_entities", { domain: "light" })).data.entities;
  const bulb = lights.find((l) => l.state === "off") ?? lights[0];
  const prior = (await call("get_state", { entity_id: bulb.entity_id })).data[0];
  await check(`set_light on 30% (${bulb.entity_id})`, async () => { const r = await call("set_light", { entity_id: bulb.entity_id, brightness_pct: 30 }); assert(!r.error && r.data.entities[0].state === "on", r.text); return `now ${r.data.entities[0].state} ${r.data.entities[0].brightness_pct}% settled=${r.data.settled}`; });
  await sleep(1500);
  await check("set_light brightness 60%", async () => { const r = await call("set_light", { entity_id: bulb.entity_id, brightness_pct: 60 }); assert(!r.error && Math.abs(r.data.entities[0].brightness_pct - 60) <= 2, r.text); return `${r.data.entities[0].brightness_pct}%`; });
  await sleep(1000);
  await check("set_light restore", async () => {
    const r = prior.state === "off" ? await call("set_light", { entity_id: bulb.entity_id, state: "off" }) : await call("set_light", { entity_id: bulb.entity_id, brightness_pct: Math.round(prior.attributes.brightness / 2.55) });
    assert(!r.error && r.data.entities[0].state === prior.state, r.text); return `restored to ${r.data.entities[0].state}`;
  });

  // set_switch: no-op (set to its current state)
  const sw = (await call("get_state", { entity_id: "switch.kjokken_kjokken_crossfade" })).data[0];
  await check("set_switch (no-op, same state)", async () => { const r = await call("set_switch", { entity_id: sw.entity_id, state: sw.state }); assert(!r.error && r.data.entities[0].state === sw.state, r.text); return `${sw.entity_id} stays ${sw.state}`; });

  // set_fan: no-op (current preset)
  const fan = (await call("get_state", { entity_id: "fan.flexit_fan" })).data[0];
  await check("set_fan (no-op, current preset)", async () => {
    const r = await call("set_fan", { entity_id: fan.entity_id, preset_mode: fan.attributes.preset_mode }); assert(!r.error, r.text);
    const now = (await call("get_state", { entity_id: fan.entity_id })).data[0];
    if (now.attributes.percentage !== fan.attributes.percentage) await call("set_fan", { entity_id: fan.entity_id, percentage: fan.attributes.percentage });
    return `preset ${now.attributes.preset_mode}, percentage ${fan.attributes.percentage}->${now.attributes.percentage}`;
  });

  // media_control: volume_set to current volume (no-op)
  const mp = (await call("get_state", { entity_id: "media_player.kjokken_kjokken" })).data[0];
  await check("media_control volume_set (no-op)", async () => { const v = mp.attributes.volume_level; const r = await call("media_control", { entity_id: mp.entity_id, action: "volume_set", volume: v }); assert(!r.error, r.text); return `volume stays ${v}`; });

  // Domains with no live devices: validation path must reject cleanly
  await check("set_climate (no climate entities -> clean error)", async () => { const r = await call("set_climate", { entity_id: "climate.none", temperature: 21 }); assert(r.error && /Unknown entity/.test(r.text), r.text); return r.text; });
  await check("set_cover (no covers -> clean error)", async () => { const r = await call("set_cover", { entity_id: "cover.none", action: "open" }); assert(r.error, r.text); return r.text; });
  await check("vacuum_control (no vacuum -> clean error)", async () => { const r = await call("vacuum_control", { entity_id: "vacuum.none", action: "start" }); assert(r.error, r.text); return r.text; });
  await check("set_light wrong domain rejected", async () => { const r = await call("set_light", { entity_id: "fan.flexit_fan", state: "off" }); assert(r.error && /not a light/.test(r.text), r.text); return r.text; });

  // Safety guards
  await check("guard: lock without confirm refused", async () => { const r = await call("call_service", { domain: "lock", service: "unlock", entity_id: "lock.front_door" }); assert(r.error && /confirm=true/.test(r.text), r.text); return "refused"; });
  await check("guard: alarm via area target refused", async () => { const r = await call("call_service", { domain: "alarm_control_panel", service: "alarm_disarm", area_id: "kjokken" }); assert(r.error && /confirm=true/.test(r.text), r.text); return "refused"; });

  // run_scene: temporary dynamic scene snapshotting the (restored) bulb -> no-op
  await ha("/api/services/scene/create", { method: "POST", body: JSON.stringify({ scene_id: TMP, snapshot_entities: [bulb.entity_id] }) });
  await sleep(800);
  await check("run_scene (temp snapshot scene)", async () => { const r = await call("run_scene", { entity_id: `scene.${TMP}` }); assert(!r.error, r.text); const s = (await call("get_state", { entity_id: bulb.entity_id })).data[0].state; assert(s === prior.state, `bulb changed to ${s}`); return `bulb still ${s}`; });

  await check("run_script (temp no-op script)", async () => { const r = await call("run_script", { entity_id: `script.${TMP}` }); assert(!r.error, r.text); return "ran"; });
  await check("list_automations", async () => { const r = await call("list_automations", { query: "mcp live test" }); assert(!r.error && r.data.length === 1, r.text); return `${r.data[0].entity_id} enabled=${r.data[0].enabled}`; });
  const autoId = (await call("list_automations", { query: "mcp live test" })).data[0]?.entity_id;
  await check("trigger_automation", async () => { const r = await call("trigger_automation", { entity_id: autoId }); assert(!r.error, r.text); return "triggered"; });
  await check("toggle_automation off/on", async () => {
    const a = await call("toggle_automation", { entity_id: autoId, enabled: false }); assert(!a.error && a.data.entities[0].state === "off", a.text);
    const b = await call("toggle_automation", { entity_id: autoId, enabled: true }); assert(!b.error && b.data.entities[0].state === "on", b.text); return "off -> on";
  });
  await check("call_service (no-op light.turn_off on off bulb)", async () => { const r = await call("call_service", { domain: "light", service: "turn_off", entity_id: bulb.entity_id }); assert(!r.error && r.data.entities[0].state === "off", r.text); return "ok"; });
  await check("call_service return_response (weather.get_forecasts)", async () => {
    const w = (await call("list_entities", { domain: "weather" })).data.entities[0];
    const r = await call("call_service", { domain: "weather", service: "get_forecasts", entity_id: w.entity_id, data: { type: "hourly" }, return_response: true });
    assert(!r.error && r.data.response?.[w.entity_id]?.forecast?.length > 0, r.text); return `${r.data.response[w.entity_id].forecast.length} hourly forecast rows`;
  });
} finally {
  await ha("/api/services/scene/delete", { method: "POST", body: JSON.stringify({ entity_id: `scene.${TMP}` }) }).catch(() => {});
  await ha(`/api/config/automation/config/${TMP}`, { method: "DELETE" });
  await ha(`/api/config/script/config/${TMP}`, { method: "DELETE" });
  await client.close();
}

const w = Math.max(...results.map((r) => r[0].length));
for (const [l, s, n] of results) console.log(`${s === "PASS" ? "✔" : "✘"} ${l.padEnd(w)}  ${String(n).slice(0, 160)}`);
const failed = results.filter((r) => r[1] !== "PASS").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
