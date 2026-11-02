import { describe, expect, it, vi } from "vitest";
import { HaBackend, mapAssistEvent, normalizeUrl, parseHistory, type AssistEvent, type ConnLike, type EntityMap } from "../src";

function fakeConn() {
  const sent: unknown[] = [];
  const binary: Uint8Array[] = [];
  let subCb: ((m: unknown) => void) | null = null;
  const responses: Record<string, unknown> = {
    "config/area_registry/list": [{ area_id: "stue", name: "Stue" }],
    "config/device_registry/list": [{ id: "d", name: "D", area_id: "stue" }],
    "config/entity_registry/list": [{ entity_id: "light.a", device_id: "d", area_id: null }],
    "history/history_during_period": { "sensor.t": [{ s: "20.5", lu: 1700000000 }, { s: "unavailable", lu: 1700000060.5 }] },
    "assist_pipeline/pipeline/list": {
      preferred_pipeline: "p2",
      pipelines: [
        { id: "p1", name: "Text", language: "en", stt_engine: null, tts_engine: null },
        { id: "p2", name: "Voice", language: "en", stt_engine: "stt.faster_whisper", tts_engine: "tts.piper" },
      ],
    },
  };
  const conn: ConnLike = {
    sendMessagePromise: async <T,>(msg: { type: string }) => { sent.push(msg); return (responses[msg.type] ?? null) as T; },
    subscribeMessage: async <T,>(cb: (m: T) => void, msg: { type: string }) => { sent.push(msg); subCb = cb as (m: unknown) => void; return async () => undefined; },
    subscribeEntities: (cb: (e: EntityMap) => void) => { cb({}); return () => undefined; },
    sendBinary: (d) => binary.push(d),
    onStatus: () => undefined,
    close: vi.fn(),
  };
  return { conn, sent, binary, push: (m: unknown) => subCb?.(m) };
}

async function connected() {
  const f = fakeConn();
  const be = new HaBackend({ url: "100.64.0.10:8123/", token: "x" }, async () => f.conn);
  const statuses: string[] = [];
  await be.connect((s) => statuses.push(s));
  return { be, f, statuses };
}

describe("HaBackend", () => {
  it("normalizes urls", () => {
    expect(normalizeUrl("100.64.0.10:8123/")).toBe("http://100.64.0.10:8123");
    expect(normalizeUrl(" https://ha.local// ")).toBe("https://ha.local");
  });

  it("reports connection status and auth failure", async () => {
    const { statuses } = await connected();
    expect(statuses).toEqual(["connecting", "connected"]);
    const bad = new HaBackend({ url: "x", token: "y" }, async () => { throw new Error("auth-failed"); });
    const s: string[] = [];
    await expect(bad.connect((x) => s.push(x))).rejects.toThrow();
    expect(s.at(-1)).toBe("auth-failed");
  });

  it("reads registries", async () => {
    const { be } = await connected();
    const reg = await be.getRegistries();
    expect(reg.areas[0]?.area_id).toBe("stue");
    expect(reg.devices).toHaveLength(1);
    expect(reg.entities[0]?.entity_id).toBe("light.a");
  });

  it("calls services with target", async () => {
    const { be, f } = await connected();
    await be.callService({ domain: "light", service: "turn_on", data: { brightness_pct: 40 }, target: { entity_id: "light.a" } });
    expect(f.sent.at(-1)).toEqual({ type: "call_service", domain: "light", service: "turn_on", service_data: { brightness_pct: 40 }, target: { entity_id: "light.a" } });
  });

  it("parses minimal history", async () => {
    const { be, f } = await connected();
    const h = await be.history(["sensor.t"], 24);
    expect(h["sensor.t"]?.[0]).toEqual({ t: 1700000000000, v: 20.5, s: "20.5" });
    expect(Number.isNaN(h["sensor.t"]?.[1]?.v)).toBe(true);
    expect((f.sent.at(-1) as { minimal_response: boolean }).minimal_response).toBe(true);
    expect(parseHistory({})).toEqual({});
  });

  it("picks the preferred assist pipeline", async () => {
    const { be } = await connected();
    expect(await be.assistCapabilities()).toEqual({ pipelineId: "p2", pipelineName: "Voice", stt: true, tts: true, language: "en" });
  });

  it("runs a text assist pipeline", async () => {
    const { be, f } = await connected();
    const events: AssistEvent[] = [];
    const run = await be.runAssist({ text: "turn on the lights", tts: false, pipelineId: "p2" }, (e) => events.push(e));
    expect(f.sent.at(-1)).toMatchObject({ type: "assist_pipeline/run", start_stage: "intent", end_stage: "intent", input: { text: "turn on the lights" }, pipeline: "p2" });
    f.push({ type: "run-start", data: {} });
    f.push({ type: "intent-end", data: { intent_output: { conversation_id: "c1", response: { response_type: "action_done", speech: { plain: { speech: "Turned on" } } } } } });
    f.push({ type: "run-end", data: null });
    await run.done;
    expect(events.map((e) => e.type)).toEqual(["run-start", "intent-end", "run-end"]);
    expect(events[1]).toMatchObject({ speech: "Turned on", conversationId: "c1" });
  });

  it("streams audio with the stt binary handler prefix, buffering until run-start", async () => {
    const { be, f } = await connected();
    const run = await be.runAssist({ audio: { sampleRate: 16000 }, tts: true }, () => undefined);
    expect(f.sent.at(-1)).toMatchObject({ start_stage: "stt", end_stage: "tts", input: { sample_rate: 16000 } });
    run.sendAudio(new Int16Array([1, 2]));
    expect(f.binary).toHaveLength(0);
    f.push({ type: "run-start", data: { runner_data: { stt_binary_handler_id: 7 } } });
    expect(f.binary).toHaveLength(1);
    expect([...f.binary[0]!]).toEqual([7, 1, 0, 2, 0]);
    run.sendAudio(new Int16Array([256]));
    run.endAudio();
    expect([...f.binary[1]!]).toEqual([7, 0, 1]);
    expect([...f.binary[2]!]).toEqual([7]);
    run.cancel();
  });

  it("maps assist events", () => {
    expect(mapAssistEvent({ type: "stt-end", data: { stt_output: { text: "hei" } } })).toEqual({ type: "stt-end", text: "hei" });
    expect(mapAssistEvent({ type: "tts-end", data: { tts_output: { url: "/api/tts_proxy/x.mp3" } } })).toEqual({ type: "tts-end", url: "/api/tts_proxy/x.mp3" });
    expect(mapAssistEvent({ type: "error", data: { code: "stt-no-text-recognized", message: "No text" } })).toMatchObject({ code: "stt-no-text-recognized" });
    expect(mapAssistEvent({ type: "wake_word-start" })).toBeNull();
  });

  it("resolves relative urls", async () => {
    const { be } = await connected();
    expect(be.resolveUrl("/api/tts_proxy/a.mp3")).toBe("http://100.64.0.10:8123/api/tts_proxy/a.mp3");
  });
});
