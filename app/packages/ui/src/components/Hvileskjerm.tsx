import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoonStar, Play, Image as ImageIcon } from "lucide-react";
import { useWeather, useNextEvent, wxIcon, WX_LABEL, hhmm, phase } from "./TopBar";
import { COLLECTIONS, DEFAULTS, KIND_LABEL, deviceId, deviceKind, effective, isNight, startHvile, useHvileSettings, type HvileMode } from "../lib/hvile";
import "./hvile.css";

type Art = { id: string; url: string; title: string; artist: string; year: string; collection: string; group: string; w: number; h: number };
type Slide = { key: string; url?: string; caption?: string; kb: number };

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Explicit user input: resets the idle clock and exits the resting screen. Never hover-dependent. */
const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
/** Ongoing interaction: resets the idle clock only (scroll can also be layout-driven, so it never exits). */
const SOFT = ["pointerup", "touchmove", "touchend", "scroll"] as const;

/** Screen Wake Lock while the resting screen shows (iPad Safari 16.4+/home-screen app 18.4+, Chrome). Night mode stays black; the screen just doesn't dim/lock. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void>; addEventListener(t: string, f: () => void): void }> } }).wakeLock;
    const root = document.documentElement;
    if (!active) { root.removeAttribute("data-wakelock"); return; }
    if (!wl) { root.setAttribute("data-wakelock", "unsupported"); return; }
    let lock: { release(): Promise<void> } | null = null; let alive = true;
    const req = async () => {
      if (!alive || document.visibilityState !== "visible") return;
      try { const l = await wl.request("screen"); if (!alive) { void l.release(); return; } lock = l; root.setAttribute("data-wakelock", "on"); l.addEventListener("release", () => { if (lock === l) { lock = null; if (alive) root.setAttribute("data-wakelock", "released"); } }); }
      catch { root.setAttribute("data-wakelock", "denied"); }
    };
    const vis = () => { if (document.visibilityState === "visible" && !lock) void req(); };
    void req(); document.addEventListener("visibilitychange", vis);
    return () => { alive = false; document.removeEventListener("visibilitychange", vis); void lock?.release().catch(() => undefined); lock = null; root.removeAttribute("data-wakelock"); };
  }, [active]);
}

/** Idle watcher + full-screen calm art view. Read-only: never calls Home Assistant services. */
export function Hvileskjerm({ blocked }: { blocked?: boolean }) {
  const { settings } = useHvileSettings();
  const eff = effective(settings);
  const [on, setOn] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [forced, setForced] = useState<HvileMode | null>(null);
  const last = useRef(Date.now());
  const seenTrigger = useRef<number>(settings.trigger?.at ?? Date.now());

  const exit = useCallback(() => { if (!on || leaving) return; setLeaving(true); setTimeout(() => { setOn(false); setLeaving(false); setForced(null); last.current = Date.now(); }, reduced() ? 150 : 700); }, [on, leaving]);
  const start = useCallback((m?: HvileMode | null) => { setForced(m ?? null); setLeaving(false); setOn(true); }, []);

  // activity tracking (while visible, any activity exits)
  useEffect(() => {
    let lx = -1, ly = -1;
    const act = () => { last.current = Date.now(); if (on) exit(); };
    const move = (e: PointerEvent) => { if (lx < 0) { lx = e.clientX; ly = e.clientY; return; } if (Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) > 24) { lx = e.clientX; ly = e.clientY; act(); } };
    const soft = () => { if (!on) last.current = Date.now(); };
    ACTIVITY.forEach((t) => window.addEventListener(t, act, { capture: true, passive: true }));
    SOFT.forEach((t) => window.addEventListener(t, soft, { capture: true, passive: true }));
    window.addEventListener("pointermove", move, { passive: true });
    return () => { ACTIVITY.forEach((t) => window.removeEventListener(t, act, { capture: true })); SOFT.forEach((t) => window.removeEventListener(t, soft, { capture: true })); window.removeEventListener("pointermove", move); };
  }, [on, exit]);
  // idle timer – app-wide (mounted once in App, independent of route/tab). Open sheets, chat, device panels and focused
  // inputs do NOT block it (the resting screen layers on top and a tap returns to exactly where you were); only edit mode
  // and the voice overlay hold it off; an open login sheet gets ≥10 min.
  const timeoutMs = eff.timeoutMin ? eff.timeoutMin * 60_000 : 0;
  useEffect(() => {
    if (on || blocked || !timeoutMs) return;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      if (document.documentElement.hasAttribute("data-editing") || document.querySelector(".voice-overlay")) { last.current = Date.now(); return; }
      // a BankID/ID-porten login can sit waiting on another device – give it at least 10 min before covering it
      const limit = document.querySelector(".auth-sheet") ? Math.max(timeoutMs, 600_000) : timeoutMs;
      if (Date.now() - last.current >= limit) { (document.activeElement as HTMLElement | null)?.blur?.(); start(); }
    };
    // hidden -> visible (iPad woke, app re-opened from home screen, bfcache restore): restart the idle clock, keep checking
    const back = () => { if (document.visibilityState === "visible") last.current = Date.now(); };
    const show = (e: PageTransitionEvent) => { if (e.persisted) last.current = Date.now(); };
    const t = setInterval(check, Math.min(5000, Math.max(500, timeoutMs / 4)));
    document.addEventListener("visibilitychange", back); window.addEventListener("pageshow", show); window.addEventListener("focus", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); window.removeEventListener("pageshow", show); window.removeEventListener("focus", back); };
  }, [on, blocked, timeoutMs, start]);
  useWakeLock(on);
  // manual trigger (Ctrl+K, dock, Settings) + remote trigger (MCP via prefs row)
  useEffect(() => { const h = (e: Event) => setTimeout(() => start((e as CustomEvent<HvileMode | undefined>).detail), 120); window.addEventListener("home:hvile-start", h); return () => window.removeEventListener("home:hvile-start", h); }, [start]);
  useEffect(() => {
    const tr = settings.trigger; if (!tr || tr.at <= seenTrigger.current) return; seenTrigger.current = tr.at;
    if (Date.now() - tr.at > 60_000 || (tr.device !== "all" && tr.device !== deviceId())) return;
    if (tr.action === "start") start(tr.mode); else exit();
  }, [settings.trigger, start, exit]);
  // ?hvile=1 / #/hvile for testing and wall displays
  useEffect(() => { if (/[?&]hvile=1/.test(location.search) || location.hash === "#/hvile") start((new URLSearchParams(location.search).get("hvilemode") as HvileMode) || null); }, [start]);

  if (!on) return null;
  return createPortal(<Scene mode={forced ?? eff.mode} cfg={eff} leaving={leaving} onExit={exit} />, document.body);
}

function useNow(ms: number) { const [n, setN] = useState(() => new Date()); useEffect(() => { const t = setInterval(() => setN(new Date()), ms); return () => clearInterval(t); }, [ms]); return n; }
function testNow(): Date | null { const q = new URLSearchParams(location.search).get("hviletime"); if (!q) return null; const [h, m] = q.split(":").map(Number); const d = new Date(); d.setHours(h ?? 0, m ?? 0, 0, 0); return d; }

function Scene({ mode, cfg, leaving, onExit }: { mode: HvileMode; cfg: ReturnType<typeof effective>; leaving: boolean; onExit: () => void }) {
  const real = useNow(10_000);
  const now = testNow() ?? real;
  const night = cfg.nightDim && isNight(now, cfg.nightFrom, cfg.nightTo);
  const wx = useWeather(); const ev = useNextEvent();
  const [pool, setPool] = useState<Slide[]>([]);
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [advanced, setAdvanced] = useState(false);
  const [tone, setTone] = useState<Record<string, string>>({});
  // average colour of a painting (1×1 canvas; same-origin /api/ambient images) -> background behind it
  const sample = (key: string, im: HTMLImageElement) => { try { const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d"); if (!x) return; x.drawImage(im, 0, 0, 1, 1); const [r, g, b] = x.getImageData(0, 0, 1, 1).data; setTone((t) => ({ ...t, [key]: `rgb(${r}, ${g}, ${b})` })); } catch { /* tainted/unsupported: keep default */ } };
  const [drift, setDrift] = useState({ x: 0, y: 0 });
  const cols = (cfg.collections ?? DEFAULTS.collections).join(",");

  useEffect(() => {
    let alive = true;
    const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j]!, b[i]!]; } return b; };
    (async () => {
      try {
        if (mode === "art") {
          const r = await fetch("/api/ambient/art"); const j = (await r.json()) as { items: Art[] };
          const pick = j.items.filter((a) => cols.split(",").includes(a.group));
          const first = new URLSearchParams(location.search).get("hvileart");
          let list = shuffle(pick.length ? pick : j.items); if (first) list = [...list.filter((a) => a.id === first), ...list.filter((a) => a.id !== first)];
          if (alive) setPool(list.map((a, i) => ({ key: a.id, url: a.url, caption: `${a.title} · ${a.artist}, ${a.year}`, kb: i % 4 })));
        } else if (mode === "photos") {
          const r = await fetch("/api/kids/feed"); const j = (await r.json()) as { photos: { id: string; video?: boolean }[] };
          if (alive) setPool(shuffle(j.photos.filter((p) => !p.video)).slice(0, 60).map((p, i) => ({ key: p.id, url: `/api/kids/photo/${p.id}`, caption: "Fra barnehagen", kb: i % 4 })));
        } else if (alive) setPool([]);
      } catch { if (alive) setPool([]); }
    })();
    return () => { alive = false; };
  }, [mode, cols]);
  useEffect(() => { if (pool.length < 2) return; const t = setInterval(() => { setAdvanced(true); setIdx((i) => (i + 1) % pool.length); }, Number(new URLSearchParams(location.search).get("hvilestep")) * 1000 || Math.max(1, cfg.intervalMin ?? 5) * 60_000); return () => clearInterval(t); }, [pool.length, cfg.intervalMin]);
  // burn-in: drift the overlay a few px every minute
  useEffect(() => { const t = setInterval(() => setDrift({ x: Math.round((Math.random() - 0.5) * 28), y: Math.round((Math.random() - 0.5) * 20) }), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => { pool.slice(idx, idx + 2).forEach((s) => { if (s.url) { const im = new Image(); im.src = s.url; } }); }, [pool, idx]);

  const cur = pool[idx];
  const time = now.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" });
  const W = wxIcon(wx?.condition);
  const showArt = !night && mode !== "gradient" && pool.length > 0;
  const evText = ev ? `${ev.allDay ? "I dag" : hhmm(ev.start)} · ${ev.title}` : null;
  return (
    <div className={`hvile ${leaving ? "out" : ""} ${night ? "night" : ""}`} data-phase={phase(now)} style={showArt && cur && tone[cur.key] ? { ["--hv-bg" as string]: tone[cur.key] } : undefined} role="dialog" aria-label="Hvileskjerm – trykk for å gå tilbake"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onExit(); }}>
      <div className="hv-grad" aria-hidden />
      {showArt && pool.map((s, i) => (i === idx || (advanced && i === (idx - 1 + pool.length) % pool.length)) && (
        <div key={s.key} className={`hv-slide ${i === idx ? (loaded[s.key] ? "show" : "") : "under"} kb${s.kb}`} style={{ ["--dur" as string]: `${(cfg.intervalMin ?? 5) * 60 + 30}s`, ["--hv-c" as string]: tone[s.key] }}>
          <img src={s.url} alt="" draggable={false} decoding="async" onLoad={(e) => { const im = e.currentTarget; setLoaded((l) => ({ ...l, [s.key]: true })); sample(s.key, im); }} />
        </div>))}
      <div className="hv-veil" aria-hidden />
      <div className="hv-ov" style={{ transform: `translate(${drift.x}px, ${drift.y}px)` }}>
        <time className="hv-time">{time}</time>
        {!night && <>
          <div className="hv-date">{date}</div>
          <div className="hv-meta">
            {wx && wx.temp != null && <span className="hv-wx"><W size={20} strokeWidth={1.4} aria-hidden /> {Math.round(wx.temp)}° <span className="dim">{WX_LABEL[wx.condition] ?? ""}</span></span>}
            {evText && <span className="hv-ev"><span className="dot" style={{ background: ev?.color }} />{evText}</span>}
          </div>
        </>}
      </div>
      {!night && showArt && cur?.caption && <div className="hv-cap" style={{ transform: `translate(${-drift.x}px, ${-drift.y / 2}px)` }}>{cur.caption}</div>}
    </div>
  );
}

/** Settings card «Hvileskjerm». */
export function HvileSettingsCard() {
  const { settings, save } = useHvileSettings();
  const id = useMemo(() => deviceId(), []); const kind = useMemo(() => deviceKind(), []);
  const eff = effective(settings, id, kind);
  const own = settings.devices?.[id];
  const [n, setN] = useState<number | null>(null);
  useEffect(() => { fetch("/api/ambient/art").then((r) => r.json()).then((j: { items: unknown[] }) => setN(j.items.length)).catch(() => undefined); }, []);
  const T = [0, 1, 3, 5, 10, 15, 30, 60];
  const tl = (m: number) => (m === 0 ? "Av" : m < 60 ? `${m} min` : "1 t");
  const cols = settings.collections ?? DEFAULTS.collections;
  const setDev = (p: { timeoutMin?: number | null; mode?: HvileMode | null }) => save({ devices: { [id]: { ...(own ?? {}), ...p, label: KIND_LABEL[kind] } as never } });
  return (
    <section className="card hv-settings">
      <h3><MoonStar size={16} strokeWidth={1.75} /> Hvileskjerm</h3>
      <p className="muted small">Når ingen har rørt skjermen en stund, toner appen over i rolig kunst med klokke, vær og neste avtale. Trykk, tast eller bevegelse tar deg tilbake.</p>
      <div className="field"><label>Vis etter (standard for alle enheter)</label>
        <div className="seg wrap">{T.map((m) => <button key={m} className={(settings.timeoutMin ?? DEFAULTS.timeoutMin) === m ? "on" : ""} onClick={() => void save({ timeoutMin: m })}>{tl(m)}</button>)}</div></div>
      <div className="field"><label>Denne enheten ({KIND_LABEL[kind]}){own?.timeoutMin != null ? "" : " – følger standard"}</label>
        <div className="seg wrap">
          <button className={own?.timeoutMin == null ? "on" : ""} onClick={() => void setDev({ timeoutMin: null })}>Standard</button>
          {T.map((m) => <button key={m} className={own?.timeoutMin === m ? "on" : ""} onClick={() => void setDev({ timeoutMin: m })}>{tl(m)}</button>)}
        </div>
        <span className="muted small">Akkurat nå: {eff.timeoutMin ? `etter ${tl(eff.timeoutMin)}` : "av"}{kind === "phone" && !settings.phone && own?.timeoutMin == null ? " (av på mobil som standard)" : ""}</span></div>
      <div className="field"><label>Innhold</label>
        <div className="seg">{([["art", "Kunst"], ["gradient", "Kun farger"], ["photos", "Barnehagebilder"]] as const).map(([k, l]) => <button key={k} className={(settings.mode ?? "art") === k ? "on" : ""} onClick={() => void save({ mode: k })}>{l}</button>)}</div>
        {(settings.mode ?? "art") === "photos" && <span className="muted small">Viser bilder fra MyKid. Bare på denne private appen over Tailscale.</span>}</div>
      {(settings.mode ?? "art") === "art" && <div className="field"><label>Samlinger {n != null && <span className="muted">({n} verk lagret lokalt)</span>}</label>
        <div className="chips">{COLLECTIONS.map((c) => { const onC = cols.includes(c.id); return <button key={c.id} className={`chip ${onC ? "on" : ""}`} onClick={() => { const next = onC ? cols.filter((x) => x !== c.id) : [...cols, c.id]; if (next.length) void save({ collections: next }); }}>{c.label}</button>; })}</div></div>}
      <label className={`hf-toggle ${settings.nightDim ?? true ? "on" : ""}`}><input type="checkbox" checked={settings.nightDim ?? true} onChange={(e) => void save({ nightDim: e.target.checked })} /><span className="hf-track"><span className="hf-knob" /></span>Nattmodus 23–06: helt mørk, bare en svak klokke</label>
      <label className={`hf-toggle ${settings.phone ? "on" : ""}`}><input type="checkbox" checked={!!settings.phone} onChange={(e) => void save({ phone: e.target.checked })} /><span className="hf-track"><span className="hf-knob" /></span>Bruk også på mobil</label>
      <div className="row gap"><button className="btn sm" onClick={() => startHvile()}><Play size={14} /> Vis nå</button>
        <button className="btn sm ghost" onClick={() => void fetch("/api/ambient/refresh", { method: "POST", body: "{}" })}><ImageIcon size={14} /> Hent manglende verk</button></div>
      <p className="muted small">Kunsten er fri for opphavsrett (bl.a. Nasjonalmuseet via Wikimedia Commons) og lagres på serveren, så den virker uten nett.</p>
    </section>
  );
}
