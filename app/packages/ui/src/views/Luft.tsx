import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { AirVent, Droplets, Flame, Gauge, Minus, Plus, RotateCcw, Snowflake, Thermometer, Timer, Wind, Zap, AlertTriangle, CalendarClock, Pin, PinOff } from "lucide-react";
import type { EntityState } from "@home/core";
import { useCall, useHistory, useSnapshot } from "../lib/home";
import { usePrefs } from "../lib/prefs";
import { Sparkline } from "../components/Sparkline";
import { VentZones, useVentZones, ventSummary } from "./VentZones";

const FAN = "fan.flexit_fan"; const P = "flexit_fan_flexit_fan_";
const num = (s?: EntityState) => { const v = Number(s?.state); return s && Number.isFinite(v) ? v : null; };
const name = (s: EntityState) => String(s.attributes.friendly_name ?? s.entity_id);
const SPEED = [["off", "Av"], ["low", "Lav"], ["medium", "Middels"], ["high", "Høy"]] as const;
const AQ = ["humidity", "temperature", "carbon_dioxide", "pm25", "volatile_organic_compounds", "volatile_organic_compounds_parts"];
const room = (n: string) => n.replace(/^(Temperatursensor|Termostat)\s+/i, "").replace(/\s*\(.*?\)/, "").replace(/\s+(luftfuktighet|temperatur|temperature)$/i, "").replace(/^Flexit vifte.*/, "Flexit (avtrekk)");

export function useLuftPinned(): [boolean, () => void] {
  const { prefs, update } = usePrefs();
  const on = !!prefs.luftPinned; return [on, () => update((p) => ({ ...p, luftPinned: !p.luftPinned }))];
}

export function LuftPage() {
  const { entities: e } = useSnapshot(); const call = useCall();
  const [range, setRange] = useState<24 | 168>(24); const [pinned, togglePin] = useLuftPinned();
  const fan = e[FAN]; const preset = String(fan?.attributes.preset_mode ?? fan?.state ?? "off");
  const sensors = useMemo(() => Object.values(e).filter((s) => s.entity_id.startsWith("sensor.") && !s.entity_id.startsWith("sensor.ventilasjon_") && AQ.includes(String(s.attributes.device_class)) && s.state !== "unavailable"), [e]);
  const rooms = useMemo(() => { const m = new Map<string, EntityState[]>(); for (const s of sensors) { const r = room(name(s)); m.set(r, [...(m.get(r) ?? []), s]); } return [...m]; }, [sensors]);
  const hist = useHistory(sensors.map((s) => s.entity_id), range);
  const climates = Object.values(e).filter((s) => s.entity_id.startsWith("climate."));
  const svc = (domain: string, service: string, entity_id: string, data?: Record<string, unknown>) => void call({ domain, service, target: { entity_id }, data });
  const s = (k: string) => e[`sensor.${P}${k}`]; const n = (k: string) => e[`number.${P}${k}`]; const sw = (k: string) => e[`switch.${P}${k}`];
  const filterDue = e[`binary_sensor.${P}filter_replacement_status`]?.state === "on";
  const timer = e[`select.${P}timer_mode`]; const boostOn = s("boost_status")?.state === "on";
  const humAuto = e["automation.flexit_humidity_boost_shower"]; const humActive = e["input_boolean.fan_humidity_boost_active"]?.state === "on";
  const heatState = e["input_select.heating_state"];
  const NumStep = ({ id, unit, step = 1 }: { id: string; unit?: string; step?: number }) => { const x = e[id]; if (!x) return null; const v = num(x) ?? 0;
    return <div className="numstep"><span className="grow">{name(x).replace(/^Flexit vifte /, "")}</span><button className="icon-btn ghost sm" onClick={() => svc("number", "set_value", id, { value: v - step })}><Minus size={13} /></button><b>{v}{unit ?? String(x.attributes.unit_of_measurement ?? "")}</b><button className="icon-btn ghost sm" onClick={() => svc("number", "set_value", id, { value: v + step })}><Plus size={13} /></button></div>; };
  return (
    <motion.div className="page luft-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="page-head"><h1 className="page-title">Luft</h1><div className="grow" />
        <button className="btn sm ghost" onClick={togglePin}>{pinned ? <PinOff size={14} /> : <Pin size={14} />} {pinned ? "Løsne fra Hjem" : "Fest til Hjem"}</button></div>

      <section className={`card luft-hero ${preset !== "off" ? "on" : ""}`}>
        <header className="row"><span className={`card-ic ${preset !== "off" ? "spin-slow" : ""}`}><AirVent size={18} /></span><div className="grow"><h3>Flexit ventilasjon</h3><span className="muted small">{fan?.state === "unavailable" ? "Offline" : "Hovedvifte .203 · koblet vifte følger"}{boostOn ? " · Boost pågår" : ""}</span></div>
          {filterDue && <span className="chip warn"><AlertTriangle size={12} /> Filter</span>}</header>
        <div className="luft-stats">
          <div><span className="big">{num(s("humidity")) ?? "–"}<small>%</small></span><span className="lbl"><Droplets size={12} /> Fukt</span></div>
          <div><span className="big">{num(s("fan_1_speed")) ?? 0}<small>rpm</small></span><span className="lbl"><Wind size={12} /> Vifte</span></div>
          <div><span className="big">{num(n("manual_speed")) ?? "–"}<small>%</small></span><span className="lbl"><Gauge size={12} /> Manuell</span></div>
          <div><span className="big small-t">{String(s("airflow")?.state ?? "–").replace("ventilation", "Ventilasjon").replace("heat_recovery", "Varmegjenvinning")}</span><span className="lbl">Luftstrøm</span></div>
        </div>
        <div className="seg-pills big">{SPEED.map(([k, l]) => <button key={k} className={preset === k ? "on" : ""} disabled={!fan || fan.state === "unavailable"} onClick={() => k === "off" ? svc("fan", "turn_off", FAN) : svc("fan", "set_preset_mode", FAN, { preset_mode: k })}>
          {preset === k && <motion.span layoutId="luft-pill" className="seg-pill-bg" />}<span>{l}</span></button>)}</div>
        <div className="luft-actions">
          {timer && <div className="seg-mini"><Timer size={14} /> {(timer.attributes.options as string[] ?? []).map((o) => <button key={o} className={`chip ${timer.state === o ? "on" : ""}`} onClick={() => svc("select", "select_option", timer.entity_id, { option: o })}>{({ off: "Ingen timer", night: "Natt", party: "Boost" } as Record<string, string>)[o] ?? o}</button>)}</div>}
          {e[`select.${P}airflow`] && <div className="seg-mini"><Wind size={14} /> {(e[`select.${P}airflow`]!.attributes.options as string[] ?? []).map((o) => <button key={o} className={`chip ${e[`select.${P}airflow`]!.state === o ? "on" : ""}`} onClick={() => svc("select", "select_option", `select.${P}airflow`, { option: o })}>{({ ventilation: "Ventilasjon", heat_recovery: "Gjenvinning", air_supply: "Tilluft" } as Record<string, string>)[o] ?? o}</button>)}</div>}
        </div>
      </section>

      <div className="widgets two">
        <section className="card"><h3><CalendarClock size={15} /> Ukeplan og hastigheter</h3>
          <label className="toggle-row"><span className="grow">Ukeplan <span className="muted small">{s("weekly_schedule")?.state === "Disabled" ? "av" : s("schedule_speed")?.state}</span></span><input type="checkbox" className="switch" checked={sw("weekly_schedule")?.state === "on"} onChange={(x) => svc("switch", x.target.checked ? "turn_on" : "turn_off", `switch.${P}weekly_schedule`)} /></label>
          {["supply_speed_low", "exhaust_speed_low", "supply_speed_medium", "exhaust_speed_medium", "supply_speed_high", "exhaust_speed_high", "boost_time"].map((k) => <NumStep key={k} id={`number.${P}${k}`} />)}
          <p className="muted tiny">Detaljert ukeplan (tider per dag) settes i Flexit Fans-appen.</p></section>
        <section className="card"><h3><Droplets size={15} /> Fuktboost og filter</h3>
          <label className="toggle-row"><span className="grow">Fuktboost ved dusj <span className={`chip static ${humActive ? "on" : ""}`}>{humActive ? "Aktiv nå" : humAuto?.state === "on" ? "Klar" : "Av"}</span></span><input type="checkbox" className="switch" checked={humAuto?.state === "on"} onChange={(x) => svc("automation", x.target.checked ? "turn_on" : "turn_off", "automation.flexit_humidity_boost_shower")} /></label>
          <div className="muted small">Fuktendring: {e["sensor.flexit_fan_humidity_rate"]?.state ?? "–"} %/min</div>
          <NumStep id={`number.${P}humidity_threshold`} />
          <label className="toggle-row"><span className="grow">Viftens egen fuktsensor-boost</span><input type="checkbox" className="switch" checked={sw("humidity_sensor")?.state === "on"} onChange={(x) => svc("switch", x.target.checked ? "turn_on" : "turn_off", `switch.${P}humidity_sensor`)} /></label>
          <div className={`filter-box ${filterDue ? "due" : ""}`}><span className="grow"><b>Filter</b><span className="muted small">{filterDue ? "Bytte nødvendig" : `${s("filter_remaining")?.state ?? "–"} % igjen`} · intervall {num(n("filter_timer_setpoint")) ?? "–"} d</span></span>
            <button className="btn sm" onClick={() => { if (confirm("Bekreft at filteret er byttet? Dette nullstiller filtertimeren.")) void call({ domain: "script", service: "turn_on", target: { entity_id: "script.flexit_filter_replaced" } }); }}><RotateCcw size={13} /> Filter byttet</button></div>
</section>
      </div>

      <VentZones />

      <section className="section"><div className="row"><h2 className="section-title grow">Inneklima per rom</h2><div className="seg-mini">{([[24, "24 t"], [168, "7 d"]] as const).map(([h, l]) => <button key={h} className={`chip ${range === h ? "on" : ""}`} onClick={() => setRange(h)}>{l}</button>)}</div></div>
        <div className="climate-grid">{rooms.map(([r, list]) => <div key={r} className="card clim">
          <h3>{r}</h3>{list.map((x) => { const dc = String(x.attributes.device_class); const v = num(x); const warn = dc === "humidity" && v != null && (v < 30 || v > 60);
            return <div key={x.entity_id} className="clim-row"><span className="clim-ic">{dc === "humidity" ? <Droplets size={13} /> : dc === "temperature" ? <Thermometer size={13} /> : <Gauge size={13} />}</span>
              <span className={`clim-v ${warn ? "warn" : ""}`}>{v ?? x.state}<small>{String(x.attributes.unit_of_measurement ?? "")}</small></span>
              <Sparkline points={hist[x.entity_id]} live={v ?? undefined} height={34} width={150} color={dc === "humidity" ? "var(--accent)" : "var(--warn, #f59e0b)"} /></div>; })}</div>)}</div>
        <p className="muted tiny">Fukt: 30–60 % er anbefalt. Viser alle temperatur-, fukt- og luftkvalitetssensorer (Aqara, termostater, Flexit, SmartThings).</p></section>

      <section className="section"><h2 className="section-title">Varme</h2>
        {heatState && <div className="seg-mini"><Flame size={14} /> {(heatState.attributes.options as string[]).map((o) => <button key={o} className={`chip ${heatState.state === o ? "on" : ""}`} onClick={() => svc("input_select", "select_option", heatState.entity_id, { option: o })}>{({ comfort: "Komfort", night: "Natt", away: "Borte", vacation: "Ferie", eco: "Eco" } as Record<string, string>)[o] ?? o}</button>)}</div>}
        <div className="climate-grid">{climates.map((c) => { const t = Number(c.attributes.temperature); const cur = Number(c.attributes.current_temperature); const st = Number(c.attributes.target_temp_step ?? 0.5);
          return <div key={c.entity_id} className={`card therm ${c.attributes.hvac_action === "heating" ? "on" : ""}`}><h3>{name(c).replace(/^Termostat /, "")}</h3>
            <div className="therm-row"><span className="big">{Number.isFinite(cur) ? cur.toFixed(1) : "–"}<small>°</small></span>
              <div className="therm-set"><button className="icon-btn ghost sm" onClick={() => svc("climate", "set_temperature", c.entity_id, { temperature: t - st })}><Minus size={13} /></button><b>{Number.isFinite(t) ? t : "–"}°</b><button className="icon-btn ghost sm" onClick={() => svc("climate", "set_temperature", c.entity_id, { temperature: t + st })}><Plus size={13} /></button></div></div>
            <span className="muted small">{c.attributes.hvac_action === "heating" ? "Varmer" : c.state === "off" ? "Av" : "Holder"}</span></div>; })}
          <div className="card therm placeholder"><h3><Snowflake size={14} /> Panasonic varmepumpe</h3><span className="muted small">Integrasjon kommer. Her får du modus, temperatur, vifte og energibruk når den er koblet til.</span><span className="chip static"><Zap size={12} /> Kommer</span></div>
        </div></section>
    </motion.div>
  );
}
/** Compact air card for Home when pinned. */
export function LuftCard({ open }: { open: () => void }) {
  const { entities: e } = useSnapshot(); const [pinned] = useLuftPinned(); const zones = useVentZones(); if (!pinned) return null;
  const fan = e[FAN]; const hum = num(e[`sensor.${P}humidity`]);
  return <section className="card luft-mini" role="button" onClick={open}><span className="card-ic"><AirVent size={17} /></span><span className="grow"><b>Luft</b><span className="muted small"> · {hum ?? "–"} % fukt · vifte {String(fan?.attributes.preset_mode ?? "av")}{zones.length ? ` · ${ventSummary(zones)}` : ""}</span></span></section>;
}
