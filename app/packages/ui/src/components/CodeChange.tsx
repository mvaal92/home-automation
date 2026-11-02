import { useCallback, useEffect, useState } from "react";
import { Check, Code2, ExternalLink, GitMerge, Loader2, RotateCcw, ShieldAlert, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import "./codechange.css";

/** One assistant code change (kode-modus): live status, diff summary, preview link, «Ta i bruk» / «Forkast». */
export interface CodeChangeRow { id: string; request: string; status: string; summary?: string | null; files: string[]; diffstat?: string | null; warnings: string[]; diff?: string | null; liveLog?: string[]; preview?: string | null; rollback_tag?: string | null }
const STATUS: Record<string, string> = { queued: "I kø", running: "Jobber…", ready: "Klar til gjennomgang", failed: "Feilet", blocked: "Stoppet av sikkerhetsregel", applied: "Tatt i bruk", discarded: "Forkastet", reverted: "Angret" };

export function CodeChange({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const [c, setC] = useState<CodeChangeRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const load = useCallback(() => api<CodeChangeRow>(`/api/code/${encodeURIComponent(id)}`).then(setC).catch(() => undefined), [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!c || !["queued", "running"].includes(c.status)) return; const t = setInterval(() => void load(), 2000); return () => clearInterval(t); }, [c, load]);
  const act = async (a: "apply" | "discard") => {
    setBusy(a); setErr(null);
    try { await api(`/api/code/${encodeURIComponent(id)}/${a}`, { method: "POST", json: {} }); await load(); onChanged?.(); if (a === "apply") setTimeout(() => location.reload(), 3500); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  if (!c) return <div className="code-card"><Loader2 size={14} className="spin" /> Laster kodeendring…</div>;
  const running = ["queued", "running"].includes(c.status);
  const last = (c.liveLog ?? []).filter(Boolean).slice(-1)[0];
  return (
    <div className={`code-card ${c.status}`}>
      <div className="code-head">
        <span className="code-ico">{running ? <Loader2 size={16} className="spin" /> : c.status === "blocked" ? <ShieldAlert size={16} /> : c.status === "applied" ? <Check size={16} /> : c.status === "failed" ? <X size={16} /> : <Code2 size={16} />}</span>
        <div className="grow"><div className="code-title">{c.request}</div><div className="muted small">{STATUS[c.status] ?? c.status} · {c.id}</div></div>
      </div>
      {running && last && <div className="code-log muted small">{last.replace(/^\S+ /, "")}</div>}
      {c.summary && !running && <p className="code-summary">{c.summary}</p>}
      {c.files.length > 0 && <div className="code-files">{c.files.map((f) => <code key={f}>{f}</code>)}</div>}
      {c.diffstat && <pre className="code-stat">{c.diffstat.split("\n").slice(-1)[0]}</pre>}
      {c.warnings.length > 0 && <ul className="code-warn">{c.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {(c.status === "failed" || c.status === "blocked") && c.liveLog && <details><summary className="small">Logg</summary><pre className="code-diff">{c.liveLog.slice(-25).join("\n")}</pre></details>}
      {c.diff && <button className="btn sm ghost" onClick={() => setShowDiff((s) => !s)}>{showDiff ? "Skjul diff" : "Vis diff"}</button>}
      {showDiff && c.diff && <pre className="code-diff">{c.diff.slice(0, 20000).split("\n").map((l, i) => <span key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : l.startsWith("@@") ? "hunk" : ""}>{l + "\n"}</span>)}</pre>}
      {err && <div className="notice bad small">{err}</div>}
      {c.status === "ready" && (
        <div className="code-btns">
          {c.preview && <a className="btn sm" href={c.preview} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Forhåndsvis</a>}
          <span className="grow" />
          <button className="btn sm" disabled={!!busy} onClick={() => void act("discard")}>{busy === "discard" ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} Forkast</button>
          <button className="btn sm primary" disabled={!!busy} onClick={() => void act("apply")}>{busy === "apply" ? <Loader2 size={14} className="spin" /> : <GitMerge size={14} />} Ta i bruk</button>
        </div>
      )}
      {(c.status === "failed" || c.status === "blocked") && <div className="code-btns"><span className="grow" /><button className="btn sm" disabled={!!busy} onClick={() => void act("discard")}><Trash2 size={14} /> Rydd bort</button></div>}
    </div>
  );
}

/** Settings panel: recent code changes and «Angre siste endring». */
export function CodeChangesPanel() {
  const [list, setList] = useState<{ changes: CodeChangeRow[]; preview: { id: string; url: string } | null } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api<typeof list>("/api/code").then(setList).catch(() => setList(null)), []);
  useEffect(() => { void load(); }, [load]);
  const undo = async () => {
    if (!confirm("Angre siste kodeendring? Appen bygges og startes på nytt.")) return;
    try { const r = await api<{ request: string }>("/api/code/undo-last", { method: "POST", json: {} }); setMsg(`Angret: ${r.request}`); void load(); setTimeout(() => location.reload(), 3500); }
    catch (e) { setMsg((e as Error).message); }
  };
  if (!list) return null;
  const applied = list.changes.some((c) => c.status === "applied");
  return (
    <div className="code-panel">
      <p className="muted small">Skriv «kode: …» til assistenten (eller slå på Kode i chatten). Endringer lages i en egen kopi, bygges og forhåndsvises; ingenting tas i bruk før du trykker «Ta i bruk».</p>
      {list.changes.filter((c) => c.status !== "discarded").slice(0, 5).map((c) => <CodeChange key={c.id} id={c.id} onChanged={load} />)}
      {list.changes.length === 0 && <p className="muted small">Ingen kodeendringer ennå.</p>}
      <div className="code-btns"><span className="grow" /><button className="btn sm" disabled={!applied} onClick={() => void undo()}><RotateCcw size={14} /> Angre siste endring</button></div>
      {msg && <div className="notice small">{msg}</div>}
    </div>
  );
}

/** Settings card «Assistent-endringer»: dashboard layout history (undo) + code changes. */
export function AssistantEditsCard() {
  const [hist, setHist] = useState<Array<{ id: number; source: string; summary: string; undone: number; created_at: number }>>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api<{ history: typeof hist }>("/api/dashedit").then((r) => setHist(r.history)).catch(() => undefined), []);
  useEffect(() => { void load(); }, [load]);
  const undo = async () => {
    try { const r = await api<{ undone: string }>("/api/dashedit/undo", { method: "POST", json: {} }); setMsg(`Angret: ${r.undone}`); window.dispatchEvent(new Event("home:prefs-refresh")); void load(); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section className="card">
      <h3>Assistent-endringer</h3>
      <div className="muted small">Oppsett endret av assistenten</div>
      {hist.length === 0 ? <p className="muted small">Ingen ennå. Prøv «fest kjøkkenlyset øverst».</p> : (
        <ul className="dash-hist">{hist.slice(0, 6).map((h) => <li key={h.id} className={h.undone ? "undone" : ""}><span className="grow">{h.summary}</span><span className="muted small">{new Date(h.created_at).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{h.undone ? " · angret" : ""}</span></li>)}</ul>
      )}
      <div className="code-btns"><span className="grow" /><button className="btn sm" disabled={!hist.some((h) => !h.undone)} onClick={() => void undo()}><RotateCcw size={14} /> Angre siste oppsett-endring</button></div>
      {msg && <div className="notice small">{msg}</div>}
      <div className="muted small" style={{ marginTop: 12 }}>Kodeendringer</div>
      <CodeChangesPanel />
    </section>
  );
}
