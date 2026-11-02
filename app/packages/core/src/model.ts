import type { Area, EntityMap, EntityRegistryEntry, EntityState, Registries } from "./types";
import { cleanName, CONTROLLABLE, domainOf, friendlyName, isOn, num, UNAVAILABLE } from "./domain";

export interface RoomEntity {
  id: string;
  name: string;
  domain: string;
  deviceId: string | null;
}

export interface Room {
  id: string;
  name: string;
  icon: string | null;
  controls: RoomEntity[];
  sensors: RoomEntity[];
  temperature?: number;
  humidity?: number;
  activeCount: number;
  lightsOn: number;
  /** Sum of instantaneous power sensors (W) in the room. */
  power?: number;
}

export interface HealthIssue {
  /** Stable key for dismissing: the device id, or the entity id when there is no device. */
  key: string;
  /** First affected entity (opens in the device sheet). */
  entityId: string;
  entityIds: string[];
  name: string;
  kind: "unavailable" | "low-battery";
  detail: string;
}

export const UNASSIGNED_ROOM = "__other";
export const LOW_BATTERY_PCT = 20;

/** Domains that are noise on a home dashboard. */
const IGNORED_DOMAINS = new Set([
  "zone", "sun", "person", "conversation", "event", "todo", "tts", "stt", "update", "button", "number",
  "select", "text", "device_tracker", "weather", "automation", "assist_satellite", "wake_word", "image", "notify",
  "input_boolean", "input_select", "input_number", "input_text", "input_datetime", "input_button", "schedule", "timer", "counter",
]);
/** Integrations whose entities are about Home Assistant itself, not the home. */
const IGNORED_PLATFORMS = new Set(["backup", "hassio", "sun", "met", "hacs"]);

/** Is this entity meant to be shown at all? (registry hidden/disabled/config/diagnostic respected) */
export function isShown(entry: EntityRegistryEntry | undefined): boolean {
  if (!entry) return true;
  return !entry.hidden_by && !entry.disabled_by && !entry.entity_category && !IGNORED_PLATFORMS.has(entry.platform ?? "");
}

/** States filtered to what the UI may show (hidden twins, config/diagnostic and system entities removed). */
export function visibleStates(reg: Registries, states: EntityMap): EntityMap {
  const entries = new Map(reg.entities.map((e) => [e.entity_id, e] as const));
  const out: EntityMap = {};
  for (const [id, s] of Object.entries(states)) if (isShown(entries.get(id))) out[id] = s;
  return out;
}

function resolveArea(entry: EntityRegistryEntry | undefined, deviceArea: Map<string, string | null>): string | null {
  if (!entry) return null;
  if (entry.area_id) return entry.area_id;
  if (entry.device_id) return deviceArea.get(entry.device_id) ?? null;
  return null;
}

function isVisible(entry: EntityRegistryEntry | undefined, state: EntityState): boolean {
  if (IGNORED_DOMAINS.has(domainOf(state.entity_id))) return false;
  return isShown(entry);
}

/** Build rooms automatically from HA areas, assigning entities by entity->device->area. */
export function buildRooms(reg: Registries, states: EntityMap): Room[] {
  const deviceArea = new Map(reg.devices.map((d) => [d.id, d.area_id] as const));
  const entries = new Map(reg.entities.map((e) => [e.entity_id, e] as const));
  const rooms = new Map<string, Room>();
  const areaName = new Map(reg.areas.map((a) => [a.area_id, a.name] as const));
  const deviceById = new Map(reg.devices.map((d) => [d.id, d] as const));
  const mk = (a: Pick<Area, "area_id" | "name" | "icon">): Room => ({
    id: a.area_id, name: a.name, icon: a.icon ?? null, controls: [], sensors: [], activeCount: 0, lightsOn: 0,
  });
  for (const a of reg.areas) rooms.set(a.area_id, mk(a));

  for (const st of Object.values(states)) {
    const entry = entries.get(st.entity_id);
    if (!isVisible(entry, st)) continue;
    const dom = domainOf(st.entity_id);
    if (!CONTROLLABLE.has(dom) && dom !== "sensor" && dom !== "binary_sensor") continue;
    if (dom === "scene" || dom === "script") continue; // shown as quick actions
    const areaId = resolveArea(entry, deviceArea) ?? UNASSIGNED_ROOM;
    // The whole-home bucket only gets things with a real reading (no "unknown" router stats etc.).
    if (areaId === UNASSIGNED_ROOM && !CONTROLLABLE.has(dom) && UNAVAILABLE.has(st.state)) continue;
    let room = rooms.get(areaId);
    if (!room) {
      room = mk({ area_id: UNASSIGNED_ROOM, name: "Hele huset", icon: null });
      rooms.set(UNASSIGNED_ROOM, room);
    }
    // Sensors with nothing to say (empty TV-channel strings etc.) are noise.
    if (!CONTROLLABLE.has(dom) && String(st.state).trim() === "") continue;
    let name = cleanName(friendlyName(st, entry?.name), areaName.get(areaId));
    // A device named after its room ("Kjøkken" speaker in Kjøkken) reads better by brand.
    if (!["light", "switch"].includes(dom) && name.toLowerCase() === (areaName.get(areaId) ?? "").toLowerCase()) {
      const dev = entry?.device_id ? deviceById.get(entry.device_id) : undefined;
      if (dev?.manufacturer) name = String(dev.manufacturer).split(/\s+/)[0]!;
    }
    const re: RoomEntity = { id: st.entity_id, name, domain: dom, deviceId: entry?.device_id ?? null };
    if (CONTROLLABLE.has(dom)) {
      room.controls.push(re);
      if (isOn(st)) room.activeCount++;
      if (dom === "light" && st.state === "on") room.lightsOn++;
    } else {
      room.sensors.push(re);
      const dc = st.attributes.device_class;
      const v = num(st.state);
      if (v !== undefined && dc === "temperature" && room.temperature === undefined) room.temperature = v;
      if (v !== undefined && dc === "humidity" && room.humidity === undefined) room.humidity = v;
      if (v !== undefined && dc === "power" && st.attributes.unit_of_measurement === "W" && !/total|forbruk|house|grid/i.test(st.entity_id)) room.power = (room.power ?? 0) + v;
    }
  }
  // climate current_temperature as a fallback room temperature
  for (const room of rooms.values()) {
    if (room.temperature === undefined) {
      const c = room.controls.find((r) => r.domain === "climate");
      const t = c ? num(states[c.id]?.attributes.current_temperature) : undefined;
      if (t !== undefined) room.temperature = t;
    }
    const order = ["light", "climate", "media_player", "switch", "fan", "cover", "lock", "vacuum"];
    room.controls.sort((a, b) => (order.indexOf(a.domain) + 99) % 99 - (order.indexOf(b.domain) + 99) % 99 || a.name.localeCompare(b.name));
    room.sensors.sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...rooms.values()].filter((r) => r.controls.length + r.sensors.length > 0 || r.id !== UNASSIGNED_ROOM)
    .sort((a, b) => (a.id === UNASSIGNED_ROOM ? 1 : b.id === UNASSIGNED_ROOM ? -1 : 0));
}

/** Surface unavailable devices and low batteries, one entry per physical device. */
export function healthIssues(reg: Registries, states: EntityMap): HealthIssue[] {
  const entries = new Map(reg.entities.map((e) => [e.entity_id, e] as const));
  const devices = new Map(reg.devices.map((d) => [d.id, d] as const));
  const groups = new Map<string, HealthIssue>();
  const add = (st: EntityState, entry: EntityRegistryEntry | undefined, kind: HealthIssue["kind"], detail: string) => {
    const dev = entry?.device_id ? devices.get(entry.device_id) : undefined;
    const key = dev?.id ?? st.entity_id;
    const g = groups.get(key);
    if (g) {
      g.entityIds.push(st.entity_id);
      if (kind === "low-battery" && g.kind === "unavailable") return; // offline wins
      if (kind === "unavailable" && g.kind === "low-battery") Object.assign(g, { kind, detail });
      return;
    }
    const name = cleanName(dev?.name_by_user || dev?.name || friendlyName(st, entry?.name));
    groups.set(key, { key, entityId: st.entity_id, entityIds: [st.entity_id], name, kind, detail });
  };
  for (const st of Object.values(states)) {
    const entry = entries.get(st.entity_id);
    if (entry?.disabled_by || entry?.hidden_by) continue;
    const dom = domainOf(st.entity_id);
    if (IGNORED_DOMAINS.has(dom) || IGNORED_PLATFORMS.has(entry?.platform ?? "")) continue;
    const isBatterySensor = st.attributes.device_class === "battery" && dom === "sensor";
    // Batteries are often diagnostic entities, so check them before the category filter.
    const level = isBatterySensor ? num(st.state) : num(st.attributes.battery_level);
    if (level !== undefined && level < LOW_BATTERY_PCT) { add(st, entry, "low-battery", `Battery ${Math.round(level)}%`); continue; }
    if (dom === "binary_sensor" && st.attributes.device_class === "battery" && st.state === "on") { add(st, entry, "low-battery", "Battery low"); continue; }
    if (entry?.entity_category) continue;
    if (st.state === "unavailable") add(st, entry, "unavailable", "Offline");
  }
  // Offline first, then by name.
  return [...groups.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "unavailable" ? -1 : 1));
}

/** Preferred order for the scene pills. */
const SCENE_ORDER = [/morning|morgen/, /dinner|middag/, /evening|kveld/, /movie|film|kino/, /night|natt/, /away|borte/];
/** Scripts worth a pill: user-facing routines. Everything else (maintenance/internal helpers) is never shown. */
const ROUTINE = /leave.?home|arrive.?home|bedtime|drar|hjemme|leggetid/;

export interface QuickAction extends RoomEntity { kind: "scene" | "routine" }

/** Real scenes first (in a natural day order), then a small curated set of routines. */
export function quickActions(states: EntityMap, reg?: Registries): QuickAction[] {
  const entries = new Map((reg?.entities ?? []).map((e) => [e.entity_id, e] as const));
  // Scenes report "unknown" until first activated, so only "unavailable" disqualifies.
  const shown = Object.values(states).filter((s) => isShown(entries.get(s.entity_id)) && s.state !== "unavailable");
  let scenes = shown.filter((s) => domainOf(s.entity_id) === "scene");
  // When the home has its own scenes, cloud-imported ones (SmartThings "Lighting Turn on"...) are noise.
  const own = scenes.filter((s) => entries.get(s.entity_id)?.platform !== "smartthings");
  if (own.length >= 3) scenes = own;
  const rank = (n: string) => { const i = SCENE_ORDER.findIndex((re) => re.test(n.toLowerCase())); return i < 0 ? 99 : i; };
  const routines = shown.filter((s) => domainOf(s.entity_id) === "script" && ROUTINE.test(`${s.entity_id} ${friendlyName(s)}`.toLowerCase()));
  const label = (s: EntityState) => friendlyName(s).replace(/^[^·]+·\s*/, "");
  return [
    ...scenes.map((s): QuickAction => ({ id: s.entity_id, name: label(s), domain: "scene", deviceId: null, kind: "scene" }))
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)),
    ...routines.map((s): QuickAction => ({ id: s.entity_id, name: label(s), domain: "script", deviceId: null, kind: "routine" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

export interface HomeMode { entityId: string; current: string; options: string[] }

/** The house-wide mode selector (input_select.home_mode), if present. */
export function homeMode(states: EntityMap): HomeMode | null {
  const e = states["input_select.home_mode"] ?? Object.values(states).find((s) => domainOf(s.entity_id) === "input_select" && /home.?mode|husmodus|modus/i.test(s.entity_id));
  if (!e || !Array.isArray(e.attributes.options)) return null;
  return { entityId: e.entity_id, current: e.state, options: e.attributes.options.map(String) };
}

export interface Helper { id: string; name: string; on: boolean; kind: "toggle" | "schedule"; detail?: string }

/** User-facing automation switches (input_booleans, schedules). Internal ones are skipped. */
export function automationHelpers(reg: Registries, states: EntityMap): Helper[] {
  const entries = new Map(reg.entities.map((e) => [e.entity_id, e] as const));
  return Object.values(states)
    .filter((s) => ["input_boolean", "schedule"].includes(domainOf(s.entity_id)) && isShown(entries.get(s.entity_id)))
    .filter((s) => !/_active$|_internal|_before_|^input_boolean\.tmp/.test(s.entity_id) && !/internal/i.test(String(s.attributes.friendly_name ?? "")))
    .map((s): Helper => ({ id: s.entity_id, name: friendlyName(s), on: s.state === "on", kind: domainOf(s.entity_id) === "schedule" ? "schedule" : "toggle" }))
    .sort((a, b) => Number(a.kind === "schedule") - Number(b.kind === "schedule") || a.name.localeCompare(b.name));
}

/** Total power draw (W) across power sensors. */
export function totalPower(states: EntityMap): number | undefined {
  let sum = 0;
  let found = false;
  for (const s of Object.values(states)) {
    if (s.attributes.device_class === "power" && s.attributes.unit_of_measurement === "W") {
      const v = num(s.state);
      if (v !== undefined) { sum += v; found = true; }
    }
  }
  return found ? sum : undefined;
}
