import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** Dashboard state shared across devices: stored in SQLite on omarchy via /api/prefs, cached in localStorage. */
export interface Prefs {
  pinnedRoutines: string[];
  pinnedLights: string[];
  collapsed: string[];
  sidebar: "full" | "rail";
  theme: "system" | "dark" | "light";
  stt?: "local" | "openai";
  assistantMode?: "auto" | "local";
  luftPinned?: boolean;
  /** Home card order / hidden cards / hidden nav tabs – editable by the assistant (dashboard_apply). */
  homeOrder?: string[];
  hiddenCards?: string[];
  hiddenTabs?: string[];
  nav?: "klassisk" | "flyt";
  /** In-view edit mode ("Rediger") – see lib/layout.ts. */
  addedCards?: string[];
  cardSize?: Record<string, CardSize>;
  titles?: Record<string, string>;
  tabOrder?: string[];
  pages?: Record<string, PageLayout>;
  perDevice?: boolean;
  phone?: Partial<LayoutFields>;
  layouts?: Record<string, LayoutFields & { perDevice?: boolean; phone?: Partial<LayoutFields> }>;
  activeLayout?: string;
  updatedAt: number;
}
export type CardSize = "s" | "m" | "l" | "full";
export interface PageLayout { order?: string[]; hidden?: string[]; size?: Record<string, CardSize>; start?: string }
export type LayoutFields = Pick<Prefs, "homeOrder" | "hiddenCards" | "addedCards" | "cardSize" | "titles" | "tabOrder" | "hiddenTabs" | "pages">;
export type EditOp = { op: string; [k: string]: unknown };

export const DEFAULT_PREFS: Prefs = {
  pinnedRoutines: ["script.leave_home", "script.arrive_home", "script.bedtime", "script.all_off"],
  pinnedLights: [
    "light.spisestue_taklampe_spisebord", "light.kjokken_taklamper_kjokken_1", "light.tv_stue_tv_lys",
    "light.inngangspart_inngangsparti", "light.kjokken_bordlampe",
  ],
  collapsed: [],
  sidebar: "full",
  theme: "system",
  updatedAt: 0,
};

const LS = "home.prefs.v1";
/** Theme is per device (phone in light, iPad in dark …): kept in its own key, never taken from the server. */
const LS_THEME = "home.theme";
const readTheme = (): Prefs["theme"] => { try { const t = localStorage.getItem(LS_THEME); return t === "light" || t === "dark" ? t : "system"; } catch { return "system"; } };
const API = "/api/prefs/dashboard";
export type SyncState = "local" | "synced" | "saving" | "offline";

function readLocal(): Prefs {
  try {
    const legacySidebar = localStorage.getItem("home.sidebar") === "rail" ? "rail" : "full";
    return { ...DEFAULT_PREFS, sidebar: legacySidebar, ...(JSON.parse(localStorage.getItem(LS) ?? "{}") as Partial<Prefs>), theme: readTheme() };
  } catch { return DEFAULT_PREFS; }
}

interface Ctx {
  prefs: Prefs; sync: SyncState; update: (fn: (p: Prefs) => Prefs) => void;
  /** Validated layout ops through /api/dashedit (recorded in prefs_history, so Angre works). */
  edit: (ops: EditOp[], summary?: string) => Promise<boolean>;
  undo: () => Promise<string | null>;
}
const PrefsCtx = createContext<Ctx | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(readLocal);
  const [sync, setSync] = useState<SyncState>("local");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const latest = useRef(prefs);
  latest.current = prefs;

  const pull = useCallback(async () => {
    if (dirty.current) return;
    try {
      const r = await fetch(API, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { value: Partial<Prefs> | null };
      if (j.value && (j.value.updatedAt ?? 0) >= latest.current.updatedAt && !dirty.current) {
        const next = { ...DEFAULT_PREFS, ...j.value, theme: latest.current.theme };
        localStorage.setItem(LS, JSON.stringify(next));
        setPrefs(next);
      } else if (!j.value || (j.value.updatedAt ?? 0) < latest.current.updatedAt) {
        void push(); // local is newer (made offline) or server empty: seed it
      }
      setSync("synced");
    } catch { setSync("offline"); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const push = useCallback(async () => {
    setSync("saving");
    try {
      const r = await fetch(API, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(latest.current) });
      if (!r.ok) throw new Error(String(r.status));
      dirty.current = false;
      setSync("synced");
    } catch { setSync("offline"); }
  }, []);

  useEffect(() => {
    void pull();
    const onVis = () => { if (document.visibilityState === "visible") void pull(); };
    const onRefresh = () => void pull(); // the assistant changed the layout server-side
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("home:prefs-refresh", onRefresh);
    const t = setInterval(() => void pull(), 30_000);
    // live sync: the server pings when any prefs row changes (other devices, assistant, edit mode)
    let es: EventSource | null = null; let first = true;
    try { es = new EventSource("/api/prefs/events"); es.onmessage = () => { if (first) { first = false; return; } void pull(); }; } catch { /* old browser: polling only */ }
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("home:prefs-refresh", onRefresh); clearInterval(t); es?.close(); };
  }, [pull]);

  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", prefs.theme);
    try { localStorage.setItem(LS_THEME, prefs.theme); } catch { /* private mode */ }
    // status bar / browser chrome colour follows the resolved theme (Auto follows the phone live)
    const mq = matchMedia("(prefers-color-scheme: light)");
    const paint = () => {
      const light = prefs.theme === "light" || (prefs.theme === "system" && mq.matches);
      const bg = light ? "#f4f4f2" : "#0c0c0d";
      document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => { m.content = bg; m.removeAttribute("media"); });
      document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.setAttribute("content", light ? "light" : "dark");
    };
    paint(); mq.addEventListener("change", paint);
    return () => mq.removeEventListener("change", paint);
  }, [prefs.theme]);

  const update = useCallback((fn: (p: Prefs) => Prefs) => {
    setPrefs((p) => {
      const next = { ...fn(p), updatedAt: Date.now() };
      localStorage.setItem(LS, JSON.stringify(next));
      latest.current = next;
      return next;
    });
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void push(), 600);
  }, [push]);

  const adopt = (v: Partial<Prefs>) => { const next = { ...DEFAULT_PREFS, ...v } as Prefs; localStorage.setItem(LS, JSON.stringify(next)); latest.current = next; setPrefs(next); setSync("synced"); };
  const flush = async () => { if (dirty.current) { if (timer.current) clearTimeout(timer.current); await push(); } };
  const edit = useCallback(async (ops: EditOp[], summary?: string) => {
    await flush(); setSync("saving");
    try {
      const r = await fetch("/api/dashedit/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops, source: "rediger", summary }) });
      const j = (await r.json()) as { prefs?: Partial<Prefs>; error?: string };
      if (!r.ok || !j.prefs) throw new Error(j.error ?? String(r.status));
      adopt(j.prefs); return true;
    } catch (e) { setSync("offline"); window.dispatchEvent(new CustomEvent("home:toast", { detail: `Kunne ikke lagre: ${(e as Error).message}` })); return false; }
  }, [push]); // eslint-disable-line react-hooks/exhaustive-deps
  const undo = useCallback(async () => {
    await flush();
    try {
      const r = await fetch("/api/dashedit/undo", { method: "POST" });
      const j = (await r.json()) as { prefs?: Partial<Prefs>; undone?: string; error?: string };
      if (!r.ok || !j.prefs) return null;
      adopt(j.prefs); return j.undone ?? "";
    } catch { return null; }
  }, [push]); // eslint-disable-line react-hooks/exhaustive-deps

  return <PrefsCtx.Provider value={{ prefs, sync, update, edit, undo }}>{children}</PrefsCtx.Provider>;
}

export function usePrefs(): Ctx {
  const c = useContext(PrefsCtx);
  if (!c) throw new Error("PrefsProvider missing");
  return c;
}

const kindOf = (id: string) => (id.startsWith("light.") ? "pinnedLights" : "pinnedRoutines") as "pinnedLights" | "pinnedRoutines";
export const pinnable = (id: string) => /^(light|script|scene)\./.test(id);

export function usePin(id: string | null | undefined): [boolean, () => void] {
  const { prefs, update } = usePrefs();
  if (!id || !pinnable(id)) return [false, () => undefined];
  const k = kindOf(id);
  const on = prefs[k].includes(id);
  return [on, () => update((p) => ({ ...p, [k]: on ? p[k].filter((x) => x !== id) : [...p[k], id] }))];
}

export function useCollapsed(section: string): [boolean, () => void] {
  const { prefs, update } = usePrefs();
  const c = prefs.collapsed.includes(section);
  return [c, () => update((p) => ({ ...p, collapsed: c ? p.collapsed.filter((x) => x !== section) : [...p.collapsed, section] }))];
}

export function moveIn(list: string[], id: string, dir: -1 | 1): string[] {
  const i = list.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const n = [...list]; [n[i], n[j]] = [n[j]!, n[i]!]; return n;
}

/** Ask PrefsProvider to re-read the server copy now (after an assistant layout change). */
export const refreshPrefs = () => window.dispatchEvent(new Event("home:prefs-refresh"));
export const tabVisible = (p: Prefs, tab: string) => !(p.hiddenTabs ?? []).includes(tab);
