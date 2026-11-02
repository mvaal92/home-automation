import { domainOf, num, brightnessPct, type EntityState } from "@home/core";

export function sensorValue(e: EntityState | undefined): string {
  if (!e) return "—";
  if (e.state === "unavailable" || e.state === "unknown") return "—";
  const dc = e.attributes.device_class;
  if (domainOf(e.entity_id) === "binary_sensor") {
    if (dc === "motion" || dc === "occupancy") return e.state === "on" ? "Bevegelse" : "Rolig";
    if (dc === "door" || dc === "window" || dc === "opening") return e.state === "on" ? "Åpen" : "Lukket";
    if (dc === "moisture") return e.state === "on" ? "Vått" : "Tørt";
    return e.state === "on" ? "På" : "Av";
  }
  const v = num(e.state);
  const unit = String(e.attributes.unit_of_measurement ?? "");
  if (v === undefined) {
    // Samsung reports apps as "<opaque id>.<APPNAME>" – show just the app.
    const app = /^[A-Za-z0-9]{6,}\.([A-Za-z0-9]+)$/.exec(e.state);
    if (app) return app[1]!.charAt(0) + app[1]!.slice(1).toLowerCase();
    return e.state.length > 1 && e.state === e.state.toLowerCase() ? e.state.charAt(0).toUpperCase() + e.state.slice(1) : e.state;
  }
  const digits = Math.abs(v) >= 100 ? 0 : unit === "NOK/kWh" ? 2 : 1;
  const sep = unit === "°C" || unit === "%" ? "" : " ";
  return `${v.toFixed(digits).replace(/\.0$/, "")}${sep}${unit}`;
}

const CAP = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
/** Home Assistant state words in Norwegian (falls back to the capitalised raw state). */
const NB_STATE: Record<string, string> = {
  on: "På", off: "Av", idle: "Klar", playing: "Spiller", paused: "Pauset", standby: "Hvilemodus", buffering: "Laster", unknown: "Ukjent",
  docked: "I dokken", cleaning: "Rengjør", returning: "På vei hjem", charging: "Lader", error: "Feil", mowing: "Klipper",
  locked: "Låst", unlocked: "Ulåst", locking: "Låser", unlocking: "Låser opp", jammed: "Fastlåst", open: "Åpen", closed: "Lukket", opening: "Åpner", closing: "Lukker",
  heating: "Varmer", cooling: "Kjøler", heat: "Varme", cool: "Kjøling", auto: "Auto", heat_cool: "Auto", dry: "Avfukting", fan_only: "Vifte", preheating: "Forvarmer",
  home: "Hjemme", not_home: "Borte", away: "Borte", running: "Går", finished: "Ferdig", stop: "Stoppet", pause: "Pause",
};
export const nbState = (s: string) => NB_STATE[s] ?? CAP(s);

export function stateLabel(e: EntityState | undefined): string {
  if (!e) return "Mangler";
  if (e.state === "unavailable") return "Frakoblet";
  const dom = domainOf(e.entity_id);
  switch (dom) {
    case "light": return e.state === "on" ? `${brightnessPct(e)}%` : "Av";
    case "climate": {
      const t = num(e.attributes.temperature);
      const cur = num(e.attributes.current_temperature);
      if (e.state === "off") return cur !== undefined ? `Av · ${cur.toFixed(1)}°` : "Av";
      return `${nbState(String(e.attributes.hvac_action ?? e.state))}${t !== undefined ? ` · ${t}°` : ""}`;
    }
    case "media_player": {
      const title = e.attributes.media_title;
      if ((e.state === "playing" || e.state === "paused") && typeof title === "string") return `${e.state === "paused" ? "Pauset · " : ""}${title}`;
      return nbState(e.state);
    }
    case "vacuum": return nbState(String(e.state));
    case "lock": return nbState(e.state);
    case "sensor": case "binary_sensor": return sensorValue(e);
    case "camera": return e.state === "streaming" ? "Direkte" : e.state === "recording" ? "Tar opp" : "Klar";
    default: return nbState(e.state);
  }
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "God natt";
  if (h < 11) return "God morgen";
  if (h < 17) return "God dag";
  if (h < 23) return "God kveld";
  return "God natt";
}

/** Kelvin -> CSS color (approximate, for previews) */
export function kelvinToRgb(k: number): string {
  const t = k / 100;
  let r: number, g: number, b: number;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * (t - 60) ** -0.1332; g = 288.12 * (t - 60) ** -0.0755; b = 255; }
  const c = (x: number) => Math.round(Math.max(0, Math.min(255, x)));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

export function lightColor(e: EntityState | undefined): string {
  const k = num(e?.attributes.color_temp_kelvin);
  return k ? kelvinToRgb(k) : "rgb(255, 196, 120)";
}

/** "now", "6 min ago", "2 h ago", "Mon 14:20" */
export function ago(t: number, now = Date.now()): string {
  const m = Math.round((now - t) / 60_000);
  if (m < 1) return "nå nettopp";
  if (m < 60) return `for ${m} min siden`;
  if (m < 24 * 60) return `for ${Math.round(m / 60)} t siden`;
  return new Date(t).toLocaleString("nb-NO", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export function clock(t: number): string {
  return new Date(t).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
}

export const humanize = (s: string) => CAP(s.replace(/^ai_/, "AI "));

export function power(w: number | undefined): string | null {
  if (w === undefined || !Number.isFinite(w) || w <= 0) return null;
  return w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`;
}
