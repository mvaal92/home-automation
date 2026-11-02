import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { domainOf, friendlyName, homeMode, isOn, num, quickActions, visibleStates, type EntityMap, type EntityState } from "@home/core";
import { HomeLink, norm } from "./home.js";
import { ConfirmationRequired, isGuarded } from "./safety.js";

type Json = unknown;
const ok = (data: Json): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }] });
const fail = (msg: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: msg }] });

const ids = z.union([z.string(), z.array(z.string())]).describe("Entity id or list of entity ids, e.g. light.kitchen");
const confirm = z.boolean().optional().describe("Must be true to act on locks, alarm panels, valves or garage/gate covers. Only set it after the user explicitly confirmed.");

/** Compact, model-friendly view of an entity. */
function brief(e: EntityState, area?: string | null) {
  const a = e.attributes;
  const out: Record<string, unknown> = { entity_id: e.entity_id, name: friendlyName(e), state: e.state };
  if (area) out.area = area;
  if (a.unit_of_measurement) out.unit = a.unit_of_measurement;
  if (a.device_class) out.device_class = a.device_class;
  const d = domainOf(e.entity_id);
  if (d === "light" && e.state === "on") {
    if (num(a.brightness) !== undefined) out.brightness_pct = Math.round((num(a.brightness)! / 255) * 100);
    if (a.color_temp_kelvin) out.color_temp_kelvin = a.color_temp_kelvin;
    if (a.rgb_color && a.color_mode !== "color_temp") out.rgb_color = a.rgb_color;
  }
  if (d === "climate") Object.assign(out, pick(a, ["current_temperature", "temperature", "hvac_action", "preset_mode", "fan_mode"]));
  if (d === "fan") Object.assign(out, pick(a, ["percentage", "preset_mode"]));
  if (d === "media_player") Object.assign(out, pick(a, ["media_title", "media_artist", "source", "volume_level", "is_volume_muted"]));
  if (d === "cover") Object.assign(out, pick(a, ["current_position"]));
  if (d === "vacuum") Object.assign(out, pick(a, ["battery_level", "fan_speed"]));
  return out;
}
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));
const asList = (v: string | string[]) => (Array.isArray(v) ? v : [v]);

export function registerTools(server: McpServer, home: HomeLink): void {
  const areaName = async () => {
    const reg = await home.registries();
    const names = new Map(reg.areas.map((a) => [a.area_id, a.name]));
    const idx = await home.areaIndex();
    return (id: string) => { const a = idx.get(id); return a ? names.get(a) ?? a : null; };
  };

  /** Resolve entity ids (validated to exist and to be of `domains`) or every matching entity in an area. */
  async function resolve(domains: string[], entity_id?: string | string[], area?: string): Promise<string[]> {
    const st = await home.states();
    let list: string[] = [];
    if (entity_id) list = asList(entity_id);
    else if (area) {
      const a = await home.findArea(area);
      if (!a) throw new Error(`No area matches "${area}". Use list_areas.`);
      const idx = await home.areaIndex();
      list = Object.keys(st).filter((id) => idx.get(id) === a.area_id && domains.includes(domainOf(id)));
      if (!list.length) throw new Error(`Area "${a.name}" has no ${domains.join("/")} entities.`);
    } else throw new Error("Provide entity_id or area.");
    for (const id of list) {
      if (!st[id]) throw new Error(`Unknown entity ${id}. Use search or list_entities.`);
      if (!domains.includes(domainOf(id))) throw new Error(`${id} is not a ${domains.join("/")} entity.`);
    }
    return list;
  }

  function guard(list: string[], st: EntityMap, confirmed?: boolean) {
    const g = list.filter((id) => isGuarded(st[id], id));
    if (g.length && confirmed !== true) throw new ConfirmationRequired(g);
  }

  /** Call a service, then wait briefly for the targets to reflect `expect` and report their new state. */
  async function act(domain: string, service: string, list: string[], data: Record<string, unknown> = {}, expect?: (e: EntityState) => boolean): Promise<CallToolResult> {
    const be = await home.backend();
    const before = await home.states();
    const prev = Object.fromEntries(list.map((id) => [id, before[id]?.last_updated]));
    await be.send({ type: "call_service", domain, service, service_data: data, target: { entity_id: list } });
    const settled = await home.waitFor((st) => list.every((id) => { const e = st[id]; return !!e && (expect ? expect(e) : e.last_updated !== prev[id]); }), 4000);
    const st = await home.states();
    return ok({ called: `${domain}.${service}`, data, settled, entities: list.map((id) => (st[id] ? brief(st[id]) : { entity_id: id, state: "missing" })) });
  }

  const wrap = <A>(fn: (a: A) => Promise<CallToolResult>) => async (a: A): Promise<CallToolResult> => {
    try { return await fn(a); } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  };

  // ---------- read ----------
  server.registerTool("home_overview", {
    title: "Home overview",
    description: "Summary of the whole home: rooms with temperature/humidity and what is on, active devices, entity counts per domain, and health issues (unavailable devices, low batteries). Start here.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, wrap(async () => {
    const st = await home.states();
    const all = Object.values(st);
    const byDomain: Record<string, number> = {};
    for (const e of all) byDomain[domainOf(e.entity_id)] = (byDomain[domainOf(e.entity_id)] ?? 0) + 1;
    const rooms = (await home.rooms()).filter((r) => r.controls.length + r.sensors.length > 0).map((r) => ({
      area: r.name, area_id: r.id, temperature: r.temperature, humidity: r.humidity, lights_on: r.lightsOn,
      on: r.controls.filter((c) => isOn(st[c.id])).map((c) => c.id), controls: r.controls.length, sensors: r.sensors.length,
    }));
    // Hidden twins (e.g. SmartThings copies of local WiZ bulbs) and config/diagnostic entities are left out.
    const visible = Object.values(visibleStates(await home.registries(), st));
    const active = visible.filter((e) => ["light", "switch", "fan", "media_player", "vacuum", "climate", "cover"].includes(domainOf(e.entity_id)) && isOn(e)).map((e) => brief(e));
    const health = await home.health();
    const mode = homeMode(st);
    return ok({ entity_count: all.length, home_mode: mode?.current, scenes_and_routines: quickActions(st, await home.registries()).map((q) => ({ entity_id: q.id, name: q.name, kind: q.kind })), by_domain: byDomain, rooms, active, unavailable: all.filter((e) => e.state === "unavailable").length, health_issues: health.slice(0, 30) });
  }));

  server.registerTool("list_areas", {
    title: "List areas", description: "All Home Assistant areas (rooms) with how many devices/entities each has.", inputSchema: {}, annotations: { readOnlyHint: true },
  }, wrap(async () => {
    const reg = await home.registries(true);
    const idx = await home.areaIndex();
    const counts = new Map<string, number>();
    for (const a of idx.values()) if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
    return ok(reg.areas.map((a) => ({ area_id: a.area_id, name: a.name, floor_id: a.floor_id ?? null, entities: counts.get(a.area_id) ?? 0, devices: reg.devices.filter((d) => d.area_id === a.area_id).length })));
  }));

  server.registerTool("list_devices", {
    title: "List devices", description: "Devices from the device registry, optionally filtered by area (name or id) or a text query on name/manufacturer/model. Includes each device's entity ids.",
    inputSchema: { area: z.string().optional(), query: z.string().optional(), limit: z.number().int().min(1).max(500).optional() }, annotations: { readOnlyHint: true },
  }, wrap(async ({ area, query, limit }) => {
    const reg = await home.registries();
    const a = area ? await home.findArea(area) : undefined;
    if (area && !a) return fail(`No area matches "${area}".`);
    const names = new Map(reg.areas.map((x) => [x.area_id, x.name]));
    const q = query ? norm(query) : "";
    const out = reg.devices
      .filter((d) => !a || d.area_id === a.area_id)
      .filter((d) => !q || norm(`${d.name_by_user ?? ""} ${d.name ?? ""} ${d.manufacturer ?? ""} ${d.model ?? ""}`).includes(q))
      .map((d) => ({ device_id: d.id, name: d.name_by_user || d.name, manufacturer: d.manufacturer, model: d.model, area: d.area_id ? names.get(d.area_id) : null,
        entities: reg.entities.filter((e) => e.device_id === d.id && !e.disabled_by).map((e) => e.entity_id) }));
    return ok({ count: out.length, devices: out.slice(0, limit ?? 200) });
  }));

  server.registerTool("list_entities", {
    title: "List entities", description: "Entities with current state, filtered by area (name or id), domain (e.g. light, sensor) and/or state. Hidden/diagnostic entities are skipped unless include_hidden.",
    inputSchema: { area: z.string().optional(), domain: z.string().optional(), state: z.string().optional(), include_hidden: z.boolean().optional(), limit: z.number().int().min(1).max(1000).optional() },
    annotations: { readOnlyHint: true },
  }, wrap(async ({ area, domain, state, include_hidden, limit }) => {
    const st = await home.states();
    const reg = await home.registries();
    const meta = new Map(reg.entities.map((e) => [e.entity_id, e]));
    const a = area ? await home.findArea(area) : undefined;
    if (area && !a) return fail(`No area matches "${area}".`);
    const idx = await home.areaIndex();
    const an = await areaName();
    const out = Object.values(st)
      .filter((e) => !domain || domainOf(e.entity_id) === domain)
      .filter((e) => !a || idx.get(e.entity_id) === a.area_id)
      .filter((e) => !state || e.state === state)
      .filter((e) => include_hidden || (!meta.get(e.entity_id)?.hidden_by && !meta.get(e.entity_id)?.entity_category))
      .sort((x, y) => x.entity_id.localeCompare(y.entity_id))
      .map((e) => brief(e, an(e.entity_id)));
    return ok({ count: out.length, entities: out.slice(0, limit ?? 300) });
  }));

  server.registerTool("get_state", {
    title: "Get state", description: "Full current state and attributes of one or more entities.", inputSchema: { entity_id: ids }, annotations: { readOnlyHint: true },
  }, wrap(async ({ entity_id }) => {
    const st = await home.states();
    const an = await areaName();
    return ok(asList(entity_id).map((id) => (st[id] ? { ...st[id], area: an(id) } : { entity_id: id, error: "unknown entity" })));
  }));

  server.registerTool("search", {
    title: "Search", description: "Find entities, devices and areas by free text (name, id, area; accent-insensitive, so 'kjokken' matches 'Kjøkken').",
    inputSchema: { query: z.string().min(1), domain: z.string().optional(), limit: z.number().int().min(1).max(200).optional() }, annotations: { readOnlyHint: true },
  }, wrap(async ({ query, domain, limit }) => {
    const st = await home.states();
    const reg = await home.registries();
    const an = await areaName();
    const terms = norm(query).split(/\s+/).filter(Boolean);
    const hit = (s: string) => { const n = norm(s); return terms.every((t) => n.includes(t)); };
    const ents = Object.values(st).filter((e) => (!domain || domainOf(e.entity_id) === domain) && hit(`${e.entity_id} ${friendlyName(e)} ${an(e.entity_id) ?? ""}`));
    return ok({
      areas: reg.areas.filter((a) => hit(`${a.name} ${a.area_id}`)).map((a) => ({ area_id: a.area_id, name: a.name })),
      devices: domain ? [] : reg.devices.filter((d) => hit(`${d.name_by_user ?? ""} ${d.name ?? ""} ${d.manufacturer ?? ""} ${d.model ?? ""}`)).slice(0, 20).map((d) => ({ device_id: d.id, name: d.name_by_user || d.name, model: d.model })),
      entities: ents.slice(0, limit ?? 50).map((e) => brief(e, an(e.entity_id))),
      total_entities: ents.length,
    });
  }));

  server.registerTool("get_history", {
    title: "Get history", description: "State history for entities over the last N hours (default 24, max 168). Numeric series are downsampled to max_points (default 48) and summarised with min/max/avg.",
    inputSchema: { entity_id: ids, hours: z.number().min(0.1).max(168).optional(), max_points: z.number().int().min(2).max(500).optional() }, annotations: { readOnlyHint: true },
  }, wrap(async ({ entity_id, hours, max_points }) => {
    const be = await home.backend();
    const list = asList(entity_id);
    const h = await be.history(list, hours ?? 24);
    const maxP = max_points ?? 48;
    return ok(Object.fromEntries(list.map((id) => {
      const pts = h[id] ?? [];
      const nums = pts.filter((p) => Number.isFinite(p.v));
      const step = Math.max(1, Math.ceil(pts.length / maxP));
      const series = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => [new Date(p.t).toISOString(), p.s]);
      const stats = nums.length ? { min: Math.min(...nums.map((p) => p.v)), max: Math.max(...nums.map((p) => p.v)), avg: +(nums.reduce((s, p) => s + p.v, 0) / nums.length).toFixed(2) } : undefined;
      return [id, { changes: pts.length, ...(stats ? { stats } : {}), series }];
    })));
  }));

  // ---------- control ----------
  server.registerTool("set_light", {
    title: "Set light", description: "Turn lights on/off/toggle and set brightness (0-100 %), colour temperature (Kelvin) or colour (rgb or a CSS colour name). Target entity ids or every light in an area.",
    inputSchema: {
      entity_id: ids.optional(), area: z.string().optional().describe("Area name or id: acts on every light in it"),
      state: z.enum(["on", "off", "toggle"]).optional().describe("Default: on (if any attribute is given) / required otherwise"),
      brightness_pct: z.number().min(0).max(100).optional(), color_temp_kelvin: z.number().int().min(1500).max(9000).optional(),
      rgb_color: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]).optional(),
      color_name: z.string().optional(), transition: z.number().min(0).max(300).optional().describe("Seconds"),
    },
  }, wrap(async (a) => {
    const list = await resolve(["light"], a.entity_id, a.area);
    const state = a.state ?? (a.brightness_pct !== undefined || a.color_temp_kelvin || a.rgb_color || a.color_name ? "on" : undefined);
    if (!state) return fail("Specify state (on/off/toggle) or an attribute to set.");
    if (state === "off" || (state === "on" && a.brightness_pct === 0)) return act("light", "turn_off", list, a.transition !== undefined ? { transition: a.transition } : {}, (e) => e.state === "off");
    if (state === "toggle") return act("light", "toggle", list);
    const data = pick(a as Record<string, unknown>, ["brightness_pct", "color_temp_kelvin", "rgb_color", "color_name", "transition"]);
    return act("light", "turn_on", list, data, (e) => e.state === "on" && (a.brightness_pct === undefined || Math.abs((num(e.attributes.brightness) ?? 0) / 2.55 - a.brightness_pct) < 2));
  }));

  server.registerTool("set_switch", {
    title: "Set switch", description: "Turn switches, smart plugs or input_booleans on/off/toggle.",
    inputSchema: { entity_id: ids.optional(), area: z.string().optional(), state: z.enum(["on", "off", "toggle"]) },
  }, wrap(async ({ entity_id, area, state }) => {
    const list = await resolve(["switch", "input_boolean"], entity_id, area);
    const byDomain = new Map<string, string[]>();
    for (const id of list) byDomain.set(domainOf(id), [...(byDomain.get(domainOf(id)) ?? []), id]);
    const res: CallToolResult[] = [];
    for (const [d, l] of byDomain) res.push(await act(d, state === "toggle" ? "toggle" : `turn_${state}`, l, {}, state === "toggle" ? undefined : (e) => e.state === state));
    return res.length === 1 ? res[0]! : ok(res.map((r) => JSON.parse((r.content[0] as { text: string }).text)));
  }));

  server.registerTool("set_fan", {
    title: "Set fan", description: "Control fans / ventilation (e.g. the Flexit unit): on/off, speed percentage, preset mode, oscillation or direction. Read get_state for available preset_modes.",
    inputSchema: { entity_id: ids, state: z.enum(["on", "off", "toggle"]).optional(), percentage: z.number().int().min(0).max(100).optional(), preset_mode: z.string().optional(), oscillating: z.boolean().optional(), direction: z.enum(["forward", "reverse"]).optional() },
  }, wrap(async (a) => {
    const list = await resolve(["fan"], a.entity_id);
    if (a.state === "off") return act("fan", "turn_off", list, {}, (e) => e.state === "off");
    if (a.state === "toggle") return act("fan", "toggle", list);
    let last: CallToolResult | null = null;
    if (a.percentage !== undefined) last = await act("fan", "set_percentage", list, { percentage: a.percentage });
    if (a.preset_mode) last = await act("fan", "set_preset_mode", list, { preset_mode: a.preset_mode }, (e) => e.attributes.preset_mode === a.preset_mode);
    if (a.oscillating !== undefined) last = await act("fan", "oscillate", list, { oscillating: a.oscillating });
    if (a.direction) last = await act("fan", "set_direction", list, { direction: a.direction });
    return last ?? (a.state === "on" ? act("fan", "turn_on", list, {}, (e) => e.state === "on") : fail("Nothing to change."));
  }));

  server.registerTool("set_climate", {
    title: "Set climate", description: "Thermostats / heat pumps: HVAC mode, target temperature (or low/high range), preset and fan mode.",
    inputSchema: { entity_id: ids, hvac_mode: z.enum(["off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"]).optional(), temperature: z.number().optional(), target_temp_low: z.number().optional(), target_temp_high: z.number().optional(), preset_mode: z.string().optional(), fan_mode: z.string().optional() },
  }, wrap(async (a) => {
    const list = await resolve(["climate"], a.entity_id);
    let last: CallToolResult | null = null;
    if (a.temperature !== undefined || a.target_temp_low !== undefined) last = await act("climate", "set_temperature", list, pick(a as Record<string, unknown>, ["temperature", "target_temp_low", "target_temp_high", "hvac_mode"]));
    else if (a.hvac_mode) last = await act("climate", "set_hvac_mode", list, { hvac_mode: a.hvac_mode }, (e) => e.state === a.hvac_mode);
    if (a.preset_mode) last = await act("climate", "set_preset_mode", list, { preset_mode: a.preset_mode });
    if (a.fan_mode) last = await act("climate", "set_fan_mode", list, { fan_mode: a.fan_mode });
    return last ?? fail("Nothing to change.");
  }));

  server.registerTool("media_control", {
    title: "Media control", description: "Control TVs / speakers: play, pause, play_pause, stop, next, previous, volume_set (volume 0-1), volume_up, volume_down, mute, unmute, turn_on, turn_off, select_source (source).",
    inputSchema: { entity_id: ids, action: z.enum(["play", "pause", "play_pause", "stop", "next", "previous", "volume_set", "volume_up", "volume_down", "mute", "unmute", "turn_on", "turn_off", "select_source"]), volume: z.number().min(0).max(1).optional(), source: z.string().optional() },
  }, wrap(async ({ entity_id, action, volume, source }) => {
    const list = await resolve(["media_player"], entity_id);
    const map: Record<string, [string, Record<string, unknown>]> = {
      play: ["media_play", {}], pause: ["media_pause", {}], play_pause: ["media_play_pause", {}], stop: ["media_stop", {}], next: ["media_next_track", {}], previous: ["media_previous_track", {}],
      volume_up: ["volume_up", {}], volume_down: ["volume_down", {}], mute: ["volume_mute", { is_volume_muted: true }], unmute: ["volume_mute", { is_volume_muted: false }],
      turn_on: ["turn_on", {}], turn_off: ["turn_off", {}], volume_set: ["volume_set", { volume_level: volume }], select_source: ["select_source", { source }],
    };
    if (action === "volume_set" && volume === undefined) return fail("volume_set needs volume (0-1).");
    if (action === "select_source" && !source) return fail("select_source needs source.");
    const [svc, data] = map[action]!;
    return act("media_player", svc, list, data);
  }));

  server.registerTool("set_cover", {
    title: "Set cover", description: "Blinds, shades, curtains: open, close, stop, set_position (0-100). Garage doors / gates require confirm=true.",
    inputSchema: { entity_id: ids, action: z.enum(["open", "close", "stop", "set_position"]), position: z.number().int().min(0).max(100).optional(), confirm },
  }, wrap(async ({ entity_id, action, position, confirm: c }) => {
    const list = await resolve(["cover"], entity_id);
    guard(list, await home.states(), c);
    if (action === "set_position") { if (position === undefined) return fail("set_position needs position."); return act("cover", "set_cover_position", list, { position }); }
    return act("cover", `${action}_cover`, list);
  }));

  server.registerTool("vacuum_control", {
    title: "Vacuum control", description: "Robot vacuums: start, pause, stop, return_to_base, locate, clean_spot, set_fan_speed (fan_speed).",
    inputSchema: { entity_id: ids, action: z.enum(["start", "pause", "stop", "return_to_base", "locate", "clean_spot", "set_fan_speed"]), fan_speed: z.string().optional() },
  }, wrap(async ({ entity_id, action, fan_speed }) => {
    const list = await resolve(["vacuum"], entity_id);
    if (action === "set_fan_speed" && !fan_speed) return fail("set_fan_speed needs fan_speed.");
    return act("vacuum", action, list, action === "set_fan_speed" ? { fan_speed } : {});
  }));

  server.registerTool("vacuum_clean_rooms", {
    title: "Vacuum specific rooms", description: "Clean specific rooms with the Dreame robot vacuum (room cleaning). rooms: Norwegian room names or ids, e.g. [\"Kjøkken\"], [\"Stue\",\"Stue 2\"]. Known rooms are in the vacuum's 'rooms' attribute (get_state vacuum.dreame_x50_ultra). Optional mode: Quick, Auto, Deep Clean, Quiet, Low Energy, AutoMop (AutoMop = mopping).",
    inputSchema: { rooms: z.array(z.union([z.string(), z.number()])).min(1), mode: z.enum(["Quick", "Auto", "Deep Clean", "Quiet", "Low Energy", "AutoMop"]).optional() },
  }, wrap(async ({ rooms, mode }) => {
    const be = await home.backend();
    const v = (await home.states())["vacuum.dreame_x50_ultra"];
    const known = (v?.attributes.rooms as Array<{ id: number; name: string; key: string }> | undefined) ?? [];
    const want = rooms.map((r) => String(r).toLowerCase());
    const hit = known.filter((r) => want.some((w) => w === String(r.id) || norm(w) === norm(r.name) || w === r.key));
    if (!hit.length) return fail(`Unknown room(s): ${rooms.join(", ")}. Known: ${known.map((r) => r.name).join(", ")}`);
    await be.send({ type: "call_service", domain: "script", service: "turn_on", service_data: { variables: { rooms: hit.map((r) => r.id), ...(mode ? { mode } : {}) } }, target: { entity_id: "script.dreame_rengjor_rom" } });
    return ok({ cleaning: hit.map((r) => r.name), mode: mode ?? null });
  }));

  server.registerTool("lawn_mower_control", {
    title: "Robot lawn mower", description: "Navimow robot lawn mower (lawn_mower.*): start_mowing, pause, dock. Use get_state for status/battery.",
    inputSchema: { entity_id: ids.optional(), action: z.enum(["start_mowing", "pause", "dock"]) },
  }, wrap(async ({ entity_id, action }) => {
    const st = await home.states();
    const all = Object.keys(st).filter((k) => k.startsWith("lawn_mower."));
    if (!all.length) return fail("No robot lawn mower is connected to Home Assistant yet (Navimow integration needs a login).");
    const list = entity_id ? await resolve(["lawn_mower"], entity_id) : all;
    return act("lawn_mower", action, list, {});
  }));

  server.registerTool("run_scene", {
    title: "Run scene", description: "Activate a scene (scene.*).", inputSchema: { entity_id: ids, transition: z.number().min(0).max(300).optional() },
  }, wrap(async ({ entity_id, transition }) => act("scene", "turn_on", await resolve(["scene"], entity_id), transition !== undefined ? { transition } : {})));

  server.registerTool("run_script", {
    title: "Run script", description: "Run a Home Assistant script (script.*) with optional variables. Scripts can do anything, so check what it does (get_state) if unsure.",
    inputSchema: { entity_id: z.string(), variables: z.record(z.unknown()).optional() },
  }, wrap(async ({ entity_id, variables }) => {
    await resolve(["script"], entity_id);
    const be = await home.backend();
    const res = await be.send({ type: "call_service", domain: "script", service: "turn_on", service_data: { variables: variables ?? {} }, target: { entity_id } });
    return ok({ called: "script.turn_on", entity_id, variables: variables ?? {}, result: res ?? null });
  }));

  server.registerTool("list_automations", {
    title: "List automations", description: "Automations with enabled state, last triggered time and mode.", inputSchema: { query: z.string().optional() }, annotations: { readOnlyHint: true },
  }, wrap(async ({ query }) => {
    const st = await home.states();
    const q = query ? norm(query) : "";
    return ok(Object.values(st).filter((e) => domainOf(e.entity_id) === "automation" && (!q || norm(`${e.entity_id} ${friendlyName(e)}`).includes(q)))
      .map((e) => ({ entity_id: e.entity_id, name: friendlyName(e), enabled: e.state === "on", last_triggered: e.attributes.last_triggered ?? null, mode: e.attributes.mode, id: e.attributes.id })));
  }));

  server.registerTool("trigger_automation", {
    title: "Trigger automation", description: "Run an automation's actions now (skip_condition defaults to true, like the HA UI).",
    inputSchema: { entity_id: z.string(), skip_condition: z.boolean().optional() },
  }, wrap(async ({ entity_id, skip_condition }) => act("automation", "trigger", await resolve(["automation"], entity_id), { skip_condition: skip_condition ?? true }, (e) => e.attributes.last_triggered !== undefined)));

  server.registerTool("toggle_automation", {
    title: "Enable/disable automation", description: "Enable or disable an automation.", inputSchema: { entity_id: z.string(), enabled: z.boolean() },
  }, wrap(async ({ entity_id, enabled }) => act("automation", enabled ? "turn_on" : "turn_off", await resolve(["automation"], entity_id), {}, (e) => e.state === (enabled ? "on" : "off"))));

  server.registerTool("call_service", {
    title: "Call service", description: "Generic Home Assistant service call (escape hatch), e.g. domain=light service=turn_on data={brightness_pct:30}. Target with entity_id, area_id or device_id. Locks, alarm panels, valves and garage/gate covers need confirm=true. return_response for services that return data (e.g. weather.get_forecasts).",
    inputSchema: {
      domain: z.string(), service: z.string(), entity_id: ids.optional(), area_id: z.union([z.string(), z.array(z.string())]).optional(), device_id: z.union([z.string(), z.array(z.string())]).optional(),
      data: z.record(z.unknown()).optional(), return_response: z.boolean().optional(), confirm,
    },
  }, wrap(async ({ domain, service, entity_id, area_id, device_id, data, return_response, confirm: c }) => {
    const st = await home.states();
    const reg = await home.registries();
    const idx = await home.areaIndex();
    // Expand every way of targeting into concrete entities so the guard can't be bypassed via area/device/data.
    const targets = new Set<string>(entity_id ? asList(entity_id) : []);
    const dataIds = data?.entity_id;
    if (typeof dataIds === "string" || Array.isArray(dataIds)) for (const id of asList(dataIds as string | string[])) targets.add(id);
    for (const a of area_id ? asList(area_id) : []) for (const [id, ar] of idx) if (ar === a) targets.add(id);
    for (const d of device_id ? asList(device_id) : []) for (const e of reg.entities) if (e.device_id === d) targets.add(e.entity_id);
    const relevant = [...targets].filter((id) => domain === "homeassistant" || domainOf(id) === domain);
    const guardedDomain = ["lock", "alarm_control_panel", "valve"].includes(domain);
    if (guardedDomain && c !== true) throw new ConfirmationRequired(relevant.length ? relevant : [`${domain}.*`]);
    guard(relevant, st, c);
    const target: Record<string, unknown> = {};
    if (entity_id) target.entity_id = entity_id;
    if (area_id) target.area_id = area_id;
    if (device_id) target.device_id = device_id;
    const be = await home.backend();
    const res = await be.send<{ response?: unknown }>({ type: "call_service", domain, service, service_data: data ?? {}, ...(Object.keys(target).length ? { target } : {}), ...(return_response ? { return_response: true } : {}) });
    if (relevant.length) await home.waitFor(() => false, 600);
    const after = await home.states();
    return ok({ called: `${domain}.${service}`, target, data: data ?? {}, response: res?.response ?? null, entities: relevant.slice(0, 50).map((id) => (after[id] ? brief(after[id]) : { entity_id: id })) });
  }));
}
