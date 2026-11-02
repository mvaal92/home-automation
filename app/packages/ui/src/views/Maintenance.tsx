import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, ChevronRight, ExternalLink, Plus, Trash2, Wrench, Link2 } from "lucide-react";
import { api } from "../lib/api";
import { item, list } from "../lib/motion";
import "./Maintenance.css";

export type MItem = { id: number; category: string; name: string; intervalDays: number; lastDone: number | null; nextDue: number | null; daysLeft: number | null;
  status: "ok" | "due" | "overdue" | "unknown"; source: "ha" | "manual"; percentLeft: number | null; haFlag: boolean; haEntity: string; haLinked: boolean; doneEntity: string; link: string; notes: string };
type Log = { id: number; itemId: number; name: string; doneAt: number; note: string };
const when = (i: MItem) => i.haFlag ? "Enheten varsler" : i.daysLeft == null ? "Ikke startet" : i.daysLeft < 0 ? `${-i.daysLeft} d over tiden` : i.daysLeft === 0 ? "I dag" : `Om ${i.daysLeft} d`;
const date = (t: number) => new Date(t).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
const pctOf = (i: MItem) => i.percentLeft ?? (i.daysLeft == null ? 0 : Math.max(0, Math.min(100, Math.round((i.daysLeft / i.intervalDays) * 100))));

export function useMaintenance(path = "/api/maintenance") {
  const [items, setItems] = useState<MItem[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<{ items: MItem[] }>(path).then((r) => setItems(r.items)).catch((e) => setErr((e as Error).message)), [path]);
  useEffect(() => { void load(); const t = setInterval(load, 5 * 60_000); return () => clearInterval(t); }, [load]);
  return { items, err, load };
}

export function MaintenanceCard({ openAll }: { openAll: () => void }) {
  const { items, load } = useMaintenance("/api/maintenance/attention");
  if (!items || items.length === 0) return null;
  return <section className="card mt-cardbox"><h3 style={{ display: "flex", alignItems: "center", gap: 8 }}><Wrench size={15} /> Vedlikehold <span className="count">{items.length}</span>
    <button className="section-action" style={{ marginLeft: "auto" }} onClick={openAll}>Alle <ChevronRight size={13} /></button></h3>
    <div className="mt-card-list">{items.slice(0, 5).map((i) => <div key={i.id} className="mt-card-row"><span className={`mt-dot ${i.status}`} /><span className="grow">{i.name}</span>
      <span className={`mt-when ${i.status}`}>{when(i)}</span>
      <button className="btn sm" onClick={() => void api(`/api/maintenance/${i.id}/done`, { json: {} }).then(load)}><Check size={13} /> Utført</button></div>)}</div></section>;
}

export function MaintenancePage() {
  const { items, err, load } = useMaintenance();
  const [open, setOpen] = useState<number | null>(null);
  const [hist, setHist] = useState<Log[]>([]);
  const [adding, setAdding] = useState(false); const [nw, setNw] = useState({ name: "", category: "Hus", intervalDays: 90 });
  useEffect(() => { api<{ history: Log[] }>("/api/maintenance/history").then((r) => setHist(r.history)).catch(() => undefined); }, [items]);
  const done = async (id: number) => { await api(`/api/maintenance/${id}/done`, { json: {} }); await load(); };
  const patch = async (id: number, b: Partial<MItem>) => { await api(`/api/maintenance/${id}`, { method: "PATCH", json: b }); await load(); };
  const cats = [...new Set((items ?? []).map((i) => i.category))];
  const n = (s: string) => (items ?? []).filter((i) => i.status === s).length;
  return <motion.div className="page mt-page" variants={list} initial="hidden" animate="show">
    <motion.div variants={item} className="mt-head"><h1 className="page-title">Vedlikehold</h1><button className="btn" onClick={() => setAdding((a) => !a)}><Plus size={15} /> Nytt punkt</button></motion.div>
    {err && <div className="notice bad small">{err}</div>}
    <motion.div variants={item} className="mt-summary">
      <div className="mt-stat"><b style={{ color: "var(--bad)" }}>{n("overdue")}</b><span>Over tiden</span></div>
      <div className="mt-stat"><b style={{ color: "var(--warn, #f5a524)" }}>{n("due")}</b><span>Snart</span></div>
      <div className="mt-stat"><b style={{ color: "var(--good)" }}>{n("ok")}</b><span>I orden</span></div>
      <div className="mt-stat"><b>{n("unknown")}</b><span>Ikke startet</span></div>
    </motion.div>
    {adding && <div className="mt-add card">
      <input placeholder="Navn, f.eks. Bytt vannfilter" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} />
      <input placeholder="Kategori" value={nw.category} onChange={(e) => setNw({ ...nw, category: e.target.value })} />
      <label className="small muted">Hver <input type="number" min={1} style={{ width: 70 }} value={nw.intervalDays} onChange={(e) => setNw({ ...nw, intervalDays: Number(e.target.value) })} /> dag</label>
      <button className="btn primary sm" disabled={!nw.name.trim()} onClick={() => void api("/api/maintenance", { json: { ...nw, lastDone: Date.now() } }).then(() => { setAdding(false); setNw({ name: "", category: "Hus", intervalDays: 90 }); return load(); })}>Legg til</button></div>}
    {cats.map((c) => <motion.section variants={item} key={c} className="mt-cat"><h2>{c}</h2>
      {(items ?? []).filter((i) => i.category === c).map((i) => <div key={i.id} className="mt-row">
        <span className={`mt-dot ${i.status}`} />
        <div onClick={() => setOpen(open === i.id ? null : i.id)} style={{ cursor: "pointer", minWidth: 0 }}>
          <div className="mt-name">{i.name}</div>
          <div className="mt-meta"><span>Hver {i.intervalDays}. dag</span>{i.lastDone && <span>Sist {date(i.lastDone)}</span>}{i.source === "ha" && <span>· fra Home Assistant</span>}</div>
          {i.status !== "unknown" && <div className="mt-bar"><i className={i.status} style={{ width: `${pctOf(i)}%` }} /></div>}
        </div>
        <span className={`mt-when ${i.status}`}>{when(i)}</span>
        <button className="btn sm" onClick={() => void done(i.id)}><Check size={13} /> Utført</button>
        {open === i.id && <div className="mt-detail">
          <div className="row">Intervall <input type="number" min={1} style={{ width: 80 }} defaultValue={i.intervalDays} onBlur={(e) => void patch(i.id, { intervalDays: Number(e.target.value) })} /> dager
            · Sist utført <input type="date" defaultValue={i.lastDone ? new Date(i.lastDone).toISOString().slice(0, 10) : ""} onChange={(e) => void patch(i.id, { lastDone: e.target.value ? new Date(e.target.value).getTime() : null })} /></div>
          <textarea rows={2} placeholder="Notater (modell, filtertype …)" defaultValue={i.notes} onBlur={(e) => void patch(i.id, { notes: e.target.value })} />
          <div className="row"><Link2 size={14} className="muted" /><input style={{ flex: 1 }} placeholder="Lenke for å bestille (Oda e.l.)" defaultValue={i.link} onBlur={(e) => void patch(i.id, { link: e.target.value })} />
            {i.link && <a className="btn sm" href={i.link} target="_blank" rel="noreferrer">Bestill <ExternalLink size={12} /></a>}</div>
          {i.doneEntity && <div className="muted small">«Utført» nullstiller også telleren i Home Assistant ({i.doneEntity}).</div>}
          <div className="row"><button className="btn sm" onClick={() => void api(`/api/maintenance/${i.id}`, { method: "DELETE" }).then(load)}><Trash2 size={13} /> Fjern</button></div>
          <div className="muted small">{hist.filter((h) => h.itemId === i.id).slice(0, 5).map((h) => date(h.doneAt)).join(" · ") || "Ingen historikk ennå."}</div>
        </div>}
      </div>)}
    </motion.section>)}
    {hist.length > 0 && <section className="card"><h3>Historikk</h3>{hist.slice(0, 10).map((h) => <div key={h.id} className="kv"><span>{h.name}</span><span className="muted">{date(h.doneAt)}</span></div>)}</section>}
  </motion.div>;
}
