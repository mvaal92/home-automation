import type { EntityState, ServiceCall } from "./types";
import { domainOf, num } from "./domain";

/**
 * Predict the state an entity will have after a service call, so the UI can
 * update instantly. Returns null when we can't predict confidently.
 * Pure function (exercised by tests).
 */
export function predictState(e: EntityState, call: ServiceCall): EntityState | null {
  const d = call.data ?? {};
  const svc = call.service;
  const dom = domainOf(e.entity_id);
  const next = (state: string, attrs: Record<string, unknown> = {}): EntityState => ({
    ...e,
    state,
    attributes: { ...e.attributes, ...attrs },
    last_updated: new Date().toISOString(),
  });

  if (svc === "toggle") {
    const toggled = e.state === "on" ? "off" : "on";
    return predictState(e, { ...call, service: toggled === "on" ? "turn_on" : "turn_off" });
  }

  switch (dom) {
    case "light": {
      if (svc === "turn_off") return next("off", { brightness: null });
      if (svc === "turn_on") {
        const attrs: Record<string, unknown> = {};
        const pct = num(d.brightness_pct);
        if (pct !== undefined) {
          if (pct <= 0) return next("off", { brightness: null });
          attrs.brightness = Math.round((pct / 100) * 255);
        } else if (e.state !== "on") {
          attrs.brightness = num(e.attributes.brightness) ?? 255;
        }
        const k = num(d.color_temp_kelvin);
        if (k !== undefined) {
          attrs.color_temp_kelvin = k;
          attrs.color_mode = "color_temp";
        }
        return next("on", attrs);
      }
      return null;
    }
    case "switch":
    case "fan":
    case "input_boolean":
    case "humidifier":
      if (svc === "turn_on") return next("on");
      if (svc === "turn_off") return next("off");
      return null;
    case "input_select":
      if (svc === "select_option" && typeof call.data?.option === "string") return next(call.data.option);
      return null;
    case "lock":
      if (svc === "lock") return next("locking");
      if (svc === "unlock") return next("unlocking");
      return null;
    case "cover":
      if (svc === "open_cover") return next("opening");
      if (svc === "close_cover") return next("closing");
      return null;
    case "climate": {
      if (svc === "set_temperature") {
        const t = num(d.temperature);
        return t === undefined ? null : next(e.state, { temperature: t });
      }
      if (svc === "set_hvac_mode" && typeof d.hvac_mode === "string") return next(d.hvac_mode);
      if (svc === "turn_off") return next("off");
      return null;
    }
    case "media_player": {
      if (svc === "media_play") return next("playing");
      if (svc === "media_pause") return next("paused");
      if (svc === "turn_off") return next("off");
      if (svc === "turn_on") return next("idle");
      if (svc === "volume_set") {
        const v = num(d.volume_level);
        return v === undefined ? null : next(e.state, { volume_level: v });
      }
      if (svc === "volume_mute") return next(e.state, { is_volume_muted: Boolean(d.is_volume_muted) });
      return null;
    }
    case "vacuum":
      if (svc === "start") return next("cleaning");
      if (svc === "pause") return next("paused");
      if (svc === "return_to_base") return next("returning");
      if (svc === "stop") return next("idle");
      return null;
    default:
      return null;
  }
}

/** Calls whose target can be patched optimistically */
export function targetIds(call: ServiceCall): string[] {
  const t = call.target.entity_id;
  return Array.isArray(t) ? t : [t];
}
