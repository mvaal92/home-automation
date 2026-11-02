import { useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Droplets, Lightbulb, Thermometer, Minus, Plus, Pin, PinOff, Sparkles, ChevronRight } from "lucide-react";
import { brightnessPct, isOn, num, supportsBrightness, supportsColorTemp, type EntityState } from "@home/core";
import { useAppliances, useCall, useCameras, useEntity, useHistory, useRooms, useSnapshot, useThrottled } from "../lib/home";
import { Slider } from "../components/Slider";
import { usePin } from "../lib/prefs";
import { SectionHead } from "./Pinned";
import { lightColor, stateLabel } from "../lib/format";
import type { CSSProperties } from "react";
import { areaIcon, entityIcon } from "../lib/icons";
import { sensorValue } from "../lib/format";
import { Sparkline } from "../components/Sparkline";
import { Tile } from "../components/Tile";
import { CameraTile } from "../components/CameraTile";
import { ApplianceCard } from "../components/ApplianceCard";
import { fade } from "../lib/motion";

export function RoomView({ roomId, back, openDevice }: { roomId: string; back: () => void; openDevice: (id: string) => void }) {
  const room = useRooms().find((r) => r.id === roomId);
  const snap = useSnapshot();
  const call = useCall();
  const apps = useAppliances().filter((a) => a.areaId === roomId);
  const cams = useCameras().filter((c) => c.areaId === roomId);
  const appIds = new Set(apps.flatMap((a) => a.entityIds));
  const [showAll, setShowAll] = useState(false);
  const allSensors = room?.sensors.filter((s) => !appIds.has(s.id)) ?? [];
  // Sensors that belong to a controllable device (a TV's energy counters, a thermostat's power...) are
  // details, not headlines: show the climate/light/air basics first and tuck the rest behind "Show more".
  const controlDevices = new Set(room?.controls.map((c) => c.deviceId).filter(Boolean));
  const headline = (id: string, deviceId: string | null) => {
    const e = snap.entities[id];
    const dc = String(e?.attributes.device_class ?? "");
    if (["temperature", "humidity", "carbon_dioxide", "pm25", "motion", "occupancy", "door", "window", "moisture", "smoke", "battery"].includes(dc)) return true;
    if (dc === "power") return (num(e?.state) ?? 0) > 0;
    return !deviceId || !controlDevices.has(deviceId) ? !["energy"].includes(dc) || e?.attributes.state_class === "total_increasing" : false;
  };
  const primary = allSensors.filter((s) => headline(s.id, s.deviceId));
  const extraSensors = allSensors.filter((s) => !headline(s.id, s.deviceId));
  const expanded = showAll || primary.length === 0;
  const sensors = expanded ? [...primary, ...extraSensors] : primary;
  const numeric = allSensors.filter((s) => num(snap.entities[s.id]?.state) !== undefined).map((s) => s.id);
  const h = useHistory(numeric, 24);
  if (!room) return <div className="page"><button className="back" onClick={back}><ArrowLeft size={15} /> Oversikt</button><p className="empty">Fant ikke rommet.</p></div>;
  const controls = room.controls.filter((c) => c.domain !== "camera" && !appIds.has(c.id));
  const lights = controls.filter((c) => c.domain === "light").map((c) => c.id);
  const Icon = areaIcon(room.icon, room.name);
  const lit = room.lightsOn > 0;
  const group = (doms: string[]) => controls.filter((c) => doms.includes(c.domain));
  const lightCtl = group(["light"]);
  const climate = group(["climate"]);
  const fans = group(["fan"]);
  const media = group(["media_player", "remote"]);
  const scenes = group(["scene", "script"]);
  const known = new Set(["light", "climate", "fan", "media_player", "remote", "scene", "script"]);
  const other = controls.filter((c) => !known.has(c.domain));
  const onLights = lights.map((l) => snap.entities[l]).filter((e): e is EntityState => isOn(e));
  const avg = onLights.length ? Math.round(onLights.reduce((t, e) => t + brightnessPct(e), 0) / onLights.length) : 0;
  return (
    <motion.div className="page room-page" key={roomId} {...fade}>
      <button className="back" onClick={back}><ArrowLeft size={15} /> Tilbake</button>
      <header className={`room-hero ${lit ? "lit" : ""}`} style={{ "--glow": `${avg}%` } as CSSProperties}>
        <div className="room-hero-top">
          <span className="room-badge"><Icon size={22} strokeWidth={1.6} /></span>
          <div className="room-head-text">
            <h1 className="page-title">{room.name}</h1>
            <p className="room-meta">
              {room.temperature !== undefined && <span><Thermometer size={14} strokeWidth={1.75} />{room.temperature.toFixed(1)}°</span>}
              {room.humidity !== undefined && <span><Droplets size={14} strokeWidth={1.75} />{room.humidity.toFixed(0)}%</span>}
              {lights.length > 0 && <span className={lit ? "hi" : ""}><Lightbulb size={14} strokeWidth={1.75} />{lit ? `${room.lightsOn} of ${lights.length} on` : "Lights off"}</span>}
            </p>
          </div>
          {lights.length > 0 && (
            <button className={`switch lg ${lit ? "on" : ""}`} role="switch" aria-checked={lit} aria-label="Alle lys"
              onClick={() => void call({ domain: "light", service: lit ? "turn_off" : "turn_on", target: { entity_id: lights } })}><span className="switch-knob" /></button>
          )}
        </div>
        {lights.length > 0 && <MasterBrightness ids={lights} value={avg} />}
        {scenes.length > 0 && (
          <div className="room-scenes">
            {scenes.map((sc) => <motion.button key={sc.id} whileTap={{ scale: 0.96 }} className="pill-btn" onClick={() => void call({ domain: sc.domain, service: "turn_on", target: { entity_id: sc.id } })}><Sparkles size={13} /> {sc.name.replace(/^.*? · /, "")}</motion.button>)}
          </div>
        )}
      </header>
      {cams.length > 0 && (
        <section className="section">
          <h2 className="section-title">{cams.some((c) => c.doorbell) ? "Doorbell" : "Camera"}</h2>
          <div className={`cameras n${Math.min(cams.length, 3)}`}>{cams.map((c) => <CameraTile key={c.id} cam={c} onOpen={openDevice} />)}</div>
        </section>
      )}
      {lightCtl.length > 0 && (
        <section className="section">
          <SectionHead id={`room-${roomId}-lights`} title="Lights" count={lightCtl.length} />
          <div className="light-grid">{lightCtl.map((l) => <LightCard key={l.id} id={l.id} name={shortName(l.name, room.name)} onOpen={openDevice} />)}</div>
        </section>
      )}
      {climate.length > 0 && (
        <section className="section">
          <h2 className="section-title">Klima</h2>
          <div className="climate-grid">{climate.map((c) => <ClimateCard key={c.id} id={c.id} name={shortName(c.name, room.name)} onOpen={openDevice} />)}</div>
        </section>
      )}
      {[["Fans", fans], ["Media", media], ["Other devices", other]].map(([t, list]) => (list as typeof controls).length + (t === "Other devices" ? apps.length : 0) > 0 && (
        <section key={t as string} className="section">
          <h2 className="section-title">{t as string}</h2>
          <div className="tiles">
            {t === "Other devices" && apps.map((a) => <ApplianceCard key={a.key} a={a} onOpen={openDevice} />)}
            {(list as typeof controls).map((c) => <Tile key={c.id} id={c.id} name={shortName(c.name, room.name)} onOpen={openDevice} />)}
          </div>
        </section>
      ))}
      {allSensors.length > 0 && (
        <section className="section">
          <h2 className="section-title">Sensors{extraSensors.length > 0 && primary.length > 0 && <button className="section-action" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show less" : `Show ${extraSensors.length} more`}</button>}</h2>
          <div className="sensor-list">
            {sensors.map((s) => {
              const e = snap.entities[s.id];
              const I = entityIcon(e, s.id);
              const v = num(e?.state);
              return (
                <button key={s.id} className={`sensor-row ${e?.state === "unavailable" ? "unavailable" : ""}`} onClick={() => openDevice(s.id)}>
                  <I size={16} strokeWidth={1.75} className="muted" />
                  <span className="sensor-name">{shortName(s.name, room.name)}</span>
                  <span className="sensor-spark">{v !== undefined && varies(h[s.id]) && <Sparkline points={h[s.id]} live={v} height={22} width={120} fill={false} color="var(--fg-3)" />}</span>
                  <span className="sensor-value">{sensorValue(e)}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </motion.div>
  );
}

const varies = (pts: Array<{ v: number }> | undefined) => {
  const vals = (pts ?? []).map((p) => p.v).filter(Number.isFinite);
  return vals.length > 1 && Math.max(...vals) - Math.min(...vals) > 1e-6;
};

/** Drop a redundant room prefix: "Laundry room Washer Power" -> "Washer Power". */
function shortName(name: string, room: string): string {
  const n = name.startsWith(room + " ") ? name.slice(room.length + 1) : name;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function MasterBrightness({ ids, value }: { ids: string[]; value: number }) {
  const call = useCall();
  const send = useThrottled<number>((v) => void call(v <= 0 ? { domain: "light", service: "turn_off", target: { entity_id: ids } } : { domain: "light", service: "turn_on", data: { brightness_pct: v }, target: { entity_id: ids } }), 200);
  return (
    <div className="master-bright">
      <Slider value={value} min={0} max={100} onChange={(v, f) => send(v, f)} ariaLabel="Room brightness" fillColor="var(--accent)" />
      <span className="tabnum">{value}%</span>
    </div>
  );
}

const TEMPS = [{ k: 2700, label: "Warm" }, { k: 4000, label: "Neutral" }, { k: 6000, label: "Cool" }];
const COLOURS = [0, 30, 120, 210, 280];

function LightCard({ id, name, onOpen }: { id: string; name: string; onOpen: (id: string) => void }) {
  const e = useEntity(id);
  const call = useCall();
  const [pinned, togglePin] = usePin(id);
  const sendB = useThrottled<number>((v) => void call({ domain: "light", service: "turn_on", data: { brightness_pct: Math.max(1, v) }, target: { entity_id: id } }), 150);
  if (!e) return null;
  const on = isOn(e);
  const off = e.state === "unavailable";
  const modes = (e.attributes.supported_color_modes as string[] | undefined) ?? [];
  const colour = modes.some((m) => ["hs", "xy", "rgb", "rgbw", "rgbww"].includes(m));
  const k = num(e.attributes.color_temp_kelvin);
  return (
    <div className={`light-card ${on ? "on" : ""} ${off ? "unavailable" : ""}`} style={{ "--tint": on ? lightColor(e) : "var(--fg-3)" } as CSSProperties}>
      <div className="light-card-head">
        <button className="light-card-name" onClick={() => onOpen(id)}><Lightbulb size={16} strokeWidth={1.75} /><span>{name}<small>{stateLabel(e)}</small></span></button>
        <button className={`icon-btn ghost pin-mini ${pinned ? "on" : ""}`} aria-label={pinned ? "Unpin" : "Pin to dashboard"} title={pinned ? "Unpin" : "Pin to dashboard"} onClick={togglePin}>{pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
        <button className={`switch sm ${on ? "on" : ""}`} role="switch" aria-checked={on} disabled={off} aria-label={name}
          onClick={() => void call({ domain: "light", service: on ? "turn_off" : "turn_on", target: { entity_id: id } })}><span className="switch-knob" /></button>
      </div>
      {supportsBrightness(e) && !off && <Slider value={on ? brightnessPct(e) : 0} min={0} max={100} onChange={(v, f) => sendB(v, f)} ariaLabel={`${name} brightness`} fillColor={on ? lightColor(e) : "var(--fg-3)"} />}
      {!off && (supportsColorTemp(e) || colour) && (
        <div className="light-chips">
          {supportsColorTemp(e) && TEMPS.map((t) => (
            <button key={t.k} className={`chip ${on && k && Math.abs(k - t.k) < 400 ? "on" : ""}`} onClick={() => void call({ domain: "light", service: "turn_on", data: { color_temp_kelvin: t.k }, target: { entity_id: id } })}>{t.label}</button>
          ))}
          {colour && COLOURS.map((h) => (
            <button key={h} className="swatch" aria-label={`Hue ${h}`} style={{ background: `hsl(${h} 80% 60%)` }} onClick={() => void call({ domain: "light", service: "turn_on", data: { hs_color: [h, 80] }, target: { entity_id: id } })} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClimateCard({ id, name, onOpen }: { id: string; name: string; onOpen: (id: string) => void }) {
  const e = useEntity(id);
  const call = useCall();
  if (!e) return null;
  const cur = num(e.attributes.current_temperature);
  const target = num(e.attributes.temperature);
  const step = num(e.attributes.target_temp_step) ?? 0.5;
  const set = (t: number) => void call({ domain: "climate", service: "set_temperature", data: { temperature: Math.round(t / step) * step }, target: { entity_id: id } });
  const modes = ((e.attributes.hvac_modes as string[] | undefined) ?? []).filter((m) => ["off", "heat", "auto", "cool"].includes(m));
  const heating = e.attributes.hvac_action === "heating";
  return (
    <div className={`climate-card ${heating ? "heating" : ""} ${e.state === "unavailable" ? "unavailable" : ""}`}>
      <button className="climate-head" onClick={() => onOpen(id)}><Thermometer size={16} strokeWidth={1.75} /><span>{name}<small>{heating ? "Varmer" : stateLabel(e)}{cur !== undefined ? ` · ${cur.toFixed(1)}° now` : ""}</small></span><ChevronRight size={15} className="muted" /></button>
      {target !== undefined && (
        <div className="climate-set">
          <button className="icon-btn round" aria-label="Senk" onClick={() => set(target - step)}><Minus size={16} /></button>
          <span className="climate-target">{target.toFixed(1)}<small>°</small></span>
          <button className="icon-btn round" aria-label="Øk" onClick={() => set(target + step)}><Plus size={16} /></button>
        </div>
      )}
      {modes.length > 1 && (
        <div className="seg sm">
          {modes.map((m) => <button key={m} className={e.state === m ? "on" : ""} onClick={() => void call({ domain: "climate", service: "set_hvac_mode", data: { hvac_mode: m }, target: { entity_id: id } })}>{m[0]!.toUpperCase() + m.slice(1)}</button>)}
        </div>
      )}
    </div>
  );
}
