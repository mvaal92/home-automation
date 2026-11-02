import { describe, expect, it } from "vitest";
import { automationHelpers, cleanName, homeMode, buildRooms, healthIssues, mockRegistries, mockStates, quickActions, totalPower, UNASSIGNED_ROOM, type Registries, type EntityMap } from "../src";

describe("buildRooms", () => {
  it("builds rooms from areas using entity -> device -> area resolution", () => {
    const reg: Registries = {
      areas: [{ area_id: "stue", name: "Stue" }, { area_id: "empty", name: "Empty" }],
      devices: [{ id: "d1", name: "Lamp", area_id: "stue" }],
      entities: [
        { entity_id: "light.lamp", device_id: "d1", area_id: null },
        { entity_id: "sensor.temp", device_id: null, area_id: "stue" },
        { entity_id: "switch.cfg", device_id: "d1", area_id: null, entity_category: "config" },
        { entity_id: "switch.hidden", device_id: "d1", area_id: null, hidden_by: "user" },
      ],
    };
    const t = { last_changed: "", last_updated: "" };
    const states: EntityMap = {
      "light.lamp": { entity_id: "light.lamp", state: "on", attributes: { friendly_name: "Lamp" }, ...t },
      "sensor.temp": { entity_id: "sensor.temp", state: "21.5", attributes: { device_class: "temperature" }, ...t },
      "switch.cfg": { entity_id: "switch.cfg", state: "on", attributes: {}, ...t },
      "switch.hidden": { entity_id: "switch.hidden", state: "on", attributes: {}, ...t },
      "switch.loose": { entity_id: "switch.loose", state: "off", attributes: {}, ...t },
      "sun.sun": { entity_id: "sun.sun", state: "above_horizon", attributes: {}, ...t },
    };
    const rooms = buildRooms(reg, states);
    const stue = rooms.find((r) => r.id === "stue")!;
    expect(stue.controls.map((c) => c.id)).toEqual(["light.lamp"]);
    expect(stue.temperature).toBe(21.5);
    expect(stue.lightsOn).toBe(1);
    expect(rooms.find((r) => r.id === "empty")).toBeDefined();
    const other = rooms.at(-1)!;
    expect(other.id).toBe(UNASSIGNED_ROOM);
    expect(other.controls.map((c) => c.id)).toEqual(["switch.loose"]);
  });

  it("lays out the demo apartment", () => {
    const s = mockStates();
    const rooms = buildRooms(mockRegistries(s), s);
    expect(rooms.map((r) => r.id)).toContain("stue");
    expect(rooms.find((r) => r.id === "stue")!.controls.some((c) => c.domain === "climate")).toBe(true);
    const qa = quickActions(s, mockRegistries(s));
    expect(qa.map((q) => q.name)).toEqual(["Morning", "Dinner", "Evening", "Movie night", "Good night", "Away", "Arrive home", "Bedtime", "Leave home"]);
    expect(totalPower(s)).toBeGreaterThan(0);
  });
});

describe("healthIssues", () => {
  it("flags unavailable and low battery", () => {
    const s = mockStates();
    const issues = healthIssues(mockRegistries(s), s);
    expect(issues.find((i) => i.entityId === "sensor.balkong_luftfuktighet")?.kind).toBe("unavailable");
    expect(issues.find((i) => i.entityId === "sensor.soverom_sensor_batteri")?.kind).toBe("low-battery");
    expect(issues.find((i) => i.entityId === "lock.inngangsdor")).toBeUndefined();
  });
});

describe("v4 tidy", () => {
  it("never shows internal scripts or SmartThings scenes when real scenes exist", () => {
    const s = mockStates();
    s["scene.lighting_turn_on"] = { ...s["scene.morgen"]!, entity_id: "scene.lighting_turn_on", attributes: { friendly_name: "Lighting Turn on" } };
    const reg = mockRegistries(s);
    reg.entities.push({ entity_id: "scene.lighting_turn_on", device_id: null, area_id: null, platform: "smartthings" });
    const names = quickActions(s, reg).map((q) => q.name);
    expect(names).not.toContain("Lighting Turn on");
    expect(names).not.toContain("Apply level");
    expect(names).not.toContain("Filter replaced");
  });
  it("groups health issues by device and respects hidden twins", () => {
    const s = mockStates();
    const reg = mockRegistries(s);
    s["light.a"] = { ...s["light.stue_tak"]!, entity_id: "light.a", state: "unavailable" };
    s["sensor.a_power"] = { ...s["sensor.stue_temperatur"]!, entity_id: "sensor.a_power", state: "unavailable" };
    s["light.twin"] = { ...s["light.stue_tak"]!, entity_id: "light.twin", state: "unavailable" };
    reg.devices.push({ id: "dev-a", name: "Juletre", area_id: "stue" });
    reg.entities.push({ entity_id: "light.a", device_id: "dev-a", area_id: null }, { entity_id: "sensor.a_power", device_id: "dev-a", area_id: null }, { entity_id: "light.twin", device_id: null, area_id: null, hidden_by: "user" });
    const issues = healthIssues(reg, s);
    const jule = issues.filter((i) => i.key === "dev-a");
    expect(jule).toHaveLength(1);
    expect(jule[0]!.entityIds).toHaveLength(2);
    expect(issues.find((i) => i.entityId === "light.twin")).toBeUndefined();
  });
  it("finds the home mode and user-facing helpers only", () => {
    const s = mockStates();
    expect(homeMode(s)?.options).toEqual(["Home", "Away", "Night", "Vacation", "Guest"]);
    const names = automationHelpers(mockRegistries(s), s).map((h) => h.name);
    expect(names).toEqual(["Adaptive lighting", "Guest mode", "Heating schedule", "Movie mode", "Quiet hours"]);
  });
  it("keeps helpers out of rooms and tidies names", () => {
    const s = mockStates();
    const rooms = buildRooms(mockRegistries(s), s);
    expect(rooms.flatMap((r) => r.controls).some((c) => c.id.startsWith("input_"))).toBe(false);
    expect(cleanName("Ingangsparti 2 (WiZ)")).toBe("Ingangsparti 2");
    expect(cleanName("Laundry room Washer", "Laundry room")).toBe("Washer");
  });
});
