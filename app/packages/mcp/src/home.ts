import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { HaBackend, buildRooms, domainOf, friendlyName, healthIssues, type EntityMap, type EntityState, type Registries } from "@home/core";

export interface HomeLinkOptions { url: string; tokenFile: string }

export const defaultOptions = (): HomeLinkOptions => ({
  url: process.env.HOME_HA_URL ?? "http://127.0.0.1:8123",
  tokenFile: (process.env.HOME_HA_TOKEN_FILE ?? "~/home-automation/secrets/ha_token").replace(/^~/, homedir()),
});

const log = (...a: unknown[]) => console.error("[home-mcp]", ...a); // stderr: stdout is reserved in stdio mode

/** One long-lived HA websocket shared by every MCP request: live entity cache + cached registries. */
export class HomeLink {
  private be: HaBackend | null = null;
  private entities: EntityMap = {};
  private reg: Registries | null = null;
  private regAt = 0;
  private ready: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly opts: HomeLinkOptions = defaultOptions()) {}

  private connect(): Promise<void> {
    this.ready ??= (async () => {
      const token = readFileSync(this.opts.tokenFile, "utf8").trim();
      const be = new HaBackend({ url: this.opts.url, token });
      await be.connect((s, d) => { if (s !== "connected") log("HA status", s, d ?? ""); });
      let first: () => void = () => {};
      const got = new Promise<void>((r) => (first = r));
      be.subscribeEntities((e) => { this.entities = e; first(); for (const l of this.listeners) l(); });
      await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error("timed out waiting for HA states")), 15000))]);
      this.be = be;
      log(`connected to ${this.opts.url}: ${Object.keys(this.entities).length} entities`);
    })().catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }

  async backend(): Promise<HaBackend> { await this.connect(); return this.be!; }
  async states(): Promise<EntityMap> { await this.connect(); return this.entities; }
  async state(id: string): Promise<EntityState | undefined> { return (await this.states())[id]; }

  async registries(force = false): Promise<Registries> {
    const be = await this.backend();
    if (force || !this.reg || Date.now() - this.regAt > 60_000) { this.reg = await be.getRegistries(); this.regAt = Date.now(); }
    return this.reg;
  }

  /** Resolves when `pred` holds for the current states, or after `ms` (returns false). */
  waitFor(pred: (e: EntityMap) => boolean, ms = 4000): Promise<boolean> {
    if (pred(this.entities)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok: boolean) => { clearTimeout(t); this.listeners.delete(l); resolve(ok); };
      const l = () => { if (pred(this.entities)) done(true); };
      const t = setTimeout(() => done(false), ms);
      this.listeners.add(l);
    });
  }

  /** entity_id -> area_id (entity override first, then its device's area). */
  async areaIndex(): Promise<Map<string, string | null>> {
    const reg = await this.registries();
    const devArea = new Map(reg.devices.map((d) => [d.id, d.area_id ?? null]));
    const out = new Map<string, string | null>();
    for (const e of reg.entities) out.set(e.entity_id, e.area_id ?? (e.device_id ? devArea.get(e.device_id) ?? null : null));
    return out;
  }

  /** Match an area by id or (case/diacritic-insensitive) name. */
  async findArea(q: string) {
    const reg = await this.registries();
    const n = norm(q);
    return reg.areas.find((a) => a.area_id === q) ?? reg.areas.find((a) => norm(a.name) === n) ?? reg.areas.find((a) => norm(a.name).includes(n));
  }

  async rooms() { return buildRooms(await this.registries(), await this.states()); }
  async health() { return healthIssues(await this.registries(), await this.states()); }

  close(): void { this.be?.disconnect(); this.be = null; this.ready = null; }
}

export const norm = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ø/g, "o").replace(/æ/g, "ae").toLowerCase().trim();
export const nameOf = (e: EntityState) => friendlyName(e);
export { domainOf };
