import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usePrefs, type CardSize, type LayoutFields, type PageLayout, type Prefs } from "./prefs";

/**
 * In-view edit mode ("Rediger"). The layout lives in the shared prefs row (home.db) and every change goes
 * through /api/dashedit as a validated op, so it lands in prefs_history (Angre / Tilbakestill) and syncs live.
 * Phone vs tablet/desktop: by default one layout everywhere ("Samme overalt"); with perDevice the phone
 * gets its own copy in prefs.phone.
 */
export type DeviceClass = "phone" | "wide";
const phoneNow = () => typeof window !== "undefined" && window.innerWidth < 768;
export function useDeviceClass(): DeviceClass {
  const [d, setD] = useState<DeviceClass>(phoneNow() ? "phone" : "wide");
  useEffect(() => { const on = () => setD(phoneNow() ? "phone" : "wide"); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []);
  return d;
}

const FIELDS = ["homeOrder", "hiddenCards", "addedCards", "cardSize", "titles", "tabOrder", "hiddenTabs", "pages"] as const;
export function effectiveLayout(p: Prefs, dev: DeviceClass): LayoutFields {
  const base: LayoutFields = {}; for (const k of FIELDS) (base as Record<string, unknown>)[k] = p[k];
  return p.perDevice && dev === "phone" && p.phone ? { ...base, ...p.phone } : base;
}

/** Nav tabs that can be ordered / hidden (Hjem and Innstillinger are always there). */
export const TAB_DEFS: { key: string; label: string }[] = [
  { key: "rooms", label: "Rom" }, { key: "kalender", label: "Kalender" }, { key: "barn", label: "Barn" }, { key: "luft", label: "Luft" }, { key: "energy", label: "Energi" },
  { key: "chat", label: "Assistent" }, { key: "notater", label: "Notater" }, { key: "robots", label: "Roboter" }, { key: "vedlikehold", label: "Vedlikehold" },
  { key: "sonos", label: "Sonos" }, { key: "spotify", label: "Spotify" }, { key: "lydboker", label: "Lydbøker" }, { key: "oda", label: "Oda" },
];
export const orderBy = (keys: string[], order?: string[]) => { const o = (order ?? []).filter((k) => keys.includes(k)); return [...o, ...keys.filter((k) => !o.includes(k))]; };

interface EditCtx {
  editing: boolean; setEditing: (v: boolean) => void;
  dev: DeviceClass; layout: LayoutFields; prefs: Prefs;
  /** Write layout fields to the current target (phone copy when perDevice on a phone). */
  patch: (fields: Partial<Record<keyof LayoutFields, unknown>>, summary: string) => Promise<boolean>;
  page: (tab: string) => PageLayout;
  patchPage: (tab: string, pg: PageLayout, summary: string) => Promise<boolean>;
  title: (key: string, fallback: string) => string;
  tabs: () => { key: string; label: string; hidden: boolean }[];
  visibleTabs: () => string[];
}
const Ctx = createContext<EditCtx | null>(null);

export function EditProvider({ children }: { children: ReactNode }) {
  const { prefs, edit } = usePrefs();
  const [editing, setEditingRaw] = useState(false);
  const dev = useDeviceClass();
  const layout = effectiveLayout(prefs, dev);
  const target = prefs.perDevice && dev === "phone" ? "phone" : "main";
  const setEditing = useCallback((v: boolean) => { setEditingRaw(v); document.documentElement.toggleAttribute("data-editing", v); if (v) navigator.vibrate?.(10); }, []);
  useEffect(() => {
    const on = () => setEditing(true);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && document.documentElement.hasAttribute("data-editing") && !(e.target instanceof HTMLInputElement)) setEditing(false); };
    window.addEventListener("home:edit", on); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("home:edit", on); window.removeEventListener("keydown", esc); };
  }, [setEditing]);
  const patch: EditCtx["patch"] = (fields, summary) => edit([{ op: "layout", target, fields }], summary);
  const page = (tab: string) => layout.pages?.[tab] ?? {};
  const patchPage: EditCtx["patchPage"] = (tab, pg, summary) => patch({ pages: { ...(layout.pages ?? {}), [tab]: pg } }, summary);
  const title = (key: string, fallback: string) => layout.titles?.[key] ?? fallback;
  const tabs = () => orderBy(TAB_DEFS.map((t) => t.key), layout.tabOrder).map((k) => ({ ...TAB_DEFS.find((t) => t.key === k)!, hidden: (layout.hiddenTabs ?? []).includes(k) }));
  const visibleTabs = () => tabs().filter((t) => !t.hidden).map((t) => t.key);
  return <Ctx.Provider value={{ editing, setEditing, dev, layout, prefs, patch, page, patchPage, title, tabs, visibleTabs }}>{children}</Ctx.Provider>;
}

export function useEdit(): EditCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("EditProvider missing");
  return c;
}
export const startEditing = () => window.dispatchEvent(new Event("home:edit"));
export type { CardSize };
