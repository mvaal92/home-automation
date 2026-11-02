import { useCallback, useEffect, useState } from "react";

/** Hvileskjerm settings (prefs row "hvile" in home.db via /api/ambient/settings) + per-device overrides. */
export type HvileMode = "art" | "gradient" | "photos";
export interface DeviceHvile { timeoutMin?: number; mode?: HvileMode; label?: string }
export interface HvileSettings {
  timeoutMin?: number; mode?: HvileMode; collections?: string[]; nightDim?: boolean; nightFrom?: number; nightTo?: number; phone?: boolean; intervalMin?: number;
  devices?: Record<string, DeviceHvile>;
  trigger?: { action: "start" | "stop"; at: number; device: string; mode?: HvileMode };
  updatedAt?: number;
}
export const COLLECTIONS: { id: string; label: string }[] = [
  { id: "nordisk", label: "Nordiske landskap" }, { id: "munch", label: "Munch" }, { id: "rolig", label: "Rolige klassikere" },
];
export const DEFAULTS = { timeoutMin: 3, mode: "art" as HvileMode, collections: ["nordisk", "munch", "rolig"], nightDim: true, nightFrom: 23, nightTo: 6, phone: false, intervalMin: 5 };

export function deviceId(): string {
  let id = localStorage.getItem("home.deviceId");
  if (!id) { id = `d${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem("home.deviceId", id); }
  return id;
}
export function deviceKind(): "phone" | "ipad" | "desktop" {
  const touch = matchMedia("(pointer: coarse)").matches;
  const w = Math.min(screen.width, screen.height);
  return touch && w < 600 ? "phone" : touch ? "ipad" : "desktop";
}
export const KIND_LABEL = { phone: "Mobil", ipad: "iPad", desktop: "PC" } as const;

/** Effective config for this device. timeoutMin 0 = off. Phones are off unless "phone" is on or the device has its own value. */
export function effective(s: HvileSettings, id = deviceId(), kind = deviceKind()) {
  const d = s.devices?.[id] ?? {};
  const base = { ...DEFAULTS, ...s };
  let timeoutMin = d.timeoutMin ?? base.timeoutMin;
  if (kind === "phone" && d.timeoutMin == null && !base.phone) timeoutMin = 0;
  return { ...base, timeoutMin, mode: d.mode ?? base.mode, own: d.timeoutMin != null || d.mode != null };
}

export function useHvileSettings() {
  const [s, setS] = useState<HvileSettings>(() => { try { return JSON.parse(localStorage.getItem("home.hvile") ?? "{}"); } catch { return {}; } });
  const load = useCallback(async () => {
    try { const r = await fetch("/api/ambient/settings", { cache: "no-store" }); if (!r.ok) return; const j = (await r.json()) as HvileSettings; localStorage.setItem("home.hvile", JSON.stringify(j)); setS(j); } catch { /* offline: keep cached */ }
  }, []);
  useEffect(() => {
    void load();
    let es: EventSource | null = null; let first = true;
    try { es = new EventSource("/api/prefs/events"); es.onmessage = () => { if (first) { first = false; return; } void load(); }; } catch { /* */ }
    const t = setInterval(() => void load(), 60_000);
    const onLocal = () => void load(); window.addEventListener("home:hvile-settings", onLocal);
    return () => { es?.close(); clearInterval(t); window.removeEventListener("home:hvile-settings", onLocal); };
  }, [load]);
  const save = useCallback(async (patch: Partial<HvileSettings>) => {
    setS((cur) => ({ ...cur, ...patch, devices: patch.devices ? { ...(cur.devices ?? {}), ...patch.devices } : cur.devices }));
    try { await fetch("/api/ambient/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }); } catch { /* */ }
    window.dispatchEvent(new Event("home:hvile-settings"));
  }, []);
  return { settings: s, save, reload: load };
}

export const startHvile = (mode?: HvileMode) => window.dispatchEvent(new CustomEvent("home:hvile-start", { detail: mode }));
export const isNight = (d: Date, from = 23, to = 6) => { const h = d.getHours(); return from > to ? h >= from || h < to : h >= from && h < to; };
