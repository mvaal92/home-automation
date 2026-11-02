import type {
  AssistCapabilities, AssistEvent, AssistRun, AssistRunOptions, ConnectionStatus, EntityMap, EntityState, HistoryMap, HomeBackend, Registries, ServiceCall,
} from "./types";
import { mockRegistries, mockStates, MOCK_SCENES } from "./fixtures";
import { predictState, targetIds } from "./optimistic";
import { domainOf, friendlyName, num } from "./domain";

const SETTLE: Record<string, string> = { locking: "locked", unlocking: "unlocked", opening: "open", closing: "closed", returning: "docked" };
const POWER_OF: Record<string, string> = { "switch.kaffemaskin": "sensor.kaffemaskin_effekt", "switch.kontor_skjerm": "sensor.kontor_skjerm_effekt" };
const POWER_ON: Record<string, number> = { "sensor.kaffemaskin_effekt": 1180, "sensor.kontor_skjerm_effekt": 64.2 };

export interface MockOptions {
  latencyMs?: number;
  /** Live drift of sensors (disable in tests). */
  simulate?: boolean;
}

/** Fully in-memory backend with realistic behaviour, for demo mode and tests. */
export class MockBackend implements HomeBackend {
  readonly kind = "mock" as const;
  private states: EntityMap = mockStates();
  private readonly reg: Registries = mockRegistries(this.states);
  private listeners = new Set<(e: EntityMap) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private sampleIdx = 0;
  private readonly latency: number;
  private readonly simulate: boolean;

  constructor(opts: MockOptions = {}) {
    this.latency = opts.latencyMs ?? 180;
    this.simulate = opts.simulate ?? true;
  }

  private wait(ms = this.latency) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  private set(next: EntityState) {
    this.states = { ...this.states, [next.entity_id]: next };
  }

  private emit() {
    for (const l of this.listeners) l(this.states);
  }

  async connect(onStatus: (s: ConnectionStatus) => void): Promise<void> {
    onStatus("connecting");
    await this.wait(120);
    onStatus("connected");
    if (this.simulate && !this.timer) {
      this.timer = setInterval(() => this.drift(), 4000);
    }
  }

  disconnect(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private drift() {
    const bump = (id: string, delta: number, digits = 1) => {
      const e = this.states[id];
      const v = e ? num(e.state) : undefined;
      if (!e || v === undefined) return;
      this.set({ ...e, state: (v + (Math.random() - 0.5) * delta).toFixed(digits), last_updated: new Date().toISOString() });
    };
    bump("sensor.stromforbruk", 180, 0);
    bump("sensor.stue_temperatur", 0.2);
    bump("sensor.kontor_co2", 30, 0);
    if (this.states["switch.kaffemaskin"]?.state === "on") bump("sensor.kaffemaskin_effekt", 40, 0);
    this.emit();
  }

  subscribeEntities(cb: (entities: EntityMap) => void): () => void {
    this.listeners.add(cb);
    cb(this.states);
    return () => this.listeners.delete(cb);
  }

  async getRegistries(): Promise<Registries> {
    return structuredClone(this.reg);
  }

  /** Synchronous accessor for tests. */
  get snapshot(): EntityMap {
    return this.states;
  }

  async callService(call: ServiceCall): Promise<void> {
    await this.wait();
    if (call.domain === "scene" && call.service === "turn_on") {
      for (const id of targetIds(call)) this.applyScene(id);
      this.emit();
      return;
    }
    for (const id of targetIds(call)) {
      const e = this.states[id];
      if (!e) throw new Error(`Unknown entity ${id}`);
      if (e.state === "unavailable") throw new Error(`${id} is unavailable`);
      const next = predictState(e, call);
      if (!next) continue;
      this.set(next);
      const pw = POWER_OF[id];
      const pe = pw ? this.states[pw] : undefined;
      if (pw && pe) this.set({ ...pe, state: next.state === "on" ? String(POWER_ON[pw] ?? 0) : "0" });
      const settle = SETTLE[next.state];
      if (settle) {
        setTimeout(() => {
          const cur = this.states[id];
          if (cur && cur.state === next.state) { this.set({ ...cur, state: settle }); this.emit(); }
        }, 900);
      }
    }
    this.emit();
  }

  private applyScene(sceneId: string) {
    for (const step of MOCK_SCENES[sceneId] ?? []) {
      const e = this.states[step.id];
      if (!e) continue;
      const dom = domainOf(step.id);
      const service = dom === "lock" ? (step.state === "locked" ? "lock" : "unlock") : dom === "vacuum" ? "start" : step.state === "on" ? "turn_on" : "turn_off";
      const data: Record<string, unknown> = {};
      if (step.pct !== undefined) data.brightness_pct = step.pct;
      if (step.kelvin !== undefined) data.color_temp_kelvin = step.kelvin;
      const next = predictState(e, { domain: dom, service, data, target: { entity_id: step.id } });
      if (next) this.set({ ...next, state: SETTLE[next.state] ?? next.state });
    }
    const sc = this.states[sceneId];
    if (sc) this.set({ ...sc, state: new Date().toISOString() });
  }

  async history(entityIds: string[], hours: number): Promise<HistoryMap> {
    const out: HistoryMap = {};
    const nowMs = Date.now();
    const points = 48;
    for (const id of entityIds) {
      const e = this.states[id];
      const base = e ? num(e.state) : undefined;
      if (base === undefined) { out[id] = []; continue; }
      const seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
      const amp = Math.max(Math.abs(base) * 0.08, 0.6);
      out[id] = Array.from({ length: points }, (_, i) => {
        const t = nowMs - (hours * 3600_000 * (points - 1 - i)) / (points - 1);
        const wave = Math.sin(i / 6 + seed) * amp + Math.sin(i / 2.3 + seed * 3) * amp * 0.3;
        const v = i === points - 1 ? base : base + wave;
        return { t, v, s: String(v) };
      });
    }
    return out;
  }

  async assistCapabilities(): Promise<AssistCapabilities> {
    return { pipelineId: "mock", pipelineName: "Demo assistant", stt: true, tts: false, language: "en" };
  }

  /** Very small intent engine so demo mode feels alive. */
  handleText(text: string): string {
    const t = text.toLowerCase();
    const rooms = this.reg.areas;
    const room = rooms.find((a) => t.includes(a.name.toLowerCase()) || t.includes(a.area_id));
    const entitiesIn = (areaId: string, dom: string) =>
      this.reg.entities.filter((r) => r.area_id === areaId && domainOf(r.entity_id) === dom).map((r) => r.entity_id);
    const apply = (ids: string[], domain: string, service: string, data?: Record<string, unknown>) => {
      for (const id of ids) {
        const e = this.states[id];
        const n = e && predictState(e, { domain, service, data, target: { entity_id: id } });
        if (n) this.set({ ...n, state: SETTLE[n.state] ?? n.state });
      }
      this.emit();
    };
    if (/temperature|how (warm|cold)/.test(t)) {
      const area = room?.area_id ?? "stue";
      const s = Object.values(this.states).find((x) => x.entity_id.startsWith(`sensor.${area}`) && x.attributes.device_class === "temperature");
      return s ? `It's ${s.state} degrees in the ${(room?.name ?? "living room").toLowerCase()}.` : "I don't have a temperature sensor there.";
    }
    if (/\b(lock)\b/.test(t) && !/unlock/.test(t)) { apply(["lock.inngangsdor"], "lock", "lock"); return "Locked the front door."; }
    if (/unlock/.test(t)) return "For safety, please unlock the front door from the app.";
    const sceneMatch = Object.values(this.states).find((s) => s.entity_id.startsWith("scene.") && t.includes(friendlyName(s).toLowerCase()));
    if (sceneMatch) { this.applyScene(sceneMatch.entity_id); this.emit(); return `Activated ${friendlyName(sceneMatch)}.`; }
    if (/vacuum|clean/.test(t)) { apply(["vacuum.roborock"], "vacuum", "start"); return "Started the vacuum."; }
    const on = /turn on|switch on|lights on/.test(t);
    const off = /turn off|switch off|lights off/.test(t);
    if ((on || off) && /light/.test(t)) {
      const ids = room ? entitiesIn(room.area_id, "light") : Object.keys(this.states).filter((k) => k.startsWith("light."));
      apply(ids, "light", on ? "turn_on" : "turn_off");
      return `Turned ${on ? "on" : "off"} the lights${room ? ` in the ${room.name.toLowerCase()}` : ""}.`;
    }
    return "Sorry, I couldn't understand that.";
  }

  async runAssist(opts: AssistRunOptions, onEvent: (e: AssistEvent) => void): Promise<AssistRun> {
    let cancelled = false;
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    const finish = async (text: string) => {
      if (cancelled) return;
      onEvent({ type: "stt-end", text });
      await this.wait(250);
      if (cancelled) return;
      onEvent({ type: "intent-end", speech: this.handleText(text), conversationId: "mock-conv" });
      onEvent({ type: "run-end" });
      resolveDone();
    };
    onEvent({ type: "run-start", sttBinaryHandlerId: opts.audio ? 1 : undefined });
    const samples = ["Turn off the kitchen lights", "What's the temperature in the bedroom", "Activate movie night", "Lock the front door"];
    if (!opts.audio) {
      queueMicrotask(() => void finish(opts.text ?? ""));
    }
    return {
      sendAudio: () => undefined,
      endAudio: () => {
        if (!opts.audio) return;
        onEvent({ type: "stt-vad-end" });
        const phrase = samples[this.sampleIdx++ % samples.length] ?? "";
        void this.wait(400).then(() => finish(phrase));
      },
      cancel: () => { cancelled = true; resolveDone(); },
      done,
    };
  }

  resolveUrl(path: string): string {
    return path;
  }
}
