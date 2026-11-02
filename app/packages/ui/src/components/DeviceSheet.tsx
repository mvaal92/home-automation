import { useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  BatteryMedium, Home as HomeIcon, Lock, LockOpen, Pause, Play, Power, SkipBack, SkipForward, Volume2, VolumeX, AlertTriangle,
} from "lucide-react";
import { brightnessPct, domainOf, friendlyName, num, supportsBrightness, supportsColorTemp, UNAVAILABLE, type EntityState } from "@home/core";
import { Sheet } from "./Sheet";
import { Slider } from "./Slider";
import { Sparkline } from "./Sparkline";
import { ThermostatDial } from "./ThermostatDial";
import { usePin, pinnable } from "../lib/prefs";
import { Pin, PinOff } from "lucide-react";
import { useCall, useCameras, useEntity, useHistory, useNow, useSnapshot, useThrottled } from "../lib/home";
import { useCameraImage } from "./CameraTile";
import { entityIcon } from "../lib/icons";
import { ago, kelvinToRgb, lightColor, sensorValue, stateLabel } from "../lib/format";

type Call = ReturnType<typeof useCall>;

export function DeviceSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const e = useEntity(id);
  const Icon = id ? entityIcon(e, id) : HomeIcon;
  return (
    <Sheet open={Boolean(id)} onClose={onClose} title={e ? friendlyName(e) : id} subtitle={stateLabel(e)} icon={<Icon size={22} />}>
      {id && pinnable(id) && <PinButton id={id} />}
      {id && e && <Controls e={e} />}
    </Sheet>
  );
}

function PinButton({ id }: { id: string }) {
  const [on, toggle] = usePin(id);
  return <button className={`btn sm pin-btn ${on ? "on" : ""}`} onClick={toggle}>{on ? <><PinOff size={14} /> Unpin from dashboard</> : <><Pin size={14} /> Pin to dashboard</>}</button>;
}

function Controls({ e }: { e: EntityState }) {
  const call = useCall();
  if (UNAVAILABLE.has(e.state) && e.state === "unavailable") {
    return <div className="notice warn"><AlertTriangle size={16} /> This device is unavailable. Check its power or connection.</div>;
  }
  switch (domainOf(e.entity_id)) {
    case "light": return <LightControls e={e} call={call} />;
    case "climate": return <ClimateControls e={e} call={call} />;
    case "media_player": return <MediaControls e={e} call={call} />;
    case "lock": return <LockControls e={e} call={call} />;
    case "vacuum": return <VacuumControls e={e} call={call} />;
    case "sensor": case "binary_sensor": return <SensorDetail e={e} />;
    case "camera": return <CameraDetail id={e.entity_id} />;
    case "select": case "event": case "update": case "number": return <div className="notice">{stateLabel(e)}</div>;
    default: return <SwitchControls e={e} call={call} />;
  }
}

function PowerButton({ on, onClick, label }: { on: boolean; onClick: () => void; label?: string }) {
  return (
    <button className={`power-btn ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on}>
      <Power size={20} /> <span>{label ?? (on ? "På" : "Av")}</span>
    </button>
  );
}

function LightControls({ e, call }: { e: EntityState; call: Call }) {
  const id = e.entity_id;
  const on = e.state === "on";
  const pct = brightnessPct(e);
  const minK = num(e.attributes.min_color_temp_kelvin) ?? 2200;
  const maxK = num(e.attributes.max_color_temp_kelvin) ?? 6500;
  const k = num(e.attributes.color_temp_kelvin) ?? 2700;
  const sendB = useThrottled<number>((v) => void call({ domain: "light", service: "turn_on", data: { brightness_pct: v }, target: { entity_id: id } }), 150);
  const sendK = useThrottled<number>((v) => void call({ domain: "light", service: "turn_on", data: { color_temp_kelvin: v }, target: { entity_id: id } }), 150);
  const presets = [2200, 2700, 3500, 4500, 6000].filter((x) => x >= minK && x <= maxK);
  return (
    <div className="ctl ctl-light">
      <div className="light-stage">
        <motion.div className="light-glow" animate={{ opacity: on ? 0.25 + pct / 140 : 0, scale: on ? 0.8 + pct / 300 : 0.6 }} style={{ background: lightColor(e) }} />
        {supportsBrightness(e) ? (
          <Slider vertical className="light-slider" value={on ? pct : 0} min={0} max={100} onChange={(v, f) => sendB(v, f)} fillColor={lightColor(e)} ariaLabel="Lysstyrke"
            label={<span className="big-num">{on ? pct : 0}<small>%</small></span>} />
        ) : <PowerButton on={on} onClick={() => void call({ domain: "light", service: on ? "turn_off" : "turn_on", target: { entity_id: id } })} />}
      </div>
      <div className="ctl-side">
        <PowerButton on={on} onClick={() => void call({ domain: "light", service: on ? "turn_off" : "turn_on", target: { entity_id: id } })} />
        {supportsColorTemp(e) && (
          <div className="field">
            <label>Fargetemperatur <span className="muted">{on ? `${k} K` : ""}</span></label>
            <Slider value={k} min={minK} max={maxK} step={50} onChange={(v, f) => sendK(v, f)} showFill={false} ariaLabel="Fargetemperatur"
              track={`linear-gradient(90deg, ${kelvinToRgb(minK)}, ${kelvinToRgb((minK + maxK) / 2)}, ${kelvinToRgb(maxK)})`} />
            <div className="chips">
              {presets.map((p) => (
                <button key={p} className={`chip swatch ${on && Math.abs(k - p) < 100 ? "active" : ""}`} style={{ background: kelvinToRgb(p) }}
                  aria-label={`${p} K`} onClick={() => void call({ domain: "light", service: "turn_on", data: { color_temp_kelvin: p }, target: { entity_id: id } })} />
              ))}
            </div>
          </div>
        )}
        <div className="chips">
          {[10, 40, 70, 100].map((p) => (
            <button key={p} className="chip" onClick={() => void call({ domain: "light", service: "turn_on", data: { brightness_pct: p }, target: { entity_id: id } })}>{p}%</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClimateControls({ e, call }: { e: EntityState; call: Call }) {
  const id = e.entity_id;
  const modes = (Array.isArray(e.attributes.hvac_modes) ? e.attributes.hvac_modes : []) as string[];
  const send = useThrottled<number>((v) => void call({ domain: "climate", service: "set_temperature", data: { temperature: v }, target: { entity_id: id } }), 600);
  return (
    <div className="ctl ctl-climate">
      <ThermostatDial
        target={num(e.attributes.temperature) ?? 21} current={num(e.attributes.current_temperature)}
        min={num(e.attributes.min_temp) ?? 7} max={num(e.attributes.max_temp) ?? 35} step={num(e.attributes.target_temp_step) ?? 0.5}
        mode={e.state} action={typeof e.attributes.hvac_action === "string" ? e.attributes.hvac_action : undefined}
        onChange={(v, final) => final && send(v, true)}
      />
      <div className="chips center">
        {modes.map((m) => (
          <button key={m} className={`chip ${e.state === m ? "active" : ""}`} onClick={() => void call({ domain: "climate", service: "set_hvac_mode", data: { hvac_mode: m }, target: { entity_id: id } })}>
            {m.replace(/_/g, " ")}
          </button>
        ))}
      </div>
    </div>
  );
}

function MediaControls({ e, call }: { e: EntityState; call: Call }) {
  const id = e.entity_id;
  const vol = Math.round((num(e.attributes.volume_level) ?? 0) * 100);
  const muted = e.attributes.is_volume_muted === true;
  const playing = e.state === "playing";
  const off = e.state === "off" || e.state === "standby";
  const sendV = useThrottled<number>((v) => void call({ domain: "media_player", service: "volume_set", data: { volume_level: v / 100 }, target: { entity_id: id } }), 200);
  const sources = (Array.isArray(e.attributes.source_list) ? e.attributes.source_list : []) as string[];
  const svc = (service: string, data?: Record<string, unknown>) => void call({ domain: "media_player", service, data, target: { entity_id: id } });
  const pic = typeof e.attributes.entity_picture === "string" ? e.attributes.entity_picture : null;
  return (
    <div className="ctl ctl-media">
      <div className="media-card">
        <div className="media-art" style={pic ? { backgroundImage: `url(${pic})` } : undefined}>{!pic && <Volume2 size={34} />}</div>
        <div className="media-meta">
          <div className="media-title">{String(e.attributes.media_title ?? (off ? "Av" : "Ingenting spilles"))}</div>
          <div className="media-artist">{String(e.attributes.media_artist ?? e.attributes.media_series_title ?? e.attributes.source ?? "")}</div>
        </div>
      </div>
      <div className="media-transport">
        <button className="icon-btn lg" aria-label="Forrige" onClick={() => svc("media_previous_track")}><SkipBack size={22} /></button>
        <button className="icon-btn xl primary" aria-label={playing ? "Pause" : "Play"} onClick={() => svc(playing ? "media_pause" : "media_play")}>
          {playing ? <Pause size={28} /> : <Play size={28} />}
        </button>
        <button className="icon-btn lg" aria-label="Neste" onClick={() => svc("media_next_track")}><SkipForward size={22} /></button>
      </div>
      <div className="field row">
        <button className="icon-btn" aria-label={muted ? "Slå på lyd" : "Demp"} onClick={() => svc("volume_mute", { is_volume_muted: !muted })}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <Slider value={vol} onChange={(v, f) => sendV(v, f)} ariaLabel="Volum" className="grow" />
        <span className="muted tabnum">{vol}</span>
      </div>
      {sources.length > 0 && (
        <div className="chips">{sources.map((s) => <button key={s} className={`chip ${e.attributes.source === s ? "active" : ""}`} onClick={() => svc("select_source", { source: s })}>{s}</button>)}</div>
      )}
      <PowerButton on={!off} onClick={() => svc(off ? "turn_on" : "turn_off")} />
    </div>
  );
}

function LockControls({ e, call }: { e: EntityState; call: Call }) {
  const id = e.entity_id;
  const locked = e.state === "locked";
  const busy = e.state === "locking" || e.state === "unlocking";
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const battery = num(e.attributes.battery_level);
  const start = () => {
    if (!locked) { void call({ domain: "lock", service: "lock", target: { entity_id: id } }); return; }
    setHolding(true);
    timer.current = setTimeout(() => { setHolding(false); void call({ domain: "lock", service: "unlock", target: { entity_id: id } }); }, 900);
  };
  const cancel = () => { if (timer.current) clearTimeout(timer.current); setHolding(false); };
  return (
    <div className="ctl ctl-lock">
      <button className={`lock-btn ${locked ? "locked" : "unlocked"} ${busy ? "busy" : ""} ${holding ? "holding" : ""}`}
        onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} aria-label={locked ? "Hold for å låse opp" : "Lås"}>
        <span className="lock-ring" />
        {locked ? <Lock size={44} /> : <LockOpen size={44} />}
      </button>
      <p className="muted center">{busy ? `${e.state[0]!.toUpperCase()}${e.state.slice(1)}…` : locked ? "Hold to unlock" : "Tap to lock"}</p>
      {battery !== undefined && <p className={`center small ${battery <= 20 ? "warn-text" : "muted"}`}><BatteryMedium size={14} /> Battery {battery}%</p>}
    </div>
  );
}

function VacuumControls({ e, call }: { e: EntityState; call: Call }) {
  const id = e.entity_id;
  const svc = (service: string, data?: Record<string, unknown>) => void call({ domain: "vacuum", service, data, target: { entity_id: id } });
  const speeds = (Array.isArray(e.attributes.fan_speed_list) ? e.attributes.fan_speed_list : []) as string[];
  const battery = num(e.attributes.battery_level);
  const cleaning = e.state === "cleaning";
  return (
    <div className="ctl ctl-vacuum">
      <div className={`vac-orb ${cleaning ? "active" : ""}`}><div className="vac-core" /></div>
      <div className="media-transport">
        <button className="icon-btn xl primary" aria-label={cleaning ? "Pause" : "Start"} onClick={() => svc(cleaning ? "pause" : "start")}>{cleaning ? <Pause size={26} /> : <Play size={26} />}</button>
        <button className="icon-btn lg" aria-label="Tilbake til dokken" onClick={() => svc("return_to_base")}><HomeIcon size={22} /></button>
      </div>
      {battery !== undefined && <p className="center muted small"><BatteryMedium size={14} /> {battery}% · {String(e.attributes.status ?? e.state)}</p>}
      {speeds.length > 0 && (
        <div className="chips center">{speeds.map((s) => <button key={s} className={`chip ${e.attributes.fan_speed === s ? "active" : ""}`} onClick={() => svc("set_fan_speed", { fan_speed: s })}>{s}</button>)}</div>
      )}
    </div>
  );
}

function SwitchControls({ e, call }: { e: EntityState; call: Call }) {
  const id = e.entity_id;
  const dom = domainOf(id);
  const on = e.state === "on";
  const snap = useSnapshot();
  const power = useMemo(() => {
    const base = id.split(".")[1] ?? "";
    return Object.values(snap.entities).find((s) => s.entity_id.startsWith(`sensor.${base}`) && s.attributes.device_class === "power");
  }, [snap.entities, id]);
  return (
    <div className="ctl ctl-switch">
      <button className={`big-toggle ${on ? "on" : ""}`} onClick={() => void call({ domain: dom, service: on ? "turn_off" : "turn_on", target: { entity_id: id } })} aria-pressed={on}>
        <motion.span className="big-toggle-knob" layout transition={{ type: "spring", stiffness: 500, damping: 32 }} />
      </button>
      {power && <SensorDetail e={power} compact />}
    </div>
  );
}

function SensorDetail({ e, compact }: { e: EntityState; compact?: boolean }) {
  const h = useHistory([e.entity_id], 24);
  const v = num(e.state);
  return (
    <div className={`ctl ctl-sensor ${compact ? "compact" : ""}`}>
      <div className="sensor-big">{sensorValue(e)}</div>
      <div className="muted small">{compact ? `${friendlyName(e)} · ` : ""}Last 24 hours</div>
      {v !== undefined ? <Sparkline points={h[e.entity_id]} live={v} height={compact ? 70 : 140} width={400} /> : <div className="muted small">Ingen tallhistorikk</div>}
    </div>
  );
}

function CameraDetail({ id }: { id: string }) {
  const cam = useCameras().find((c) => c.id === id);
  const now = useNow();
  const src = useCameraImage(cam ?? { id, name: "", areaId: null, doorbell: false, available: false, picture: null, lastRing: null, motion: false }, 3000);
  if (!cam) return null;
  return (
    <div className="ctl">
      <div className="camera-still">{src ? <img src={src} alt={`${cam.name} kamera`} /> : <span className="camera-empty">{cam.available ? "Ingen bilde ennå" : "Kamera frakoblet"}</span>}</div>
      <dl className="kv">
        <dt>Status</dt><dd>{cam.available ? "Online · refreshes every 3 s" : "Offline"}</dd>
        {cam.doorbell && <><dt>Ringte sist</dt><dd>{cam.lastRing ? ago(cam.lastRing, now) : "—"}</dd></>}
        <dt>Bevegelse</dt><dd>{cam.motion ? "Oppdaget" : "Ingen"}</dd>
      </dl>
    </div>
  );
}
