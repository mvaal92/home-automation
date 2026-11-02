import { describe, expect, it } from "vitest";
import { HomeStore, MockBackend, OPTIMISTIC_TTL_MS, toPcm16, rms, type HomeBackend } from "../src";

describe("HomeStore (optimistic updates)", () => {
  it("applies optimistic state immediately and confirms from server", async () => {
    const be = new MockBackend({ latencyMs: 20, simulate: false });
    const store = new HomeStore(be);
    await store.start();
    expect(store.getSnapshot().status).toBe("connected");
    expect(store.getSnapshot().registries.areas.length).toBeGreaterThan(3);
    const p = store.call({ domain: "light", service: "turn_off", target: { entity_id: "light.stue_tak" } });
    expect(store.getSnapshot().entities["light.stue_tak"]?.state).toBe("off");
    expect(store.getSnapshot().pending.has("light.stue_tak")).toBe(true);
    await p;
    expect(be.snapshot["light.stue_tak"]?.state).toBe("off");
    expect(store.getSnapshot().pending.has("light.stue_tak")).toBe(false);
    store.stop();
  });

  it("reverts on failure", async () => {
    const be = new MockBackend({ latencyMs: 5, simulate: false });
    const failing: HomeBackend = Object.assign(Object.create(Object.getPrototypeOf(be)), be, {
      callService: async () => { throw new Error("boom"); },
    });
    const store = new HomeStore(failing);
    await store.start();
    await expect(store.call({ domain: "switch", service: "turn_off", target: { entity_id: "switch.kaffemaskin" } })).rejects.toThrow("boom");
    expect(store.getSnapshot().entities["switch.kaffemaskin"]?.state).toBe("on");
    expect(store.getSnapshot().lastError?.message).toBe("boom");
    store.stop();
  });

  it("expires stale overlays", async () => {
    let now = 1000;
    const be = new MockBackend({ latencyMs: 0, simulate: false });
    const never: HomeBackend = Object.assign(Object.create(Object.getPrototypeOf(be)), be, { callService: async () => undefined });
    const store = new HomeStore(never, () => now);
    await store.start();
    await store.call({ domain: "switch", service: "turn_off", target: { entity_id: "switch.kaffemaskin" } });
    expect(store.getSnapshot().entities["switch.kaffemaskin"]?.state).toBe("off");
    now += OPTIMISTIC_TTL_MS + 1;
    store.expireOverlays();
    expect(store.getSnapshot().entities["switch.kaffemaskin"]?.state).toBe("on");
    store.stop();
  });
});

describe("MockBackend", () => {
  it("settles locks and applies scenes", async () => {
    const be = new MockBackend({ latencyMs: 0, simulate: false });
    await be.callService({ domain: "scene", service: "turn_on", target: { entity_id: "scene.film" } });
    expect(be.snapshot["light.stue_tak"]?.state).toBe("off");
    expect(be.snapshot["light.stue_gulvlampe"]?.attributes.brightness).toBe(38);
  });
  it("answers text intents", async () => {
    const be = new MockBackend({ latencyMs: 0, simulate: false });
    expect(be.handleText("Turn off the lights in the kitchen")).toMatch(/kitchen/);
    expect(be.snapshot["light.kjokken_benk"]?.state).toBe("off");
    expect(be.handleText("what's the temperature in the bedroom")).toContain("18.6");
  });
  it("synthesizes history ending at the current value", async () => {
    const be = new MockBackend({ simulate: false });
    const h = await be.history(["sensor.stromforbruk"], 24);
    expect(h["sensor.stromforbruk"]).toHaveLength(48);
    expect(h["sensor.stromforbruk"]?.at(-1)?.v).toBe(2140);
  });
});

describe("audio", () => {
  it("downsamples 48k float to 16k pcm16", () => {
    const f = new Float32Array(480).fill(0.5);
    const pcm = toPcm16(f, 48000);
    expect(pcm.length).toBe(160);
    expect(pcm[0]).toBe(Math.floor(0.5 * 0x7fff));
    expect(rms(f)).toBeCloseTo(0.5);
  });
});
