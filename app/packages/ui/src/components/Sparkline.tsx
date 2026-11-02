import { useId, useMemo } from "react";
import type { HistoryPoint } from "@home/core";

interface Props {
  points: HistoryPoint[] | undefined;
  live?: number;
  color?: string;
  height?: number;
  width?: number;
  fill?: boolean;
  className?: string;
}

/** Smooth SVG sparkline with gradient fill. */
export function Sparkline({ points, live, color = "var(--accent)", height = 36, width = 120, fill = true, className }: Props) {
  const gid = useId();
  const d = useMemo(() => {
    const vals = (points ?? []).filter((p) => Number.isFinite(p.v));
    if (live !== undefined && Number.isFinite(live)) vals.push({ t: Date.now(), v: live, s: String(live) });
    if (vals.length < 2) return null;
    const t0 = vals[0]!.t, t1 = vals[vals.length - 1]!.t;
    let lo = Infinity, hi = -Infinity;
    for (const p of vals) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
    if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
    const pad = 3;
    const xy = vals.map((p) => [((p.t - t0) / Math.max(1, t1 - t0)) * width, pad + (1 - (p.v - lo) / (hi - lo)) * (height - pad * 2)] as const);
    let path = `M${xy[0]![0].toFixed(1)},${xy[0]![1].toFixed(1)}`;
    for (let i = 1; i < xy.length; i++) {
      const [x0, y0] = xy[i - 1]!; const [x1, y1] = xy[i]!;
      const cx = (x0 + x1) / 2;
      path += ` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    const last = xy[xy.length - 1]!;
    return { path, area: `${path} L${width},${height} L0,${height} Z`, last };
  }, [points, live, width, height]);
  if (!d) return <svg className={className} width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden />;
  return (
    <svg className={className} width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={d.area} fill={`url(#${gid})`} />}
      <path d={d.path} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
    </svg>
  );
}
