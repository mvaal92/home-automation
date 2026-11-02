import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  buildRooms, healthIssues, quickActions, type EntityState, type HistoryMap, type HomeSnapshot, type HomeStore, type ServiceCall, appliances, automationHelpers, cameras, homeMode, visibleStates } from "@home/core";

const Ctx = createContext<HomeStore | null>(null);

export function HomeProvider({ store, children }: { store: HomeStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): HomeStore {
  const s = useContext(Ctx);
  if (!s) throw new Error("HomeProvider missing");
  return s;
}

export function useSnapshot(): HomeSnapshot {
  const s = useStore();
  return useSyncExternalStore(s.subscribe, s.getSnapshot);
}

export function useEntity(id: string | null | undefined): EntityState | undefined {
  const snap = useSnapshot();
  return id ? snap.entities[id] : undefined;
}

export function useCall() {
  const s = useStore();
  return useCallback((call: ServiceCall) => s.call(call).catch(() => undefined), [s]);
}

export function useRooms() {
  const snap = useSnapshot();
  return useMemo(() => buildRooms(snap.registries, snap.entities), [snap.registries, snap.entities]);
}

export function useAppliances() {
  const snap = useSnapshot();
  return useMemo(() => appliances(snap.registries, snap.entities), [snap.registries, snap.entities]);
}

export function useCameras() {
  const snap = useSnapshot();
  return useMemo(() => cameras(snap.registries, snap.entities), [snap.registries, snap.entities]);
}

/** Ticks every `ms` so relative times ("6 min ago") stay fresh. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function useHomeMode() {
  const snap = useSnapshot();
  return useMemo(() => homeMode(snap.entities), [snap.entities]);
}

export function useHelpers() {
  const snap = useSnapshot();
  return useMemo(() => automationHelpers(snap.registries, snap.entities), [snap.registries, snap.entities]);
}

/** Entities the UI may show (hidden twins / config / diagnostic removed). */
export function useVisibleEntities() {
  const snap = useSnapshot();
  return useMemo(() => visibleStates(snap.registries, snap.entities), [snap.registries, snap.entities]);
}

const DISMISS_KEY = "home.dismissedHealth";
/** Health alerts the user has dismissed (known-offline devices such as a seasonal plug). Stored per device. */
export function useDismissed(): [Set<string>, (key: string, dismissed: boolean) => void] {
  const [set, setSet] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]") as string[]); } catch { return new Set(); } });
  useEffect(() => {
    const on = () => { try { setSet(new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]") as string[])); } catch { /* ignore */ } };
    window.addEventListener("home-dismissed", on);
    return () => window.removeEventListener("home-dismissed", on);
  }, []);
  const toggle = useCallback((key: string, dismissed: boolean) => {
    let next: Set<string>;
    try { next = new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]") as string[]); } catch { next = new Set(set); }
    if (dismissed) next.add(key); else next.delete(key);
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
    setSet(next);
    window.dispatchEvent(new Event("home-dismissed"));
  }, [set]);
  return [set, toggle];
}

export function useHealth() {
  const snap = useSnapshot();
  return useMemo(() => healthIssues(snap.registries, snap.entities), [snap.registries, snap.entities]);
}

export function useQuickActions() {
  const snap = useSnapshot();
  return useMemo(() => quickActions(snap.entities, snap.registries), [snap.entities, snap.registries]);
}

/** Fetch history for sparklines; refreshes every 5 minutes. */
export function useHistory(ids: string[], hours = 24): HistoryMap {
  const s = useStore();
  const [data, setData] = useState<HistoryMap>({});
  const key = ids.join(",");
  useEffect(() => {
    let alive = true;
    const list = key ? key.split(",") : [];
    const load = () => s.backend.history(list, hours).then((h) => alive && setData(h)).catch(() => undefined);
    void load();
    const t = setInterval(load, 300_000);
    return () => { alive = false; clearInterval(t); };
  }, [s, key, hours]);
  return data;
}

/** Debounce helper for sliders: update UI locally, send at most every `ms`. */
export function useThrottled<T>(fn: (v: T) => void, ms = 120) {
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<T | null>(null);
  return useCallback((v: T, final = false) => {
    latest.current = v;
    const now = Date.now();
    if (timer.current) clearTimeout(timer.current);
    if (final || now - last.current >= ms) { last.current = now; fn(v); return; }
    timer.current = setTimeout(() => { last.current = Date.now(); fn(latest.current as T); }, ms);
  }, [fn, ms]);
}
