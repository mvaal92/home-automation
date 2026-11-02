import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw, Settings2, MapPin, Trash2, Pencil, Link2, Cloud, Lock, ExternalLink, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { item, list } from "../lib/motion";
import { Sheet } from "../components/Sheet";
import "./Kalender.css";

export type CalEvent = { id: string; calendar: string; calendarName: string; color: string; writable: boolean; title: string; start: string; end: string | null; allDay: boolean;
  location: string | null; desc: string | null; url: string | null; recurring: boolean; readOnly?: string; kind?: string };
export type CalSource = { id: string; kind: "local" | "kids" | "maintenance" | "icloud" | "webcal"; name: string; color: string; visible: boolean; writable: boolean; syncedAt: number | null; error: string | null; url?: string };
type Cals = { sources: CalSource[]; icloud: { connected: boolean; account: string | null; error: string | null }; lastSync: number | null; defaultCalendar: string };
type View = "maned" | "uke" | "agenda";

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); const t = s.length > 10 ? s.slice(11, 16).split(":").map(Number) : [0, 0]; return new Date(y!, m! - 1, d!, t[0], t[1]); };
const add = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monday = (d: Date) => add(d, -((d.getDay() + 6) % 7));
const isoWeek = (d: Date) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7); };
const WD = ["man", "tir", "ons", "tor", "fre", "lør", "søn"];
export const time = (e: CalEvent) => e.allDay ? "Hele dagen" : e.start.slice(11, 16) + (e.end && e.end.slice(0, 10) === e.start.slice(0, 10) && e.end !== e.start ? `–${e.end.slice(11, 16)}` : "");
/** Does the event cover the given day (YYYY-MM-DD)? All-day ends are exclusive. */
const onDay = (e: CalEvent, day: string) => { const s = e.start.slice(0, 10); const en = (e.end ?? e.start).slice(0, 10); return e.allDay ? s <= day && (en > day || (en === s && s === day)) : s <= day && en >= day; };
const dayLabel = (d: Date) => d.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" });

export function useCalendarEvents(from: string, to: string) {
  const [events, setEvents] = useState<CalEvent[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<{ events: CalEvent[] }>(`/api/calendar/events?from=${from}&to=${to}`).then((r) => { setEvents(r.events); setErr(null); }).catch((e) => setErr((e as Error).message)), [from, to]);
  useEffect(() => { void load(); const t = setInterval(load, 5 * 60_000); return () => clearInterval(t); }, [load]);
  return { events, err, load };
}

/** Hjem card: «I dag» – today's and the next upcoming events. */
export function TodayCard() {
  const [d, setD] = useState<{ today: string; events: CalEvent[]; todayCount: number } | null>(null);
  useEffect(() => { const load = () => api<typeof d>("/api/calendar/upcoming?days=7&limit=6").then(setD).catch(() => undefined); void load(); const t = setInterval(load, 5 * 60_000); return () => clearInterval(t); }, []);
  if (!d) return null;
  const tToday = d.events.filter((e) => e.start.slice(0, 10) <= d.today); const later = d.events.filter((e) => e.start.slice(0, 10) > d.today).slice(0, Math.max(2, 5 - tToday.length));
  const row = (e: CalEvent, showDay = false) => <button key={e.id} className="kal-today-row" onClick={() => { location.hash = "#/kalender"; }}>
    <i className="kal-bar" style={{ background: e.color }} /><span className="kal-today-t">{showDay ? parse(e.start).toLocaleDateString("nb-NO", { weekday: "short" }) + (e.allDay ? "" : " " + e.start.slice(11, 16)) : e.allDay ? "Hele dagen" : e.start.slice(11, 16)}</span>
    <span className="grow ellip">{e.title}</span>{e.location && <span className="muted small ellip kal-loc">{e.location}</span>}</button>;
  return <section className="card kal-today">
    <h3><CalendarDays size={15} /> I dag <span className="muted small" style={{ fontWeight: 400 }}>{tToday.length ? `${tToday.length} avtale${tToday.length === 1 ? "" : "r"}` : "Ingen avtaler"}</span>
      <button className="section-action" style={{ marginLeft: "auto" }} onClick={() => { location.hash = "#/kalender"; }}>Kalender <ChevronRight size={13} /></button></h3>
    <div className="kal-today-list">{tToday.map((e) => row(e))}
      {later.length > 0 && <><div className="kal-today-sep">Kommende</div>{later.map((e) => row(e, true))}</>}
      {d.events.length === 0 && <span className="muted small">Ingenting de neste sju dagene.</span>}</div>
  </section>;
}

export function KalenderPage() {
  const [view, setView] = useState<View>(() => (localStorage.getItem("kal.view") as View) || (window.innerWidth < 768 ? "agenda" : "maned"));
  const [cursor, setCursor] = useState(() => new Date());
  const [sel, setSel] = useState<string>(() => ymd(new Date()));
  const [cals, setCals] = useState<Cals | null>(null);
  const [open, setOpen] = useState<CalEvent | null>(null);
  const [editing, setEditing] = useState<Partial<CalEvent> | null>(null);
  const [settings, setSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => localStorage.setItem("kal.view", view), [view]);
  const range = useMemo(() => {
    if (view === "maned") { const f = monday(new Date(cursor.getFullYear(), cursor.getMonth(), 1)); return { from: f, days: 42 }; }
    if (view === "uke") return { from: monday(cursor), days: 7 };
    const f = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()); return { from: f, days: 60 };
  }, [view, cursor]);
  const from = ymd(range.from), to = ymd(add(range.from, range.days));
  const { events, err, load } = useCalendarEvents(from, to);
  const loadCals = useCallback(() => api<Cals>("/api/calendar/calendars").then(setCals).catch(() => undefined), []);
  useEffect(() => { void loadCals(); }, [loadCals]);
  const today = ymd(new Date());
  const step = (n: number) => setCursor((c) => view === "maned" ? new Date(c.getFullYear(), c.getMonth() + n, 1) : view === "uke" ? add(c, 7 * n) : add(c, 30 * n));
  const title = view === "maned" ? cursor.toLocaleDateString("nb-NO", { month: "long", year: "numeric" }) : view === "uke" ? `Uke ${isoWeek(range.from)} · ${range.from.toLocaleDateString("nb-NO", { day: "numeric", month: "short" })}–${add(range.from, 6).toLocaleDateString("nb-NO", { day: "numeric", month: "short" })}` : "Kommende";
  const byDay = (day: string) => (events ?? []).filter((e) => onDay(e, day));
  const sync = async () => { setSyncing(true); try { await api("/api/calendar/sync", { method: "POST" }); } catch { /* */ } setSyncing(false); void load(); void loadCals(); };
  const newAt = (day: string) => setEditing({ title: "", start: `${day}T${pad(Math.min(21, new Date().getHours() + 1))}:00`, allDay: false, calendar: cals?.defaultCalendar ?? "local" });
  const reload = () => { void load(); void loadCals(); };
  return <motion.div className="page kal-page" variants={list} initial="hidden" animate="show">
    <motion.div variants={item} className="kal-head">
      <h1 className="page-title">Kalender</h1>
      <div className="kal-tools">
        <div className="seg" role="tablist">{(["maned", "uke", "agenda"] as View[]).map((v) => <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>{v === "maned" ? "Måned" : v === "uke" ? "Uke" : "Agenda"}</button>)}</div>
        <button className="icon-btn ghost" onClick={() => void sync()} title="Synk nå" aria-label="Synk nå">{syncing ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}</button>
        <button className="icon-btn ghost" onClick={() => setSettings(true)} title="Kalendere" aria-label="Kalendere"><Settings2 size={16} /></button>
        <button className="btn primary" onClick={() => newAt(sel)}><Plus size={15} /> <span className="lbl">Ny avtale</span></button>
      </div>
    </motion.div>
    <motion.div variants={item} className="kal-nav">
      <button className="icon-btn ghost" onClick={() => step(-1)} aria-label="Forrige"><ChevronLeft size={18} /></button>
      <h2 className="kal-title">{title}</h2>
      <button className="icon-btn ghost" onClick={() => step(1)} aria-label="Neste"><ChevronRight size={18} /></button>
      <button className="chip" onClick={() => { setCursor(new Date()); setSel(today); }}>I dag</button>
      <div className="kal-legend">{cals?.sources.filter((s) => s.visible).map((s) => <span key={s.id}><i style={{ background: s.color }} />{s.name}</span>)}</div>
    </motion.div>
    {err && <div className="notice bad small">{err}</div>}
    {cals && !cals.icloud.connected && <motion.div variants={item} className="kal-banner"><Cloud size={16} /><span className="grow">Koble til iCloud for å se familiens kalendere her.</span>
      <button className="btn sm" onClick={() => { location.hash = "#/settings/login/icloud"; }}>Koble til</button><button className="btn sm ghost" onClick={() => setSettings(true)}><Link2 size={13} /> Delt lenke</button></motion.div>}
    {cals?.icloud.error && <div className="notice warn small">iCloud: {cals.icloud.error} – <a href="#/settings/login/icloud">logg inn på nytt</a></div>}

    <motion.div variants={item}>
      {view === "maned" && <div className="kal-month">
        <div className="kal-wd"><span className="kal-wn" />{WD.map((w) => <span key={w}>{w}</span>)}</div>
        {Array.from({ length: 6 }, (_, w) => { const wk = add(range.from, w * 7); return <div key={w} className="kal-week">
          <span className="kal-wn">{isoWeek(wk)}</span>
          {Array.from({ length: 7 }, (_, i) => { const d = add(wk, i); const k = ymd(d); const evs = byDay(k); const out = d.getMonth() !== cursor.getMonth();
            return <div key={k} className={`kal-day ${out ? "out" : ""} ${k === today ? "today" : ""} ${k === sel ? "sel" : ""} ${i >= 5 ? "we" : ""}`} onClick={() => setSel(k)} onDoubleClick={() => newAt(k)}>
              <span className="kal-num">{d.getDate()}</span>
              <div className="kal-evs">{evs.slice(0, 3).map((e) => <button key={e.id} className={`kal-ev ${e.allDay ? "ad" : ""}`} style={{ ["--c" as string]: e.color }} onClick={(ev) => { ev.stopPropagation(); setOpen(e); }}>
                {!e.allDay && <b>{e.start.slice(11, 16)}</b>}<span>{e.title}</span></button>)}
                {evs.length > 3 && <span className="kal-more">+{evs.length - 3}</span>}
                {evs.length > 0 && <span className="kal-dots">{evs.slice(0, 4).map((e) => <i key={e.id} style={{ background: e.color }} />)}</span>}</div>
            </div>; })}
        </div>; })}
      </div>}
      {view === "uke" && <div className="kal-wk">{Array.from({ length: 7 }, (_, i) => { const d = add(range.from, i); const k = ymd(d); const evs = byDay(k);
        return <div key={k} className={`kal-wk-col ${k === today ? "today" : ""}`} onDoubleClick={() => newAt(k)}>
          <div className="kal-wk-h"><span>{WD[i]}</span><b>{d.getDate()}</b></div>
          <div className="kal-wk-list">{evs.length === 0 && <button className="kal-wk-empty" onClick={() => newAt(k)}>+</button>}
            {evs.map((e) => <button key={e.id} className={`kal-card ${e.allDay ? "ad" : ""}`} style={{ ["--c" as string]: e.color }} onClick={() => setOpen(e)}>
              <span className="kal-card-t">{time(e)}</span><span className="kal-card-n">{e.title}</span>{e.location && <span className="kal-card-l"><MapPin size={11} />{e.location}</span>}</button>)}</div>
        </div>; })}</div>}
      {view === "agenda" && <Agenda events={events} from={range.from} days={range.days} today={today} onOpen={setOpen} />}
    </motion.div>
    {view === "maned" && <motion.div variants={item} className="kal-sel">
      <h3>{dayLabel(parse(sel))}{sel === today && <span className="kal-pill">I dag</span>}<button className="section-action" style={{ marginLeft: "auto" }} onClick={() => newAt(sel)}><Plus size={13} /> Legg til</button></h3>
      {byDay(sel).length === 0 ? <p className="muted small">Ingen avtaler.</p> : <div className="kal-agenda-list">{byDay(sel).map((e) => <EventRow key={e.id} e={e} onOpen={setOpen} />)}</div>}
    </motion.div>}
    <EventSheet e={open} onClose={() => setOpen(null)} onEdit={(e) => { setOpen(null); setEditing(e); }} onDeleted={() => { setOpen(null); reload(); }} />
    <EditSheet draft={editing} cals={cals} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
    <CalendarsSheet open={settings} cals={cals} onClose={() => setSettings(false)} onChange={reload} />
  </motion.div>;
}

function EventRow({ e, onOpen }: { e: CalEvent; onOpen: (e: CalEvent) => void }) {
  return <button className="kal-row" onClick={() => onOpen(e)}><i className="kal-bar" style={{ background: e.color }} />
    <span className="kal-row-t">{time(e)}</span><span className="kal-row-b"><b>{e.title}</b><span className="muted small">{e.calendarName}{e.location ? ` · ${e.location}` : ""}</span></span>
    {!e.writable && <Lock size={12} className="muted" />}</button>;
}

function Agenda({ events, from, days, today, onOpen }: { events: CalEvent[] | null; from: Date; days: number; today: string; onOpen: (e: CalEvent) => void }) {
  if (!events) return <div className="kal-agenda"><span className="sk sk-line" /></div>;
  const groups: { day: string; d: Date; evs: CalEvent[] }[] = [];
  for (let i = 0; i < days; i++) { const d = add(from, i); const k = ymd(d); const evs = events.filter((e) => onDay(e, k)); if (evs.length || k === today) groups.push({ day: k, d, evs }); }
  return <div className="kal-agenda">{groups.map((g) => <div key={g.day} className={`kal-agenda-day ${g.day === today ? "today" : ""}`}>
    <div className="kal-agenda-h"><span className="kal-agenda-n">{g.d.getDate()}</span><span><b>{g.d.toLocaleDateString("nb-NO", { weekday: "long" })}</b><span className="muted small">{g.d.toLocaleDateString("nb-NO", { month: "long" })}{g.day === today ? " · i dag" : ""}</span></span></div>
    <div className="kal-agenda-list">{g.evs.length === 0 ? <span className="muted small">Ingen avtaler i dag</span> : g.evs.map((e) => <EventRow key={e.id} e={e} onOpen={onOpen} />)}</div>
  </div>)}{groups.length === 0 && <p className="muted">Ingen kommende avtaler.</p>}</div>;
}

function EventSheet({ e, onClose, onEdit, onDeleted }: { e: CalEvent | null; onClose: () => void; onEdit: (e: CalEvent) => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => setErr(null), [e]);
  const del = async () => { if (!e || !confirm(`Slette «${e.title}»${e.recurring ? " (hele serien)" : ""}?`)) return; setBusy(true);
    try { await api(`/api/calendar/events/${e.id}`, { method: "DELETE", json: { confirm: true } }); onDeleted(); } catch (x) { setErr((x as Error).message); } setBusy(false); };
  return <Sheet open={!!e} onClose={onClose} title={e?.title ?? ""} subtitle={e ? `${dayLabel(parse(e.start))} · ${time(e)}` : ""} icon={<i className="kal-sheet-dot" style={{ background: e?.color }} />}>
    {e && <div className="kal-detail">
      <div className="kal-detail-row"><CalendarDays size={14} /> {e.calendarName}{e.recurring && " · gjentas"}</div>
      {e.location && <div className="kal-detail-row"><MapPin size={14} /> <a href={`https://maps.apple.com/?q=${encodeURIComponent(e.location)}`} target="_blank" rel="noreferrer">{e.location}</a></div>}
      {e.desc && <p className="kal-desc">{e.desc}</p>}
      {e.url && <a className="btn sm" href={e.url} {...(e.url.startsWith("#") ? {} : { target: "_blank", rel: "noreferrer" })}><ExternalLink size={13} /> Åpne</a>}
      {err && <div className="notice bad small">{err}</div>}
      {e.writable ? <div className="kal-actions"><button className="btn" onClick={() => onEdit(e)}><Pencil size={14} /> Endre</button><button className="btn danger" disabled={busy} onClick={() => void del()}><Trash2 size={14} /> Slett</button></div>
        : <p className="muted small"><Lock size={12} /> {e.readOnly ?? "Skrivebeskyttet kalender"}</p>}
    </div>}
  </Sheet>;
}

function EditSheet({ draft, cals, onClose, onSaved }: { draft: Partial<CalEvent> | null; cals: Cals | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: "", calendar: "local", allDay: false, date: "", startT: "09:00", endDate: "", endT: "10:00", location: "", desc: "" });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!draft) return; const s = draft.start ?? `${ymd(new Date())}T09:00`; const allDay = !!draft.allDay;
    const e = draft.end ?? (allDay ? s.slice(0, 10) : `${s.slice(0, 10)}T${pad(Math.min(23, Number(s.slice(11, 13)) + 1))}:${s.slice(14, 16) || "00"}`);
    const endDay = allDay && draft.end ? ymd(add(parse(draft.end), -1)) : e.slice(0, 10);
    setF({ title: draft.title ?? "", calendar: draft.calendar ?? cals?.defaultCalendar ?? "local", allDay, date: s.slice(0, 10), startT: s.slice(11, 16) || "09:00", endDate: endDay, endT: e.slice(11, 16) || "10:00", location: draft.location ?? "", desc: draft.desc ?? "" }); setErr(null); }, [draft, cals?.defaultCalendar]);
  const writable = (cals?.sources ?? []).filter((s) => s.writable && s.kind !== "webcal");
  const save = async () => {
    setBusy(true); setErr(null);
    const endDay = f.endDate && f.endDate >= f.date ? f.endDate : f.date;
    const body = { title: f.title, calendar: f.calendar, allDay: f.allDay, location: f.location || null, desc: f.desc || null,
      start: f.allDay ? f.date : `${f.date}T${f.startT}`, end: f.allDay ? ymd(add(parse(endDay), 1)) : `${endDay}T${f.endT}` };
    try { if (draft?.id) await api(`/api/calendar/events/${draft.id}`, { method: "PATCH", json: body }); else await api("/api/calendar/events", { json: body }); onSaved(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF((x) => ({ ...x, [k]: ev.target.value }));
  return <Sheet open={!!draft} onClose={onClose} title={draft?.id ? "Endre avtale" : "Ny avtale"} icon={<CalendarDays size={18} />}>
    <form className="kal-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <input className="input" autoFocus placeholder="Tittel" value={f.title} onChange={set("title")} maxLength={200} />
      {!draft?.id && <label className="kal-field"><span>Kalender</span><select className="input" value={f.calendar} onChange={set("calendar")}>{writable.map((s) => <option key={s.id} value={s.id}>{s.name}{s.kind === "icloud" ? " (iCloud)" : ""}</option>)}</select></label>}
      <label className="kal-check"><input type="checkbox" checked={f.allDay} onChange={(e) => setF((x) => ({ ...x, allDay: e.target.checked }))} /> Hele dagen</label>
      <div className="kal-two"><label className="kal-field"><span>Fra</span><input className="input" type="date" value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value, endDate: x.endDate < e.target.value ? e.target.value : x.endDate }))} /></label>
        {!f.allDay && <label className="kal-field"><span>Kl.</span><input className="input" type="time" value={f.startT} onChange={set("startT")} /></label>}</div>
      <div className="kal-two"><label className="kal-field"><span>Til</span><input className="input" type="date" value={f.endDate} min={f.date} onChange={set("endDate")} /></label>
        {!f.allDay && <label className="kal-field"><span>Kl.</span><input className="input" type="time" value={f.endT} onChange={set("endT")} /></label>}</div>
      <input className="input" placeholder="Sted" value={f.location} onChange={set("location")} />
      <textarea className="input" placeholder="Notat" rows={3} value={f.desc} onChange={set("desc")} />
      {err && <div className="notice bad small">{err}</div>}
      <div className="kal-actions"><button type="button" className="btn ghost" onClick={onClose}>Avbryt</button><button className="btn primary" disabled={busy || !f.title.trim() || !f.date}>{busy ? <Loader2 size={14} className="spin" /> : null} Lagre</button></div>
    </form>
  </Sheet>;
}

const SWATCH = ["#5b8def", "#e5734a", "#3fb27f", "#b36ae2", "#e2b33c", "#e0567a", "#3cb7c4", "#8a8f98"];
const KIND: Record<string, string> = { local: "Lagret i Home-appen", kids: "Skole og barnehage (kun lesing)", maintenance: "Forfallsdatoer fra Vedlikehold", icloud: "iCloud", webcal: "Delt lenke (kun lesing)" };
function CalendarsSheet({ open, cals, onClose, onChange }: { open: boolean; cals: Cals | null; onClose: () => void; onChange: () => void }) {
  const [url, setUrl] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [pick, setPick] = useState<string | null>(null);
  const patch = async (id: string, b: Partial<CalSource>) => { await api(`/api/calendar/sources/${encodeURIComponent(id)}`, { method: "PATCH", json: b }).catch(() => undefined); onChange(); };
  const addUrl = async () => { setBusy(true); setErr(null); try { await api("/api/calendar/sources", { json: { url } }); setUrl(""); onChange(); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  const ago = (t: number | null) => t ? `synket ${new Date(t).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}` : "ikke synket";
  return <Sheet open={open} onClose={onClose} title="Kalendere" subtitle="Velg hva som vises og fargen på hver kalender" icon={<Settings2 size={18} />}>
    <div className="kal-cals">
      {cals?.sources.map((s) => <div key={s.id} className="kal-cal">
        <button className="kal-swatch" style={{ background: s.color }} onClick={() => setPick(pick === s.id ? null : s.id)} aria-label="Velg farge" />
        <span className="grow"><b>{s.name}</b><span className="muted small">{KIND[s.kind]}{s.kind === "icloud" || s.kind === "webcal" ? ` · ${ago(s.syncedAt)}` : ""}{s.error ? ` · ${s.error}` : ""}</span></span>
        {s.kind === "webcal" && <button className="icon-btn ghost" onClick={() => void api(`/api/calendar/sources/${encodeURIComponent(s.id)}`, { method: "DELETE" }).then(onChange)} aria-label="Fjern"><Trash2 size={14} /></button>}
        <button className={`switch sm ${s.visible ? "on" : ""}`} role="switch" aria-checked={s.visible} aria-label={`Vis ${s.name}`} onClick={() => void patch(s.id, { visible: !s.visible })}><span className="switch-knob" /></button>
        {pick === s.id && <div className="kal-swatches">{SWATCH.map((c) => <button key={c} className={`chip swatch ${c === s.color ? "active" : ""}`} style={{ background: c }} onClick={() => { setPick(null); void patch(s.id, { color: c }); }} />)}
          <input type="color" value={s.color} onChange={(e) => void patch(s.id, { color: e.target.value })} aria-label="Egen farge" /></div>}
      </div>)}
    </div>
    <div className="kal-connect">
      <h4><Cloud size={14} /> iCloud</h4>
      {cals?.icloud.connected ? <p className="small">Tilkoblet som {cals.icloud.account}. Synkes hvert 10. minutt. <a href="#/settings">Administrer i Tilkoblinger</a></p>
        : <><p className="muted small">Bruk Apple-ID og et app-spesifikt passord (account.apple.com → Logg på og sikkerhet → App-spesifikke passord). Da kan du også legge til avtaler herfra.</p>
          <button className="btn" onClick={() => { location.hash = "#/settings/login/icloud"; }}><Cloud size={14} /> Koble til iCloud</button></>}
      <h4 style={{ marginTop: 18 }}><Link2 size={14} /> Delt eller offentlig kalender</h4>
      <p className="muted small">Lim inn en webcal://-lenke (iCloud: Del kalender → Offentlig kalender). Kun lesing.</p>
      <form className="kal-url" onSubmit={(e) => { e.preventDefault(); void addUrl(); }}><input className="input" placeholder="webcal://p01-caldav.icloud.com/published/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn" disabled={busy || url.length < 12}>{busy ? <Loader2 size={14} className="spin" /> : "Legg til"}</button></form>
      {err && <div className="notice bad small">{err}</div>}
    </div>
  </Sheet>;
}
