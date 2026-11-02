import { useEffect, useRef, useState, type PointerEvent as RPE } from "react";
import { CheckCircle2, AlertTriangle, Loader2, Smartphone, ExternalLink, Monitor } from "lucide-react";
import { Sheet } from "./Sheet";
import { auth, type Provider, type Step } from "../lib/auth";
import "./auth.css";

/** Native in-app login: renders the broker's steps (forms, BankID wait, OAuth redirect, remote view) on this device. */
export function LoginSheet({ provider, onClose, onDone }: { provider: Provider | null; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<Step | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sid = useRef<string | null>(null);
  useEffect(() => {
    if (!provider) return; setStep(null); setErr(null); setVals({});
    auth.start(provider.id).then((s) => { sid.current = s.session; setStep(s); }).catch((e) => setErr((e as Error).message));
    return () => { if (sid.current) void auth.cancel(sid.current).catch(() => {}); sid.current = null; };
  }, [provider]);
  useEffect(() => {   // poll waiting / remote steps
    if (!step || (step.state !== "waiting" && step.state !== "remote")) return;
    const t = setTimeout(() => auth.poll(step.session).then(setStep).catch((e) => setErr((e as Error).message)), step.pollMs ?? 2000);
    return () => clearTimeout(t);
  }, [step]);
  useEffect(() => { if (step?.state === "done") { sid.current = null; onDone(); } }, [step, onDone]);
  const submit = async (extra: Record<string, unknown> = {}) => {
    if (!step) return; setBusy(true); setErr(null);
    try { const s = await auth.step(step.session, { ...vals, ...extra }); setVals({}); setStep(s); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const go = () => { if (!step?.url) return; if (step.external) window.open(step.url, "_blank", "noopener"); else location.href = step.url; };
  return (
    <Sheet open={!!provider} onClose={onClose} title={step?.title ?? provider?.name ?? ""} subtitle={provider?.name}>
      <div className="auth-sheet">
        {!step && !err && <div className="auth-center"><Loader2 className="spin" size={22} /> <span className="muted">Starter innlogging …</span></div>}
        {step?.message && step.state !== "done" && <p className="auth-msg">{step.message}</p>}
        {step?.state === "form" && (
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="auth-form">
            {step.fields?.map((f, i) => (
              <label key={f.name} className="auth-field"><span>{f.label}</span>
                <input autoFocus={i === 0} name={f.name} value={vals[f.name] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))}
                  type={f.type === "password" ? "password" : f.type === "email" ? "email" : f.type === "tel" ? "tel" : "text"}
                  inputMode={(f.inputmode as "numeric" | "tel" | undefined) ?? (f.type === "code" || f.type === "nin" ? "numeric" : undefined)}
                  autoComplete={f.autocomplete ?? (f.type === "nin" ? "off" : undefined)} maxLength={f.maxLength} spellCheck={false} autoCapitalize="off"
                  className={f.type === "code" ? "auth-code" : undefined} /></label>))}
            {provider?.attemptsLeft != null && <p className="muted auth-small">{provider.attemptsLeft} passordforsøk igjen</p>}
            <button className="btn primary auth-submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : null}{step.submit ?? "Fortsett"}</button>
            {step.alt && <button type="button" className="btn ghost" onClick={() => void submit({ view: "remote" })}><Monitor size={14} /> {step.alt}</button>}
          </form>)}
        {step?.state === "waiting" && <div className="auth-center auth-wait"><div className="auth-pulse"><Smartphone size={30} /></div><strong>{step.title}</strong><Loader2 className="spin" size={16} /></div>}
        {step?.state === "redirect" && <div className="auth-center"><button className="btn primary auth-submit" onClick={go}><ExternalLink size={16} /> Fortsett</button></div>}
        {step?.state === "remote" && <RemoteView step={step} vals={vals} setVals={setVals} insert={(v) => submit({ insertFocused: true, ...v })} />}
        {step?.state === "done" && <div className="auth-center auth-ok"><CheckCircle2 size={36} /><strong>{step.message ?? "Innlogget"}</strong><button className="btn" onClick={onClose}>Lukk</button></div>}
        {(step?.state === "error" || err) && <div className="auth-center auth-err"><AlertTriangle size={30} /><span>{err ?? step?.message}</span>
          <button className="btn" onClick={() => { const p = provider; onClose(); setTimeout(() => p && window.dispatchEvent(new CustomEvent("home-login", { detail: p.id })), 250); }}>Prøv igjen</button></div>}
      </div>
    </Sheet>
  );
}

function RemoteView({ step, vals, setVals, insert }: { step: Step; vals: Record<string, string>; setVals: (f: (v: Record<string, string>) => Record<string, string>) => void; insert: (v: Record<string, string>) => void }) {
  const [n, setN] = useState(0); const [img, setImg] = useState<string | null>(null);
  const down = useRef(false); const lastMove = useRef(0); const box = useRef<HTMLImageElement>(null);
  useEffect(() => { let alive = true; let url: string | null = null;
    const tick = async () => { try { const r = await fetch(auth.frameUrl(step.session, n)); if (r.ok) { const b = URL.createObjectURL(await r.blob()); if (url) URL.revokeObjectURL(url); url = b; if (alive) setImg(b); } } catch { /* */ } if (alive) setTimeout(() => setN((x) => x + 1), down.current ? 250 : 700); };
    void tick(); return () => { alive = false; };
  }, [n, step.session]);
  const rel = (e: RPE) => { const r = box.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const send = (type: string, e: RPE) => void auth.input(step.session, { type, ...rel(e) }).catch(() => {});
  const f = step.insert;
  return (
    <div className="auth-remote">
      {img ? <img ref={box} src={img} alt="Innloggingsside" draggable={false}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); down.current = true; send("down", e); }}
        onPointerMove={(e) => { if (!down.current || Date.now() - lastMove.current < 30) return; lastMove.current = Date.now(); send("move", e); }}
        onPointerUp={(e) => { down.current = false; send("up", e); }} /> : <div className="auth-center"><Loader2 className="spin" size={20} /></div>}
      {f && <form className="auth-insert" onSubmit={(e) => { e.preventDefault(); insert({ [f.name]: vals[f.name] ?? "" }); setVals((v) => ({ ...v, [f.name]: "" })); }}>
        <input placeholder={f.label} value={vals[f.name] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))} inputMode={f.type === "nin" || f.type === "code" ? "numeric" : undefined} autoComplete="off" type={f.type === "password" ? "password" : "text"} />
        <button className="btn">Sett inn</button>
        <button type="button" className="btn ghost" onClick={() => void auth.input(step.session, { key: "Enter" })}>↵</button>
      </form>}
    </div>
  );
}
