import type { ConnectionStatus, EntityMap, EntityState, HomeBackend, Registries, ServiceCall } from "./types";
import { predictState, targetIds } from "./optimistic";

export interface HomeSnapshot {
  status: ConnectionStatus;
  statusDetail?: string;
  /** Server state merged with pending optimistic patches. */
  entities: EntityMap;
  registries: Registries;
  pending: ReadonlySet<string>;
  lastError?: { message: string; at: number };
}

const EMPTY_REG: Registries = { areas: [], devices: [], entities: [] };
/** How long an optimistic patch survives without server confirmation. */
export const OPTIMISTIC_TTL_MS = 5000;

/**
 * Framework-agnostic store. Holds server truth plus optimistic overlays and
 * exposes a subscribe/getSnapshot pair suited to React's useSyncExternalStore.
 */
export class HomeStore {
  private server: EntityMap = {};
  private overlay = new Map<string, { state: EntityState; expires: number }>();
  private snap: HomeSnapshot = { status: "idle", entities: {}, registries: EMPTY_REG, pending: new Set() };
  private listeners = new Set<() => void>();
  private unsubEntities: (() => void) | null = null;
  private sweep: ReturnType<typeof setInterval> | null = null;

  constructor(public readonly backend: HomeBackend, private readonly clock: () => number = Date.now) {}

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): HomeSnapshot => this.snap;

  private publish(patch: Partial<HomeSnapshot> = {}) {
    const entities: EntityMap = { ...this.server };
    for (const [id, o] of this.overlay) entities[id] = o.state;
    this.snap = { ...this.snap, ...patch, entities, pending: new Set(this.overlay.keys()) };
    for (const l of this.listeners) l();
  }

  private generation = 0;

  async start(): Promise<void> {
    const gen = ++this.generation;
    await this.backend.connect((status, detail) => {
      if (gen !== this.generation) return;
      this.publish({ status, statusDetail: detail });
      if (status === "connected" && this.unsubEntities) void this.refreshRegistries();
    });
    if (gen !== this.generation) return; // stopped while connecting
    this.unsubEntities = this.backend.subscribeEntities((ents) => this.onServer(ents));
    await this.refreshRegistries();
    this.sweep = setInterval(() => this.expireOverlays(), 1000);
  }

  stop(): void {
    this.generation++;
    this.unsubEntities?.();
    this.unsubEntities = null;
    if (this.sweep) clearInterval(this.sweep);
    this.backend.disconnect();
  }

  async refreshRegistries(): Promise<void> {
    try {
      const registries = await this.backend.getRegistries();
      this.publish({ registries });
    } catch (err) {
      this.publish({ lastError: { message: `Registry: ${String(err)}`, at: this.clock() } });
    }
  }

  /** Server push: confirmed state replaces any overlay once it changes. */
  onServer(ents: EntityMap): void {
    const prev = this.server;
    this.server = ents;
    for (const [id] of this.overlay) {
      const before = prev[id];
      const after = ents[id];
      if (!after || !before || after.last_updated !== before.last_updated) this.overlay.delete(id);
    }
    this.publish();
  }

  expireOverlays(): void {
    const now = this.clock();
    let changed = false;
    for (const [id, o] of this.overlay) if (o.expires <= now) { this.overlay.delete(id); changed = true; }
    if (changed) this.publish();
  }

  /** Call a service with optimistic UI. Reverts on failure. */
  async call(call: ServiceCall): Promise<void> {
    const ids = targetIds(call);
    for (const id of ids) {
      const cur = this.snap.entities[id];
      const predicted = cur ? predictState(cur, call) : null;
      if (predicted) this.overlay.set(id, { state: predicted, expires: this.clock() + OPTIMISTIC_TTL_MS });
    }
    this.publish();
    try {
      await this.backend.callService(call);
    } catch (err) {
      for (const id of ids) this.overlay.delete(id);
      this.publish({ lastError: { message: err instanceof Error ? err.message : String(err), at: this.clock() } });
      throw err;
    }
  }
}
