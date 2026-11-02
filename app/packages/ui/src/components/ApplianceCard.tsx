import { WashingMachine, Wind, CookingPot, Plug } from "lucide-react";
import type { Appliance } from "@home/core";
import { useNow } from "../lib/home";
import { clock, humanize, power } from "../lib/format";

const ICON = { washer: WashingMachine, dryer: Wind, dishwasher: WashingMachine, oven: CookingPot, appliance: Plug };

export function ApplianceCard({ a, onOpen }: { a: Appliance; onOpen: (id: string) => void }) {
  const now = useNow();
  const running = a.machineState === "run";
  const paused = a.machineState === "pause";
  const left = a.completesAt && (running || paused) ? Math.max(0, Math.round((a.completesAt - now) / 60_000)) : null;
  // Progress estimate: assume a typical 2h cycle when the start time is unknown.
  const pct = left !== null ? Math.max(4, Math.min(100, 100 - (left / 120) * 100)) : running ? 50 : 0;
  const Icon = ICON[a.kind];
  const status = a.machineState === "unavailable" ? "Frakoblet" : running ? humanize(a.job ?? "går") : paused ? "Pauset" : "Klar";
  const detail = [left !== null ? (left === 0 ? "Finishing" : `${left} min left`) : null, left ? `done ${clock(a.completesAt!)}` : null, running ? power(a.powerW) : null].filter(Boolean).join(" · ");
  return (
    <button className={`appliance ${running ? "on" : ""} ${a.machineState === "unavailable" ? "unavailable" : ""}`} onClick={() => onOpen(a.primaryId)} aria-label={`${a.name}: ${status}`}>
      <span className="appliance-ring" style={{ "--p": `${pct}%` } as React.CSSProperties}>
        <span className="appliance-icon"><Icon size={18} strokeWidth={1.75} className={running ? "spin-slow" : ""} /></span>
      </span>
      <span className="tile-text">
        <span className="tile-name">{a.name}</span>
        <span className="tile-state">{status}{detail ? ` · ${detail}` : ""}</span>
      </span>
    </button>
  );
}
