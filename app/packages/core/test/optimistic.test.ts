import { describe, expect, it } from "vitest";
import { predictState, type EntityState } from "../src";

const e = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): EntityState => ({
  entity_id, state, attributes, last_changed: "", last_updated: "",
});

describe("predictState", () => {
  it("dims a light by percent", () => {
    const n = predictState(e("light.a", "off"), { domain: "light", service: "turn_on", data: { brightness_pct: 50 }, target: { entity_id: "light.a" } });
    expect(n?.state).toBe("on");
    expect(n?.attributes.brightness).toBe(128);
  });
  it("brightness 0 turns a light off", () => {
    const n = predictState(e("light.a", "on", { brightness: 200 }), { domain: "light", service: "turn_on", data: { brightness_pct: 0 }, target: { entity_id: "light.a" } });
    expect(n?.state).toBe("off");
  });
  it("sets color temperature", () => {
    const n = predictState(e("light.a", "on", { brightness: 255 }), { domain: "light", service: "turn_on", data: { color_temp_kelvin: 3000 }, target: { entity_id: "light.a" } });
    expect(n?.attributes.color_temp_kelvin).toBe(3000);
    expect(n?.attributes.brightness).toBe(255);
  });
  it("toggles switches", () => {
    expect(predictState(e("switch.p", "on"), { domain: "switch", service: "toggle", target: { entity_id: "switch.p" } })?.state).toBe("off");
    expect(predictState(e("switch.p", "off"), { domain: "homeassistant", service: "toggle", target: { entity_id: "switch.p" } })?.state).toBe("on");
  });
  it("uses transitional lock states", () => {
    expect(predictState(e("lock.d", "locked"), { domain: "lock", service: "unlock", target: { entity_id: "lock.d" } })?.state).toBe("unlocking");
  });
  it("sets thermostat target and media volume", () => {
    expect(predictState(e("climate.c", "heat", { temperature: 20 }), { domain: "climate", service: "set_temperature", data: { temperature: 22.5 }, target: { entity_id: "climate.c" } })?.attributes.temperature).toBe(22.5);
    expect(predictState(e("media_player.m", "playing"), { domain: "media_player", service: "volume_set", data: { volume_level: 0.4 }, target: { entity_id: "media_player.m" } })?.attributes.volume_level).toBe(0.4);
  });
  it("returns null for unknown services", () => {
    expect(predictState(e("sensor.x", "1"), { domain: "sensor", service: "frobnicate", target: { entity_id: "sensor.x" } })).toBeNull();
  });
});
