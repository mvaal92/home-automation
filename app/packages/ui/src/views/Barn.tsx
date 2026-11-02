import { useEdit, orderBy } from "../lib/layout";
import { EditGrid } from "../components/EditMode";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Backpack, Baby, CalendarDays, Camera, Check, ChevronLeft, ChevronRight, CircleAlert, ClipboardList, Copy, GraduationCap, Images, Mail, Newspaper, Plus, RefreshCw, Sun, Trash2, Users, X } from "lucide-react";
import { api } from "../lib/api";
const PORTAL = "https://foresatt.visma.no/kommunen"; const MYKID = "https://mykid.no/foreldre";
/** Turn plain URLs (and the stripped "[lenke i Foresattportalen]") into real links that open in a new tab. */
function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>()"]+|\[lenke i Foresattportalen\])/g);
  return <>{parts.map((p, i) => /^https?:\/\//.test(p) ? <a key={i} className="ext-link" href={p.replace(/[.,;:!?]+$/, "")} target="_blank" rel="noreferrer">{p.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}</a>
    : p === "[lenke i Foresattportalen]" ? <a key={i} className="ext-link" href={PORTAL} target="_blank" rel="noreferrer">Åpne i Foresattportalen</a> : p)}</>;
}
async function copyText(t: string) { try { await navigator.clipboard.writeText(t); return true; } catch { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok; } }

export interface WeekItem { title: string; start: string | null; end: string | null; desc: string | null; icon: string | null }
export interface Day { date: string | null; label: string; absent: string | null; items: WeekItem[]; packing: { item: string; done: boolean }[] }
export interface Child { id: string; name: string; fullName?: string; kind: "barnehage" | "skole"; institution: string; group?: string; source: string; pending?: boolean; today: Day | null; week: Day[]; latestPost?: { date: string; blocks: { group: string; text: string }[] } | null; photoCount?: number; latestPhotos?: string[]; school?: SchoolSum }
export interface SchoolSum { syncedAt: number; loginRequired: boolean; unread: number; latest: SMsg | null; homework: { title: string; text: string; sent: string; teacher: string; plan: string | null } | null; openForms: number; absenceDays: number }
interface SMsg { id: string; from: string; teacher: string; title: string; text: string; sent: string; unread: boolean; attachments: { name: string; size: number; ref?: string | null }[] }
interface Skole { loginRequired: boolean; error?: string | null; syncedAt?: number; municipality?: string; portal?: string; child?: { name: string; fullName: string; school: string; level: number; contactTeacher: string | null; sfo: string | null }; messages?: SMsg[]; notices?: { id: string; title: string; from: string; text: string; sent: string; unread: boolean }[]; homework?: { id: string; title: string; text: string; sent: string; teacher: string; plan: string | null }[]; absence?: { year: string | null; terms: { term: number; totalDays: number; totalMinutes: number; documentedDays: number; undocumentedDays: number }[]; items: unknown[] }; forms?: { id: number; title: string; deadline: string | null; published: string | null; answered: boolean; closed: boolean }[]; consents?: { id: number; title: string; status: number; modified: string | null }[]; timetable?: { day: string; startTime?: string; endTime?: string; subject?: string; room?: string }[] }
export interface Todo { id: number; child: string; title: string; due: string | null; source: string; done: number }
export interface Overview { sources: { id: string; kind: string; label: string; app: string; status: string; note?: string }[]; syncedAt: number | null; transport: string | null; children: Child[]; todos: Todo[] }
interface Photo { id: string; album: string; date: string | null; caption: string | null; video: boolean }
interface Feed { posts: { date: string; blocks: { group: string; text: string }[] }[]; albums: { id: string; title: string; photoIds: string[] }[]; photos: Photo[]; newsletters: { id: string; title: string; date: string }[]; notices: { id: string; title: string; date: string }[]; birthdays: { name: string; when: string }[]; staff: string[] }
interface Ev { id: string; title: string; start: string; end: string | null; allDay: boolean; desc: string | null; child: string; kind?: string }

export const photoUrl = (id: string) => `/api/kids/photo/${id}`;
const fmtDay = (d: string, o: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) => new Date(`${d}T12:00`).toLocaleDateString("nb-NO", o);
const todayIso = () => new Date().toLocaleDateString("sv-SE");
export function useKids() {
  const [o, setO] = useState<Overview | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = () => api<Overview>("/api/kids/overview").then(setO).catch((e) => setErr((e as Error).message));
  useEffect(() => { void load(); const t = setInterval(load, 10 * 60_000); return () => clearInterval(t); }, []);
  return { o, setO, err, load };
}
const TABS = [["oversikt", "Oversikt", Sun], ["skole", "Skole", GraduationCap], ["uke", "Uke", CalendarDays], ["oppgaver", "Oppgaver", ClipboardList], ["bilder", "Bilder", Images], ["dagenmin", "Dagen min", Newspaper], ["meldinger", "Oppslag", Mail], ["kontakter", "Kontakter", Users]] as const;
type Tab = typeof TABS[number][0];

export function BarnPage() {
  const { o, setO, err, load } = useKids();
  const ed = useEdit(); const pg = ed.page("barn");
  const tabKeys = orderBy(TABS.map(([k]) => k), pg.order).filter((k) => !(pg.hidden ?? []).includes(k)) as Tab[];
  const [tab, setTab] = useState<Tab>(() => (location.hash.split("/")[2] as Tab) || tabKeys[0] || "oversikt");
  const [child, setChild] = useState<string>("alle");
  const [feed, setFeed] = useState<Feed | null>(null); const [events, setEvents] = useState<Ev[]>([]);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => { api<Feed>("/api/kids/feed").then(setFeed).catch(() => undefined); api<{ events: Ev[] }>("/api/kids/agenda").then((r) => setEvents(r.events)).catch(() => undefined); }, [o?.syncedAt]);
  useEffect(() => { const on = () => { if (!location.hash.startsWith("#/barn")) return; const t = (location.hash.split("/")[2] || "oversikt") as Tab; if (TABS.some(([k]) => k === t)) setTab(t); }; window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  const pick = (t: Tab) => { setTab(t); history.replaceState(null, "", `#/barn/${t}`); };
  const sync = async () => { setSyncing(true); try { await api("/api/kids/sync", { method: "POST" }); await load(); } finally { setSyncing(false); } };
  const kids = o?.children ?? [];
  const shown = child === "alle" ? kids : kids.filter((k) => k.id === child);
  return (
    <div className="page barn-page">
      <div className="page-head"><h1 className="page-title">Barn</h1>
        <div className="grow" />
        <span className="muted small">{o?.syncedAt ? `Oppdatert ${new Date(o.syncedAt).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
        <button className="icon-btn ghost" onClick={() => void sync()} aria-label="Oppdater" title="Hent nytt fra MyKid"><RefreshCw size={16} className={syncing ? "spin" : ""} /></button>
      </div>
      {err && <div className="notice bad small"><CircleAlert size={14} /> {err}</div>}
      <div className="kid-switch" role="tablist">
        <button className={`kid-pill ${child === "alle" ? "on" : ""}`} onClick={() => setChild("alle")}><Users size={14} /> Alle</button>
        {kids.map((k) => <button key={k.id} className={`kid-pill ${child === k.id ? "on" : ""} ${k.pending ? "pending" : ""}`} onClick={() => setChild(k.id)}>
          <span className={`kid-av ${k.kind}`}>{k.kind === "skole" ? <GraduationCap size={13} /> : <Baby size={13} />}</span>{k.name}<span className="muted tiny">{k.kind === "skole" ? "Skole" : "Barnehage"}</span></button>)}
      </div>
      {ed.editing
        ? <EditGrid tab="barn" label="Barn – faner" variant="chips" items={TABS.map(([k, l, I]) => ({ key: k, label: l, node: <span className="seg-tab-chip"><I size={14} /> {l}</span> }))}
            order={pg.order} hidden={pg.hidden} onChange={(n, why) => void ed.patchPage("barn", { ...pg, ...n }, why)} />
        : <div className="seg-tabs">{tabKeys.map((k) => { const [, l, I] = TABS.find(([x]) => x === k)!; return <button key={k} className={tab === k ? "on" : ""} onClick={() => pick(k)}><I size={14} /> {l}</button>; })}</div>}
      <AnimatePresence mode="wait"><motion.div key={tab + child} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }} className="barn-body">
        {tab === "oversikt" && <Today kids={shown} feed={feed} todos={o?.todos ?? []} setTodos={(t) => o && setO({ ...o, todos: t })} sources={o?.sources ?? []} openTab={pick} />}
        {tab === "skole" && <SkolePage />}
        {tab === "uke" && <Week kids={shown} events={events} />}
        {tab === "oppgaver" && <Todos todos={o?.todos ?? []} setTodos={(t) => o && setO({ ...o, todos: t })} kids={kids} />}
        {tab === "bilder" && <Gallery feed={feed} />}
        {tab === "dagenmin" && <Posts feed={feed} />}
        {tab === "meldinger" && <Notices feed={feed} sources={o?.sources ?? []} />}
        {tab === "kontakter" && <Contacts feed={feed} kids={kids} />}
      </motion.div></AnimatePresence>
    </div>
  );
}

function Packing({ child, day }: { child: string; day: Day }) {
  const [p, setP] = useState(day.packing);
  if (!p.length || !day.date) return null;
  const tick = (item: string, done: boolean) => { setP((l) => l.map((x) => x.item === item ? { ...x, done } : x)); void api("/api/kids/pack", { method: "POST", json: { date: day.date, child, item, done } }); };
  return <div className="packing"><span className="packing-h"><Backpack size={14} /> Pakk {day.date === todayIso() ? "i dag" : fmtDay(day.date, { weekday: "long" })}</span>
    <div className="pack-chips">{p.map((x) => <button key={x.item} className={`pack-chip ${x.done ? "done" : ""}`} onClick={() => tick(x.item, !x.done)}>{x.done ? <Check size={13} /> : <span className="box" />}{x.item}</button>)}</div></div>;
}
function DayItems({ day }: { day: Day }) {
  const items = day.items.filter((i) => !/^FN-uker$/i.test(i.title) || day.items.length === 1);
  const theme = day.items.filter((i) => !i.start && !i.desc).map((i) => i.title);
  return <ul className="day-items">
    {theme.length > 0 && <li className="theme">{theme.join(" · ")}</li>}
    {items.filter((i) => i.start || i.desc).map((i, n) => <li key={n} className={`ev ev-${i.icon ?? "x"}`}><span className="ev-time">{i.start ? `${i.start}–${i.end}` : "Hele dagen"}</span><span className="ev-main"><b>{i.title}</b>{i.desc && <span className="muted">{i.desc}</span>}</span></li>)}
    {day.absent && <li className="ev"><span className="ev-time">Fravær</span><span className="ev-main">{day.absent === "Fr" ? "Fri" : day.absent}</span></li>}
  </ul>;
}
function Today({ kids, feed, todos, setTodos, sources, openTab }: { kids: Child[]; feed: Feed | null; todos: Todo[]; setTodos: (t: Todo[]) => void; sources: Overview["sources"]; openTab: (t: Tab) => void }) {
  const tomorrow = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString("sv-SE"); }, []);
  const open = todos.filter((t) => !t.done).slice(0, 4);
  return <div className="barn-grid">
    {kids.map((k) => k.pending ? <PendingSchool key={k.id} name={k.name} src={sources.find((s) => s.id === k.source)} /> : k.kind === "skole" ? <SchoolCard key={k.id} k={k} open={() => openTab("skole")} /> : <section key={k.id} className="card kid-card">
      <header className="kid-head"><span className={`kid-av lg ${k.kind}`}><Baby size={18} /></span><div className="grow"><h3>{k.name}</h3><span className="muted small">{k.institution} · {k.group}</span></div></header>
      <div className="kid-days">
        {[["I dag", k.today], ["I morgen", k.week.find((d) => d.date === tomorrow)]].map(([l, d]) => <div key={l as string} className="kid-day">
          <span className="kid-day-l">{l as string}</span>{d ? <><DayItems day={d as Day} /><Packing child={k.id} day={d as Day} /></> : <span className="muted small">Ingenting registrert</span>}</div>)}
      </div>
      {k.latestPost && <button className="latest-post" onClick={() => openTab("dagenmin")}><Newspaper size={14} /><span className="grow"><b>Dagen min · {fmtDay(k.latestPost.date, { weekday: "short", day: "numeric", month: "short" })}</b><span className="clamp2">{k.latestPost.blocks[0]?.text}</span></span><ChevronRight size={14} /></button>}
      {k.latestPhotos && k.latestPhotos.length > 0 && <div className="photo-strip" onClick={() => openTab("bilder")}>{k.latestPhotos.slice(0, 6).map((id) => <img key={id} src={photoUrl(id)} loading="lazy" alt="" />)}<span className="more">{k.photoCount} bilder <ChevronRight size={13} /></span></div>}
    </section>)}
    <section className="card">
      <header className="row"><h3 className="grow"><ClipboardList size={15} /> Å gjøre</h3><button className="btn sm ghost" onClick={() => openTab("oppgaver")}>Alle</button></header>
      {open.length ? <TodoList todos={open} all={todos} setTodos={setTodos} /> : <span className="muted small">Ingen åpne oppgaver.</span>}
      {feed && feed.newsletters.length > 0 && <><h4 className="mini-h">Siste fra barnehagen</h4><ul className="plain-list">{feed.newsletters.slice(0, 3).map((n) => <li key={n.id}><a className="grow ext-link" href={MYKID} target="_blank" rel="noreferrer">{n.title}</a><span className="muted tiny">{fmtDay(n.date, { day: "numeric", month: "short" })}</span></li>)}</ul></>}
      <div className="row ics-row"><a className="btn sm ghost ics" href={`webcal://${location.host}/api/kids/barn.ics`}><CalendarDays size={13} /> Abonner (ICS)</a>
        <button className="btn sm ghost" onClick={async (e) => { const b = e.currentTarget; const ok = await copyText(location.origin + "/api/kids/barn.ics"); b.textContent = ok ? "Lenke kopiert ✓" : location.origin + "/api/kids/barn.ics"; }}><Copy size={13} /> Kopier lenke</button>
        <a className="btn sm ghost" href="/api/kids/barn.ics" download="barn.ics">Last ned</a></div>
    </section>
  </div>;
}
function PendingSchool({ src, name }: { src?: Overview["sources"][number]; name?: string }) {
  return <section className="card kid-card pending-card"><header className="kid-head"><span className="kid-av lg skole"><GraduationCap size={18} /></span><div className="grow"><h3>{name ?? "Skolebarn"} · Skole</h3><span className="muted small">{src?.app ?? "Foresattportalen"}</span></div><span className="chip static">Venter på innlogging</span></header>
    <p className="muted small">{src?.note}</p><a className="btn sm" href="#/settings">Logg inn via Tilkoblinger</a>
    <ul className="ghost-list"><li>Timeplan og lekser</li><li>Meldinger fra kontaktlærer</li><li>Fravær og SFO</li><li>Samtykker og skjema med frist</li></ul></section>;
}
const fmtShort = (d: string) => fmtDay(d.slice(0, 10), { weekday: "short", day: "numeric", month: "short" });
function SchoolCard({ k, open }: { k: Child; open: () => void }) {
  const s = k.school!;
  return <section className="card kid-card"><header className="kid-head"><span className="kid-av lg skole"><GraduationCap size={18} /></span><div className="grow"><h3>{k.name}</h3><span className="muted small">{k.institution} · {k.group}</span></div>{s.unread > 0 && <span className="chip on">{s.unread} ulest</span>}{s.loginRequired && <span className="chip static">Logg inn på nytt</span>}</header>
    {s.homework && <button className="latest-post" onClick={open}><ClipboardList size={14} /><span className="grow"><b>{s.homework.title} · {fmtShort(s.homework.sent)}</b><span className="clamp2">{s.homework.text}</span></span><ChevronRight size={14} /></button>}
    {s.latest && s.latest.id !== undefined && <button className="latest-post" onClick={open}><Mail size={14} /><span className="grow"><b>{s.latest.from} · {fmtShort(s.latest.sent)}</b><span className="clamp2">{s.latest.title}</span></span><ChevronRight size={14} /></button>}
    <div className="chips-row"><span className="chip static">{s.openForms ? `${s.openForms} skjema å svare på` : "Ingen åpne skjema"}</span><span className="chip static">Fravær: {s.absenceDays} dager</span></div>
  </section>;
}
function SkolePage() {
  const [s, setS] = useState<Skole | null>(null); const [busy, setBusy] = useState(false); const [sel, setSel] = useState<string | null>(null); const [selN, setSelN] = useState<string | null>(null);
  const openMsg = (id: string) => { setSel(id); setTimeout(() => document.getElementById("skole-msgs")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  const load = () => api<Skole>("/api/kids/skole").then(setS).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  const sync = async () => { setBusy(true); try { await api("/api/kids/skole/sync", { method: "POST" }); } catch { /* */ } finally { await load(); setBusy(false); } };
  if (!s) return <div className="muted">Laster skole…</div>;
  if (!s.child) return <section className="card"><h3>Skole</h3><p className="muted small">Logg inn i Foresattportalen (Kommunen) med BankID i Brave på omarchy, og trykk oppdater.</p><button className="btn sm" onClick={() => void sync()}>Oppdater</button></section>;
  const msgs = (s.messages ?? []).filter((m) => m.from !== "Deg"); const open = (s.messages ?? []).find((m) => m.id === sel); const [note, setNote] = [selN, setSelN];
  const total = (s.absence?.terms ?? []).reduce((a, t) => a + t.totalDays, 0);
  return <div className="barn-grid skole-grid">
    <section className="card"><header className="row"><span className="kid-av lg skole"><GraduationCap size={18} /></span><div className="grow"><h3>{s.child.name} · {s.child.school}</h3><span className="muted small">{s.child.level}. trinn · kontaktlærer {s.child.contactTeacher} · {s.municipality}</span></div>
      <button className="icon-btn ghost" onClick={() => void sync()} title="Hent fra Foresattportalen"><RefreshCw size={16} className={busy ? "spin" : ""} /></button></header>
      {s.loginRequired && <div className="notice bad small"><CircleAlert size={14} /> Økten i Foresattportalen er utløpt. Logg inn med BankID i Brave – viser data fra {s.syncedAt ? new Date(s.syncedAt).toLocaleString("nb-NO") : "siste synk"}.</div>}
      <div className="chips-row"><span className="chip static">SFO: {s.child.sfo ?? "–"}</span><span className="chip static">Fravær {s.absence?.year}: {total} dager</span><span className="chip static">Kun lesing</span></div></section>
    <section className="card"><h3><ClipboardList size={15} /> Lekser og ukeplan</h3><ul className="plain-list">{(s.homework ?? []).slice(0, 5).map((h) => <li key={h.id} onClick={() => openMsg(h.id)} role="button"><span className="grow"><b>{h.title}</b>{h.plan && <span className="muted tiny"> · 📎 {h.plan}</span>}</span><span className="muted tiny">{fmtShort(h.sent)}</span></li>)}</ul>
      <p className="muted tiny">Trykk for å åpne meldingen og ukeplanen (PDF).</p></section>
    <section className="card"><h3><CalendarDays size={15} /> Timeplan</h3>{s.timetable?.length ? <ul className="plain-list">{s.timetable.map((l, i) => <li key={i}><span className="ev-time">{fmtShort(l.day)} {l.startTime ?? ""}</span><span className="grow">{l.subject}</span></li>)}</ul> : <span className="muted small">Skolen publiserer ikke timeplan i portalen for {s.child.level}. trinn – se ukeplanen.</span>}</section>
    <section className="card wide" id="skole-msgs"><h3><Mail size={15} /> Meldinger fra skolen</h3>
      {open ? <article className="msg-open"><button className="btn sm ghost" onClick={() => setSel(null)}><ChevronLeft size={14} /> Tilbake</button><h4>{open.title}</h4><span className="muted small">{open.from} · {fmtDay(open.sent.slice(0, 10))}</span><p className="pre"><Linkify text={open.text} /></p><div className="chips-row">{open.attachments.map((a, i) => <a key={a.name + i} className="chip att" href={`/api/kids/skole/attachment/${open.id}/${i}`} target="_blank" rel="noreferrer">📎 {a.name} <span className="muted tiny">{Math.max(1, Math.round(a.size / 1024))} kB</span></a>)}</div><p className="muted tiny">Svar sendes kun fra <a className="ext-link" href={PORTAL} target="_blank" rel="noreferrer">Foresattportalen</a>.</p></article>
      : <ul className="plain-list">{msgs.slice(0, 12).map((m) => <li key={m.id} onClick={() => openMsg(m.id)} role="button" className={m.unread ? "strong" : ""}><span className="grow"><b>{m.title}</b> <span className="muted small">– {m.from}</span></span><span className="muted tiny">{fmtShort(m.sent)}</span></li>)}</ul>}</section>
    <section className="card"><h3><Newspaper size={15} /> Beskjeder</h3><ul className="plain-list">{(s.notices ?? []).slice(0, 8).map((n) => <li key={n.id} role="button" onClick={() => setNote(note === n.id ? null : n.id)} className={n.unread ? "strong" : ""}><span className="grow">{n.title}{note === n.id && <span className="pre muted small note-body"><Linkify text={n.text} /></span>}</span><span className="muted tiny">{fmtShort(n.sent)}</span></li>)}</ul></section>
    <section className="card"><h3><ClipboardList size={15} /> Skjema og samtykker</h3><ul className="plain-list">{(s.forms ?? []).map((f) => <li key={f.id}><a className="grow ext-link" href={PORTAL} target="_blank" rel="noreferrer">{f.title}</a><span className={`chip static ${!f.answered && !f.closed ? "on" : ""}`}>{f.answered ? "Besvart" : f.closed ? "Lukket" : `Frist ${f.deadline}`}</span></li>)}</ul>
      <h4 className="mini-h">Samtykker</h4><ul className="plain-list">{(s.consents ?? []).map((c) => <li key={c.id}><a className="grow ext-link" href={PORTAL} target="_blank" rel="noreferrer">{c.title}</a><span className="muted tiny">{c.modified}</span></li>)}</ul><p className="muted tiny">Kun visning. Du svarer selv i <a className="ext-link" href={PORTAL} target="_blank" rel="noreferrer">Foresattportalen ↗</a>.</p></section>
  </div>;
}
function Week({ kids, events }: { kids: Child[]; events: Ev[] }) {
  const k = kids.find((x) => !x.pending && x.kind !== "skole");
  const [off, setOff] = useState(0);
  const month = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() + off, 1); return d; }, [off]);
  const ym = month.toLocaleDateString("sv-SE").slice(0, 7);
  const upcoming = events.filter((e) => e.start.slice(0, 7) === ym && e.kind !== "birthday");
  const byDay = new Map<string, Ev[]>(); for (const e of upcoming) { const d = e.start.slice(0, 10); byDay.set(d, [...(byDay.get(d) ?? []), e]); }
  return <div className="week-wrap">
    {k && <section className="week-strip">{k.week.map((d) => <div key={d.label} className={`week-col ${d.date === todayIso() ? "today" : ""}`}><span className="week-d">{d.label}</span><DayItems day={d} />{d.packing.length > 0 && <span className="pack-hint"><Backpack size={12} /> {d.packing.map((p) => p.item).join(", ")}</span>}</div>)}</section>}
    <section className="card"><header className="row"><button className="icon-btn ghost" onClick={() => setOff(off - 1)}><ChevronLeft size={16} /></button><h3 className="grow center">{month.toLocaleDateString("nb-NO", { month: "long", year: "numeric" })}</h3><button className="icon-btn ghost" onClick={() => setOff(off + 1)}><ChevronRight size={16} /></button></header>
      {byDay.size === 0 ? <span className="muted small">Ingen hendelser.</span> : <ul className="agenda">{[...byDay].map(([d, l]) => <li key={d}><span className={`ag-date ${d === todayIso() ? "today" : ""}`}><b>{new Date(`${d}T12:00`).getDate()}</b>{fmtDay(d, { weekday: "short" })}</span><div className="grow">{l.map((e) => <div key={e.id} className="ag-ev"><span className="ev-time">{e.allDay || e.start.length <= 10 ? "Hele dagen" : e.start.slice(11, 16)}</span>{e.title}</div>)}</div></li>)}</ul>}
    </section>
  </div>;
}
function TodoList({ todos, all, setTodos }: { todos: Todo[]; all: Todo[]; setTodos: (t: Todo[]) => void }) {
  const set = async (t: Todo, done: boolean) => { setTodos(all.map((x) => x.id === t.id ? { ...x, done: done ? 1 : 0 } : x)); const r = await api<{ todos: Todo[] }>(`/api/kids/todos/${t.id}`, { method: "PATCH", json: { done } }); setTodos(r.todos); };
  const del = async (t: Todo) => setTodos((await api<{ todos: Todo[] }>(`/api/kids/todos/${t.id}`, { method: "DELETE" })).todos);
  return <ul className="todo-list">{todos.map((t) => { const late = t.due && !t.done && t.due < todayIso();
    return <li key={t.id} className={t.done ? "done" : ""}><button className={`check ${t.done ? "on" : ""}`} onClick={() => void set(t, !t.done)} aria-label="Ferdig">{t.done ? <Check size={13} /> : null}</button>
      <span className="grow">{t.title}</span>{t.due && <span className={`due ${late ? "late" : ""}`}>{fmtDay(t.due, { weekday: "short", day: "numeric", month: "short" })}</span>}
      <button className="icon-btn ghost sm" onClick={() => void del(t)} aria-label="Slett"><Trash2 size={13} /></button></li>; })}</ul>;
}
function Todos({ todos, setTodos, kids }: { todos: Todo[]; setTodos: (t: Todo[]) => void; kids: Child[] }) {
  const [title, setTitle] = useState(""); const [due, setDue] = useState(""); const [who, setWho] = useState(kids[0]?.id ?? "");
  const add = async () => { if (!title.trim()) return; setTodos((await api<{ todos: Todo[] }>("/api/kids/todos", { method: "POST", json: { title, due: due || null, child: who } })).todos); setTitle(""); setDue(""); };
  return <section className="card"><h3><ClipboardList size={15} /> Oppgaver og skjema</h3>
    <div className="todo-add"><input placeholder="F.eks. «Signere samtykke for tur»" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} /><select value={who} onChange={(e) => setWho(e.target.value)}>{kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select>
      <button className="btn sm primary" onClick={() => void add()}><Plus size={14} /> Legg til</button></div>
    {todos.length ? <TodoList todos={todos} all={todos} setTodos={setTodos} /> : <span className="muted small">Ingen oppgaver ennå. «Husk …» fra ukeplanen havner her automatisk.</span>}
    <p className="muted tiny">Huskelisten er lokal. Åpne skjema fra skolen legges inn automatisk, men du svarer alltid selv i appen.</p></section>;
}
function Gallery({ feed }: { feed: Feed | null }) {
  const [open, setOpen] = useState<number | null>(null); const [album, setAlbum] = useState<string>("alle");
  const photos = (feed?.photos ?? []).filter((p) => !p.video && (album === "alle" || p.album === album));
  const groups = useMemo(() => { const m = new Map<string, Photo[]>(); for (const p of photos) { const k = p.date ? p.date.slice(0, 7) : "Uten dato"; m.set(k, [...(m.get(k) ?? []), p]); } return [...m]; }, [photos]);
  const albums = [...new Set((feed?.photos ?? []).map((p) => p.album))];
  useEffect(() => { const k = (e: KeyboardEvent) => { if (open == null) return; if (e.key === "Escape") setOpen(null); if (e.key === "ArrowRight") setOpen((i) => Math.min(photos.length - 1, (i ?? 0) + 1)); if (e.key === "ArrowLeft") setOpen((i) => Math.max(0, (i ?? 0) - 1)); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [open, photos.length]);
  if (!feed) return <div className="muted">Laster bilder…</div>;
  let idx = 0;
  return <div className="gallery">
    <div className="chips-row"><button className={`chip ${album === "alle" ? "on" : ""}`} onClick={() => setAlbum("alle")}>Alle ({feed.photos.length})</button>{albums.map((a) => <button key={a} className={`chip ${album === a ? "on" : ""}`} onClick={() => setAlbum(a)}>{a}</button>)}</div>
    {groups.map(([m, list]) => <section key={m}><h3 className="section-title">{m === "Uten dato" ? m : new Date(`${m}-15`).toLocaleDateString("nb-NO", { month: "long", year: "numeric" })} <span className="muted small">{list.length}</span></h3>
      <div className="photo-grid">{list.map((p) => { const i = idx++; return <button key={p.id} className="ph" onClick={() => setOpen(i)}><img src={photoUrl(p.id)} loading="lazy" alt={p.caption ?? ""} />{p.date && <span className="ph-date">{fmtDay(p.date, { day: "numeric", month: "short" })}</span>}</button>; })}</div></section>)}
    <AnimatePresence>{open != null && photos[open] && <motion.div className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(null)}>
      <button className="lb-x icon-btn" onClick={() => setOpen(null)} aria-label="Lukk"><X size={20} /></button>
      <button className="lb-nav l icon-btn" onClick={(e) => { e.stopPropagation(); setOpen(Math.max(0, open - 1)); }}><ChevronLeft size={26} /></button>
      <motion.img key={photos[open].id} initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} src={photoUrl(photos[open].id)} onClick={(e) => e.stopPropagation()} alt="" />
      <button className="lb-nav r icon-btn" onClick={(e) => { e.stopPropagation(); setOpen(Math.min(photos.length - 1, open + 1)); }}><ChevronRight size={26} /></button>
      <div className="lb-cap"><b>{photos[open].album}</b>{photos[open].date && ` · ${fmtDay(photos[open].date!)}`}{photos[open].caption && <div>{photos[open].caption}</div>}<span className="muted">{open + 1} / {photos.length}</span></div>
    </motion.div>}</AnimatePresence>
  </div>;
}
function Posts({ feed }: { feed: Feed | null }) {
  if (!feed) return null;
  const byDate = new Map<string, Photo[]>(); for (const p of feed.photos) if (p.date) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p]);
  return <div className="posts">{feed.posts.length === 0 && <span className="muted">Ingen innlegg de siste ukene.</span>}
    {feed.posts.map((p) => <article key={p.date} className="card post"><header><span className="post-date">{fmtDay(p.date)}</span></header>
      {p.blocks.map((b, i) => <div key={i}><span className="post-group">{b.group}</span><p>{b.text}</p></div>)}
      {byDate.get(p.date) && <div className="post-photos">{byDate.get(p.date)!.slice(0, 6).map((ph) => <img key={ph.id} src={photoUrl(ph.id)} loading="lazy" alt="" />)}</div>}</article>)}</div>;
}
function Notices({ feed, sources }: { feed: Feed | null; sources: Overview["sources"] }) {
  if (!feed) return null;
  const L = ({ t, l }: { t: string; l: { id: string; title: string; date: string }[] }) => <section className="card"><h3>{t}</h3><ul className="plain-list">{l.map((n) => <li key={n.id}><a className={`grow ext-link ${/viktig/i.test(n.title) ? "strong" : ""}`} href={MYKID} target="_blank" rel="noreferrer">{n.title}</a><span className="muted tiny">{n.date && fmtDay(n.date, { day: "numeric", month: "short", year: "numeric" })}</span></li>)}</ul></section>;
  return <div className="barn-grid"><L t="Nyhetsbrev" l={feed.newsletters} /><L t="Faste oppslag" l={feed.notices} />
    <section className="card"><h3><Mail size={15} /> Meldinger</h3><p className="muted small">Kun lesing. Meldinger fra skolen finner du i Skole-fanen. Svar sendes alltid fra appen selv.</p></section></div>;
}
function Contacts({ feed, kids }: { feed: Feed | null; kids: Child[] }) {
  return <div className="barn-grid">{kids.filter((k) => !k.pending && k.kind !== "skole").map((k) => <section key={k.id} className="card"><h3>{k.institution} · {k.group}</h3>
    <ul className="plain-list">{(feed?.staff ?? []).map((s) => <li key={s}><Users size={13} /> {s}</li>)}</ul>
    {feed?.birthdays.length ? <><h4 className="mini-h">Kommende bursdager</h4><ul className="plain-list">{feed.birthdays.map((b) => <li key={b.name}>🎂 {b.name} <span className="muted small">{b.when}</span></li>)}</ul></> : null}</section>)}
    <section className="card"><h3><Camera size={15} /> Kilder</h3><p className="muted small"><a className="ext-link" href={MYKID} target="_blank" rel="noreferrer">MyKid ↗</a> · <a className="ext-link" href={PORTAL} target="_blank" rel="noreferrer">Foresattportalen ↗</a></p><p className="muted small">MyKid (barnehage) leses via din innloggede økt. Ingenting sendes, likes eller markeres som lest av appen.</p></section></div>;
}
/** Compact dashboard card: today per kid + latest photos. */
export function BarnCard({ open }: { open: () => void }) {
  const { o } = useKids();
  if (!o) return null;
  const k = o.children.filter((c) => !c.pending);
  return <section className="card barn-card" onClick={open} role="button">
    <header className="row"><span className="card-ic"><Baby size={17} /></span><h3 className="grow">Barn i dag</h3><ChevronRight size={16} className="muted" /></header>
    {k.map((c) => { const items = (c.today?.items ?? []).filter((i) => i.start || i.desc); const pack = (c.today?.packing ?? []).filter((p) => !p.done);
      if (c.school) return <div key={c.id} className="barn-line"><b>{c.name}</b><span className="grow muted">{c.school.homework ? c.school.homework.title : c.institution}{c.school.unread ? ` · ${c.school.unread} ulest` : ""}</span></div>;
      return <div key={c.id} className="barn-line"><b>{c.name}</b><span className="grow muted">{items.length ? items.map((i) => `${i.start ?? ""} ${i.title}`.trim()).join(" · ") : (c.today?.items[0]?.title ?? "Vanlig dag")}</span>
        {pack.length > 0 && <span className="chip on"><Backpack size={12} /> {pack.map((p) => p.item).join(", ")}</span>}</div>; })}
    {o.children.some((c) => c.pending) && <div className="barn-line"><b>{o.children.find((c) => c.pending)?.name}</b><span className="muted">Skole kobles til når Foresattportalen er innlogget</span></div>}
    {k[0]?.latestPhotos?.length ? <div className="photo-strip small">{k[0].latestPhotos.slice(0, 5).map((id) => <img key={id} src={photoUrl(id)} loading="lazy" alt="" />)}</div> : null}
  </section>;
}
