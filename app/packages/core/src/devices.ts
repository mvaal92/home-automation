import type { EntityMap, EntityState, Registries } from "./types";
import { domainOf, friendlyName, num, UNAVAILABLE } from "./domain";

/** A connected appliance (washer, dryer, dishwasher...) assembled from its SmartThings-style sensors. */
export interface Appliance {
  /** Shared entity-id prefix, e.g. "laundry_room_washer". */
  key: string;
  name: string;
  kind: "washer" | "dryer" | "dishwasher" | "oven" | "appliance";
  areaId: string | null;
  /** run | pause | stop | unavailable */
  machineState: string;
  /** Current cycle phase, e.g. wash, rinse, spin (null when idle). */
  job: string | null;
  completesAt: number | null;
  powerW?: number;
  /** All entity ids that belong to this appliance (hidden from the plain sensor list). */
  entityIds: string[];
  /** Entity to open in the detail sheet. */
  primaryId: string;
}

const KIND: Array<[RegExp, Appliance["kind"]]> = [[/wash|vask/, "washer"], [/dry|tork/, "dryer"], [/dish|oppvask/, "dishwasher"], [/oven|ovn/, "oven"]];

export function appliances(reg: Registries, states: EntityMap): Appliance[] {
  const areaOf = entityAreaIndex(reg);
  const out: Appliance[] = [];
  for (const e of Object.values(states)) {
    if (domainOf(e.entity_id) !== "sensor" || !e.entity_id.endsWith("_machine_state")) continue;
    const key = e.entity_id.slice("sensor.".length, -"_machine_state".length);
    const ids = Object.keys(states).filter((id) => id.split(".")[1]?.startsWith(key) && ["sensor", "binary_sensor", "select", "switch", "number"].includes(domainOf(id)));
    const job = states[`sensor.${key}_job_state`]?.state;
    const done = states[`sensor.${key}_completion_time`]?.state;
    const doneAt = done ? Date.parse(done) : NaN;
    const raw = friendlyName(e).replace(/\s*machine state$/i, "");
    const kind = KIND.find(([re]) => re.test(`${key} ${raw}`.toLowerCase()))?.[1] ?? "appliance";
    out.push({
      key, name: raw || "Appliance", kind, areaId: areaOf(e.entity_id),
      machineState: UNAVAILABLE.has(e.state) ? "unavailable" : e.state,
      job: job && !["none", "finish", "unknown", "unavailable"].includes(job) ? job : null,
      completesAt: Number.isFinite(doneAt) ? doneAt : null,
      powerW: num(states[`sensor.${key}_power`]?.state),
      entityIds: ids, primaryId: states[`sensor.${key}_power`] ? `sensor.${key}_power` : e.entity_id,
    });
  }
  return out;
}

export interface Camera {
  id: string;
  name: string;
  areaId: string | null;
  doorbell: boolean;
  available: boolean;
  picture: string | null;
  /** Last doorbell ring (ms epoch) from a doorbell event / binary_sensor in the same device or area. */
  lastRing: number | null;
  motion: boolean;
}

export function cameras(reg: Registries, states: EntityMap): Camera[] {
  const areaOf = entityAreaIndex(reg);
  const devOf = new Map(reg.entities.map((e) => [e.entity_id, e.device_id] as const));
  const list = Object.values(states).filter((e) => domainOf(e.entity_id) === "camera");
  const rings = Object.values(states).filter((e) => (domainOf(e.entity_id) === "event" || domainOf(e.entity_id) === "binary_sensor") && (e.attributes.device_class === "doorbell" || /doorbell|ringeklokke|ring\b/i.test(`${e.entity_id} ${String(e.attributes.friendly_name ?? "")}`)));
  const related = (cam: EntityState, other: EntityState) => {
    const d = devOf.get(cam.entity_id);
    if (d && d === devOf.get(other.entity_id)) return true;
    const a = areaOf(cam.entity_id);
    return !!a && a === areaOf(other.entity_id);
  };
  return list.map((c) => {
    const ring = rings.find((r) => related(c, r));
    const motion = Object.values(states).find((s) => domainOf(s.entity_id) === "binary_sensor" && s.attributes.device_class === "motion" && related(c, s));
    const ringAt = ring ? (domainOf(ring.entity_id) === "event" ? Date.parse(ring.state) : ring.state === "on" ? Date.parse(ring.last_changed) : Date.parse(ring.last_changed)) : NaN;
    const name = friendlyName(c);
    return {
      id: c.entity_id, name, areaId: areaOf(c.entity_id),
      doorbell: !!ring || /doorbell|ringeklokke|g4/i.test(`${c.entity_id} ${name} ${String(c.attributes.model_name ?? "")}`),
      available: !UNAVAILABLE.has(c.state),
      picture: typeof c.attributes.entity_picture === "string" ? c.attributes.entity_picture : null,
      lastRing: Number.isFinite(ringAt) ? ringAt : null,
      motion: motion?.state === "on",
    };
  }).sort((a, b) => Number(b.doorbell) - Number(a.doorbell) || a.name.localeCompare(b.name));
}

export function entityAreaIndex(reg: Registries): (id: string) => string | null {
  const devArea = new Map(reg.devices.map((d) => [d.id, d.area_id] as const));
  const ent = new Map(reg.entities.map((e) => [e.entity_id, e] as const));
  return (id) => { const e = ent.get(id); return e?.area_id ?? (e?.device_id ? devArea.get(e.device_id) ?? null : null); };
}
