import { motion } from "motion/react";
import { AirVent, CloudSun, Cloud, CloudRain, CloudSnow, Sun, Moon, CloudFog, Zap, Music2, Pause, Play, SkipForward, LogOut, LogIn, BedDouble, Power, Droplets, ChevronRight, Thermometer, Lightbulb } from "lucide-react";
import { domainOf, isOn, num, totalPower, type EntityMap, type EntityState, type Room } from "@home/core";
import { useCall, useSnapshot } from "../lib/home";
import { areaIcon } from "../lib/icons";
import { nbState } from "../lib/format";

const wxIcon = (s?: string) => !s ? CloudSun : /night/.test(s) ? Moon : /sunny/.test(s) ? Sun : /partly/.test(s) ? CloudSun : /rain|pour/.test(s) ? CloudRain : /snow/.test(s) ? CloudSnow : /fog/.test(s) ? CloudFog : Cloud;
const wxLabel: Record<string, string> = { "clear-night": "Klarvær", sunny: "Sol", partlycloudy: "Delvis skyet", cloudy: "Skyet", rainy: "Regn", pouring: "Kraftig regn", snowy: "Snø", fog: "Tåke", windy: "Vind", lightning: "Torden" };

export function WeatherChip() {
  const { entities } = useSnapshot();
  const w = Object.values(entities).find((e) => domainOf(e.entity_id) === "weather");
  if (!w) return null;
  const I = wxIcon(w.state);
  const t = num(w.attributes.temperature);
  return (
    <div className="wx" title={String(w.attributes.attribution ?? "")}>
      <I size={22} strokeWidth={1.5} />
      <span className="wx-t">{t !== undefined ? `${Math.round(t)}°` : "–"}</span>
      <span className="wx-d">{wxLabel[w.state] ?? w.state}<br /><span className="muted">{num(w.attributes.humidity) ?? "–"}% · {Math.round(num(w.attributes.wind_speed) ?? 0)} km/h</span></span>
    </div>
  );
}

const ROUTINES: Array<{ id: string; label: string; icon: typeof Power }> = [
  { id: "script.leave_home", label: "Leave", icon: LogOut },
  { id: "script.arrive_home", label: "Arrive", icon: LogIn },
  { id: "script.bedtime", label: "Bedtime", icon: BedDouble },
  { id: "script.all_off", label: "All off", icon: Power },
];

export function Routines() {
  const { entities } = useSnapshot();
  const call = useCall();
  const list = ROUTINES.filter((r) => entities[r.id]);
  if (!list.length) return null;
  return (
    <div className="routines" role="list" aria-label="Rutiner">
      {list.map((r) => {
        const running = entities[r.id]?.state === "on";
        return (
          <motion.button key={r.id} role="listitem" className={`routine ${running ? "running" : ""}`} whileTap={{ scale: 0.95 }}
            onClick={() => void call({ domain: "script", service: "turn_on", target: { entity_id: r.id } })}>
            <span className="routine-ic"><r.icon size={18} strokeWidth={1.75} /></span>
            <span>{r.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

const FAN = "fan.flexit_fan";
const SPEEDS = ["off", "low", "medium", "high"] as const;

export function VentCard({ openDevice }: { openDevice: (id: string) => void }) {
  const { entities: e } = useSnapshot();
  const call = useCall();
  const fan = e[FAN];
  if (!fan) return null;
  const preset = String(fan.attributes.preset_mode ?? fan.state);
  const hum = num(e["sensor.flexit_fan_flexit_fan_humidity"]?.state);
  const rpm = num(e["sensor.flexit_fan_flexit_fan_fan_1_speed"]?.state);
  const filter = e["binary_sensor.flexit_fan_flexit_fan_filter_replacement_status"]?.state === "on";
  const boost = e["sensor.flexit_fan_flexit_fan_boost_status"]?.state === "on";
  const off = fan.state === "unavailable";
  return (
    <div className={`card vent ${isOn(fan) ? "on" : ""}`}>
      <button className="card-head" onClick={() => openDevice(FAN)}>
        <span className={`card-ic ${isOn(fan) ? "spin-slow" : ""}`}><AirVent size={18} strokeWidth={1.75} /></span>
        <span className="card-title">Ventilasjon<span className="card-sub">Flexit · tilkoblet vifte følger</span></span>
        <ChevronRight size={16} className="muted" />
      </button>
      <div className="card-stats">
        <div><span className="big">{hum ?? "–"}<small>%</small></span><span className="lbl"><Droplets size={12} /> Fukt</span></div>
        <div><span className="big">{rpm ?? 0}<small>rpm</small></span><span className="lbl">{boost ? "Boost" : preset === "off" ? "Hvilemodus" : nbState(preset)}</span></div>
      </div>
      <div className="seg-pills" role="radiogroup" aria-label="Viftefart">
        {SPEEDS.map((s) => (
          <button key={s} role="radio" aria-checked={preset === s} disabled={off} className={preset === s ? "on" : ""}
            onClick={() => void call(s === "off" ? { domain: "fan", service: "turn_off", target: { entity_id: FAN } } : { domain: "fan", service: "set_preset_mode", target: { entity_id: FAN }, data: { preset_mode: s } })}>
            {preset === s && <motion.span layoutId="vent-pill" className="seg-pill-bg" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            <span>{s[0]!.toUpperCase() + s.slice(1)}</span>
          </button>
        ))}
      </div>
      <p className="card-foot">{filter ? <><span className="dot warn" /> Bytt filter – trykk «Filter byttet» etterpå</> : "Filter OK"}</p>
    </div>
  );
}

function mainPower(entities: EntityMap): number | undefined {
  const all = Object.values(entities);
  const main = all.find((x) => x.attributes.device_class === "power" && /total|forbruk|house|home|grid/i.test(`${x.entity_id} ${String(x.attributes.friendly_name)}`));
  return main ? num(main.state) : totalPower(entities);
}

export function EnergyCard() {
  const { entities } = useSnapshot();
  const w = mainPower(entities) ?? 0;
  const top = Object.values(entities)
    .filter((x) => x.attributes.device_class === "power" && (num(x.state) ?? 0) > 0)
    .sort((a, b) => (num(b.state) ?? 0) - (num(a.state) ?? 0)).slice(0, 3);
  const climate = Object.values(entities).filter((x) => domainOf(x.entity_id) === "climate" && x.state !== "unavailable");
  const heating = climate.filter((c) => c.attributes.hvac_action === "heating").length;
  return (
    <div className="card energy">
      <div className="card-head static">
        <span className="card-ic"><Zap size={18} strokeWidth={1.75} /></span>
        <span className="card-title">Strøm<span className="card-sub">Forbruk nå fra målte enheter</span></span>
      </div>
      <div className="card-stats">
        <div><span className="big">{w >= 1000 ? (w / 1000).toFixed(1) : Math.round(w)}<small>{w >= 1000 ? "kW" : "W"}</small></span><span className="lbl">Nå</span></div>
        <div><span className="big">{heating}<small>/{climate.length}</small></span><span className="lbl"><Thermometer size={12} /> Varmer</span></div>
      </div>
      <ul className="mini-list">
        {top.length ? top.map((x) => <li key={x.entity_id}><span>{String(x.attributes.friendly_name ?? x.entity_id).replace(/ Power$/, "")}</span><span className="tabnum">{Math.round(num(x.state) ?? 0)} W</span></li>)
          : <li className="muted">Ingenting trekker strøm akkurat nå</li>}
      </ul>
    </div>
  );
}

function pickPlayer(entities: EntityMap): EntityState | undefined {
  const players = Object.values(entities).filter((x) => domainOf(x.entity_id) === "media_player" && x.state !== "unavailable" && /sonos|arc|lydplanke/i.test(`${x.entity_id} ${String(x.attributes.friendly_name)}`));
  return players.find((p) => p.state === "playing") ?? players.find((p) => p.state === "paused") ?? players.find((p) => /arc/i.test(String(p.attributes.friendly_name))) ?? players[0];
}

export function MediaCard({ openDevice }: { openDevice: (id: string) => void }) {
  const { entities } = useSnapshot();
  const call = useCall();
  const p = pickPlayer(entities);
  if (!p) return null;
  const playing = p.state === "playing";
  const title = String(p.attributes.media_title ?? (p.state === "idle" ? "Ingenting spilles" : nbState(p.state)));
  const artist = String(p.attributes.media_artist ?? p.attributes.source ?? "");
  const art = p.attributes.entity_picture as string | undefined;
  return (
    <div className={`card media ${playing ? "on" : ""}`}>
      <button className="card-head" onClick={() => openDevice(p.entity_id)}>
        <span className="card-ic"><Music2 size={18} strokeWidth={1.75} /></span>
        <span className="card-title">{String(p.attributes.friendly_name)}<span className="card-sub">{playing ? "Spiller" : p.state === "paused" ? "Pauset" : "Klar"}</span></span>
        <ChevronRight size={16} className="muted" />
      </button>
      <div className="media-body">
        <div className="art">{art ? <img src={art} alt="" /> : <Music2 size={22} strokeWidth={1.5} />}{playing && <span className="eq"><i /><i /><i /></span>}</div>
        <div className="media-text"><strong>{title}</strong><span className="muted">{artist}</span></div>
        <button className="icon-btn primary round" aria-label={playing ? "Pause" : "Play"} onClick={() => void call({ domain: "media_player", service: "media_play_pause", target: { entity_id: p.entity_id } })}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="icon-btn ghost" aria-label="Neste" onClick={() => void call({ domain: "media_player", service: "media_next_track", target: { entity_id: p.entity_id } })}><SkipForward size={16} /></button>
      </div>
    </div>
  );
}

export function RoomCard({ room, onOpen, sub }: { room: Room; onOpen: () => void; sub: string }) {
  const Icon = areaIcon(room.icon, room.name);
  const call = useCall();
  const lights = room.controls.filter((c) => c.domain === "light").map((c) => c.id);
  const lit = room.lightsOn > 0;
  return (
    <motion.div layout className={`room-card ${lit ? "lit" : ""}`}>
      <button className="room-card-main" onClick={onOpen} aria-label={`Åpne ${room.name}`}>
        <span className="room-card-top">
          <span className="room-card-ic"><Icon size={18} strokeWidth={1.75} /></span>
          {room.temperature !== undefined && <span className="room-card-temp">{room.temperature.toFixed(1)}°</span>}
        </span>
        <span className="room-card-name">{room.name}</span>
        <span className="room-card-sub">{sub}</span>
      </button>
      {lights.length > 0 && (
        <button className={`room-card-light ${lit ? "on" : ""}`} aria-pressed={lit} aria-label={`${room.name} lights ${lit ? "off" : "on"}`}
          onClick={() => void call({ domain: "light", service: lit ? "turn_off" : "turn_on", target: { entity_id: lights } })}>
          <Lightbulb size={15} strokeWidth={1.75} /><span>{lit ? `${room.lightsOn}/${lights.length}` : "Av"}</span>
        </button>
      )}
    </motion.div>
  );
}
