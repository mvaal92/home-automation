import { useEffect, useMemo, useRef, useState } from "react";
import { Baby, BookOpen, BookmarkPlus, BookmarkCheck, Clock, ExternalLink, Headphones, History, LogIn, Pause, Play, Search, Speaker, X } from "lucide-react";
import { api } from "../lib/api";
import { useSnapshot } from "../lib/home";

export interface FabelBook { isbn: string; title: string; authors: string[]; readers: string[]; cover: string | null; coverSmall: string | null; minutes: number | null; series: string | null; seriesPart: number | null; category: string | null; publisher: string | null; released: string | null; inSubscription: boolean; subscriptionFrom: string | null; price: number | null; themes: string[]; url: string; sample: string }
interface ShelfItem { book: FabelBook; status: "leser" | "vil-lese" | "ferdig"; progress: number; updatedAt: number }
interface Shelf { items: ShelfItem[] }

const dur = (m: number | null) => (m == null ? "" : `${Math.floor(m / 60)} t ${m % 60} min`);
const SHELVES = [["Nytt og populært", "2026"], ["Jo Nesbø", "Jo Nesbø"], ["Krim og spenning", "krim"], ["Lars Mytting", "Lars Mytting"], ["Fakta", "historie"]] as const;
const LS = "home.lydboker.v1";
interface KidSeries { title: string; age: string; books: FabelBook[] }
type Filter = "barn" | "alle" | "voksne";
const isKidBook = (b: FabelBook) => /^(Barn|Ungdom)$/i.test(b.category ?? "");

function useShelf() {
  const [shelf, setShelf] = useState<Shelf>(() => { try { return JSON.parse(localStorage.getItem(LS) ?? "") as Shelf; } catch { return { items: [] }; } });
  useEffect(() => { api<{ value: Shelf | null }>("/api/prefs/lydboker").then((r) => { if (r.value?.items) setShelf(r.value); }).catch(() => undefined); }, []);
  const save = (s: Shelf) => { setShelf(s); localStorage.setItem(LS, JSON.stringify(s)); void api("/api/prefs/lydboker", { method: "PUT", json: s }).catch(() => undefined); };
  const upsert = (book: FabelBook, patch: Partial<ShelfItem>) => {
    const cur = shelf.items.find((i) => i.book.isbn === book.isbn) ?? { book, status: "vil-lese" as const, progress: 0, updatedAt: 0 };
    save({ items: [{ ...cur, ...patch, book, updatedAt: Date.now() }, ...shelf.items.filter((i) => i.book.isbn !== book.isbn)] });
  };
  const remove = (isbn: string) => save({ items: shelf.items.filter((i) => i.book.isbn !== isbn) });
  return { shelf, upsert, remove };
}

export function LydbokerPage() {
  const [q, setQ] = useState(""); const [res, setRes] = useState<FabelBook[] | null>(null); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [open, setOpen] = useState<FabelBook | null>(null);
  const [rows, setRows] = useState<Record<string, FabelBook[]>>({});
  const { shelf, upsert, remove } = useShelf();
  const [filter, setFilter] = useState<Filter>(() => (localStorage.getItem("home.lydboker.filter") as Filter) || "barn");
  const [age, setAge] = useState<"alle" | "3–9" | "9+">("alle");
  const [kids, setKids] = useState<{ series: KidSeries[]; popular: FabelBook[] } | null>(null);
  const [recent, setRecent] = useState<{ loggedIn: boolean; items: { book: FabelBook; progress?: number }[] } | null>(null);
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const pickFilter = (f: Filter) => { setFilter(f); localStorage.setItem("home.lydboker.filter", f); };
  useEffect(() => { api<{ series: KidSeries[]; popular: FabelBook[] }>("/api/fabel/kids").then(setKids).catch((e) => setErr((e as Error).message)); api<{ loggedIn: boolean; items: { book: FabelBook; progress?: number }[] }>("/api/fabel/recent").then(setRecent).catch(() => setRecent({ loggedIn: false, items: [] })); }, []);
  const login = async () => { setLoginMsg(""); location.hash = "#/settings/login/fabel"; };  // native login sheet (auth broker)
  const audio = useRef<HTMLAudioElement | null>(null); const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => { if (filter === "barn") return; SHELVES.forEach(([l, term]) => api<{ books: FabelBook[] }>(`/api/fabel/search?q=${encodeURIComponent(term)}&n=12`).then((r) => setRows((m) => ({ ...m, [l]: r.books }))).catch((e) => setErr((e as Error).message))); return () => audio.current?.pause(); }, [filter === "barn"]);
  const search = async (term = q) => { if (!term.trim()) { setRes(null); return; } setBusy(true); try { setRes((await api<{ books: FabelBook[] }>(`/api/fabel/search?q=${encodeURIComponent(term)}&n=36`)).books); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const toggleSample = (b: FabelBook) => {
    if (playing === b.isbn) { audio.current?.pause(); setPlaying(null); return; }
    audio.current?.pause(); audio.current = new Audio(b.sample); audio.current.onended = () => setPlaying(null);
    void audio.current.play().then(() => setPlaying(b.isbn)).catch(() => setErr("Fant ikke utdrag for denne boka."));
  };
  const reading = shelf.items.filter((i) => i.status === "leser");
  const want = shelf.items.filter((i) => i.status === "vil-lese");
  return (
    <div className="page books-page">
      <div className="page-head"><h1 className="page-title">Lydbøker <span className="muted small title-sub">fra Fabel</span></h1></div>
      <div className="seg-tabs compact books-filter">{([["barn", "Barn"], ["alle", "Alle"], ["voksne", "Voksne"]] as const).map(([k, l]) => <button key={k} className={filter === k ? "on" : ""} onClick={() => pickFilter(k)}>{k === "barn" && <Baby size={14} />} {l}</button>)}</div>
      <div className="search-bar big"><Search size={18} /><input value={q} placeholder="Søk etter bok, forfatter eller innleser…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />{busy && <span className="muted small">Søker…</span>}{res && <button className="icon-btn ghost" onClick={() => { setQ(""); setRes(null); }} aria-label="Tøm"><X size={16} /></button>}</div>
      {err && <div className="notice bad small" onClick={() => setErr(null)}>{err}</div>}

      {res ? <section><h3 className="section-title">{(filter === "barn" ? res.filter(isKidBook) : filter === "voksne" ? res.filter((b) => !isKidBook(b)) : res).length} treff{filter !== "alle" && <span className="muted small"> · filter: {filter}</span>}</h3><div className="book-grid">{(filter === "barn" ? res.filter(isKidBook) : filter === "voksne" ? res.filter((b) => !isKidBook(b)) : res).map((b) => <BookCard key={b.isbn} b={b} onOpen={setOpen} />)}</div></section> : <>
        <section className="card recent-card"><header className="row"><h3 className="grow"><History size={15} /> Sist lyttet</h3>{recent?.loggedIn ? <span className="chip static">Fabel-konto</span> : <button className="btn sm" onClick={() => void login()}><LogIn size={13} /> Logg inn</button>}</header>
          {recent?.loggedIn && recent.items.length > 0 ? <div className="book-scroll">{recent.items.map((i) => <BookCard key={i.book.isbn} b={i.book} onOpen={setOpen} />)}</div>
            : <div className="recent-empty"><Headphones size={22} className="muted" /><div className="grow"><b>Koble til Fabel for å se det dere sist lyttet til</b><div className="muted small">Innlogging skjer med mobilnummer og en kode på SMS. Trykk «Logg inn» – Fabel åpnes i Brave på omarchy, eller bruk <a className="ext-link" href="#/settings">Tilkoblinger</a>.</div>{loginMsg && <div className="small">{loginMsg}</div>}</div></div>}
        </section>
        {reading.length > 0 && <section className="card reading-card"><h3><Headphones size={15} /> Leser nå</h3>
          {reading.map((i) => <div key={i.book.isbn} className="reading-row" onClick={() => setOpen(i.book)}>
            <img className="reading-cover" src={i.book.coverSmall ?? ""} alt="" />
            <div className="grow"><div className="reading-title">{i.book.title}</div><div className="muted small">{i.book.authors.join(", ")}</div>
              <div className="progress"><span style={{ width: `${i.progress}%` }} /></div><div className="muted tiny">{i.progress}% · {dur(i.book.minutes ? Math.round(i.book.minutes * (1 - i.progress / 100)) : null)} igjen</div></div>
            <a className="btn sm primary" href={i.book.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><Play size={13} /> Fortsett i Fabel</a>
          </div>)}</section>}
        {want.length > 0 && <Row title="Min hylle" books={want.map((i) => i.book)} onOpen={setOpen} />}
        {filter !== "voksne" && <>
          <div className="chips-row books-age"><span className="muted small">Alder</span>{(["alle", "3–9", "9+"] as const).map((a) => <button key={a} className={`chip ${age === a ? "on" : ""}`} onClick={() => setAge(a)}>{a === "alle" ? "Alle" : `${a} år`}</button>)}</div>
          {!kids && <div className="muted">Henter barneserier…</div>}
          {kids?.series.filter((g) => age === "alle" || g.age === age).map((g) => <SeriesRow key={g.title} g={g} onOpen={setOpen} />)}
          {kids && kids.popular.length > 0 && age !== "9+" && <Row title="Populære barnebøker" books={kids.popular} onOpen={setOpen} />}
        </>}
        {filter !== "barn" && SHELVES.map(([l]) => rows[l] && <Row key={l} title={l} books={rows[l]} onOpen={setOpen} />)}
        <p className="muted small books-note">Lytting skjer i Fabel-appen. Her kan du søke, holde hylla di og høre utdrag – også på Sonos.</p>
      </>}

      {open && <BookSheet b={open} item={shelf.items.find((i) => i.book.isbn === open.isbn)} close={() => setOpen(null)} playing={playing === open.isbn} toggle={() => toggleSample(open)} upsert={upsert} remove={remove} />}
    </div>
  );
}

function Row({ title, books, onOpen }: { title: string; books: FabelBook[]; onOpen: (b: FabelBook) => void }) {
  return <section className="book-row"><h3 className="section-title">{title}</h3><div className="book-scroll">{books.map((b) => <BookCard key={b.isbn} b={b} onOpen={onOpen} />)}</div></section>;
}
function SeriesRow({ g, onOpen }: { g: KidSeries; onOpen: (b: FabelBook) => void }) {
  return <section className="book-row series-row"><h3 className="section-title">{g.title} <span className="muted small">{g.age} år · {g.books.length} bøker</span></h3>
    <div className="book-scroll">{g.books.map((b, i) => <BookCard key={b.isbn} b={b} onOpen={onOpen} part={b.seriesPart ?? i + 1} />)}</div></section>;
}
function BookCard({ b, onOpen, part }: { b: FabelBook; onOpen: (b: FabelBook) => void; part?: number }) {
  return <button className="book" onClick={() => onOpen(b)}>
    <span className="book-cover">{part != null && <span className="book-part">{part}</span>}{b.coverSmall ? <img src={b.coverSmall} alt="" loading="lazy" /> : <BookOpen size={28} />}</span>
    <span className="book-title">{b.title}</span><span className="muted tiny">{b.authors.join(", ")}</span></button>;
}

function BookSheet({ b, item, close, playing, toggle, upsert, remove }: { b: FabelBook; item?: ShelfItem; close: () => void; playing: boolean; toggle: () => void; upsert: (b: FabelBook, p: Partial<ShelfItem>) => void; remove: (isbn: string) => void }) {
  const snap = useSnapshot();
  const speakers = useMemo(() => Object.values(snap.entities).filter((e) => e.entity_id.startsWith("media_player.") && Array.isArray(e.attributes.group_members) && e.state !== "unavailable"), [snap.entities]);
  const [cast, setCast] = useState<string>(""); const [msg, setMsg] = useState<string | null>(null);
  const doCast = async () => { if (!cast) return; try { await api("/api/fabel/cast", { json: { isbn: b.isbn, entity_id: cast } }); setMsg("Spiller utdrag på Sonos"); } catch (e) { setMsg((e as Error).message); } };
  return <div className="sheet-backdrop" onClick={close}><div className="sheet book-sheet" onClick={(e) => e.stopPropagation()}>
    <button className="icon-btn ghost sheet-close" onClick={close} aria-label="Lukk"><X size={18} /></button>
    <div className="book-hero">
      {b.cover && <img className="book-hero-cover" src={b.cover} alt="" />}
      <div className="grow">
        {b.series && <div className="muted small">{b.series}{b.seriesPart ? ` · del ${b.seriesPart}` : ""}</div>}
        <h2>{b.title}</h2><div>{b.authors.join(", ")}</div>
        <div className="muted small">Lest av {b.readers.join(", ") || "–"}</div>
        <div className="book-meta"><span><Clock size={13} /> {dur(b.minutes)}</span>{b.category && <span>{b.category}</span>}{b.publisher && <span>{b.publisher}</span>}</div>
        <div className={`pill ${b.inSubscription ? "ok" : ""}`}>{b.inSubscription ? "I abonnementet" : b.subscriptionFrom ? `I abonnementet fra ${new Date(b.subscriptionFrom).toLocaleDateString("nb-NO")}` : b.price ? `Kjøp ${b.price} kr` : "Ikke i abonnement"}</div>
      </div>
    </div>
    <div className="row-actions wrap">
      <a className="btn primary" href={b.url} target="_blank" rel="noreferrer"><Headphones size={14} /> Lytt i Fabel <ExternalLink size={12} /></a>
      <button className="btn" onClick={toggle}>{playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Stopp utdrag" : "Hør utdrag"}</button>
      {item ? <button className="btn" onClick={() => remove(b.isbn)}><BookmarkCheck size={14} /> På hylla</button> : <button className="btn" onClick={() => upsert(b, { status: "vil-lese" })}><BookmarkPlus size={14} /> Vil lese</button>}
      <button className={`btn ${item?.status === "leser" ? "primary" : ""}`} onClick={() => upsert(b, { status: "leser" })}><BookOpen size={14} /> Leser nå</button>
    </div>
    {item?.status === "leser" && <label className="progress-edit">Fremdrift {item.progress}%<input type="range" min={0} max={100} value={item.progress} onChange={(e) => upsert(b, { progress: Number(e.target.value), status: Number(e.target.value) >= 100 ? "ferdig" : "leser" })} /></label>}
    {speakers.length > 0 && <div className="cast-row"><Speaker size={15} /><select className="select" value={cast} onChange={(e) => setCast(e.target.value)}><option value="">Hør utdrag på…</option>{speakers.map((s) => <option key={s.entity_id} value={s.entity_id}>{String(s.attributes.friendly_name ?? s.entity_id)}</option>)}</select><button className="btn sm" disabled={!cast} onClick={() => void doCast()}>Spill</button>{msg && <span className="muted small">{msg}</span>}</div>}
    {b.themes.length > 0 && <div className="chips">{b.themes.map((t) => <span key={t} className="chip static">{t}</span>)}</div>}
  </div></div>;
}
