import { useMemo, useState } from "react";
import { Droplets, Fan, Minus, Moon, Pause, Play, Plus, Rocket, SlidersHorizontal, Wind } from "lucide-react";
import type { EntityState } from "@home/core";
import { useCall, useHistory, useSnapshot } from "../lib/home";
import { Sparkline } from "../components/Sparkline";

/** Fuktstyrte ventilasjonssoner fra HA-pakken ventilation_humidity (sensor.ventilasjon_<sone>, attributt ventilation_zone). */
type Attrs = Record<string, unknown> & { curve?: Record<string, number>; entities?: Record<string, string>; override_ends?: string | null };
type Zone = { id: string; name: string; e: EntityState; a: Attrs; ents: Record<string, string> };

export const MODE: Record<string, [string, string]> = {
  grunn: ["Grunnventilasjon", ""], okt: ["Øker med fukt", "on"], maks: ["Maks fukt", "warn"], natt: ["Natt (dempet)", ""],
  boost: ["Boost", "on"], pause: ["Pause", "warn"], fast: ["Fast (automatikk av)", ""], sensorfeil: ["Sensorfeil", "warn"],
};
const CURVE: [string, string, number][] = [["min_humidity", "Start ved fukt", 1], ["max_humidity", "Full fart ved fukt", 1], ["min_speed", "Minste fart", 5], ["max_speed", "Største fart", 5], ["baseline_offset", "Over grunnlinje", 1], ["night_cap", "Maks om natta", 5]];
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : null; };

export function useVentZones(): Zone[] {
  const { entities: e } = useSnapshot();
  return useMemo(() => Object.values(e).filter((s) => s.entity_id.startsWith("sensor.ventilasjon_") && s.attributes.ventilation_zone === true)
    .map((s) => { const a = s.attributes as Attrs; return { id: String(a.zone), name: String(a.name ?? a.zone), e: s, a, ents: (a.entities ?? {}) as Record<string, string> }; }), [e]);
}

const until = (iso?: string | null) => { if (!iso) return ""; const m = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000)); return ` · ${m} min igjen`; };

export function VentZones() {
  const zones = useVentZones(); const [range, setRange] = useState<24 | 168>(24);
  if (!zones.length) return null;
  return <section className="section vent-zones"><div className="row"><h2 className="section-title grow">Fuktstyrt ventilasjon</h2>
    <div className="seg-mini">{([[24, "24 t"], [168, "7 d"]] as const).map(([h, l]) => <button key={h} className={`chip ${range === h ? "on" : ""}`} onClick={() => setRange(h)}>{l}</button>)}</div></div>
    <div className="widgets two">{zones.map((z) => <ZoneCard key={z.id} z={z} range={range} />)}</div></section>;
}

function ZoneCard({ z, range }: { z: Zone; range: 24 | 168 }) {
  const { entities: e } = useSnapshot(); const call = useCall(); const [open, setOpen] = useState(false);
  const a = z.a; const mode = String(a.mode ?? ""); const [ml, mc] = MODE[mode] ?? [mode || "–", ""];
  const hist = useHistory([z.ents.humidity_sensor, z.e.entity_id].filter(Boolean) as string[], range);
  const over = (kind: "boost" | "pause" | "auto", minutes?: number) => void call({ domain: "script", service: "turn_on", target: { entity_id: "script.ventilasjon_overstyr" }, data: { variables: { zone: z.id, kind, ...(minutes ? { minutes } : {}) } } });
  const setNum = (id: string, value: number) => void call({ domain: "input_number", service: "set_value", target: { entity_id: id }, data: { value } });
  const c = a.curve ?? {}; const ov = String(a.override ?? "auto");
  const hum = n(a.humidity); const speed = n(z.e.state); const rpm = n(a.rpm);
  return <section className={`card vent-zone ${speed ? "on" : ""}`}>
    <header className="row"><span className={`card-ic ${speed ? "spin-slow" : ""}`}><Fan size={18} /></span>
      <div className="grow"><h3>{z.name}</h3><span className="muted small">{mode === "natt" && <Moon size={11} />} {ov !== "auto" ? `${ov === "boost" ? "Boost" : "Pause"}${until(a.override_ends)}` : `Sensor: ${String(e[z.ents.humidity_sensor ?? ""]?.attributes.friendly_name ?? "–").replace(/\s+luftfuktighet$/i, "")}`}</span></div>
      <span className={`chip static vent-mode ${mc}`}>{ml}</span></header>
    <div className="luft-stats">
      <div><span className="big">{hum ?? "–"}<small>%</small></span><span className="lbl"><Droplets size={12} /> Fukt</span></div>
      <div><span className="big">{n(a.baseline) ?? "–"}<small>%</small></span><span className="lbl">Grunnlinje</span></div>
      <div><span className="big">{speed ?? "–"}<small>%</small></span><span className="lbl"><Wind size={12} /> Viftefart</span></div>
      <div><span className="big">{rpm ?? "–"}<small>rpm</small></span><span className="lbl">Målt</span></div>
    </div>
    <div className="vent-graph">
      <span className="muted tiny">Fukt</span><Sparkline points={hist[z.ents.humidity_sensor ?? ""]} live={hum ?? undefined} height={46} width={320} />
      <span className="muted tiny">Viftefart</span><Sparkline points={hist[z.e.entity_id]} live={speed ?? undefined} height={30} width={320} color="var(--warn, #f59e0b)" />
    </div>
    <p className="muted tiny">Kurve: {c.min_speed ?? "–"} % ved ≤ {n(a.start_humidity) ?? "–"} % fukt → {c.max_speed ?? "–"} % ved ≥ {n(a.full_humidity) ?? "–"} %. Natt {String(a.night_start)}–{String(a.night_end)}: maks {c.night_cap ?? "–"} %.</p>
    <div className="luft-actions">
      <button className={`btn sm ${ov === "boost" ? "primary" : ""}`} onClick={() => over("boost", Number(a.boost_minutes) || 30)}><Rocket size={13} /> Boost {Number(a.boost_minutes) || 30} min</button>
      <button className={`btn sm ${ov === "pause" ? "primary" : ""}`} onClick={() => over("pause", Number(a.pause_minutes) || 30)}><Pause size={13} /> Pause {Number(a.pause_minutes) || 30} min</button>
      {(ov !== "auto" || a.auto === false) && <button className="btn sm" onClick={() => over("auto")}><Play size={13} /> Automatikk</button>}
      <button className="btn sm ghost" onClick={() => setOpen((o) => !o)}><SlidersHorizontal size={13} /> Kurve</button>
    </div>
    {open && <div className="vent-curve">
      <label className="toggle-row"><span className="grow">Automatisk fuktstyring <span className="muted small">(av = fast minste fart)</span></span>
        <input type="checkbox" className="switch" checked={e[z.ents.auto ?? ""]?.state === "on"} onChange={(x) => void call({ domain: "input_boolean", service: x.target.checked ? "turn_on" : "turn_off", target: { entity_id: z.ents.auto! } })} /></label>
      {CURVE.map(([k, label, step]) => { const id = z.ents[k]; const v = n(e[id ?? ""]?.state); if (!id || v == null) return null;
        return <div key={k} className="numstep"><span className="grow">{label}</span>
          <button className="icon-btn ghost sm" aria-label={`${label} ned`} onClick={() => setNum(id, v - step)}><Minus size={13} /></button><b>{v} %</b>
          <button className="icon-btn ghost sm" aria-label={`${label} opp`} onClick={() => setNum(id, v + step)}><Plus size={13} /></button></div>; })}
      <p className="muted tiny">Startfukt = høyeste av «Start ved fukt» og grunnlinje + «Over grunnlinje». Sensor: {String(e[z.ents.humidity_sensor ?? ""]?.attributes.friendly_name ?? z.ents.humidity_sensor)}.</p>
    </div>}
  </section>;
}

/** Kort linje til Hjem-kortet. */
export function ventSummary(zones: Zone[]): string {
  return zones.map((z) => `${z.name} ${z.e.state} % (${(MODE[String(z.a.mode)] ?? [String(z.a.mode)])[0].toLowerCase()})`).join(" · ");
}
