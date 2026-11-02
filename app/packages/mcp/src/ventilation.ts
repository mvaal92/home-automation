import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { EntityMap } from "@home/core";
import type { HomeLink } from "./home.js";

/**
 * Fuktstyrt ventilasjon (HA package ventilation_humidity, generated from app/ha-packages/ventilation/zones.yaml).
 * Each zone is sensor.ventilasjon_<zone> with attributes.ventilation_zone = true. Fan speed follows a proportional
 * humidity curve inside HA; these tools only read zones, start a timed override (boost/pause), resume automatic
 * control, or change curve settings (input_number helpers). They never write to the fan directly.
 */
const ok = (data: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }] });
const fail = (msg: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: msg }] });
const MODES: Record<string, string> = { grunn: "grunnventilasjon (minste fart)", okt: "øker med fukt", maks: "maks fukt (største fart)", natt: "natt (dempet)", boost: "boost (overstyrt)", pause: "pause (vifte stoppet)", fast: "automatikk av – fast minste fart", sensorfeil: "sensorfeil – minste fart" };
const CURVE_KEYS = ["min_humidity", "max_humidity", "min_speed", "max_speed", "baseline_offset", "night_cap"] as const;

export function zonesOf(st: EntityMap) {
  return Object.values(st).filter((s) => s.entity_id.startsWith("sensor.ventilasjon_") && (s.attributes as Record<string, unknown>).ventilation_zone === true).map((s) => {
    const a = s.attributes as Record<string, unknown>; const ents = (a.entities ?? {}) as Record<string, string>;
    return {
      zone: String(a.zone), name: a.name, target_speed_pct: Number(s.state), mode: a.mode, mode_text: MODES[String(a.mode)] ?? String(a.mode),
      humidity: a.humidity, humidity_smoothed: a.humidity_smoothed, baseline: a.baseline, start_humidity: a.start_humidity, full_humidity: a.full_humidity,
      rpm: a.rpm, last_set_pct: a.last_set, auto: a.auto, override: a.override, override_ends: a.override_ends, night: a.night,
      night_window: `${String(a.night_start)}–${String(a.night_end)}`, curve: a.curve as Record<string, number> | undefined, boost_speed: a.boost_speed, boost_minutes: Number(a.boost_minutes) || 30, pause_minutes: Number(a.pause_minutes) || 30,
      humidity_sensor: ents.humidity_sensor, humidity_sensor_name: st[ents.humidity_sensor ?? ""]?.attributes.friendly_name, entities: ents,
    };
  });
}

export function registerVentilationTools(server: McpServer, home: HomeLink): void {
  const zone = z.string().regex(/^[a-z][a-z0-9_]*$/).describe("Zone id from ventilation_zones, e.g. bad");
  const find = async (id: string) => { const zs = zonesOf(await home.states()); const f = zs.find((x) => x.zone === id); if (!f) throw new Error(`ukjent sone ${id} (finnes: ${zs.map((x) => x.zone).join(", ") || "ingen"})`); return f; };
  const call = async (domain: string, service: string, entity_id: string, data: Record<string, unknown> = {}) => (await home.backend()).send({ type: "call_service", domain, service, service_data: data, target: { entity_id } });
  const settle = async (id: string, pred: (z: ReturnType<typeof zonesOf>[number]) => boolean) => { await home.waitFor((st) => { const f = zonesOf(st).find((x) => x.zone === id); return !!f && pred(f); }, 5000); return find(id); };
  const wrap = <A>(fn: (a: A) => Promise<unknown>) => async (a: A): Promise<CallToolResult> => { try { return ok(await fn(a)); } catch (e) { return fail(e instanceof Error ? e.message : String(e)); } };

  server.registerTool("ventilation_zones", { title: "Ventilasjonssoner", description: "READ ONLY. Fuktstyrt ventilasjon: every zone (e.g. bad = Flexit Bodo Supreme) with current humidity, rolling baseline, target fan speed %, measured rpm, mode (grunn/okt/maks/natt/boost/pause/fast/sensorfeil), override and remaining time, and the proportional curve settings.", inputSchema: {}, annotations: { readOnlyHint: true } },
    wrap(async () => ({ zones: zonesOf(await home.states()), how_it_works: "Viftefart = minste fart ved startfukt → største fart ved full fukt (lineært, i trinn på 5 %). Startfukt = max(min_humidity, grunnlinje + baseline_offset). Natt: kappet til night_cap med mindre fukta er over full fukt. Senking tidligst etter hold_minutes." })));

  server.registerTool("ventilation_boost", { title: "Boost ventilasjon (DEVICE ACTUATION)", description: "DEVICE ACTUATION: run a zone's fan at boost speed for N minutes (default the zone's boost_minutes, usually 30), then automatic humidity control resumes.", inputSchema: { zone, minutes: z.number().int().min(1).max(240).optional() } },
    wrap(async ({ zone: id, minutes }) => { const f = await find(id); await call("script", "turn_on", "script.ventilasjon_overstyr", { variables: { zone: id, kind: "boost", minutes: minutes ?? f.boost_minutes ?? 30 } }); return settle(id, (x) => x.override === "boost"); }));

  server.registerTool("ventilation_pause", { title: "Pause ventilasjon (DEVICE ACTUATION)", description: "DEVICE ACTUATION: stop a zone's fan for N minutes (default pause_minutes, usually 30); afterwards automatic control resumes. resume=true ends any boost/pause now and turns automatic control back on.", inputSchema: { zone, minutes: z.number().int().min(1).max(240).optional(), resume: z.boolean().optional() } },
    wrap(async ({ zone: id, minutes, resume }) => { const f = await find(id);
      if (resume) { await call("script", "turn_on", "script.ventilasjon_overstyr", { variables: { zone: id, kind: "auto" } }); return settle(id, (x) => x.override === "auto" && x.auto === true); }
      await call("script", "turn_on", "script.ventilasjon_overstyr", { variables: { zone: id, kind: "pause", minutes: minutes ?? f.pause_minutes ?? 30 } }); return settle(id, (x) => x.override === "pause"); }));

  server.registerTool("ventilation_curve", { title: "Ventilasjonskurve", description: "Change a zone's proportional humidity curve and/or turn automatic control on/off (off = fixed minimum speed). Values in %: min_humidity (start), max_humidity (full speed), min_speed, max_speed, baseline_offset (start this far above the rolling baseline), night_cap (max speed 23–07 unless humidity is above full).", inputSchema: { zone, auto: z.boolean().optional(), min_humidity: z.number().min(30).max(95).optional(), max_humidity: z.number().min(40).max(100).optional(), min_speed: z.number().min(0).max(100).optional(), max_speed: z.number().min(0).max(100).optional(), baseline_offset: z.number().min(0).max(25).optional(), night_cap: z.number().min(0).max(100).optional() } },
    wrap(async ({ zone: id, auto, ...vals }) => { const f = await find(id); const changed: Record<string, unknown> = {};
      for (const k of CURVE_KEYS) { const v = (vals as Record<string, number | undefined>)[k]; if (v === undefined) continue; const ent = f.entities[k]; if (!ent) throw new Error(`sone ${id} mangler ${k}`); await call("input_number", "set_value", ent, { value: v }); changed[k] = v; }
      if (auto !== undefined && f.entities.auto) { await call("input_boolean", auto ? "turn_on" : "turn_off", f.entities.auto); changed.auto = auto; }
      if (!Object.keys(changed).length) throw new Error("ingen endring oppgitt");
      return { changed, zone: await settle(id, (x) => CURVE_KEYS.every((k) => changed[k] === undefined || Number(x.curve?.[k]) === Number(changed[k]))) }; }));
}
