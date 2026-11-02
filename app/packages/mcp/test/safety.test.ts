import { describe, expect, it } from "vitest";
import { isGuarded } from "../src/safety";

const e = (entity_id: string, attributes: Record<string, unknown> = {}) => ({ entity_id, state: "closed", attributes, last_changed: "", last_updated: "" });

describe("isGuarded", () => {
  it("guards locks, alarm panels and valves", () => {
    expect(isGuarded(e("lock.front"), "lock.front")).toBe(true);
    expect(isGuarded(e("alarm_control_panel.home"), "alarm_control_panel.home")).toBe(true);
    expect(isGuarded(e("valve.water"), "valve.water")).toBe(true);
  });
  it("guards garage/gate covers but not blinds", () => {
    expect(isGuarded(e("cover.garage", { device_class: "garage" }), "cover.garage")).toBe(true);
    expect(isGuarded(e("cover.x", { device_class: "gate" }), "cover.x")).toBe(true);
    expect(isGuarded(e("cover.garasjeport", { friendly_name: "Garasjeport" }), "cover.garasjeport")).toBe(true);
    expect(isGuarded(e("cover.living_blinds", { device_class: "blind" }), "cover.living_blinds")).toBe(false);
  });
  it("does not guard lights or switches", () => {
    expect(isGuarded(e("light.kitchen"), "light.kitchen")).toBe(false);
    expect(isGuarded(e("switch.plug"), "switch.plug")).toBe(false);
  });
});
