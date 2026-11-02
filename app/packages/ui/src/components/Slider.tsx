import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number, final: boolean) => void;
  vertical?: boolean;
  /** CSS background of the track (e.g. gradient). */
  track?: string;
  fillColor?: string;
  showFill?: boolean;
  label?: ReactNode;
  className?: string;
  ariaLabel: string;
}

/** Big touch-friendly slider (pointer events; works with mouse, touch, pen). */
export function Slider({ value, min = 0, max = 100, step = 1, onChange, vertical, track, fillColor, showFill = true, label, className, ariaLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [local, setLocal] = useState<number | null>(null);
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) setLocal(null); }, [value]);
  const v = local ?? value;
  const pct = ((v - min) / (max - min)) * 100;

  const fromEvent = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const f = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    const raw = min + Math.max(0, Math.min(1, f)) * (max - min);
    return Math.round(raw / step) * step;
  };
  const style = { "--pct": `${pct}%`, "--track": track ?? "", "--fill": fillColor ?? "var(--accent)" } as CSSProperties;
  return (
    <div
      ref={ref}
      className={`slider ${vertical ? "slider-v" : "slider-h"} ${track ? "slider-custom" : ""} ${className ?? ""}`}
      style={style}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(v)}
      tabIndex={0}
      onKeyDown={(e) => {
        const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? step * 5 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -step * 5 : 0;
        if (d) { e.preventDefault(); const n = Math.max(min, Math.min(max, v + d)); setLocal(n); onChange(n, true); }
      }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        dragging.current = true;
        const n = fromEvent(e); setLocal(n); onChange(n, false);
      }}
      onPointerMove={(e) => { if (!dragging.current) return; const n = fromEvent(e); setLocal(n); onChange(n, false); }}
      onPointerUp={(e) => { if (!dragging.current) return; dragging.current = false; const n = fromEvent(e); setLocal(n); onChange(n, true); }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      {showFill && <div className="slider-fill" />}
      <div className="slider-thumb" />
      {label && <div className="slider-label">{label}</div>}
    </div>
  );
}
