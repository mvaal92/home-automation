import { describe, expect, it } from "vitest";
import { appliances, buildRooms, cameras, mockRegistries, mockStates } from "../src";

describe("appliances", () => {
  it("assembles a washer from SmartThings-style sensors", () => {
    const s = mockStates();
    const [w] = appliances(mockRegistries(s), s);
    expect(w).toMatchObject({ key: "vaskerom_washer", kind: "washer", machineState: "run", job: "rinse", powerW: 412, areaId: "vaskerom", primaryId: "sensor.vaskerom_washer_power" });
    expect(w!.completesAt).toBeGreaterThan(Date.now());
    expect(w!.entityIds).toContain("sensor.vaskerom_washer_energy");
  });
  it("treats job 'none' as idle", () => {
    const s = mockStates();
    s["sensor.vaskerom_washer_job_state"]!.state = "none";
    expect(appliances(mockRegistries(s), s)[0]!.job).toBeNull();
  });
});

describe("cameras", () => {
  it("puts the doorbell first and links its ring event by area", () => {
    const s = mockStates();
    const cams = cameras(mockRegistries(s), s);
    expect(cams.map((c) => c.id)).toEqual(["camera.gang_doorbell", "camera.stue_kamera"]);
    expect(cams[0]!.doorbell).toBe(true);
    expect(cams[0]!.lastRing).toBeLessThan(Date.now());
    expect(cams[1]!.doorbell).toBe(false);
  });
});

describe("room power", () => {
  it("sums per-room power sensors but not the house total", () => {
    const s = mockStates();
    const rooms = buildRooms(mockRegistries(s), s);
    expect(rooms.find((r) => r.id === "vaskerom")!.power).toBe(412);
  });
});
