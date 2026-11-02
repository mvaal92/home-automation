import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Code2, Loader2, Mic, Plus, ShieldAlert, ShoppingCart, Sparkles, Square, Trash2, Wrench, X } from "lucide-react";
import { api, streamAssistant, type AssistantEvent, type OdaProduct } from "../lib/api";
import { refreshPrefs, usePrefs } from "../lib/prefs";
import { CodeChange } from "../components/CodeChange";

type Action = { tool: string; state: string; input?: Record<string, unknown> };
type Confirm = { id: string; kind: string; title: string; product?: OdaProduct; resolved?: "approved" | "declined" | "failed" };
export type Msg = { id: string; role: "user" | "assistant" | "system"; text: string; code?: string; provider?: string; ms?: number; status?: string; actions: Action[]; confirms: Confirm[]; pending?: boolean; error?: string };

const HIDDEN_TOOLS = new Set(["search_tool", "use_tool"]);
const TOOL_LABEL: Record<string, string> = { home_overview: "Oversikt", list_areas: "Rom", list_devices: "Enheter", list_entities: "Enheter", get_state: "Leser tilstand", search: "Søker", get_history: "Historikk", set_light: "Lys", set_switch: "Bryter", set_fan: "Vifte", set_climate: "Klima", media_control: "Media", set_cover: "Gardin/port", vacuum_control: "Støvsuger", run_scene: "Scene", run_script: "Rutine", list_automations: "Automasjoner", trigger_automation: "Kjører automasjon", toggle_automation: "Automasjon", call_service: "Tjeneste" };
const SUGGESTIONS = ["Hvilke lys er på?", "Hvor varmt er det i stua?", "Gjør klar til filmkveld", "Legg melk og brød i Oda-kurven", "Skru ned viftene til lav", "Oppsummer huset"];
const uid = () => Math.random().toString(36).slice(2);
const clean = (t: string) => t.replace(/^\s*ODA_ADD:.*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();

/** Lightweight markdown: **bold**, bullets, line breaks. */
function Md({ text }: { text: string }) {
  const lines = clean(text).split("\n");
  return <>{lines.map((l, i) => {
    const bullet = /^\s*[-*•]\s+/.test(l); const body = l.replace(/^\s*[-*•]\s+/, "");
    const parts = body.split(/(\*\*[^*]+\*\*)/g).map((p, j) => p.startsWith("**") ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>);
    return l.trim() === "" ? <div key={i} className="md-gap" /> : bullet ? <div key={i} className="md-li">{parts}</div> : <p key={i}>{parts}</p>;
  })}</>;
}

export function useChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [conv, setConv] = useState<string | null>(() => localStorage.getItem("home.chat.conv"));
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!conv) return;
    api<{ messages: Array<{ id: number; role: Msg["role"]; content: string; meta: { provider?: string; ms?: number; actions?: Action[]; confirms?: Confirm[]; code?: string } | null }> }>(`/api/assistant/conversations/${encodeURIComponent(conv)}`)
      .then((r) => setMsgs(r.messages.map((m) => ({ id: String(m.id), role: m.role, text: m.content, provider: m.meta?.provider, ms: m.meta?.ms, code: m.meta?.code, actions: m.meta?.actions ?? [], confirms: (m.meta?.confirms ?? []).map((c) => ({ ...c, resolved: c.resolved ?? "declined" })) }))))
      .catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const patch = (id: string, f: (m: Msg) => Msg) => setMsgs((ms) => ms.map((m) => (m.id === id ? f(m) : m)));
  const onEvent = (aid: string) => (e: AssistantEvent) => {
    if (e.type === "start") { setConv(e.conversationId); localStorage.setItem("home.chat.conv", e.conversationId); }
    else if (e.type === "status") patch(aid, (m) => ({ ...m, status: e.text, provider: e.provider, text: e.reset ? "" : m.text }));
    else if (e.type === "delta") patch(aid, (m) => ({ ...m, text: m.text + e.text }));
    else if (e.type === "action") patch(aid, (m) => {
      if (HIDDEN_TOOLS.has(e.tool)) return m;
      const i = m.actions.findIndex((a) => a.tool === e.tool && a.state === "running" && JSON.stringify(a.input) === JSON.stringify(e.input));
      const actions = [...m.actions]; if (i >= 0) actions[i] = { tool: e.tool, state: e.state, input: e.input }; else actions.push({ tool: e.tool, state: e.state, input: e.input });
      return { ...m, actions };
    });
    else if (e.type === "confirm") patch(aid, (m) => ({ ...m, confirms: [...m.confirms, { id: e.id, kind: e.kind, title: e.title, product: e.product }] }));
    else if (e.type === "done") patch(aid, (m) => ({ ...m, pending: false, status: undefined, provider: e.provider, ms: e.ms, text: m.text || e.text || "" }));
    else if (e.type === "prefs") refreshPrefs();
    else if (e.type === "code") patch(aid, (m) => ({ ...m, code: e.id }));
    else if (e.type === "error") patch(aid, (m) => ({ ...m, pending: false, status: undefined, error: e.message }));
  };
  const send = async (text: string, mode: "auto" | "local" | "kode" = "auto") => {
    if (!text.trim() || busy) return;
    const aid = uid();
    setMsgs((ms) => [...ms, { id: uid(), role: "user", text, actions: [], confirms: [] }, { id: aid, role: "assistant", text: "", pending: true, actions: [], confirms: [], status: "Tenker…" }]);
    setBusy(true); abort.current = new AbortController();
    try { await streamAssistant("/api/assistant", { text, conversationId: conv, mode }, onEvent(aid), abort.current.signal); }
    catch (e) { if ((e as Error).name !== "AbortError") patch(aid, (m) => ({ ...m, pending: false, error: "Mistet forbindelsen." })); else patch(aid, (m) => ({ ...m, pending: false, status: undefined, text: m.text || "Stoppet." })); }
    finally { setBusy(false); patch(aid, (m) => (m.pending ? { ...m, pending: false, status: undefined } : m)); }
  };
  const resolve = async (mid: string, c: Confirm, approve: boolean) => {
    let result: Confirm["resolved"] = approve ? "approved" : "declined";
    await streamAssistant("/api/assistant/confirm", { id: c.id, approve }, (e) => { if (e.type === "error") { result = "failed"; patch(mid, (m) => ({ ...m, error: e.message })); } });
    patch(mid, (m) => ({ ...m, confirms: m.confirms.map((x) => (x.id === c.id ? { ...x, resolved: result } : x)) }));
  };
  const reset = () => { setMsgs([]); setConv(null); localStorage.removeItem("home.chat.conv"); };
  const stop = () => abort.current?.abort();
  return { msgs, send, resolve, reset, stop, busy, conv };
}
export type ChatApi = ReturnType<typeof useChat>;

function useRecorder(onText: (t: string) => void, onFallback: () => void) {
  const { prefs } = usePrefs();
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const openai = prefs.stt === "openai";
  const toggle = async () => {
    if (!openai) { onFallback(); return; }
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream); const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); setRec(null);
        const blob = new Blob(chunks, { type: r.mimeType });
        try { const res = await fetch("/api/assistant/stt", { method: "POST", headers: { "content-type": r.mimeType }, body: blob }); const j = await res.json(); if (!res.ok) throw new Error(j.error); onText(j.text); }
        catch (e) { setErr((e as Error).message); setTimeout(() => setErr(null), 5000); }
      };
      r.start(); setRec(r);
    } catch { setErr("Ingen mikrofontilgang"); setTimeout(() => setErr(null), 4000); }
  };
  return { toggle, recording: Boolean(rec), err, openai };
}

export function ChatView({ chat, compact = false, openVoice }: { chat: ChatApi; compact?: boolean; openVoice: () => void }) {
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const mic = useRecorder((t) => { setText(t); input.current?.focus(); }, openVoice);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [chat.msgs]);
  const [kode, setKode] = useState(false);
  const submit = () => { const t = text.trim(); if (!t) return; setText(""); void chat.send(t, kode ? "kode" : "auto"); };
  return (
    <div className={`chat ${compact ? "compact" : ""}`}>
      <div className="chat-scroll" ref={scroller}>
        {chat.msgs.length === 0 ? (
          <div className="chat-empty">
            <span className="chat-orb"><Sparkles size={20} strokeWidth={1.75} /></span>
            <h2>Hva kan jeg hjelpe med?</h2>
            <p className="muted">Styr huset, spør om tilstand, eller legg varer i Oda-kurven. Enkle kommandoer går rett til Home Assistant; resten til Grok.</p>
            <div className="chat-suggest">{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => void chat.send(s)}>{s}</button>)}</div>
          </div>
        ) : chat.msgs.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === "user" ? <div className="bubble">{m.text}</div> : (
              <div className="answer">
                {m.actions.some((a) => !HIDDEN_TOOLS.has(a.tool)) && <div className="actions">{m.actions.filter((a) => !HIDDEN_TOOLS.has(a.tool)).map((a, i) => (
                  <span key={i} className={`action ${a.state}`} title={a.input ? JSON.stringify(a.input) : undefined}>
                    {a.state === "running" ? <Loader2 size={12} className="spin" /> : a.state === "needs-confirm" ? <ShieldAlert size={12} /> : a.state === "error" ? <X size={12} /> : <Wrench size={12} />}
                    {TOOL_LABEL[a.tool] ?? a.tool}
                  </span>))}</div>}
                {m.text ? <div className="md"><Md text={m.text} /></div> : m.pending && <div className="typing"><span /><span /><span /><em>{m.status}</em></div>}
                {m.confirms.map((c) => (
                  <div key={c.id} className={`confirm-card ${c.kind} ${c.resolved ?? ""}`}>
                    {c.product?.image ? <img src={c.product.image} alt="" /> : <span className="confirm-ico">{c.kind === "oda" ? <ShoppingCart size={18} /> : <ShieldAlert size={18} />}</span>}
                    <div className="grow"><div className="confirm-title">{c.title}</div>
                      <div className="muted small">{c.kind === "oda" ? `${c.product?.extra ?? ""} · ${c.product?.price?.toFixed(2)} kr` : "Sikkerhetsfølsom handling – krever din bekreftelse"}</div></div>
                    {c.resolved ? <span className="confirm-state">{c.resolved === "approved" ? <><Check size={14} /> Utført</> : c.resolved === "failed" ? "Feilet" : "Avbrutt"}</span> : (
                      <div className="confirm-btns"><button className="btn sm" onClick={() => void chat.resolve(m.id, c, false)}>Avbryt</button><button className="btn sm primary" onClick={() => void chat.resolve(m.id, c, true)}>{c.kind === "oda" ? "Legg til" : "Bekreft"}</button></div>
                    )}
                  </div>
                ))}
                {m.code && <CodeChange id={m.code} />}
                {m.error && <div className="notice bad small">{m.error}</div>}
                {!m.pending && m.provider && <div className="meta">{m.provider === "assist" ? "Home Assistant" : m.provider === "grok" ? "Grok" : m.provider === "openai" ? "OpenAI" : m.provider === "app" ? "" : m.provider}{m.ms ? ` · ${(m.ms / 1000).toFixed(1)} s` : ""}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="composer">
        {chat.msgs.length > 0 && <button className="icon-btn ghost" onClick={chat.reset} title="Ny samtale" aria-label="Ny samtale"><Plus size={18} /></button>}
        <button className={`chip kode-toggle ${kode ? "on" : ""}`} onClick={() => setKode((k) => !k)} aria-pressed={kode} title="Kode-modus: be assistenten endre appens kode (forhåndsvises før du tar den i bruk)"><Code2 size={14} /> Kode</button>
        <textarea ref={input} rows={1} value={text} placeholder={kode ? "Beskriv endringen i appen…" : "Spør om huset ditt…"} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <button className={`icon-btn ghost ${mic.recording ? "rec" : ""}`} onClick={() => void mic.toggle()} title={mic.openai ? "Snakk (OpenAI Whisper)" : "Stemme (lokal Whisper)"} aria-label="Stemme"><Mic size={18} /></button>
        {chat.busy ? <button className="send" onClick={chat.stop} aria-label="Stopp"><Square size={14} /></button>
          : <button className="send" onClick={submit} disabled={!text.trim()} aria-label="Send"><ArrowUp size={18} /></button>}
      </div>
      {mic.err && <div className="toast">{mic.err}</div>}
    </div>
  );
}

export function ChatPage({ chat, openVoice }: { chat: ChatApi; openVoice: () => void }) {
  const [convs, setConvs] = useState<Array<{ id: string; title: string; updated_at: number; n: number }>>([]);
  useEffect(() => { api<{ conversations: typeof convs }>("/api/assistant/conversations").then((r) => setConvs(r.conversations)).catch(() => undefined); }, [chat.conv, chat.busy]);
  return (
    <div className="page chat-page">
      <div className="chat-layout">
        <aside className="chat-history">
          <div className="section-title">Samtaler</div>
          <button className="btn sm" onClick={chat.reset}><Plus size={14} /> Ny samtale</button>
          {convs.map((c) => (
            <div key={c.id} className={`conv ${c.id === chat.conv ? "active" : ""}`}>
              <button className="grow" onClick={() => { localStorage.setItem("home.chat.conv", c.id); location.reload(); }}>{c.title || "Samtale"}<span className="muted small">{new Date(c.updated_at).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></button>
              <button className="icon-btn ghost" aria-label="Slett" onClick={async () => { await api(`/api/assistant/conversations/${encodeURIComponent(c.id)}`, { method: "DELETE" }); if (c.id === chat.conv) chat.reset(); setConvs((x) => x.filter((y) => y.id !== c.id)); }}><Trash2 size={14} /></button>
            </div>
          ))}
        </aside>
        <ChatView chat={chat} openVoice={openVoice} />
      </div>
    </div>
  );
}
