import { domainOf, type EntityState } from "@home/core";

/** Domains whose actions have physical-security consequences. */
export const GUARDED_DOMAINS = new Set(["lock", "alarm_control_panel", "valve", "water_heater"]);
const GUARDED_COVER_CLASSES = new Set(["garage", "gate", "door"]);

export function isGuarded(e: EntityState | undefined, entityId: string): boolean {
  const d = domainOf(entityId);
  if (GUARDED_DOMAINS.has(d)) return true;
  if (d === "cover") {
    const dc = String(e?.attributes.device_class ?? "");
    return GUARDED_COVER_CLASSES.has(dc) || /garage|gate|port/i.test(`${entityId} ${String(e?.attributes.friendly_name ?? "")}`);
  }
  return false;
}

export class ConfirmationRequired extends Error {
  constructor(public readonly entities: string[]) {
    super(`Refusing to act on security-sensitive ${entities.length === 1 ? "entity" : "entities"} ${entities.join(", ")} without confirm=true. Ask the user to confirm explicitly, then retry with confirm=true.`);
  }
}
