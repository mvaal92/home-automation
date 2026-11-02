import { BarnCard } from "./Barn";
import { LuftCard } from "./Luft";
import { motion } from "motion/react";
import { House, Settings2, Sparkles, X } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { domainOf, isOn, num, type EntityMap, type Room } from "@home/core";
import { useAppliances, useCall, useCameras, useDismissed, useHealth, useHelpers, useHomeMode, useQuickActions, useRooms, useSnapshot, useVisibleEntities } from "../lib/home";
import { CameraTile } from "../components/CameraTile";
import { ApplianceCard } from "../components/ApplianceCard";
import { humanize, stateLabel } from "../lib/format";
import { modeIcon, sceneIcon } from "../lib/icons";
import { Tile } from "../components/Tile";
import { item, list } from "../lib/motion";
import { MediaCard, RoomCard, VentCard } from "./Widgets";
import { Pinned, SectionHead } from "./Pinned";
import { NotesCard } from "./Notes";
import { MaintenanceCard } from "./Maintenance";
import { useCollapsed, type CardSize } from "../lib/prefs";
import { useEdit } from "../lib/layout";
import { EditGrid, PinBadge, type EgItem } from "../components/EditMode";
import { Bot, MoonStar } from "lucide-react";
import { startHvile } from "../lib/hvile";
import { TodayCard } from "./Kalender";
import { NowCard, Suggestions } from "./Now";
import "./hjem.css";

/** One calm sentence summarising the home, e.g. "3 lights on · 21.4° inside · Front door locked · 2.1 kW". */
export function useStatusLine(): string[] {
  const visible = useVisibleEntities();
  const rooms = useRooms();
  return statusParts(visible, rooms);
}

export function statusParts(entities: EntityMap, rooms: Room[]): string[] {
  const parts: string[] = [];
  const all = Object.values(entities);
  const lightsOn = all.filter((e) => domainOf(e.entity_id) === "light" && e.state === "on").length;
  parts.push(lightsOn === 0 ? "Alle lys av" : `${lightsOn} lys på`);
  const indoor = rooms.filter((r) => r.temperature !== undefined && !/balcon|balkong|outdoor|ute/i.test(r.id + r.name));
  if (indoor.length) parts.push(`${(indoor.reduce((a, r) => a + (r.temperature ?? 0), 0) / indoor.length).toFixed(1)}° inne`);
  const weather = all.find((e) => domainOf(e.entity_id) === "weather");
  const out = num(weather?.attributes.temperature);
  if (out !== undefined) parts.push(`${out.toFixed(0)}° ute`);
  const locks = all.filter((e) => domainOf(e.entity_id) === "lock");
  if (locks.length) {
    const open = locks.filter((l) => l.state !== "locked").length;
    parts.push(open ? `${open} ulåst` : locks.length === 1 ? "Døren er låst" : "Alle dører låst");
  }
  return parts;
}

export function Dashboard({ openRoom, openDevice, openSettings, openNotes, openMaintenance, unread, openNotif }: { openRoom: (id: string) => void; openDevice: (id: string) => void; openSettings?: () => void; openNotes?: () => void; openMaintenance?: () => void; unread?: number; openNotif?: () => void }) {
  const allRooms = useRooms();
  const rooms = allRooms.filter((r) => r.controls.length + r.sensors.length > 0);
  const emptyAreas = allRooms.length - rooms.length;
  const snap = useSnapshot();
  const cams = useCameras();
  const apps = useAppliances();
  const loading = Object.keys(snap.entities).length === 0 && (snap.status === "connecting" || snap.status === "reconnecting" || snap.status === "idle");
  const c = { scenes: useCollapsed("scenes")[0], widgets: useCollapsed("widgets")[0], cameras: useCollapsed("cameras")[0], rooms: useCollapsed("rooms")[0], active: useCollapsed("active")[0] };
  const ed = useEdit();
  if (loading) return <DashboardSkeleton />;
  const T = (k: string, d: string) => ed.title(`home.${k}`, d);
  const running = apps.filter((a) => a.machineState === "run" || a.machineState === "pause");
  const active = rooms.flatMap((r) => r.controls.filter((c) => isOn(snap.entities[c.id]) && !["climate", "lock", "camera"].includes(c.domain)));
  const appliancesByArea = new Map<string, string>();
  for (const a of apps) if (a.areaId) appliancesByArea.set(a.areaId, a.machineState === "run" ? `${a.name} · ${humanize(a.job ?? "går").toLowerCase()}` : a.machineState === "pause" ? `${a.name} på pause` : a.machineState === "unavailable" ? `${a.name} frakoblet` : `${a.name} klar`);
  const cards: Record<string, ReactNode> = {
    naa: <motion.div variants={item}><NowCard /></motion.div>,
    forslag: <motion.div variants={item}><Suggestions unread={unread} openNotif={openNotif} /></motion.div>,
    pinned: (
      <motion.div variants={item}><Pinned openDevice={openDevice} title={T("pinned", "Festet")} /></motion.div>
    ),
    kalender: (
      <motion.div variants={item}><TodayCard /></motion.div>
    ),
    barnluft: (
      <motion.div variants={item} className="home-duo"><BarnCard open={() => { location.hash = "#/barn"; }} /><LuftCard open={() => { location.hash = "#/luft"; }} /></motion.div>
    ),
    notes: (
      <motion.div variants={item}><NotesCard openAll={() => openNotes?.()} /></motion.div>
    ),
    maintenance: (
      <motion.div variants={item}><MaintenanceCard openAll={() => openMaintenance?.()} /></motion.div>
    ),
    mode: (
      <motion.div variants={item} className="hero-row"><HomeModeControl /></motion.div>
    ),
    health: (
      <motion.div variants={item}><Health openDevice={openDevice} /></motion.div>
    ),
    scenes: (
      <motion.section variants={item} className="section">
        <SectionHead id="scenes" title={T("scenes", "Scener")} />
        {!c.scenes && <Scenes />}
      </motion.section>
    ),
    widgets: (
      <motion.section variants={item} className="section">
        <SectionHead id="widgets" title={T("widgets", "Klima og media")} />
        {!c.widgets && <div className="widgets two"><VentCard openDevice={openDevice} /><MediaCard openDevice={openDevice} /></div>}
      </motion.section>
    ),
    cameras: cams.length > 0 && (
        <motion.section variants={item} className="section">
          <SectionHead id="cameras" title={T("cameras", cams[0]!.doorbell ? "Ved døren" : "Kameraer")} />
          {!c.cameras && <div className={`cameras n${Math.min(cams.length, 3)}`}>
            {cams.slice(0, 3).map((c, i) => <CameraTile key={c.id} cam={c} onOpen={openDevice} wide={i === 0 && cams.length > 1} />)}
          </div>}
        </motion.section>
      ),
    rooms: (
      <motion.section variants={item} className="section">
        <SectionHead id="rooms" title={T("rooms", "Rom")} count={rooms.length} />
        {c.rooms ? null : rooms.length === 0 ? <EmptyHome openSettings={openSettings} /> : (
          <div className="room-grid">
            {rooms.map((r) => <RoomCard key={r.id} room={r} sub={roomSummary(r, snap.entities, appliancesByArea.get(r.id), true)} onOpen={() => openRoom(r.id)} />)}
          </div>
        )}
        {emptyAreas > 0 && rooms.length > 0 && <p className="footnote">{emptyAreas} {emptyAreas === 1 ? "tomt område" : "tomme områder"} skjult</p>}
      </motion.section>
    ),
    active: active.length + running.length > 0 && (
        <motion.section variants={item} className="section">
          <SectionHead id="active" title={T("active", "Aktive")} count={active.length + running.length} />
          {!c.active && <div className="tiles">
            {running.map((a) => <ApplianceCard key={a.key} a={a} onOpen={openDevice} />)}
            {active.map((x) => <Tile key={x.id} id={x.id} name={x.name} onOpen={openDevice} />)}
          </div>}
        </motion.section>
      ),
    kids: <motion.div variants={item}><BarnCard open={() => { location.hash = "#/barn"; }} /></motion.div>,
    air: <motion.div variants={item}><LuftCard open={() => { location.hash = "#/luft"; }} /></motion.div>,
    music: <motion.div variants={item}><MediaCard openDevice={openDevice} /></motion.div>,
    robots: <motion.div variants={item}><RobotsMini /></motion.div>,
    hvile: <motion.div variants={item}><HvileTile /></motion.div>,
    automation: (
      <motion.div variants={item}><Automation title={T("automation", "Automatikk")} /></motion.div>
    ),
  };
  const L = ed.layout;
  const added = new Set(L.addedCards ?? []);
  const keys = HOME_CARDS.filter((k) => !OPTIONAL_CARDS.includes(k) || added.has(k));
  const items: EgItem[] = keys.filter((k) => cards[k]).map((k) => ({ key: k, label: T(k, CARD_LABEL[k] ?? k), hint: CARD_HINT[k], node: <Fragment>{cards[k]}</Fragment>,
    titleKey: TITLED.includes(k) ? `home.${k}` : undefined, size: (CARD_DEFAULT_SIZE[k] ?? "full") as CardSize }));
  const onChange = (n: { order?: string[]; hidden?: string[]; size?: Record<string, CardSize> }, why: string) => {
    const f: Record<string, unknown> = {};
    if (n.order) f.homeOrder = n.order;
    if (n.size) f.cardSize = n.size;
    if (n.hidden) {
      const h = n.hidden.filter((k) => !OPTIONAL_CARDS.includes(k));
      const drop = n.hidden.filter((k) => OPTIONAL_CARDS.includes(k));
      f.hiddenCards = h;
      if (drop.length) f.addedCards = [...added].filter((k) => !drop.includes(k));
    }
    void ed.patch(f, why);
  };
  const available = OPTIONAL_CARDS.filter((k) => !added.has(k)).map((k) => ({ key: k, label: CARD_LABEL[k]!, hint: CARD_HINT[k],
    add: () => void ed.patch({ addedCards: [...added, k], hiddenCards: (L.hiddenCards ?? []).filter((x) => x !== k), homeOrder: [k, ...(L.homeOrder ?? []).filter((x) => x !== k)] }, `la til ${CARD_LABEL[k]}`) }));
  return (
    <motion.div className="page hjem" variants={list} initial="hidden" animate="show">
      <EditGrid tab="home" label="Hjem" items={items} order={withNew(L.homeOrder)} hidden={L.hiddenCards} sizes={L.cardSize} onChange={onChange} available={available} />
    </motion.div>
  );
}

/** House-wide mode (input_select.home_mode) as a quiet segmented control. */
const MODE_LABEL: Record<string, string> = { Home: "Hjemme", Away: "Borte", Night: "Natt", Vacation: "Ferie", Guest: "Gjest" };

function HomeModeControl() {
  const mode = useHomeMode();
  const call = useCall();
  if (!mode || mode.options.length < 2) return null;
  return (
    <div className="modes" role="radiogroup" aria-label="Hjemmemodus">
      {mode.options.map((o) => {
        const Icon = modeIcon(o);
        const on = o === mode.current;
        return (
          <button key={o} role="radio" aria-checked={on} className={`mode ${on ? "on" : ""}`}
            onClick={() => { if (!on) void call({ domain: "input_select", service: "select_option", target: { entity_id: mode.entityId }, data: { option: o } }); }}>
            {on && <motion.span layoutId="mode-pill" className="mode-pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <Icon size={14} strokeWidth={1.75} /><span className="mode-label">{MODE_LABEL[o] ?? o}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Automation switches (helpers) live here, never among devices. */
function Automation({ title }: { title: string }) {
  const helpers = useHelpers();
  const call = useCall();
  if (helpers.length === 0) return null;
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      <div className="helper-list">
        {helpers.map((h) => (
          <div key={h.id} className="helper-row">
            <span className="helper-name">{h.name}</span>
            {h.kind === "schedule" ? (
              <span className={`helper-state ${h.on ? "on" : ""}`}>{h.on ? "Aktiv nå" : "Ikke aktiv"}</span>
            ) : (
              <button className={`switch sm ${h.on ? "on" : ""}`} role="switch" aria-checked={h.on} aria-label={h.name}
                onClick={() => void call({ domain: "input_boolean", service: h.on ? "turn_off" : "turn_on", target: { entity_id: h.id } })}>
                <span className="switch-knob" />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="page hjem skeleton" aria-busy="true" aria-label="Laster hjemmet">
      <div className="now-grid">{[0, 1, 2, 3].map((i) => <span key={i} className="now-tile sk-tile"><span className="sk sk-line sm" style={{ width: 70 }} /><span className="sk sk-line" style={{ width: `${55 + i * 9}%`, height: 18 }} /><span className="sk sk-line sm" style={{ width: "40%" }} /></span>)}</div>
      <div className="sk-cards">{[0, 1].map((i) => <span key={i} className="card sk-card"><span className="sk sk-line" style={{ width: 110 }} />{[0, 1, 2].map((j) => <span key={j} className="sk sk-line sm" style={{ width: `${60 + ((i + j) * 13) % 30}%` }} />)}</span>)}</div>
    </div>
  );
}

function EmptyHome({ openSettings }: { openSettings?: () => void }) {
  return (
    <div className="empty-state">
      <span className="empty-mark"><House size={22} strokeWidth={1.5} /></span>
      <h3>Klar for rom</h3>
      <p>Rom hentes fra områder i Home Assistant. Legg enheter i et område, så dukker de opp her.</p>
      <div className="row gap center">
        {openSettings && <button className="btn" onClick={openSettings}><Settings2 size={15} strokeWidth={1.75} /> Tilkobling</button>}
        <a className="btn ghost" href="?mock"><Sparkles size={15} strokeWidth={1.75} /> Prøv demohjemmet</a>
      </div>
    </div>
  );
}

function Scenes() {
  const actions = useQuickActions();
  const call = useCall();
  const snap = useSnapshot();
  if (actions.length === 0) return null;
  const scenes = actions.filter((a) => a.kind === "scene");
  const routines = actions.filter((a) => a.kind === "routine");
  const pill = (s: (typeof actions)[number]) => {
    const Icon = sceneIcon(snap.entities[s.id], s.name);
    return (
      <span key={s.id} className="pin-badge-host" role="listitem"><motion.button className={`pill-btn ${s.kind}`} whileTap={{ scale: 0.96 }} transition={{ duration: 0.12 }}
        onClick={() => void call({ domain: s.domain, service: "turn_on", target: { entity_id: s.id } })}>
        <Icon size={14} strokeWidth={1.75} /> {s.name}
      </motion.button><PinBadge id={s.id} /></span>
    );
  };
  return (
    <div className="scenes" role="list" aria-label="Scener og rutiner">
      {scenes.map(pill)}
      {routines.filter((r) => !/^script\.(leave_home|arrive_home|bedtime|all_off)$/.test(r.id)).map(pill)}
    </div>
  );
}

function Health({ openDevice }: { openDevice: (id: string) => void }) {
  const all = useHealth();
  const [dismissed, setDismissed] = useDismissed();
  const [open, setOpen] = useState(false);
  const issues = all.filter((i) => !dismissed.has(i.key));
  if (issues.length === 0) return null;
  const shown = open ? issues : issues.slice(0, 3);
  return (
    <div className={`health ${open ? "open" : ""}`}>
      <span className="health-head"><span className="dot warn" />{issues.length} {issues.length === 1 ? "enhet trenger" : "enheter trenger"} tilsyn</span>
      <span className="health-items">
        {shown.map((i) => (
          <span key={i.key} className="health-item">
            <button className="link" onClick={() => openDevice(i.entityId)}>{i.name} <span className="muted">{i.kind === "unavailable" ? "frakoblet" : i.detail.replace(/battery/i, "batteri").replace(/\blow\b/i, "lavt").toLowerCase()}</span></button>
            <button className="health-x" aria-label={`Skjul ${i.name}`} title="Kjent frakoblet – skjul" onClick={() => setDismissed(i.key, true)}><X size={12} strokeWidth={2} /></button>
          </span>
        ))}
        {issues.length > 3 && <button className="link muted" onClick={() => setOpen(!open)}>{open ? "Vis færre" : `+${issues.length - 3}`}</button>}
      </span>
    </div>
  );
}

function roomSummary(room: Room, entities: EntityMap, extra?: string, compact = false): string {
  const bits: string[] = [];
  if (extra) bits.push(extra);
  if (room.temperature !== undefined && !compact) bits.push(`${room.temperature.toFixed(1)}°`);
  if (room.humidity !== undefined) bits.push(`${room.humidity.toFixed(0)}%`);
  const lights = room.controls.filter((c) => c.domain === "light").length;
  if (lights && !compact) bits.push(room.lightsOn ? `${room.lightsOn} av ${lights} lys på` : "Lys av");
  const cams = room.controls.filter((c) => c.domain === "camera").length;
  if (cams) bits.push(cams === 1 ? "Kamera" : `${cams} kameraer`);
  // Name the few other devices ("TV off · Sonos playing") instead of a vague count.
  const named = room.controls.filter((c) => !["light", "camera", "climate"].includes(c.domain));
  const offline = named.filter((c) => entities[c.id]?.state === "unavailable");
  const online = named.filter((c) => entities[c.id]?.state !== "unavailable");
  if (online.length > 0 && online.length <= 2) {
    for (const c of online) { const e = entities[c.id]; if (e) bits.push(`${c.name} ${stateLabel(e).toLowerCase()}`); }
  } else if (online.length > 2) bits.push(`${online.length} andre enheter`);
  if (offline.length === 1) bits.push(`${offline[0]!.name} frakoblet`);
  else if (offline.length > 1) bits.push(`${offline.length} frakoblet`);
  if (!room.controls.length && room.sensors.length && !extra) bits.push(`${room.sensors.length} sensor${room.sensors.length === 1 ? "" : "er"}`);
  return bits.join(" · ");
}

/** Phone "Rooms" tab: the whole house as a list. */
export function RoomsPage({ openRoom }: { openRoom: (id: string) => void }) {
  const rooms = useRooms().filter((r) => r.controls.length + r.sensors.length > 0);
  const snap = useSnapshot();
  const ed = useEdit();
  const pg = ed.page("rooms");
  return (
    <motion.div className="page" variants={list} initial="hidden" animate="show">
      <motion.h1 variants={item} className="page-title">Rom</motion.h1>
      <motion.p variants={item} className="muted rooms-sub">{rooms.reduce((t, r) => t + r.lightsOn, 0)} lys på i {rooms.length} rom</motion.p>
      <motion.div variants={item}>
        <EditGrid tab="rooms" label="Rom" variant="flow" className="rooms-page-grid"
          items={rooms.map((r) => ({ key: r.id, label: r.name, node: <RoomCard room={r} sub={roomSummary(r, snap.entities, undefined, true)} onOpen={() => openRoom(r.id)} /> }))}
          order={pg.order} hidden={pg.hidden} sizes={pg.size} onChange={(n, why) => void ed.patchPage("rooms", { ...pg, ...n }, why)} />
      </motion.div>
    </motion.div>
  );
}

/** Home card ids, in the order the assistant (or the owner) chose; hidden ones removed. */
export const HOME_CARDS = ["naa", "forslag", "pinned", "kalender", "barnluft", "notes", "maintenance", "mode", "health", "scenes", "widgets", "cameras", "rooms", "active", "automation", "kids", "air", "robots", "music", "hvile"];
/** Extra cards that only show once added from «Legg til kort». */
export const OPTIONAL_CARDS = ["kids", "air", "robots", "music", "hvile"];
const CARD_LABEL: Record<string, string> = { naa: "Nå", forslag: "Forslag", pinned: "Festet", kalender: "I dag (kalender)", barnluft: "Barn og luft", notes: "Notater", maintenance: "Vedlikehold", mode: "Modus og vær", health: "Varsler fra enheter",
  scenes: "Scener", widgets: "Klima og media", cameras: "Kameraer", rooms: "Rom", active: "Aktive", automation: "Automatikk", kids: "Barn", air: "Luft", robots: "Roboter", music: "Musikk", hvile: "Hvilemodus" };
const CARD_HINT: Record<string, string> = { naa: "Modus, neste avtale, aktivt og sikkerhet", forslag: "Tips etter tid på dagen – kjører aldri selv", pinned: "Rutiner og lys", kalender: "Dagens og kommende avtaler", kids: "Skole og barnehage", air: "Ventilasjon og fukt", robots: "Støvsuger og gressklipper", music: "Det som spilles nå", hvile: "Ett trykk til rolig kunst og klokke", scenes: "Scener og rutiner", rooms: "Alle rom" };
const TITLED = ["pinned", "scenes", "widgets", "cameras", "rooms", "active", "automation"];
const CARD_DEFAULT_SIZE: Record<string, string> = { kalender: "m", barnluft: "m", notes: "m", maintenance: "m", kids: "m", air: "m", robots: "m", music: "m" };
/** New cards (Nå, Forslag) go first for layouts saved before they existed; a saved order is otherwise respected. */
const NEW_TOP = ["naa", "forslag"];
const withNew = (o?: string[]) => !o ? o : [...NEW_TOP.filter((k) => !o.includes(k)), ...o];

/** One-tap resting screen (Hvileskjerm). Display only – never touches devices. */
function HvileTile() {
  return (
    <button className="card hvile-tile" onClick={() => startHvile()} aria-label="Hvilemodus – vis hvileskjermen nå">
      <span className="hvile-tile-ic"><MoonStar size={20} strokeWidth={1.6} /></span>
      <span className="hvile-tile-txt"><b>Hvilemodus</b><span className="muted small">Rolig kunst, klokke og vær</span></span>
    </button>
  );
}

/** Read-only robot status; tap opens the Roboter tab (never sends commands). */
function RobotsMini() {
  const { entities } = useSnapshot();
  const bots = Object.values(entities).filter((e) => /^(vacuum|lawn_mower)\./.test(e.entity_id));
  return (
    <button className="card robots-mini" onClick={() => { location.hash = "#/robots"; }}>
      <span className="section-title"><Bot size={14} /> Roboter</span>
      {bots.length === 0 ? <span className="muted small">Ingen roboter funnet</span> :
        bots.slice(0, 3).map((b) => <span key={b.entity_id} className="robots-mini-row"><b>{String(b.attributes.friendly_name ?? b.entity_id)}</b><span className="muted">{stateLabel(b)}</span></span>)}
    </button>
  );
}
