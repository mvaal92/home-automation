import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import {
  Home as HomeIcon, LayoutGrid, MessageCircle, Speaker, Music2, ShoppingCart, Headphones, StickyNote, Bot, Wrench, Baby, Wind, Zap, CalendarDays,
  Settings as SettingsIcon, Mic, Search, CornerDownLeft, Sparkles, Lightbulb, Play, DoorOpen, ArrowRight, Command, Pencil, MoonStar,
} from "lucide-react";
import { useCall, useQuickActions, useRooms } from "../lib/home";
import { areaIcon } from "../lib/icons";
import { usePrefs } from "../lib/prefs";
import { startEditing, useEdit, orderBy } from "../lib/layout";
import { startHvile } from "../lib/hvile";

/** Tabs the user hid in edit mode are left out of the dock, pill, radial menu, swipe pager and palette; order follows tabOrder. */
function useNavKeys() { const ed = useEdit(); const vis = ed.visibleTabs(); const custom = !!ed.layout.tabOrder;
  return (keys: string[]) => { const k = keys.filter((x) => x === "home" || x === "settings" || vis.includes(x)); return custom ? [...k.filter((x) => x === "home"), ...orderBy(k.filter((x) => x !== "home" && x !== "settings"), vis), ...k.filter((x) => x === "settings")] : k; }; }
import "./altnav.css";

/* ───────────────────────── mode + transitions ───────────────────────── */

export type NavMode = "klassisk" | "flyt";
type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;

/** Navigation style stored in the shared prefs DB (`nav`), default "klassisk" (the sidebar). */
export function useNavMode(): [NavMode, (m: NavMode) => void] {
  const { prefs, update } = usePrefs();
  const mode = ((prefs as unknown as { nav?: NavMode }).nav ?? "klassisk") as NavMode;
  const set = useCallback((m: NavMode) => update((p) => ({ ...p, nav: m }) as typeof p), [update]);
  return [mode, set];
}

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
type VTDoc = Document & { startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> } };

/** Page order used for slide direction and phone swipe paging. */
export const PAGE_ORDER = ["home", "rooms", "room", "kalender", "barn", "luft", "chat", "notater", "robots", "vedlikehold", "energy", "sonos", "spotify", "lydboker", "oda", "settings"];
let lastPressed: Element | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (e) => {
    lastPressed = (e.target as Element | null)?.closest?.(".room-card, .tile, .card, .dock-item, .pill-item, .pal-item, button") ?? null;
  }, true);
}

/**
 * Run a route change. In "flyt" mode it becomes a View Transition: the pressed card morphs into the new
 * page title (shared element) and pages slide in the direction of travel. Falls back to an instant swap
 * when the API is missing or reduced motion is requested.
 */
export function navTransition(apply: () => void, fromKind: string, toKey: string) {
  const d = document as VTDoc;
  const root = document.documentElement;
  if (root.dataset.nav !== "flyt" || !d.startViewTransition || reduced()) { apply(); return; }
  const toKind = toKey.startsWith("room-") ? "room" : toKey;
  const dir = PAGE_ORDER.indexOf(toKind) >= PAGE_ORDER.indexOf(fromKind) ? "fwd" : "back";
  root.dataset.vtDir = dir;
  const hero = lastPressed instanceof HTMLElement && !lastPressed.closest(".dock, .pill, .palette, .sidebar") ? lastPressed : null;
  if (hero) hero.style.setProperty("view-transition-name", "nav-hero");
  const vt = d.startViewTransition(async () => {
    if (hero) hero.style.removeProperty("view-transition-name");
    flushSync(apply);
    // wait (max 300 ms) for the new page to mount; AnimatePresence swaps on the next frame
    for (let i = 0; i < 20; i++) {
      if (document.querySelector(`.main [data-route="${CSS.escape(toKey)}"]`)) break;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    const title = document.querySelector<HTMLElement>(`.main [data-route="${CSS.escape(toKey)}"] .page-title, .main [data-route="${CSS.escape(toKey)}"] h1`);
    if (hero && title) title.style.setProperty("view-transition-name", "nav-hero");
  });
  vt.finished.finally(() => {
    document.querySelectorAll<HTMLElement>("[style*='view-transition-name']").forEach((el) => el.style.removeProperty("view-transition-name"));
    delete root.dataset.vtDir;
  });
}

/* ───────────────────────── destinations ───────────────────────── */

interface Dest { key: string; label: string; icon: Icon; hint?: string }
export const DESTS: Dest[] = [
  { key: "home", label: "Hjem", icon: HomeIcon, hint: "Oversikt" },
  { key: "rooms", label: "Rom", icon: LayoutGrid },
  { key: "kalender", label: "Kalender", icon: CalendarDays, hint: "Familiekalender" },
  { key: "barn", label: "Barn", icon: Baby, hint: "Skole og barnehage" },
  { key: "luft", label: "Luft", icon: Wind, hint: "Ventilasjon og fukt" },
  { key: "chat", label: "Assistent", icon: MessageCircle, hint: "Grok" },
  { key: "notater", label: "Notater", icon: StickyNote },
  { key: "robots", label: "Roboter", icon: Bot, hint: "Støvsuger og gressklipper" },
  { key: "vedlikehold", label: "Vedlikehold", icon: Wrench, hint: "Filtre, avkalking" },
  { key: "energy", label: "Energi", icon: Zap },
  { key: "sonos", label: "Sonos", icon: Speaker },
  { key: "spotify", label: "Spotify", icon: Music2 },
  { key: "lydboker", label: "Lydbøker", icon: Headphones, hint: "Fabel" },
  { key: "oda", label: "Oda", icon: ShoppingCart, hint: "Handlekurv" },
  { key: "settings", label: "Innstillinger", icon: SettingsIcon },
];
const DOCK_KEYS = ["home", "rooms", "kalender", "barn", "luft", "chat", "notater", "robots", "vedlikehold", "sonos", "spotify", "oda"];
const PHONE_PILL = ["home", "rooms", "chat", "barn"];
const RADIAL = ["kalender", "luft", "notater", "robots", "sonos", "oda"];

/* ───────────────────────── fuzzy search ───────────────────────── */

export const norm = (s: string) => s.toLowerCase().replace(/ø/g, "o").replace(/æ/g, "ae").replace(/å/g, "a").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/** Subsequence fuzzy score (higher is better, -1 = no match). Rewards word starts, prefixes and runs. */
export function fuzzy(query: string, text: string): number {
  const q = norm(query).replace(/\s+/g, ""), t = norm(text);
  if (!q) return 0;
  if (t.startsWith(q)) return 1000 - t.length;
  const idx = t.indexOf(q);
  if (idx >= 0) return 800 - idx - t.length / 10;
  let score = 0, ti = 0, run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    const wordStart = found === 0 || /[\s\-_./]/.test(t[found - 1]!);
    run = found === ti ? run + 1 : 0;
    score += 10 + (wordStart ? 25 : 0) + run * 8 - Math.min(found - ti, 10);
    ti = found + 1;
  }
  return score - t.length / 5;
}

/* ───────────────────────── root component ───────────────────────── */

export interface AltNavProps {
  routeKind: string;
  routeKey: string;
  go: (kind: string, id?: string) => void;
  openDevice: (id: string) => void;
  openVoice: () => void;
  openChat: (q?: string) => void;
}

export function AltNav(props: AltNavProps) {
  const [mode] = useNavMode();
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "flyt") root.dataset.nav = "flyt"; else delete root.dataset.nav;
    return () => { delete root.dataset.nav; };
  }, [mode]);
  // Cmd/Ctrl+K opens the palette in flyt mode (capture phase so it wins over the classic voice shortcut).
  useEffect(() => {
    if (mode !== "flyt") return;
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); e.stopImmediatePropagation(); setPalette((o) => !o); }
      else if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener("keydown", down, true);
    const open = () => setPalette(true);
    window.addEventListener("home-open-palette", open);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("home-open-palette", open); };
  }, [mode]);
  if (mode !== "flyt") return null;
  return (
    <>
      <Dock {...props} openPalette={() => setPalette(true)} />
      <PhoneNav {...props} openPalette={() => setPalette(true)} />
      <SwipePager {...props} />
      <AnimatePresence>{palette && <Palette {...props} close={() => setPalette(false)} />}</AnimatePresence>
    </>
  );
}

/* ───────────────────────── command palette ───────────────────────── */

interface Item { id: string; group: string; label: string; sub?: string; icon: Icon; run: () => void; keywords?: string }
const RECENT = "home.palette.recent";

function Palette({ go, openDevice, openVoice, openChat, close }: AltNavProps & { close: () => void }) {
  const rooms = useRooms();
  const quick = useQuickActions();
  const call = useCall();
  const navKeys = useNavKeys();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [notes, setNotes] = useState<{ id: number; text: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); fetch("/api/notes").then((r) => (r.ok ? r.json() : { notes: [] })).then((j: { notes: { id: number; text: string; done: boolean }[] }) => setNotes(j.notes.filter((n) => !n.done))).catch(() => undefined); }, []);
  const recent: string[] = useMemo(() => { try { return JSON.parse(localStorage.getItem(RECENT) ?? "[]") as string[]; } catch { return []; } }, []);

  const all: Item[] = useMemo(() => {
    const out: Item[] = [];
    for (const d of DESTS.filter((d) => navKeys([d.key]).length)) out.push({ id: `tab:${d.key}`, group: "Faner", label: d.label, sub: d.hint, icon: d.icon, run: () => go(d.key) });
    for (const r of rooms.filter((r) => r.controls.length + r.sensors.length > 0)) {
      const I = areaIcon(r.icon, r.name) as Icon;
      const bits = [r.temperature != null ? `${r.temperature.toFixed(1)}°` : "", r.lightsOn ? `${r.lightsOn} lys på` : ""].filter(Boolean).join(" · ");
      out.push({ id: `room:${r.id}`, group: "Rom", label: r.name, sub: bits || undefined, icon: I, run: () => go("room", r.id) });
      for (const c of r.controls) out.push({ id: `dev:${c.id}`, group: "Enheter", label: c.name, sub: r.name, icon: c.domain === "light" ? Lightbulb : DoorOpen, keywords: `${r.name} ${c.domain}`, run: () => openDevice(c.id) });
    }
    for (const a of quick.filter((a) => a.kind === "scene" || a.kind === "routine")) {
      out.push({ id: `act:${a.id}`, group: a.kind === "scene" ? "Scener" : "Rutiner", label: a.name, sub: "Kjør", icon: Play, run: () => void call({ domain: a.domain, service: "turn_on", target: { entity_id: a.id } }) });
    }
    for (const n of notes) out.push({ id: `note:${n.id}`, group: "Notater", label: n.text.split("\n")[0]!.slice(0, 80), icon: StickyNote, run: () => go("notater") });
    out.push({ id: "cmd:edit", group: "Handlinger", label: "Rediger visning", sub: "Flytt, skjul og endre størrelse på kort", icon: Pencil, keywords: "tilpass endre layout kort", run: startEditing });
    out.push({ id: "cmd:hvile", group: "Handlinger", label: "Hvileskjerm", sub: "Rolig kunst med klokke og vær", icon: MoonStar, keywords: "hvile skjermsparer kunst ambient pause", run: () => startHvile() });
    out.push({ id: "cmd:voice", group: "Handlinger", label: "Stemme", sub: "Snakk til huset", icon: Mic, run: openVoice });
    out.push({ id: "cmd:chat", group: "Handlinger", label: "Åpne assistent", sub: "Ctrl+J", icon: Sparkles, run: () => openChat() });
    return out;
  }, [rooms, quick, notes, go, openDevice, openVoice, openChat, call, navKeys]);

  const results: Item[] = useMemo(() => {
    if (!q.trim()) {
      const rec = recent.map((id) => all.find((i) => i.id === id)).filter(Boolean).map((i) => ({ ...i!, group: "Nylig" }));
      return [...rec, ...all.filter((i) => i.group === "Faner" || i.group === "Rom" || i.group === "Scener")].slice(0, 40);
    }
    const scored = all.map((i) => ({ i, s: Math.max(fuzzy(q, i.label), fuzzy(q, `${i.label} ${i.sub ?? ""} ${i.keywords ?? ""}`) - 40) + (i.group === "Faner" ? 30 : i.group === "Rom" ? 20 : 0) + (recent.includes(i.id) ? 40 : 0) }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 30).map((x) => x.i);
    return [...scored, { id: "ask", group: "Assistent", label: `Spør assistenten: «${q.trim()}»`, icon: Sparkles, run: () => openChat(q.trim()) }];
  }, [q, all, recent]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const pick = (i: Item) => {
    try { localStorage.setItem(RECENT, JSON.stringify([i.id, ...recent.filter((x) => x !== i.id)].slice(0, 5))); } catch { /* ignore */ }
    close(); setTimeout(i.run, 10);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const it = results[sel]; if (it) pick(it); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") { e.preventDefault(); // jump to next group
      const g = results[sel]?.group; const n = results.findIndex((r, k) => k > sel && r.group !== g); setSel(n < 0 ? 0 : n); }
  };
  let lastGroup = "";
  return (
    <motion.div className="pal-scrim" onMouseDown={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
      <motion.div className="palette" role="dialog" aria-label="Søk og naviger" onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: -6 }}
        transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.7 }}>
        <div className="pal-input">
          <Search size={18} strokeWidth={1.75} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Søk etter rom, enheter, scener, notater …" aria-label="Søk" role="combobox" aria-expanded aria-controls="pal-list" aria-activedescendant={`pal-${sel}`} />
          <kbd>Esc</kbd>
        </div>
        <div className="pal-list" id="pal-list" role="listbox" ref={listRef}>
          {results.map((it, k) => {
            const head = it.group !== lastGroup ? <div className="pal-group" key={`g-${it.group}-${k}`}>{it.group}</div> : null;
            lastGroup = it.group;
            const I = it.icon;
            return [head,
              <div key={it.id + k} id={`pal-${k}`} data-i={k} role="option" aria-selected={k === sel} className={`pal-item ${k === sel ? "sel" : ""}`} onMouseMove={() => setSel(k)} onClick={() => pick(it)}>
                {k === sel && <motion.span layoutId="pal-hl" className="pal-hl" transition={{ type: "spring", stiffness: 700, damping: 45 }} />}
                <span className="pal-ic"><I size={16} strokeWidth={1.75} /></span>
                <span className="pal-label">{it.label}</span>
                {it.sub && <span className="pal-sub">{it.sub}</span>}
                {k === sel && <CornerDownLeft className="pal-enter" size={14} />}
              </div>];
          })}
        </div>
        <div className="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> velg</span><span><kbd>↵</kbd> åpne</span><span><kbd>Tab</kbd> neste gruppe</span><span className="grow" /><span><Command size={12} /> K</span></div>
      </motion.div>
    </motion.div>
  );
}

/* ───────────────────────── magnifying dock (desktop / iPad) ───────────────────────── */

function Dock({ routeKind, go, openPalette, openVoice }: AltNavProps & { openPalette: () => void }) {
  const mouseX = useMotionValue(Infinity);
  const navKeys = useNavKeys();
  const items = navKeys(DOCK_KEYS).map((k) => DESTS.find((d) => d.key === k)!);
  return (
    <motion.nav className="dock" aria-label="Navigasjon" onMouseMove={(e) => mouseX.set(e.clientX)} onMouseLeave={() => mouseX.set(Infinity)}
      initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.05 }}>
      {items.map((d) => <DockItem key={d.key} d={d} mouseX={mouseX} active={routeKind === d.key || (d.key === "rooms" && routeKind === "room")} onClick={() => go(d.key)} />)}
      <span className="dock-sep" aria-hidden />
      <DockItem d={{ key: "search", label: "Søk (Ctrl+K)", icon: Search }} mouseX={mouseX} active={false} onClick={openPalette} />
      <DockItem d={{ key: "voice", label: "Stemme", icon: Mic }} mouseX={mouseX} active={false} onClick={openVoice} />
      <DockItem d={{ key: "edit", label: "Rediger visning", icon: Pencil }} mouseX={mouseX} active={false} onClick={startEditing} />
      <DockItem d={{ key: "hvile", label: "Hvileskjerm", icon: MoonStar }} mouseX={mouseX} active={false} onClick={() => startHvile()} />
      <DockItem d={DESTS.find((x) => x.key === "settings")!} mouseX={mouseX} active={routeKind === "settings"} onClick={() => go("settings")} />
    </motion.nav>
  );
}

function DockItem({ d, mouseX, active, onClick }: { d: Dest; mouseX: MotionValue<number>; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const dist = useTransform(mouseX, (x) => { const b = ref.current?.getBoundingClientRect(); return b ? x - (b.left + b.width / 2) : Infinity; });
  const target = useTransform(dist, [-150, 0, 150], [44, reduced() ? 44 : 70, 44]);
  const size = useSpring(target, { mass: 0.12, stiffness: 190, damping: 14 });
  const iconSize = useTransform(size, (s) => s * 0.44);
  const I = d.icon;
  return (
    <motion.button ref={ref} className={`dock-item ${active ? "active" : ""}`} style={{ width: size, height: size }} onClick={onClick} aria-label={d.label} aria-current={active ? "page" : undefined} whileTap={{ scale: 0.88 }}>
      <motion.span className="dock-ic" style={{ width: iconSize, height: iconSize }}><I size={22} strokeWidth={1.6} /></motion.span>
      <span className="dock-tip">{d.label}</span>
      {active && <motion.span layoutId="dock-dot" className="dock-dot" transition={{ type: "spring", stiffness: 500, damping: 30 }} />}
    </motion.button>
  );
}

/* ───────────────────────── phone: floating pill + radial home menu ───────────────────────── */

function PhoneNav({ routeKind, go, openPalette, openVoice }: AltNavProps & { openPalette: () => void }) {
  const [radial, setRadial] = useState(false);
  const [hot, setHot] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const center = useRef<{ x: number; y: number } | null>(null);
  const longFired = useRef(false);
  const navKeys = useNavKeys();
  const items = navKeys(RADIAL).map((k) => DESTS.find((d) => d.key === k)!);
  const extra: Dest[] = [{ key: "voice", label: "Stemme", icon: Mic }, { key: "edit", label: "Rediger", icon: Pencil }];
  const ring = [...items, ...extra];
  const R = 138;
  const angle = (i: number) => Math.PI * (1.17 + (0.66 * i) / (ring.length - 1)); // upper arc, left → right
  const choose = (i: number) => { const d = ring[i]!; if (d.key === "search") openPalette(); else if (d.key === "voice") openVoice(); else if (d.key === "edit") startEditing(); else go(d.key); };
  const hit = (x: number, y: number) => {
    const c = center.current; if (!c) return null;
    const dx = x - c.x, dy = y - c.y; if (Math.hypot(dx, dy) < 50) return null;
    let a = Math.atan2(dy, dx); if (a < 0) a += 2 * Math.PI;
    let best: number | null = null, bd = 1e9;
    ring.forEach((_, i) => { const d = Math.abs(angle(i) - a); if (d < bd) { bd = d; best = i; } });
    return bd < 0.32 ? best : null;
  };
  const down = (e: React.PointerEvent) => {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    center.current = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    longFired.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    timer.current = window.setTimeout(() => { longFired.current = true; setRadial(true); navigator.vibrate?.(12); }, 380);
  };
  const move = (e: React.PointerEvent) => { if (radial) setHot(hit(e.clientX, e.clientY)); };
  const up = () => {
    clearTimeout(timer.current);
    if (radial) { if (hot != null) choose(hot); else if (!longFired.current) go("home"); setRadial(false); setHot(null); return; }
    if (!longFired.current) go("home");
  };
  const pill = navKeys(PHONE_PILL).filter((k) => k !== "home").map((k) => DESTS.find((d) => d.key === k)!);
  return (
    <>
      <AnimatePresence>{radial && <motion.div className="radial-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setRadial(false)} />}</AnimatePresence>
      <nav className="pill" aria-label="Navigasjon">
        <div className="pill-track">
          {pill.slice(0, 2).map((d) => <PillItem key={d.key} d={d} active={routeKind === d.key || (d.key === "rooms" && routeKind === "room")} onClick={() => go(d.key)} />)}
          <div className="pill-home-slot">
            <AnimatePresence>
              {radial && ring.map((d, i) => {
                const I = d.icon; const a = angle(i);
                return (
                  <motion.span key={d.key} className={`radial-item ${hot === i ? "hot" : ""}`} aria-hidden
                    initial={{ x: 0, y: 0, scale: 0.3, opacity: 0 }} animate={{ x: Math.cos(a) * R, y: Math.sin(a) * R, scale: hot === i ? 1.22 : 1, opacity: 1 }}
                    exit={{ x: 0, y: 0, scale: 0.3, opacity: 0, transition: { duration: 0.12 } }}
                    transition={{ type: "spring", stiffness: 420, damping: 22, delay: reduced() ? 0 : i * 0.018 }}>
                    <I size={20} strokeWidth={1.75} /><em>{d.label}</em>
                  </motion.span>);
              })}
            </AnimatePresence>
            <motion.button className={`pill-home ${routeKind === "home" ? "active" : ""}`} aria-label="Hjem (hold for hurtigmeny)"
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { clearTimeout(timer.current); setRadial(false); }}
              onContextMenu={(e) => e.preventDefault()} animate={{ scale: radial ? 1.12 : 1 }} transition={{ type: "spring", stiffness: 500, damping: 26 }}>
              <HomeIcon size={24} strokeWidth={1.8} />
            </motion.button>
          </div>
          {[...pill.slice(2), { key: "search", label: "Søk", icon: Search }].map((d) => <PillItem key={d.key} d={d} active={routeKind === d.key} onClick={() => (d.key === "search" ? openPalette() : go(d.key))} />)}
        </div>
      </nav>
    </>
  );
}

function PillItem({ d, active, onClick }: { d: Dest; active: boolean; onClick: () => void }) {
  const I = d.icon;
  return (
    <motion.button className={`pill-item ${active ? "active" : ""}`} onClick={onClick} whileTap={{ scale: 0.86 }} aria-label={d.label} aria-current={active ? "page" : undefined}>
      {active && <motion.span layoutId="pill-bg" className="pill-bg" transition={{ type: "spring", stiffness: 520, damping: 34 }} />}
      <I size={21} strokeWidth={1.75} /><span>{d.label}</span>
    </motion.button>
  );
}

/* ───────────────────────── phone: swipe between pages ───────────────────────── */

const SWIPE_PAGES = ["home", "rooms", "barn", "luft", "chat", "notater", "robots"];
function SwipePager({ routeKind, go }: AltNavProps) {
  const [hint, setHint] = useState<{ dx: number; label: string } | null>(null);
  const navKeys = useNavKeys(); const { editing } = useEdit();
  const PAGES = navKeys(SWIPE_PAGES); const sig = PAGES.join();
  useEffect(() => {
    const main = document.querySelector<HTMLElement>(".main");
    if (!main) return;
    let sx = 0, sy = 0, active = false, dx = 0;
    const idx = PAGES.indexOf(routeKind);
    const start = (e: TouchEvent) => {
      if (editing || window.innerWidth >= 768 || idx < 0 || e.touches.length !== 1) return;
      const t = e.target as Element;
      if (t.closest("input, textarea, [role=slider], .slider, .no-swipe, .h-scroll, .chips, .seg")) return;
      sx = e.touches[0]!.clientX; sy = e.touches[0]!.clientY; active = true; dx = 0;
    };
    const mv = (e: TouchEvent) => {
      if (!active) return;
      dx = e.touches[0]!.clientX - sx; const dy = e.touches[0]!.clientY - sy;
      if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) { active = false; setHint(null); main.style.transform = ""; return; }
      if (Math.abs(dx) > 12) {
        const n = PAGES[idx + (dx < 0 ? 1 : -1)];
        if (!n) { main.style.transform = `translateX(${dx * 0.15}px)`; return; } // rubber band at the ends
        main.style.transform = `translateX(${dx * 0.35}px)`;
        setHint({ dx, label: DESTS.find((d) => d.key === n)?.label ?? n });
      }
    };
    const end = () => {
      if (!active) return; active = false;
      main.style.transition = "transform 320ms cubic-bezier(0.34, 1.4, 0.64, 1)"; main.style.transform = "";
      setTimeout(() => { main.style.transition = ""; }, 330);
      setHint(null);
      const n = PAGES[idx + (dx < 0 ? 1 : -1)];
      if (Math.abs(dx) > 80 && n) go(n);
    };
    main.addEventListener("touchstart", start, { passive: true });
    main.addEventListener("touchmove", mv, { passive: true });
    main.addEventListener("touchend", end);
    main.addEventListener("touchcancel", end);
    return () => { main.removeEventListener("touchstart", start); main.removeEventListener("touchmove", mv); main.removeEventListener("touchend", end); main.removeEventListener("touchcancel", end); main.style.transform = ""; };
  }, [routeKind, go, sig, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const idx = PAGES.indexOf(routeKind);
  return (
    <>
      {idx >= 0 && <div className="swipe-dots" aria-hidden>{PAGES.map((k, i) => <span key={k} className={i === idx ? "on" : ""} />)}</div>}
      <AnimatePresence>{hint && (
        <motion.div className={`swipe-hint ${hint.dx < 0 ? "right" : "left"}`} initial={{ opacity: 0 }} animate={{ opacity: Math.min(1, Math.abs(hint.dx) / 80) }} exit={{ opacity: 0 }}>
          {hint.dx > 0 && <ArrowRight size={14} style={{ transform: "rotate(180deg)" }} />}{hint.label}{hint.dx < 0 && <ArrowRight size={14} />}
        </motion.div>)}
      </AnimatePresence>
    </>
  );
}

/* ───────────────────────── settings card ───────────────────────── */

export function NavSettings() {
  const [mode, setMode] = useNavMode();
  const vt = typeof document !== "undefined" && "startViewTransition" in document;
  return (
    <section className="card">
      <h3>Navigasjon</h3>
      <div className="seg" role="radiogroup" aria-label="Navigasjon">
        {([["klassisk", "Klassisk"], ["flyt", "Flyt"]] as const).map(([k, l]) => (
          <button key={k} role="radio" aria-checked={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{l}</button>
        ))}
      </div>
      <p className="muted small">
        {mode === "flyt"
          ? `Flyt: dokk med forstørrelse nederst, Ctrl/⌘+K eller / for søk overalt, sveip mellom sider på mobil og hold inne Hjem-knappen for hurtigmeny. ${vt ? "Glidende overganger mellom sider." : "Nettleseren støtter ikke View Transitions, så sider byttes uten animasjon."} Respekterer «redusert bevegelse».`
          : "Klassisk: sidemeny på PC/iPad og fanelinje på mobil."}
      </p>
    </section>
  );
}
