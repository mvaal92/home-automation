import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  ERR_INVALID_AUTH,
  type Connection,
  type HassEntities,
  type MessageBase,
} from "home-assistant-js-websocket";
import type {
  AssistCapabilities, AssistEvent, AssistRun, AssistRunOptions, ConnectionStatus, EntityMap, HistoryMap, HomeBackend, Registries, ServiceCall,
} from "./types";
import { num } from "./domain";

/** The subset of a HA websocket connection we use. Lets tests inject a fake. */
export interface ConnLike {
  sendMessagePromise<T>(msg: MessageBase): Promise<T>;
  subscribeMessage<T>(cb: (msg: T) => void, msg: MessageBase): Promise<() => Promise<void>>;
  subscribeEntities(cb: (e: EntityMap) => void): () => void;
  sendBinary(data: Uint8Array): void;
  onStatus(cb: (s: ConnectionStatus) => void): void;
  close(): void;
}

export interface HaConfig {
  url: string;
  token: string;
}

export function normalizeUrl(url: string): string {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, "");
}

/** Real connection using home-assistant-js-websocket. */
export async function openHaConnection(cfg: HaConfig): Promise<ConnLike> {
  const auth = createLongLivedTokenAuth(normalizeUrl(cfg.url), cfg.token);
  let conn: Connection;
  try {
    conn = await createConnection({ auth });
  } catch (err) {
    console.warn("Home Assistant connection failed:", err);
    if (err === ERR_INVALID_AUTH) throw new Error("auth-failed");
    throw new Error("cannot-connect");
  }
  return wrapConnection(conn);
}

export function wrapConnection(conn: Connection): ConnLike {
  return {
    sendMessagePromise: <T>(msg: MessageBase) => conn.sendMessagePromise<T>(msg),
    subscribeMessage: <T>(cb: (m: T) => void, msg: MessageBase) => conn.subscribeMessage<T>(cb, msg),
    subscribeEntities: (cb) => subscribeEntities(conn, (ents: HassEntities) => cb(ents as unknown as EntityMap)),
    sendBinary: (data) => conn.socket?.send(data),
    onStatus: (cb) => {
      conn.addEventListener("ready", () => cb("connected"));
      conn.addEventListener("disconnected", () => cb("reconnecting"));
      conn.addEventListener("reconnect-error", (_c, err) => cb(err === ERR_INVALID_AUTH ? "auth-failed" : "reconnecting"));
    },
    close: () => conn.close(),
  };
}

interface RawPipeline {
  id: string;
  name: string;
  language: string;
  stt_engine: string | null;
  tts_engine: string | null;
}

interface RawAssistEvent {
  type: string;
  data?: Record<string, unknown> | null;
}

/** Map a raw assist_pipeline/run event to our typed event. Exported for tests. */
export function mapAssistEvent(raw: RawAssistEvent): AssistEvent | null {
  const d = (raw.data ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (raw.type) {
    case "run-start":
      return { type: "run-start", sttBinaryHandlerId: num(d.runner_data?.stt_binary_handler_id) };
    case "stt-vad-start":
      return { type: "stt-vad-start" };
    case "stt-vad-end":
      return { type: "stt-vad-end" };
    case "stt-end":
      return { type: "stt-end", text: String(d.stt_output?.text ?? "") };
    case "intent-end": {
      const resp = d.intent_output?.response;
      return {
        type: "intent-end",
        speech: String(resp?.speech?.plain?.speech ?? ""),
        conversationId: d.intent_output?.conversation_id ?? null,
        responseType: resp?.response_type,
      };
    }
    case "tts-end":
      return { type: "tts-end", url: String(d.tts_output?.url ?? "") };
    case "error":
      return { type: "error", code: String(d.code ?? "error"), message: String(d.message ?? "Unknown error") };
    case "run-end":
      return { type: "run-end" };
    default:
      return null;
  }
}

/** Convert compressed history response to points. Exported for tests. */
export function parseHistory(raw: Record<string, Array<{ s: string; lu: number; lc?: number }>>): HistoryMap {
  const out: HistoryMap = {};
  for (const [id, rows] of Object.entries(raw)) {
    out[id] = rows.map((r) => ({ t: Math.round((r.lu ?? r.lc ?? 0) * 1000), s: r.s, v: num(r.s) ?? Number.NaN }));
  }
  return out;
}

export class HaBackend implements HomeBackend {
  readonly kind = "live" as const;
  private conn: ConnLike | null = null;
  private closed = false;
  private readonly baseUrl: string;

  constructor(
    private readonly cfg: HaConfig,
    private readonly open: (cfg: HaConfig) => Promise<ConnLike> = openHaConnection,
  ) {
    this.baseUrl = normalizeUrl(cfg.url);
  }

  private get c(): ConnLike {
    if (!this.conn) throw new Error("Not connected");
    return this.conn;
  }

  async connect(onStatus: (s: ConnectionStatus, detail?: string) => void): Promise<void> {
    onStatus("connecting");
    this.closed = false;
    try {
      const conn = await this.open(this.cfg);
      if (this.closed) { conn.close(); throw new Error("closed"); }
      this.conn = conn;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onStatus(msg === "auth-failed" ? "auth-failed" : "error", msg);
      throw err;
    }
    this.conn.onStatus((s) => onStatus(s));
    onStatus("connected");
  }

  disconnect(): void {
    this.closed = true;
    this.conn?.close();
    this.conn = null;
  }

  subscribeEntities(cb: (entities: EntityMap) => void): () => void {
    return this.c.subscribeEntities(cb);
  }

  /** Send any raw websocket command (used by the MCP server for e.g. service calls with responses). */
  send<T>(msg: MessageBase): Promise<T> {
    return this.c.sendMessagePromise<T>(msg);
  }

  async getRegistries(): Promise<Registries> {
    const [areas, devices, entities] = await Promise.all([
      this.c.sendMessagePromise<Registries["areas"]>({ type: "config/area_registry/list" }),
      this.c.sendMessagePromise<Registries["devices"]>({ type: "config/device_registry/list" }),
      this.c.sendMessagePromise<Registries["entities"]>({ type: "config/entity_registry/list" }),
    ]);
    return { areas, devices, entities };
  }

  async callService(call: ServiceCall): Promise<void> {
    await this.c.sendMessagePromise({
      type: "call_service",
      domain: call.domain,
      service: call.service,
      service_data: call.data ?? {},
      target: call.target,
    });
  }

  async history(entityIds: string[], hours: number): Promise<HistoryMap> {
    if (entityIds.length === 0) return {};
    const raw = await this.c.sendMessagePromise<Record<string, Array<{ s: string; lu: number }>>>({
      type: "history/history_during_period",
      start_time: new Date(Date.now() - hours * 3600_000).toISOString(),
      entity_ids: entityIds,
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    });
    return parseHistory(raw);
  }

  async assistCapabilities(): Promise<AssistCapabilities> {
    try {
      const res = await this.c.sendMessagePromise<{ pipelines: RawPipeline[]; preferred_pipeline: string | null }>({
        type: "assist_pipeline/pipeline/list",
      });
      const p = res.pipelines.find((x) => x.id === res.preferred_pipeline) ?? res.pipelines[0];
      if (!p) return { pipelineId: null, pipelineName: null, stt: false, tts: false, language: "en" };
      return { pipelineId: p.id, pipelineName: p.name, stt: Boolean(p.stt_engine), tts: Boolean(p.tts_engine), language: p.language };
    } catch {
      return { pipelineId: null, pipelineName: null, stt: false, tts: false, language: "en" };
    }
  }

  async runAssist(opts: AssistRunOptions, onEvent: (e: AssistEvent) => void): Promise<AssistRun> {
    let handlerId: number | undefined;
    let pending: Int16Array[] = [];
    let ended = false;
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    const sendChunk = (chunk: Int16Array) => {
      const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      const msg = new Uint8Array(bytes.length + 1);
      msg[0] = handlerId!;
      msg.set(bytes, 1);
      this.c.sendBinary(msg);
    };
    const sendEnd = () => this.c.sendBinary(new Uint8Array([handlerId!]));

    const msg: MessageBase = {
      type: "assist_pipeline/run",
      start_stage: opts.audio ? "stt" : "intent",
      end_stage: opts.tts ? "tts" : "intent",
      input: opts.audio ? { sample_rate: opts.audio.sampleRate } : { text: opts.text ?? "" },
    };
    if (opts.pipelineId) msg.pipeline = opts.pipelineId;
    if (opts.conversationId) msg.conversation_id = opts.conversationId;

    let unsub: (() => Promise<void>) | null = null;
    let finished = false;
    unsub = await this.c.subscribeMessage<RawAssistEvent>((raw) => {
      const ev = mapAssistEvent(raw);
      if (!ev) return;
      if (ev.type === "run-start" && ev.sttBinaryHandlerId !== undefined) {
        handlerId = ev.sttBinaryHandlerId;
        for (const p of pending) sendChunk(p);
        pending = [];
        if (ended) sendEnd();
      }
      onEvent(ev);
      if (ev.type === "run-end" || ev.type === "error") {
        finished = true;
        void unsub?.();
        resolveDone();
      }
    }, msg);
    if (finished) void unsub();

    return {
      sendAudio: (chunk) => {
        if (ended) return;
        if (handlerId === undefined) pending.push(chunk);
        else sendChunk(chunk);
      },
      endAudio: () => {
        if (ended) return;
        ended = true;
        if (handlerId !== undefined) sendEnd();
      },
      cancel: () => {
        ended = true;
        void unsub?.();
        resolveDone();
      },
      done,
    };
  }

  resolveUrl(path: string): string {
    return /^https?:/.test(path) ? path : `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  }
}
