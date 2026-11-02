import { AnimatePresence, motion } from "motion/react";
import { AudioLines, Mic, MicOff, Send, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { VoiceApi } from "../lib/voice";

const LABEL: Record<string, string> = { idle: "Hold for å snakke", listening: "Lytter", thinking: "Tenker", speaking: "Snakker", error: "Noe gikk galt" };

export function VoiceOverlay({ open, onClose, voice }: { open: boolean; onClose: () => void; voice: VoiceApi }) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const { caps, phase, level, log, handsFree, error } = voice;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [log]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { voice.cancel(); onClose(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose, voice]);
  const sttOk = Boolean(caps?.stt);
  const orbStyle = { "--lv": String(phase === "listening" ? level : phase === "speaking" ? 0.35 : 0) } as CSSProperties;
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="voice" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="voice-top">
            <div className="voice-pipeline">
              <AudioLines size={15} strokeWidth={1.75} />
              <span>Local voice</span>
              <span className="muted">{caps?.pipelineName ?? "Assist"}{sttOk ? "" : " · typing only"}{caps?.tts ? "" : " · device voice"}</span>
            </div>
            <button className="icon-btn" aria-label="Lukk stemme" onClick={() => { voice.cancel(); onClose(); }}><X size={20} /></button>
          </div>

          <div className="voice-log">
            {log.length === 0 && (
              <div className="voice-hints">
                <p className="muted">Try saying</p>
                {["Slå av lyset på kjøkkenet", "Hvor varmt er det på soverommet?", "Start filmkveld", "Hvor fuktig er det på badet?"].map((h) => (
                  <button key={h} className="chip" onClick={() => void voice.sendText(h)}>“{h}”</button>
                ))}
              </div>
            )}
            {log.map((x) => (
              <motion.div key={x.id} className="exchange" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="bubble user">{x.user}</div>
                {x.reply && <div className={`bubble bot ${x.error ? "err" : ""}`}>{x.reply}</div>}
              </motion.div>
            ))}
            <div ref={endRef} />
          </div>

          <div className="voice-center">
            <button
              className={`orb ${phase}`} style={orbStyle} disabled={!sttOk}
              aria-label="Hold for å snakke"
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); if (!handsFree) void voice.listen(); }}
              onPointerUp={() => { if (!handsFree) voice.release(); }}
            >
              <span className="orb-ring r1" /><span className="orb-ring r2" /><span className="orb-ring r3" />
              <span className="orb-core">{sttOk ? <Mic size={26} strokeWidth={1.75} /> : <MicOff size={26} strokeWidth={1.75} />}</span>
            </button>
            <div className="voice-status">{handsFree && phase === "idle" ? "Hands-free on" : LABEL[phase]}</div>
            {error && <div className="voice-error">{error}</div>}
            <label className={`hf-toggle ${handsFree ? "on" : ""} ${sttOk ? "" : "disabled"}`}>
              <input type="checkbox" checked={handsFree} disabled={!sttOk} onChange={voice.toggleHandsFree} />
              <span className="hf-track"><span className="hf-knob" /></span>
              Hands-free
            </label>
            <label className="hf-toggle disabled" title="Kommer snart">
              <input type="checkbox" checked={false} disabled readOnly />
              <span className="hf-track"><span className="hf-knob" /></span>
              Grok voice (coming soon)
            </label>
          </div>

          <form className="voice-input" onSubmit={(e) => { e.preventDefault(); void voice.sendText(text); setText(""); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Eller skriv en kommando …" aria-label="Kommando" />
            <button className="icon-btn primary" type="submit" aria-label="Send"><Send size={18} /></button>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
