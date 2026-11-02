import { AssistantEditsCard } from "../components/CodeChange";
import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { HaBackend } from "@home/core";
import { DEFAULT_URL, hasProxy, platformName, PROXY_TOKEN, secureStoreLabel, type HomeConfig } from "../platform";
import type { VoiceApi } from "../lib/voice";
import { useDismissed, useHealth } from "../lib/home";
import { usePrefs } from "../lib/prefs";
import { NavSettings } from "../components/AltNav";
import { Connections } from "../components/Connections";
import { HvileSettingsCard } from "../components/Hvileskjerm";

export function Settings({ config, secureBackend, onSave, voice, live }: {
  config: HomeConfig; secureBackend?: string; onSave: (c: HomeConfig) => Promise<void>; voice: VoiceApi; live: boolean;
}) {
  const [proxy, setProxy] = useState(Boolean(config.proxy));
  const [url, setUrl] = useState(config.proxy ? DEFAULT_URL : config.url);
  const [token, setToken] = useState(config.proxy ? "" : config.token);
  const [mock, setMock] = useState(config.mock);
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<{ state: "idle" | "busy" | "ok" | "fail"; msg?: string }>({ state: "idle" });
  const [saved, setSaved] = useState(false);

  const runTest = async () => {
    setTest({ state: "busy" });
    const be = new HaBackend(proxy ? { url: `${location.origin}/ha`, token: PROXY_TOKEN } : { url, token });
    try {
      await be.connect(() => undefined);
      const reg = await be.getRegistries();
      const caps = await be.assistCapabilities();
      be.disconnect();
      setTest({ state: "ok", msg: `Connected · ${reg.areas.length} areas, ${reg.entities.length} entities · voice: ${caps.stt ? "speech" : "text only"}` });
    } catch (e) {
      setTest({ state: "fail", msg: e instanceof Error && e.message === "auth-failed" ? "Token avvist" : "Får ikke kontakt med Home Assistant på den adressen" });
    }
  };

  return (
    <div className="page settings">
      <h1 className="page-title">Innstillinger</h1>
      <Appearance />
      <Connections />
      <NavSettings />
      <HvileSettingsCard />
      <AssistantSettings />
      <AssistantEditsCard />
      <section className="card">
        <h3>Home Assistant</h3>
        {hasProxy() && (
          <label className={`hf-toggle ${proxy ? "on" : ""}`}>
            <input type="checkbox" checked={proxy} onChange={(e) => setProxy(e.target.checked)} />
            <span className="hf-track"><span className="hf-knob" /></span>
            Koble til via denne serveren (trenger ikke token)
          </label>
        )}
        {!proxy && <>
        <div className="field">
          <label htmlFor="ha-url">Serveradresse</label>
          <input id="ha-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_URL} spellCheck={false} />
        </div>
        <div className="field">
          <label htmlFor="ha-token">Langvarig tilgangstoken</label>
          <div className="input-row">
            <input id="ha-token" type={show ? "text" : "password"} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Lim inn token fra HA-profilen → Sikkerhet" spellCheck={false} autoComplete="off" />
            <button className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? "Skjul token" : "Vis token"}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
          <p className="muted small"><ShieldCheck size={12} /> Lagret i {secureStoreLabel(secureBackend)}</p>
        </div>
        </>}
        <label className={`hf-toggle ${mock ? "on" : ""}`}>
          <input type="checkbox" checked={mock} onChange={(e) => setMock(e.target.checked)} />
          <span className="hf-track"><span className="hf-knob" /></span>
          Demomodus (eksempelleilighet, uten HA)
        </label>
        <div className="row gap">
          <button className="btn" onClick={() => void runTest()} disabled={(!proxy && !token) || test.state === "busy"}>
            {test.state === "busy" ? <Loader2 size={14} className="spin" /> : null} Test tilkobling
          </button>
          <button className="btn primary" onClick={() => void onSave({ url, token, mock, proxy }).then(() => { setSaved(true); setTimeout(() => setSaved(false), 2000); })}>
            {saved ? "Lagret" : "Lagre og koble til"}
          </button>
        </div>
        {test.state === "ok" && <p className="notice good"><CheckCircle2 size={14} /> {test.msg}</p>}
        {test.state === "fail" && <p className="notice bad"><XCircle size={14} /> {test.msg}</p>}
      </section>
      <section className="card">
        <h3>Stemme</h3>
        <div className="options" role="radiogroup" aria-label="Stemmemotor">
          <label className="option selected">
            <input type="radio" name="voice-engine" checked readOnly />
            <span className="option-text"><strong>Lokal stemme</strong><span className="muted">Whisper + Piper på denne serveren. Gratis, privat, uten nett.</span></span>
            <span className="tag">Standard</span>
          </label>
          <label className="option disabled" aria-disabled>
            <input type="checkbox" disabled readOnly checked={false} />
            <span className="option-text"><strong>Grok-stemme (kommer)</strong><span className="muted">Naturlig samtale med Grok.</span></span>
            <span className="switch" aria-hidden><span className="switch-knob" /></span>
          </label>
        </div>
        <dl className="kv">
          <dt>Pipeline</dt><dd>{voice.caps?.pipelineName ?? "—"}</dd>
          <dt>Talegjenkjenning</dt><dd>{voice.caps?.stt ? "Tilgjengelig" : "Ikke satt opp (bare skrevne kommandoer)"}</dd>
          <dt>Tale</dt><dd>{voice.caps?.tts ? "Home Assistant" : "Lokal reserve på enheten"}</dd>
          <dt>Språk</dt><dd>{voice.caps?.language ?? "—"}</dd>
        </dl>
      </section>
      <DismissedAlerts />
      <section className="card">
        <h3>Om appen</h3>
        <dl className="kv">
          <dt>Plattform</dt><dd>{platformName()}</dd>
          <dt>Kilde</dt><dd>{live ? "Home Assistant (live)" : "Demodata"}</dd>
          <dt>Versjon</dt><dd>0.1.0</dd>
        </dl>
      </section>
    </div>
  );
}

/** Devices whose "offline" alert was dismissed (e.g. a seasonal plug). */
function DismissedAlerts() {
  const [dismissed, setDismissed] = useDismissed();
  const issues = useHealth().filter((i) => dismissed.has(i.key));
  if (dismissed.size === 0) return null;
  return (
    <section className="card">
      <h3>Skjulte varsler</h3>
      <p className="muted">Kjent frakoblede enheter du har skjult. De holdes borte fra varsellinjen til du gjenoppretter dem.</p>
      <div className="dismissed-list">
        {issues.map((i) => (
          <div key={i.key} className="dismissed-row">
            <span>{i.name} <span className="muted">{i.detail.toLowerCase()}</span></span>
            <button className="btn ghost sm" onClick={() => setDismissed(i.key, false)}>Gjenopprett</button>
          </div>
        ))}
        {dismissed.size > issues.length && (
          <div className="dismissed-row"><span className="muted">{dismissed.size - issues.length} tilbake på nett</span>
            <button className="btn ghost sm" onClick={() => { for (const k of dismissed) if (!issues.some((i) => i.key === k)) setDismissed(k, false); }}>Rydd</button></div>
        )}
      </div>
    </section>
  );
}

function Appearance() {
  const { prefs, update, sync } = usePrefs();
  const label = { synced: "lagret på omarchy · likt på alle enheter", saving: "lagrer …", offline: "frakoblet · lagret på denne enheten, synkes senere", local: "lagret på denne enheten" }[sync];
  return (
    <section className="card">
      <h3>Utseende</h3>
      <div className="seg" role="radiogroup" aria-label="Tema">
        {(["system", "light", "dark"] as const).map((t) => (
          <button key={t} role="radio" aria-checked={prefs.theme === t} className={prefs.theme === t ? "on" : ""} onClick={() => update((p) => ({ ...p, theme: t }))}>{({ system: "Auto", light: "Lys", dark: "Mørk" } as const)[t]}</button>
        ))}
      </div>
      <p className="muted small">Tema gjelder bare denne enheten{prefs.theme === "system" ? " (Auto følger telefonens lys/mørk-modus)" : ""}. Oppsett og festede elementer: {label}</p>
    </section>
  );
}

function AssistantSettings() {
  const { prefs, update } = usePrefs();
  const [st, setSt] = useState<{ grok: boolean; model: string; openai: boolean; oda: { loggedIn: boolean; user: string | null } } | null>(null);
  useEffect(() => { fetch("/api/assistant/status").then((r) => (r.ok ? r.json() : null)).then(setSt).catch(() => undefined); }, []);
  const stt = prefs.stt ?? "local";
  return (
    <section className="card">
      <h3>Assistent</h3>
      <div className="kv"><span className="muted">Grok</span><span>{st ? `${st.model} · via grok.com-plan` : "–"}</span></div>
      <div className="kv"><span className="muted">OpenAI (reserve)</span><span>{st ? (st.openai ? "Klar" : "Mangler API-nøkkel") : "–"}</span></div>
      <div className="kv"><span className="muted">Oda</span><span>{st ? (st.oda.loggedIn ? `Innlogget (${st.oda.user})` : "Ikke innlogget") : "–"}</span></div>
      <div className="muted small">Talegjenkjenning i chat</div>
      <div className="seg" role="radiogroup" aria-label="Talegjenkjenning">
        {(["local", "openai"] as const).map((t) => (
          <button key={t} role="radio" aria-checked={stt === t} className={stt === t ? "on" : ""} disabled={t === "openai" && st !== null && !st.openai} onClick={() => update((p) => ({ ...p, stt: t }))}>{t === "local" ? "Lokal Whisper (gratis)" : "OpenAI Whisper"}</button>
        ))}
      </div>
      <p className="muted small">Lokal Whisper kjører på omarchy; lyd forlater aldri huset. OpenAI krever en nøkkel i secrets/openai_api_key.</p>
    </section>
  );
}
