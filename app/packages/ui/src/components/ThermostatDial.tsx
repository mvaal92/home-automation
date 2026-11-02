import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { nbState } from "../lib/format";

const START = 135; // degrees, 0 = 3 o'clock, clockwise
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
}
function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const [x0, y0] = polar(cx, cy, r, a0); const [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0},${y0} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1},${y1}`;
}

/** Draggable circular thermostat dial. */
export function ThermostatDial({ target, current, min, max, step, mode, action, onChange }: {
  target: number; current?: number; min: number; max: number; step: number; mode: string; action?: string;
  onChange: (v: number, final: boolean) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [local, setLocal] = useState<number | null>(null);
  const drag = useRef(false);
  useEffect(() => { if (!drag.current) setLocal(null); }, [target]);
  const v = local ?? target;
  const f = (v - min) / (max - min);
  const color = mode === "off" ? "var(--muted)" : mode === "cool" ? "var(--cool)" : "var(--warm)";
  const set = (n: number, final: boolean) => {
    const c = Math.max(min, Math.min(max, Math.round(n / step) * step));
    setLocal(c); onChange(c, final);
  };
  const fromPointer = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const ang = (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
    let rel = (ang - START + 360) % 360;
    if (rel > SWEEP) rel = rel > SWEEP + (360 - SWEEP) / 2 ? 0 : SWEEP;
    return min + (rel / SWEEP) * (max - min);
  };
  const [kx, ky] = polar(100, 100, 82, START + f * SWEEP);
  const curF = current !== undefined ? Math.max(0, Math.min(1, (current - min) / (max - min))) : undefined;
  const ticks = Array.from({ length: 55 }, (_, i) => START + (i / 54) * SWEEP);
  return (
    <div className="dial">
      <svg
        ref={ref} viewBox="0 0 200 200" className="dial-svg"
        onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = true; set(fromPointer(e), false); }}
        onPointerMove={(e) => drag.current && set(fromPointer(e), false)}
        onPointerUp={(e) => { if (drag.current) { drag.current = false; set(fromPointer(e), true); } }}
      >
        <defs>
          <filter id="dialglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
        </defs>
        {ticks.map((a, i) => {
          const [x0, y0] = polar(100, 100, 66, a); const [x1, y1] = polar(100, 100, i % 6 === 0 ? 60 : 62, a);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--line-2)" strokeWidth={1} />;
        })}
        <path d={arc(100, 100, 82, START, START + SWEEP)} stroke="var(--line)" strokeWidth={12} fill="none" strokeLinecap="round" />
        {f > 0.001 && <path d={arc(100, 100, 82, START, START + f * SWEEP)} stroke={color} strokeWidth={12} fill="none" strokeLinecap="round" filter="url(#dialglow)" opacity={0.6} />}
        {f > 0.001 && <path d={arc(100, 100, 82, START, START + f * SWEEP)} stroke={color} strokeWidth={12} fill="none" strokeLinecap="round" />}
        {curF !== undefined && (() => { const [cx, cy] = polar(100, 100, 82, START + curF * SWEEP); return <circle cx={cx} cy={cy} r={3} fill="#fff" opacity={0.8} />; })()}
        <circle cx={kx} cy={ky} r={10} fill="#fff" stroke={color} strokeWidth={3} className="dial-knob" />
      </svg>
      <div className="dial-center">
        <span className="dial-mode">{mode === "off" ? "Av" : nbState(action ?? mode)}</span>
        <span className="dial-target">{v.toFixed(step < 1 ? 1 : 0)}<sup>°</sup></span>
        {current !== undefined && <span className="dial-current">Nå {current.toFixed(1)}°</span>}
        <div className="dial-steps">
          <button className="icon-btn" aria-label="Senk" onClick={() => set(v - step, true)}><Minus size={18} /></button>
          <button className="icon-btn" aria-label="Øk" onClick={() => set(v + step, true)}><Plus size={18} /></button>
        </div>
      </div>
    </div>
  );
}
