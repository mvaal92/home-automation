import type { EntityState } from "./types";

export const domainOf = (entityId: string): string => entityId.split(".")[0] ?? "";

export const UNAVAILABLE = new Set(["unavailable", "unknown"]);

export function friendlyName(e: EntityState, override?: string | null): string {
  if (override) return override;
  const n = e.attributes.friendly_name;
  if (typeof n === "string" && n.length > 0) return n;
  return e.entity_id.split(".")[1]?.replace(/_/g, " ") ?? e.entity_id;
}

export function isOn(e: EntityState | undefined): boolean {
  if (!e) return false;
  return ["on", "open", "playing", "unlocked", "cleaning", "heat", "cool", "heat_cool", "auto", "home"].includes(e.state);
}

export function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Brightness 0-255 -> percent 0-100 */
export const brightnessPct = (e: EntityState): number => {
  const b = num(e.attributes.brightness);
  if (e.state !== "on") return 0;
  return b === undefined ? 100 : Math.round((b / 255) * 100);
};

/** Domains the UI renders as primary controllable tiles. */
export const CONTROLLABLE = new Set([
  "light", "switch", "fan", "climate", "media_player", "lock", "vacuum", "cover", "scene", "script", "humidifier", "camera",
]);

export const SENSOR_DOMAINS = new Set(["sensor", "binary_sensor"]);

/** Light supports color temp? */
export function supportsColorTemp(e: EntityState): boolean {
  const modes = e.attributes.supported_color_modes;
  return Array.isArray(modes) && modes.some((m) => m === "color_temp" || m === "hs" || m === "xy" || m === "rgb" || m === "rgbw" || m === "rgbww");
}

export function supportsBrightness(e: EntityState): boolean {
  const modes = e.attributes.supported_color_modes;
  if (!Array.isArray(modes)) return e.attributes.brightness !== undefined;
  return modes.some((m) => m !== "onoff");
}

/** Tidy display names: drop a "(WiZ)"-style integration suffix and a redundant leading area name. */
export function cleanName(name: string, areaName?: string | null): string {
  let n = name.replace(/\s*\((wiz|smartthings|sonos|local)\)\s*$/i, "").replace(/\b(\w+) \1\b/gi, "$1").trim();
  if (areaName && n.toLowerCase().startsWith(areaName.toLowerCase() + " ") && n.length > areaName.length + 2) n = n.slice(areaName.length + 1);
  return n.charAt(0).toUpperCase() + n.slice(1);
}
