import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { BellRing, Cctv, VideoOff } from "lucide-react";
import type { Camera } from "@home/core";
import { useNow, useStore } from "../lib/home";
import { ago } from "../lib/format";

/** Refreshing still from HA's camera proxy (through /ha when served by the Home server). */
export function useCameraImage(cam: Camera, everyMs = 10_000): string | null {
  const store = useStore();
  const [tick, setTick] = useState(0);
  const live = store.backend.kind === "live";
  useEffect(() => {
    if (!live || !cam.available) return;
    const t = setInterval(() => setTick((n) => n + 1), everyMs);
    return () => clearInterval(t);
  }, [live, cam.available, everyMs]);
  if (!cam.picture || !cam.available) return null;
  const url = store.backend.resolveUrl(cam.picture);
  return live ? `${url}${url.includes("?") ? "&" : "?"}t=${tick}` : url;
}

export function CameraTile({ cam, onOpen, wide }: { cam: Camera; onOpen: (id: string) => void; wide?: boolean }) {
  const src = useCameraImage(cam);
  const now = useNow();
  const [loaded, setLoaded] = useState(false);
  const recentRing = cam.lastRing !== null && now - cam.lastRing < 15 * 60_000;
  const Icon = cam.doorbell ? BellRing : Cctv;
  return (
    <motion.button className={`camera ${wide ? "wide" : ""} ${cam.available ? "" : "offline"} ${recentRing ? "rang" : ""}`} onClick={() => onOpen(cam.id)}
      whileTap={{ scale: 0.99 }} transition={{ duration: 0.15 }} aria-label={`${cam.name} camera`}>
      <span className="camera-frame">
        {src ? <img src={src} alt="" onLoad={() => setLoaded(true)} className={loaded ? "ready" : ""} draggable={false} /> : null}
        {!src && <span className="camera-empty"><VideoOff size={20} strokeWidth={1.5} />{cam.available ? "Ingen bilde ennå" : "Kamera frakoblet"}</span>}
        {src && !loaded && <span className="camera-shimmer" />}
      </span>
      <span className="camera-scrim" />
      <span className="camera-top">
        {cam.available ? <span className="live-dot">{cam.doorbell ? "Ringeklokke" : "Direkte"}</span> : <span className="live-dot off">Frakoblet</span>}
      </span>
      <span className="camera-meta">
        <span className="camera-name"><Icon size={15} strokeWidth={1.75} /> {cam.name}</span>
        <span className="camera-sub">
          {cam.lastRing !== null ? `${recentRing ? "Rang" : "Ringte sist"} ${ago(cam.lastRing, now)}` : cam.motion ? "Bevegelse oppdaget" : cam.available ? "Alt rolig" : "Sjekk strøm eller Wi-Fi"}
        </span>
      </span>
    </motion.button>
  );
}
