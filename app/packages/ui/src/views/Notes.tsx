import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Pencil, Pin, PinOff, Plus, StickyNote, Trash2, ArrowRight } from "lucide-react";
import { api } from "../lib/api";

export interface Note { id: number; text: string; pinned: boolean; done: boolean; color: string; createdAt: number; updatedAt: number }
const COLORS = ["", "amber", "green", "blue", "rose", "violet"] as const;
const LS = "home.notes.cache";

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "nå"; if (s < 3600) return `${Math.floor(s / 60)} min siden`; if (s < 86400) return `${Math.floor(s / 3600)} t siden`;
  return new Date(t).toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
}

/** Markdown-light: **bold**, *italic*, `- ` lists, `- [ ]`/`- [x]` checkboxes (clickable). */
function Md({ text, onToggle }: { text: string; onToggle: (line: number) => void }) {
  const inline = (s: string, k: number): ReactNode[] => s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={`${k}-${i}`}>{p.slice(2, -2)}</strong> : p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <em key={`${k}-${i}`}>{p.slice(1, -1)}</em> : p);
  return <div className="note-md">{text.split("\n").map((l, i) => {
    const cb = l.match(/^\s*[-*] \[( |x|X)\] (.*)$/);
    if (cb) return <label key={i} className={`md-check ${cb[1] !== " " ? "on" : ""}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(i); }}><span className="box">{cb[1] !== " " && <Check size={11} />}</span><span>{inline(cb[2] ?? "", i)}</span></label>;
    const li = l.match(/^\s*[-*] (.*)$/);
    if (li) return <div key={i} className="md-li">{inline(li[1] ?? "", i)}</div>;
    return l.trim() ? <p key={i}>{inline(l, i)}</p> : <div key={i} className="md-gap" />;
  })}</div>;
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>(() => { try { return JSON.parse(localStorage.getItem(LS) ?? "[]") as Note[]; } catch { return []; } });
  const [toast, setToast] = useState<{ note: Note } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const set = (n: Note[]) => { setNotes(n); localStorage.setItem(LS, JSON.stringify(n)); };
  const load = useCallback(() => api<{ notes: Note[] }>("/api/notes").then((r) => set(r.notes)).catch(() => undefined), []);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 30000); const f = () => void load(); window.addEventListener("focus", f); return () => { clearInterval(t); window.removeEventListener("focus", f); }; }, [load]);
  const sort = (a: Note[]) => [...a].sort((x, y) => Number(y.pinned) - Number(x.pinned) || Number(x.done) - Number(y.done) || y.updatedAt - x.updatedAt);
  const add = async (text: string, color = "") => { const n = await api<Note>("/api/notes", { json: { text, color } }); set(sort([n, ...notes])); };
  const patch = async (id: number, p: Partial<Note>) => { set(sort(notes.map((n) => (n.id === id ? { ...n, ...p, updatedAt: Date.now() } : n)))); const n = await api<Note>(`/api/notes/${id}`, { method: "PATCH", json: p }); set(sort(notes.map((x) => (x.id === id ? n : x)))); };
  const remove = async (id: number) => {
    const n = notes.find((x) => x.id === id); set(notes.filter((x) => x.id !== id)); await api(`/api/notes/${id}`, { method: "DELETE" });
    if (n) { setToast({ note: n }); clearTimeout(timer.current); timer.current = window.setTimeout(() => setToast(null), 6000); }
  };
  const undo = async () => { if (!toast) return; const n = await api<Note>(`/api/notes/${toast.note.id}/restore`, { method: "POST" }); setToast(null); set(sort([n, ...notes])); };
  return { notes, add, patch, remove, toast, undo };
}

function NoteItem({ n, patch, remove }: { n: Note; patch: (id: number, p: Partial<Note>) => void; remove: (id: number) => void }) {
  const [edit, setEdit] = useState(false); const [draft, setDraft] = useState(n.text);
  const toggleLine = (line: number) => { const ls = n.text.split("\n"); ls[line] = (ls[line] ?? "").replace(/\[( |x|X)\]/, (m) => (m === "[ ]" ? "[x]" : "[ ]")); patch(n.id, { text: ls.join("\n") }); };
  const save = () => { setEdit(false); if (draft.trim() && draft !== n.text) patch(n.id, { text: draft }); };
  return <div className={`note c-${n.color || "none"} ${n.done ? "done" : ""} ${n.pinned ? "note-pinned" : ""}`}>
    <button className={`note-check ${n.done ? "on" : ""}`} onClick={() => patch(n.id, { done: !n.done })} aria-label={n.done ? "Marker som ikke ferdig" : "Marker som ferdig"}>{n.done && <Check size={12} />}</button>
    <div className="grow note-body" onDoubleClick={() => { setDraft(n.text); setEdit(true); }}>
      {edit ? <textarea autoFocus className="note-edit" value={draft} rows={Math.min(10, draft.split("\n").length + 1)} onChange={(e) => setDraft(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); if (e.key === "Escape") setEdit(false); }} /> : <Md text={n.text} onToggle={toggleLine} />}
      <div className="note-foot"><span className="muted tiny">{ago(n.updatedAt)}</span>
        <span className="note-colors">{COLORS.map((c) => <button key={c || "none"} className={`dot c-${c || "none"} ${n.color === c ? "on" : ""}`} onClick={() => patch(n.id, { color: c })} aria-label={`Farge ${c || "ingen"}`} />)}</span></div>
    </div>
    <div className="note-actions">
      <button className="icon-btn ghost" onClick={() => patch(n.id, { pinned: !n.pinned })} aria-label={n.pinned ? "Løsne" : "Fest"} title={n.pinned ? "Løsne" : "Fest"}>{n.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
      <button className="icon-btn ghost" onClick={() => { setDraft(n.text); setEdit(true); }} aria-label="Rediger" title="Rediger"><Pencil size={14} /></button>
      <button className="icon-btn ghost" onClick={() => remove(n.id)} aria-label="Slett" title="Slett"><Trash2 size={14} /></button>
    </div>
  </div>;
}

function QuickAdd({ add, multi }: { add: (t: string, c?: string) => Promise<void>; multi?: boolean }) {
  const [t, setT] = useState(""); const [c, setC] = useState("");
  const go = async () => { if (!t.trim()) return; await add(t.trim(), c); setT(""); };
  return <div className="note-add">
    <Plus size={16} className="muted" />
    {multi ? <textarea value={t} rows={Math.min(8, t.split("\n").length)} placeholder="Nytt notat… (Ctrl+Enter lagrer · **fet**, - liste, - [ ] sjekkliste)" onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && void go()} />
      : <input value={t} placeholder="Skriv et notat og trykk Enter…" onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void go()} />}
    <span className="note-colors">{COLORS.slice(1).map((x) => <button key={x} className={`dot c-${x} ${c === x ? "on" : ""}`} onClick={() => setC(c === x ? "" : x)} aria-label={`Farge ${x}`} />)}</span>
    <button className="btn sm primary" disabled={!t.trim()} onClick={() => void go()}>Legg til</button>
  </div>;
}

function Toast({ s }: { s: ReturnType<typeof useNotes> }) {
  return s.toast ? <div className="toast"><span>Notat slettet</span><button className="btn sm" onClick={() => void s.undo()}>Angre</button></div> : null;
}

export function NotesCard({ openAll }: { openAll: () => void }) {
  const s = useNotes(); const open = s.notes.filter((n) => !n.done);
  return <section className="section notes-card">
    <h2 className="section-title"><StickyNote size={14} /> Notater <span className="count">{open.length}</span><button className="link-btn" onClick={openAll}>Alle <ArrowRight size={13} /></button></h2>
    <div className="card notes-wrap">
      <QuickAdd add={s.add} />
      <div className="note-list">{open.slice(0, 5).map((n) => <NoteItem key={n.id} n={n} patch={s.patch} remove={s.remove} />)}</div>
      {open.length === 0 && <p className="muted small notes-empty">Ingen notater ennå. Prøv også «legg til notat kjøp batterier» i assistenten.</p>}
      {open.length > 5 && <button className="link-btn more" onClick={openAll}>+ {open.length - 5} til</button>}
    </div>
    <Toast s={s} />
  </section>;
}

export function NotesPage() {
  const s = useNotes(); const [f, setF] = useState<"open" | "done" | "all">("open"); const [q, setQ] = useState("");
  const list = s.notes.filter((n) => (f === "all" || (f === "done") === n.done) && (!q || n.text.toLowerCase().includes(q.toLowerCase())));
  return <div className="page notes-page">
    <div className="page-head"><h1 className="page-title">Notater</h1></div>
    <QuickAdd add={s.add} multi />
    <div className="notes-tools"><div className="seg">{([["open", "Åpne"], ["done", "Ferdige"], ["all", "Alle"]] as const).map(([k, l]) => <button key={k} className={f === k ? "on" : ""} onClick={() => setF(k)}>{l}</button>)}</div>
      <input className="notes-search" placeholder="Søk i notater…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    <div className="notes-grid">{list.map((n) => <NoteItem key={n.id} n={n} patch={s.patch} remove={s.remove} />)}</div>
    {list.length === 0 && <p className="muted">Ingen notater her.</p>}
    <Toast s={s} />
  </div>;
}
