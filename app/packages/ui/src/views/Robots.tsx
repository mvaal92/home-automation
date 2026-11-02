import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { BatteryCharging, Bot, CircleAlert, Droplets, Gauge, History, Home as HomeIcon, Map as MapIcon, Pause, Play, Sparkles, Trees, Wrench, Zap } from "lucide-react";
import { domainOf, friendlyName, num, type EntityState } from "@home/core";
import { useCall, useSnapshot } from "../lib/home";
import { item, list } from "../lib/motion";
import "./Robots.css";

type Room = { id: number; name: string; key?: string };
const V_STATE: Record<string, string> = { cleaning: "Rengjør", docked: "I dokken", paused: "Pauset", returning: "På vei hjem", idle: "Klar", error: "Feil", unavailable: "Utilgjengelig", unknown: "Ukjent" };
const M_STATE: Record<string, string> = { mowing: "Klipper", docked: "I ladestasjon", paused: "Pauset", returning: "På vei hjem", error: "Feil", unavailable: "Utilgjengelig" };
const MODE_NB: Record<string, string> = { Quick: "Rask", Auto: "Auto", "Deep Clean": "Dyprens", Quiet: "Stille", "Low Energy": "Sparemodus", AutoMop: "Vask (mopp)" };
/** rough floor-plan footprint per room so the grid reads like a map */
const SHAPE: Record<string, string> = { livingroom: "wide tall", livingroom2: "wide", kitchen: "wide", diningroom: "", corridor: "wide", bathroom: "", boxroom: "", room8: "" };
const ago = (iso?: string) => { if (!iso) return ""; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? "nå" : m < 60 ? `${m} min siden` : m < 1440 ? `${Math.round(m / 60)} t siden` : `${Math.round(m / 1440)} d siden`; };

export function useRobots() {
  const { entities } = useSnapshot();
  return useMemo(() => {
    const all = Object.values(entities);
    const vacs = all.filter((e) => domainOf(e.entity_id) === "vacuum").sort((a, b) => Number(b.attributes.battery_level !== undefined) - Number(a.attributes.battery_level !== undefined));
    const mowers = all.filter((e) => domainOf(e.entity_id) === "lawn_mower");
    return { vacuum: vacs[0] as EntityState | undefined, mower: mowers[0] as EntityState | undefined, all, entities };
  }, [entities]);
}

function roomsOf(v?: EntityState): Room[] {
  const r = v?.attributes.rooms as unknown;
  if (Array.isArray(r)) return r as Room[];
  if (r && typeof r === "object") return Object.values(r as Record<string, Room[]>).flat(); // Tasshack: {map: [{id,name}]}
  return [];
}

export function RobotsPage() {
  const { vacuum, mower } = useRobots();
  const [tab, setTab] = useState<"vacuum" | "mower">(vacuum || !mower ? "vacuum" : "mower");
  return (
    <motion.div className="page robots-page" variants={list} initial="hidden" animate="show">
      <motion.div variants={item} className="robots-head"><h1 className="page-title">Roboter</h1>
        <div className="seg robot-tabs">
          <button className={tab === "vacuum" ? "on active" : ""} onClick={() => setTab("vacuum")}><Bot size={14} /> Støvsuger</button>
          <button className={tab === "mower" ? "on active" : ""} onClick={() => setTab("mower")}><Trees size={14} /> Gressklipper</button>
        </div>
      </motion.div>
      {tab === "vacuum" ? <VacuumView v={vacuum} /> : <MowerView m={mower} />}
    </motion.div>
  );
}

function VacuumView({ v }: { v?: EntityState }) {
  const call = useCall();
  const { all } = useRobots();
  const [sel, setSel] = useState<number[]>([]);
  if (!v) return <section className="card"><h3><Bot size={16} /> Ingen robotstøvsuger funnet</h3><p className="muted">Dreame-integrasjonen er ikke koblet til ennå.</p></section>;
  const id = v.entity_id; const st = v.state; const a = v.attributes;
  const rooms = roomsOf(v);
  const source = String(a.source ?? (id.includes("dreame") ? "dreame" : ""));
  const cam = all.find((e) => domainOf(e.entity_id) === "camera" && /dreame|x50|vacuum/i.test(e.entity_id) && !/saved|wifi/i.test(e.entity_id));
  const consumables = all.filter((e) => domainOf(e.entity_id) === "sensor" && /dreame|x50/i.test(e.entity_id) && /(brush|filter|mop|pad|sensor|left)/i.test(e.entity_id) && e.attributes.unit_of_measurement === "%");
  const extra = all.filter((e) => /dreame|x50/i.test(e.entity_id) && ["select", "switch", "button", "number"].includes(domainOf(e.entity_id)) && e.state !== "unavailable").slice(0, 24);
  const presets = all.filter((e) => /^script\.(stovsug|vask_gulv|dreame_til)/.test(e.entity_id));
  const errorText = all.find((e) => /dreame.*error/i.test(e.entity_id))?.state;
  const speeds = (a.fan_speed_list as string[] | undefined) ?? [];
  const svc = (service: string, data: Record<string, unknown> = {}) => void call({ domain: "vacuum", service, data, target: { entity_id: id } });
  const cleanRooms = (ids: number[]) => {
    if (!ids.length) return;
    if (source === "smartthings") void call({ domain: "script", service: "turn_on", data: { variables: { rooms: ids } }, target: { entity_id: "script.dreame_rengjor_rom" } });
    else void call({ domain: "dreame_vacuum", service: "vacuum_clean_segment", data: { segments: ids }, target: { entity_id: id } });
    setSel([]);
  };
  const toggle = (rid: number) => setSel((s) => s.includes(rid) ? s.filter((x) => x !== rid) : [...s, rid]);
  const battery = num(a.battery_level);
  return <>
    <motion.section variants={item} className="robot-hero">
      <div className={`robot-orb ${st === "cleaning" || st === "returning" ? "active" : ""}`}><Bot size={30} strokeWidth={1.5} /></div>
      <div><h2>{friendlyName(v)}</h2>
        <div className="robot-state">{V_STATE[st] ?? st}{a.fan_speed ? ` · ${MODE_NB[String(a.fan_speed)] ?? a.fan_speed}` : ""}{battery !== undefined ? ` · ${battery} %` : ""} · {ago(v.last_changed)}</div>
        {(st === "error" || errorText && errorText !== "no_error") && <div className="notice bad small"><CircleAlert size={14} /> {errorText ?? "Støvsugeren rapporterer en feil"}</div>}
      </div>
      <div className="robot-actions">
        {st === "cleaning" ? <button className="btn" onClick={() => svc("pause")}><Pause size={15} /> Pause</button>
          : <button className="btn primary" onClick={() => svc("start")}><Play size={15} /> {st === "paused" ? "Fortsett" : "Start"}</button>}
        <button className="btn" onClick={() => svc("return_to_base")}><HomeIcon size={15} /> Til dokken</button>
      </div>
    </motion.section>

    <motion.section variants={item} className="robot-map">
      {cam ? <img src={`/ha${String(cam.attributes.entity_picture ?? "")}`} alt="Kart" /> : (
        <div className="floorplan" role="group" aria-label="Rom">
          {rooms.map((r) => <button key={r.id} className={`fp-room ${SHAPE[r.key ?? ""] ?? ""} ${sel.includes(r.id) ? "sel" : ""}`} onClick={() => toggle(r.id)} aria-pressed={sel.includes(r.id)}>
            <span className="fp-name">{r.name}</span><span className="fp-meta">{sel.includes(r.id) ? `Valgt #${sel.indexOf(r.id) + 1}` : `Rom ${r.id}`}</span></button>)}
          {rooms.length === 0 && <p className="muted" style={{ gridColumn: "1 / -1" }}>Ingen rom rapportert ennå.</p>}
        </div>)}
      {cam && rooms.length > 0 && <div className="floorplan">{rooms.map((r) => <button key={r.id} className={`fp-room ${sel.includes(r.id) ? "sel" : ""}`} onClick={() => toggle(r.id)}><span className="fp-name">{r.name}</span></button>)}</div>}
      <div className="map-bar"><MapIcon size={15} className="muted" />
        <span className="grow muted small">{sel.length ? `${sel.length} rom valgt – rengjøres i valgt rekkefølge` : cam ? "Live kart · trykk rom under for å rengjøre" : "Trykk på rom for å velge"}</span>
        {sel.length > 0 && <button className="btn sm" onClick={() => setSel([])}>Nullstill</button>}
        <button className="btn sm primary" disabled={!sel.length} onClick={() => cleanRooms(sel)}><Sparkles size={13} /> Rengjør valgte</button>
      </div>
    </motion.section>

    <motion.div variants={item} className="robot-grid">
      {speeds.length > 0 && <section className="card"><h3><Gauge size={15} /> Modus</h3>
        <div className="mode-grid">{speeds.map((s) => <button key={s} className={a.fan_speed === s ? "on" : ""} onClick={() => svc("set_fan_speed", { fan_speed: s })}>{MODE_NB[s] ?? s}</button>)}</div>
        <p className="footnote">«Vask (mopp)» lar roboten velge mopp og vannmengde selv.</p></section>}

      <section className="card"><h3><Sparkles size={15} /> Hurtigvalg</h3>
        <div className="preset-list">{presets.map((p) => <button key={p.entity_id} onClick={() => void call({ domain: "script", service: "turn_on", target: { entity_id: p.entity_id } })}>
          {/vask/.test(p.entity_id) ? <Droplets size={15} /> : /dokk/.test(p.entity_id) ? <HomeIcon size={15} /> : <Bot size={15} />} {friendlyName(p)}</button>)}</div>
        <p className="footnote">Kan festes på forsiden via «Rediger» under Pinned.</p></section>

      <section className="card"><h3><Wrench size={15} /> Forbruksdeler</h3>
        {consumables.length ? consumables.map((c) => { const p = num(c.state) ?? 0; return <div key={c.entity_id} className="consumable"><span>{friendlyName(c).replace(/^Dreame X50 Ultra /i, "")}</span><span className="muted">{p} %</span><div className="bar"><i className={p < 15 ? "low" : ""} style={{ width: `${p}%` }} /></div></div>; })
          : <p className="muted small">Børster, filter og mopp-pads vises her når Dreame-skykontoen er koblet til.</p>}</section>

      <VacuumHistory id={id} />

      {extra.length > 0 && <section className="card"><h3><Zap size={15} /> Dokk og innstillinger</h3>
        {extra.map((e) => domainOf(e.entity_id) === "button" ? <button key={e.entity_id} className="btn sm" onClick={() => void call({ domain: "button", service: "press", target: { entity_id: e.entity_id } })}>{friendlyName(e)}</button>
          : <div key={e.entity_id} className="kv"><span>{friendlyName(e)}</span><span className="muted">{e.state}</span></div>)}</section>}
    </motion.div>
    {source === "smartthings" && <p className="footnote">Koblet via SmartThings (Matter): start, pause, dokk, rom og modus. Live kart, forbruksdeler, vannmengde og tømming av dokk kommer når Dreame-kontoen er logget inn.</p>}
  </>;
}

function VacuumHistory({ id }: { id: string }) {
  const [rows, setRows] = useState<Array<{ when: string; state: string }>>([]);
  useEffect(() => {
    const start = new Date(Date.now() - 7 * 864e5).toISOString();
    fetch(`/ha/api/history/period/${start}?filter_entity_id=${id}&minimal_response&no_attributes`).then((r) => r.ok ? r.json() : []).then((d: Array<Array<{ state: string; last_changed: string }>>) => {
      setRows((d[0] ?? []).filter((x, i, arr) => i === 0 || x.state !== arr[i - 1]!.state).reverse().slice(0, 8).map((x) => ({ when: x.last_changed, state: x.state })));
    }).catch(() => undefined);
  }, [id]);
  return <section className="card"><h3><History size={15} /> Historikk (7 dager)</h3>
    <div className="timeline">{rows.length ? rows.map((r) => <div key={r.when}><span>{V_STATE[r.state] ?? r.state}</span><span className="muted">{new Date(r.when).toLocaleString("nb-NO", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span></div>) : <span className="muted small">Ingen aktivitet registrert ennå.</span>}</div></section>;
}

function MowerView({ m }: { m?: EntityState }) {
  const call = useCall();
  const { all } = useRobots();
  if (!m) return <section className="card"><h3><Trees size={16} /> Navimow er ikke koblet til ennå</h3>
    <p className="muted">Den offisielle Navimow-integrasjonen er installert i Home Assistant, men trenger én innlogging med Navimow-kontoen din. Da dukker status, batteri, posisjon og start/pause/dokk opp her automatisk.</p></section>;
  const id = m.entity_id; const st = m.state;
  const rel = all.filter((e) => e.entity_id !== id && /navimow|mower|gressklipper/i.test(e.entity_id));
  const battery = num(rel.find((e) => e.attributes.device_class === "battery")?.state ?? m.attributes.battery_level);
  const tracker = rel.find((e) => domainOf(e.entity_id) === "device_tracker");
  const cam = rel.find((e) => domainOf(e.entity_id) === "camera" || domainOf(e.entity_id) === "image");
  const svc = (service: string) => void call({ domain: "lawn_mower", service, target: { entity_id: id } });
  return <>
    <motion.section variants={item} className="robot-hero">
      <div className="battery-ring" style={{ ["--p" as string]: battery ?? 0 }}><span>{battery !== undefined ? `${battery}%` : <BatteryCharging size={18} />}</span></div>
      <div><h2>{friendlyName(m)}</h2><div className="robot-state">{M_STATE[st] ?? st} · {ago(m.last_changed)}</div>
        {st === "error" && <div className="notice bad small"><CircleAlert size={14} /> Klipperen rapporterer en feil</div>}</div>
      <div className="robot-actions">
        {st === "mowing" ? <button className="btn" onClick={() => svc("pause")}><Pause size={15} /> Pause</button> : <button className="btn primary" onClick={() => svc("start_mowing")}><Play size={15} /> Start klipping</button>}
        <button className="btn" onClick={() => svc("dock")}><HomeIcon size={15} /> Til ladestasjon</button>
      </div>
    </motion.section>
    {cam && <section className="robot-map"><img src={`/ha${String(cam.attributes.entity_picture ?? "")}`} alt="Kart" /></section>}
    <div className="robot-grid">
      {tracker && <section className="card"><h3><MapIcon size={15} /> Posisjon</h3><div className="kv"><span>Breddegrad</span><span className="muted">{String(tracker.attributes.latitude ?? "–")}</span></div><div className="kv"><span>Lengdegrad</span><span className="muted">{String(tracker.attributes.longitude ?? "–")}</span></div></section>}
      <section className="card"><h3><Gauge size={15} /> Status</h3>{rel.filter((e) => domainOf(e.entity_id) === "sensor").map((e) => <div key={e.entity_id} className="kv"><span>{friendlyName(e)}</span><span className="muted">{e.state}{e.attributes.unit_of_measurement ? ` ${e.attributes.unit_of_measurement}` : ""}</span></div>)}</section>
    </div>
  </>;
}
