/** Minimal typed view of Home Assistant data the UI cares about. */
export interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export type EntityMap = Record<string, EntityState>;

export interface Area {
  area_id: string;
  name: string;
  icon?: string | null;
  floor_id?: string | null;
  picture?: string | null;
}

export interface Device {
  id: string;
  name: string | null;
  name_by_user?: string | null;
  area_id: string | null;
  manufacturer?: string | null;
  model?: string | null;
}

export interface EntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  area_id: string | null;
  name?: string | null;
  icon?: string | null;
  hidden_by?: string | null;
  disabled_by?: string | null;
  entity_category?: "config" | "diagnostic" | null;
  platform?: string;
}

export interface Registries {
  areas: Area[];
  devices: Device[];
  entities: EntityRegistryEntry[];
}

export interface ServiceCall {
  domain: string;
  service: string;
  data?: Record<string, unknown>;
  target: { entity_id: string | string[] };
}

export interface HistoryPoint {
  /** epoch ms */
  t: number;
  /** numeric value (NaN when not numeric) */
  v: number;
  s: string;
}

export type HistoryMap = Record<string, HistoryPoint[]>;

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "auth-failed" | "error";

export interface AssistCapabilities {
  pipelineId: string | null;
  pipelineName: string | null;
  stt: boolean;
  tts: boolean;
  language: string;
}

export type AssistEvent =
  | { type: "run-start"; sttBinaryHandlerId?: number }
  | { type: "stt-vad-start" }
  | { type: "stt-vad-end" }
  | { type: "stt-end"; text: string }
  | { type: "intent-end"; speech: string; conversationId?: string | null; responseType?: string }
  | { type: "tts-end"; url: string }
  | { type: "error"; code: string; message: string }
  | { type: "run-end" };

export interface AssistRunOptions {
  pipelineId?: string | null;
  conversationId?: string | null;
  /** Text input: runs intent (+tts if requested). */
  text?: string;
  /** Audio input: runs stt -> intent (-> tts). */
  audio?: { sampleRate: number };
  tts: boolean;
}

export interface AssistRun {
  /** Push 16-bit little-endian mono PCM. */
  sendAudio(chunk: Int16Array): void;
  /** Signal end of audio stream. */
  endAudio(): void;
  cancel(): void;
  done: Promise<void>;
}

export interface HomeBackend {
  readonly kind: "live" | "mock";
  connect(onStatus: (s: ConnectionStatus, detail?: string) => void): Promise<void>;
  disconnect(): void;
  subscribeEntities(cb: (entities: EntityMap) => void): () => void;
  getRegistries(): Promise<Registries>;
  callService(call: ServiceCall): Promise<void>;
  history(entityIds: string[], hours: number): Promise<HistoryMap>;
  assistCapabilities(): Promise<AssistCapabilities>;
  runAssist(opts: AssistRunOptions, onEvent: (e: AssistEvent) => void): Promise<AssistRun>;
  /** Absolute URL for an HA-relative path (tts media, entity pictures). */
  resolveUrl(path: string): string;
}
