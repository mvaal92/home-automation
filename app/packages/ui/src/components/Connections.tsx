import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Loader2, RefreshCw, LogIn, LogOut } from "lucide-react";
import { auth, type Provider } from "../lib/auth";
import { LoginSheet } from "./LoginSheet";

const LABEL: Record<string, string> = { ok: "Tilkoblet", "login-required": "Må logges inn", "not-connected": "Ikke koblet til", "needs-setup": "Må settes opp", error: "Feil", expired: "Utløpt", unknown: "Ukjent" };
const t = (ms?: number | null) => (ms ? new Date(ms).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "–");
const loginHash = () => /^#\/settings\/login\/([a-z-]+)/.exec(location.hash)?.[1] ?? null;

/** Tilkoblinger: every login runs natively in the app sheet on the device you tap from (auth broker /api/auth). */
export function Connections() {
  const [list, setList] = useState<Provider[] | null>(null);
  const [open, setOpen] = useState<Provider | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => auth.providers().then((r) => { setList(r.providers); return r.providers; }).catch(() => { setList([]); return [] as Provider[]; }), []);
  useEffect(() => { void load(); const i = setInterval(load, 60000); return () => clearInterval(i); }, [load]);
  useEffect(() => {   // deep links from notifications / OAuth callback: #/settings/login/<id>
    const on = () => { const id = loginHash(); if (!id) return; const ok = /result=ok/.test(location.hash);
      void load().then((ps) => { const p = ps.find((x) => x.id === id); if (p && !ok) setOpen(p); history.replaceState(null, "", "#/settings"); }); };
    const retry = (e: Event) => { const id = (e as CustomEvent<string>).detail; const p = list?.find((x) => x.id === id); if (p) setOpen({ ...p }); };
    on(); window.addEventListener("hashchange", on); window.addEventListener("home-login", retry);
    return () => { window.removeEventListener("hashchange", on); window.removeEventListener("home-login", retry); };
  }, [load, list]);
  const side = async (p: Provider, what: "refresh" | "logout") => { setBusy(p.id); try { await auth[what](p.id); } catch { /* */ } setBusy(null); void load(); };
  return (
    <section className="card connections">
      <h3>Tilkoblinger</h3>
      {!list ? <Loader2 className="spin" size={18} /> : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
          {list.filter((p) => !p.mock || location.search.includes("authmock")).map((p) => (
            <li key={p.id} className="conn-row">
              <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0, flex: "1 1 240px" }}>
                {p.status === "ok" ? <CheckCircle2 size={18} color="var(--ok, #3fb950)" /> : <AlertTriangle size={18} color="var(--warn, #d29922)" />}
                <div style={{ minWidth: 0 }}>
                  <div><strong>{p.name}</strong> · <span className="muted">{LABEL[p.status] ?? p.status}</span></div>
                  <div className="muted" style={{ fontSize: 12 }}>{p.method}{p.expiresAt ? ` · token til ${t(p.expiresAt)}${p.autoRenew ? " (fornyes automatisk)" : ""}` : ""}</div>
                  {p.detail && p.status !== "ok" && <div className="muted" style={{ fontSize: 12 }}>{p.detail}</div>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {p.canRefresh && p.status === "ok" && <button className="btn ghost" title="Forny nå" disabled={busy === p.id} onClick={() => side(p, "refresh")}>{busy === p.id ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}</button>}
                {p.status === "ok" && p.canLogout && <button className="btn ghost" title="Logg ut" onClick={() => side(p, "logout")}><LogOut size={14} /></button>}
                <button className="btn" onClick={() => setOpen(p)}><LogIn size={14} /> {p.status === "ok" ? "Logg inn på nytt" : p.status === "needs-setup" ? "Sett opp" : "Logg inn"}</button>
              </div>
            </li>))}
        </ul>)}
      <LoginSheet provider={open} onClose={() => setOpen(null)} onDone={() => void load()} />
    </section>
  );
}
