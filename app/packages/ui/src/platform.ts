/**
 * Platform adapter: where connection settings live.
 *  - Electron: window.homeBridge (main process, token encrypted with safeStorage)
 *  - iOS (Capacitor): SecureStoragePlugin -> iOS Keychain
 *  - Web/dev: localStorage (token optional via dev server /__dev/ha-config)
 */
export interface HomeConfig {
  url: string;
  token: string;
  mock: boolean;
  /** Web only: use the hosting server's same-origin /ha proxy (token injected server-side). */
  proxy?: boolean;
}

import { HA_FALLBACK_URLS, firstReachable } from "@home/core";

export const PROXY_TOKEN = "proxy";
let proxyAvailable = false;
/** True when served by apps/web-server over Tailscale (zero-setup mode). */
export const hasProxy = () => proxyAvailable;
export const proxyUrl = () => `${location.origin}/ha`;

export const DEFAULT_URL: string = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_HA_URL ?? "http://homeassistant.local:8123";

export interface HomeBridge {
  platform: string;
  getConfig(): Promise<Partial<HomeConfig> & { secureBackend?: string }>;
  setConfig(cfg: HomeConfig): Promise<{ ok: boolean; secureBackend?: string }>;
}

interface CapSecure {
  get(o: { key: string }): Promise<{ value: string }>;
  set(o: { key: string; value: string }): Promise<{ value: boolean }>;
}
interface CapGlobal {
  isNativePlatform(): boolean;
  getPlatform(): string;
  Plugins: { SecureStoragePlugin?: CapSecure };
}

declare global {
  interface Window {
    homeBridge?: HomeBridge;
    Capacitor?: CapGlobal;
  }
}

const LS_KEY = "home.config";
const forceMock = import.meta.env.VITE_HOME_MOCK === "1" || new URLSearchParams(location.search).has("mock");

export function platformName(): string {
  if (window.homeBridge) return `desktop (${window.homeBridge.platform})`;
  if (window.Capacitor?.isNativePlatform()) return window.Capacitor.getPlatform();
  return "web";
}

export function secureStoreLabel(backend?: string): string {
  if (window.homeBridge) return backend ? `Electron safeStorage (${backend})` : "Electron safeStorage";
  if (window.Capacitor?.isNativePlatform()) return "iOS Keychain";
  if (backend === "server-side proxy") return "the Home server (token never reaches the browser)";
  return "this browser's localStorage";
}

export async function loadConfig(): Promise<HomeConfig & { secureBackend?: string }> {
  let cfg: Partial<HomeConfig> & { secureBackend?: string } = {};
  if (window.homeBridge) {
    cfg = await window.homeBridge.getConfig();
  } else if (window.Capacitor?.isNativePlatform() && window.Capacitor.Plugins.SecureStoragePlugin) {
    try {
      cfg = JSON.parse((await window.Capacitor.Plugins.SecureStoragePlugin.get({ key: LS_KEY })).value) as Partial<HomeConfig>;
    } catch { cfg = {}; }
  } else {
    try { cfg = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as Partial<HomeConfig>; } catch { cfg = {}; }
    if (!import.meta.env.DEV) {
      try {
        const r = await fetch("./app-config.json", { cache: "no-store" });
        if (r.ok) proxyAvailable = ((await r.json()) as { proxy?: boolean }).proxy === true;
      } catch { /* static hosting without the server */ }
      // Zero setup: default to the proxy unless the user configured a direct connection.
      if (proxyAvailable && (cfg.proxy ?? !cfg.token)) cfg = { ...cfg, proxy: true, mock: cfg.mock ?? false };
    }
    if (import.meta.env.DEV && !cfg.token) {
      try {
        const r = await fetch("/__dev/ha-config", { cache: "no-store" });
        if (r.ok) {
          const dev = (await r.json()) as { token: string; url: string | null };
          cfg = { ...cfg, token: dev.token, url: cfg.url ?? dev.url ?? undefined };
        }
      } catch { /* no dev token */ }
    }
  }
  if (cfg.proxy && proxyAvailable) {
    return { url: proxyUrl(), token: PROXY_TOKEN, proxy: true, mock: forceMock || cfg.mock === true, secureBackend: "server-side proxy" };
  }
  // Direct mode: if no URL was chosen (or it is one of the known servers), use the first reachable one (omarchy, then Mac mini).
  let url = cfg.url || DEFAULT_URL;
  if (!forceMock && cfg.token && HA_FALLBACK_URLS.includes(url)) url = (await firstReachable([url, ...HA_FALLBACK_URLS.filter((u) => u !== url)], "/api/")) ?? url;
  const out = { url, token: cfg.token ?? "", mock: forceMock || cfg.mock === true, proxy: false, secureBackend: cfg.secureBackend };
  if (!out.token && !forceMock && cfg.mock === undefined) out.mock = true; // first run: show the demo
  return out;
}

export async function saveConfig(cfg: HomeConfig): Promise<void> {
  if (window.homeBridge) { await window.homeBridge.setConfig(cfg); return; }
  if (window.Capacitor?.isNativePlatform() && window.Capacitor.Plugins.SecureStoragePlugin) {
    await window.Capacitor.Plugins.SecureStoragePlugin.set({ key: LS_KEY, value: JSON.stringify(cfg) });
    return;
  }
  // In proxy mode the URL/token are derived, so only persist the choice.
  localStorage.setItem(LS_KEY, JSON.stringify(cfg.proxy ? { proxy: true, mock: cfg.mock } : { ...cfg, proxy: false }));
}
