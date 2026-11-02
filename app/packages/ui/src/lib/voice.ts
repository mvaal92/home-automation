import { useCallback, useEffect, useRef, useState } from "react";
import { rms, toPcm16, type AssistCapabilities, type AssistRun, type HomeStore } from "@home/core";

export type VoicePhase = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface Exchange { id: number; user: string; reply: string; error?: boolean }

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('home-tap', Tap);`;

interface Mic {
  stop(): void;
}

async function openMic(onFrame: (f: Float32Array, rate: number) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "home-tap");
  node.port.onmessage = (ev: MessageEvent<Float32Array>) => onFrame(ev.data, ctx.sampleRate);
  src.connect(node);
  return {
    stop: () => { node.port.onmessage = null; src.disconnect(); node.disconnect(); stream.getTracks().forEach((t) => t.stop()); void ctx.close(); },
  };
}

/**
 * Voice controller: push-to-talk and hands-free over HA's Assist pipeline.
 * stt -> intent -> tts when the pipeline has engines; text-only otherwise
 * (browser speech synthesis is used as a TTS fallback).
 */
export function useVoice(store: HomeStore) {
  const [caps, setCaps] = useState<AssistCapabilities | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState("");
  const [log, setLog] = useState<Exchange[]>([]);
  const [handsFree, setHandsFree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef<AssistRun | null>(null);
  const mic = useRef<Mic | null>(null);
  const conv = useRef<string | null>(null);
  const handsFreeRef = useRef(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const seq = useRef(0);
  const released = useRef(false);
  const listenRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => { handsFreeRef.current = handsFree; }, [handsFree]);
  useEffect(() => {
    let alive = true;
    let have = false;
    const refresh = () => store.backend.assistCapabilities().then((c) => { if (alive) { have = c.pipelineId !== null; setCaps(c); } }).catch(() => undefined);
    void refresh();
    // Re-check once after (re)connecting if the first attempt found nothing.
    let last = store.getSnapshot().status;
    const unsub = store.subscribe(() => {
      const st = store.getSnapshot().status;
      if (st !== last) { last = st; if (st === "connected" && !have) void refresh(); }
    });
    return () => { alive = false; unsub(); };
  }, [store]);

  const stopMic = useCallback(() => { mic.current?.stop(); mic.current = null; setLevel(0); }, []);

  const speak = useCallback(async (url: string | null, text: string) => {
    setPhase("speaking");
    try {
      if (url) {
        const a = new Audio(store.backend.resolveUrl(url));
        audio.current = a;
        await a.play();
        await new Promise<void>((res) => { a.onended = () => res(); a.onerror = () => res(); });
      } else if ("speechSynthesis" in window && text) {
        await new Promise<void>((res) => {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = caps?.language === "nb" ? "nb-NO" : "en-US";
          u.onend = () => res(); u.onerror = () => res();
          speechSynthesis.speak(u);
          setTimeout(res, 8000);
        });
      }
    } catch { /* autoplay blocked etc. */ }
    setPhase("idle");
    if (handsFreeRef.current) setTimeout(() => void listenRef.current(), 250);
  }, [store, caps]);

  const handle = useCallback(async (opts: { text?: string; audio?: boolean }) => {
    const id = ++seq.current;
    let userText = opts.text ?? "";
    let reply = "";
    let ttsUrl: string | null = null;
    let failed = false;
    setError(null);
    setLog((l) => [...l.slice(-12), { id, user: userText || "…", reply: "" }]);
    const update = (p: Partial<Exchange>) => setLog((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const wantTts = Boolean(caps?.tts);
    const r = await store.backend.runAssist(
      { text: opts.text, audio: opts.audio ? { sampleRate: 16000 } : undefined, tts: wantTts, pipelineId: caps?.pipelineId, conversationId: conv.current },
      (ev) => {
        if (ev.type === "stt-vad-end") { stopMic(); setPhase("thinking"); run.current?.endAudio(); }
        if (ev.type === "stt-end") { userText = ev.text.trim(); update({ user: userText }); setPartial(""); stopMic(); setPhase("thinking"); }
        if (ev.type === "intent-end") { reply = ev.speech; conv.current = ev.conversationId ?? conv.current; update({ reply }); }
        if (ev.type === "tts-end") ttsUrl = ev.url;
        if (ev.type === "error") {
          failed = true; stopMic();
          const msg = ev.code === "stt-no-text-recognized" ? "I didn't catch that." : ev.message;
          update({ reply: msg, error: true, user: userText || "(no speech)" }); setError(msg);
        }
      },
    );
    run.current = r;
    return r.done.then(async () => {
      run.current = null;
      if (failed) { setPhase("idle"); if (handsFreeRef.current) setTimeout(() => void listenRef.current(), 800); return; }
      await speak(ttsUrl, reply);
    });
  }, [store, caps, speak, stopMic]);

  const sendText = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setPhase("thinking");
    try { await handle({ text: text.trim() }); } catch (e) { setPhase("error"); setError(String(e)); }
  }, [handle]);

  /** Start streaming the mic into an stt run. */
  const activeRun = () => run.current;
  const listen = useCallback(async () => {
    if (activeRun() || mic.current) return;
    if (!caps?.stt) { setError("This Home Assistant has no speech-to-text engine. Type instead."); return; }
    audio.current?.pause();
    setPhase("listening"); setPartial("Listening…");
    const startedAt = Date.now();
    let heard = false, silentSince = 0;
    let p: Promise<void> | null = null;
    const early: Int16Array[] = [];
    released.current = false;
    try {
      p = handle({ audio: true });
      mic.current = await openMic((frame, rate) => {
        const lv = rms(frame);
        setLevel((x) => x * 0.6 + Math.min(1, lv * 6) * 0.4);
        const pcm = toPcm16(frame, rate);
        if (!run.current) { early.push(pcm); return; }
        while (early.length) run.current.sendAudio(early.shift()!);
        run.current.sendAudio(pcm);
        // hands-free end-of-utterance (HA's VAD also ends the run)
        if (handsFreeRef.current) {
          const now = Date.now();
          if (lv > 0.02) { heard = true; silentSince = 0; } else if (heard && !silentSince) silentSince = now;
          if ((heard && silentSince && now - silentSince > 900) || now - startedAt > 12000) { stopMic(); run.current?.endAudio(); setPhase("thinking"); }
        }
      });
      if (released.current) { stopMic(); run.current?.endAudio(); setPhase("thinking"); }
      await p;
    } catch (e) {
      stopMic(); run.current?.cancel(); run.current = null;
      setPhase("error");
      setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Mikrofontilgang ble avvist." : `Stemmefeil: ${String(e)}`);
    }
  }, [caps, handle, stopMic]);
  useEffect(() => { listenRef.current = listen; }, [listen]);

  /** Push-to-talk release. */
  const release = useCallback(() => {
    released.current = true;
    if (!mic.current) return;
    stopMic();
    run.current?.endAudio();
    setPhase("thinking");
  }, [stopMic]);

  const cancel = useCallback(() => {
    setHandsFree(false); handsFreeRef.current = false;
    stopMic(); run.current?.cancel(); run.current = null; audio.current?.pause();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    setPhase("idle");
  }, [stopMic]);

  const toggleHandsFree = useCallback(() => {
    const next = !handsFreeRef.current;
    setHandsFree(next); handsFreeRef.current = next;
    if (next) void listen(); else cancel();
  }, [listen, cancel]);

  return { caps, phase, level, partial, log, handsFree, error, listen, release, cancel, sendText, toggleHandsFree };
}

export type VoiceApi = ReturnType<typeof useVoice>;
