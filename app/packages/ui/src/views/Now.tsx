import { motion, useReducedMotion } from "motion/react";
import { Bell, CalendarDays, CloudRain, DoorOpen, Home as HomeIcon, Lightbulb, Lock, LockOpen, Moon, Music2, ShieldCheck, Sparkles, Sun, Sunset, Thermometer, Users, ChevronRight, type LucideIcon } from "lucide-react";
import { domainOf, type EntityState } from "@home/core";
import { useCall, useHomeMode, useNow, useQuickActions, useRooms, useSnapshot } from "../lib/home";
import { ALARM, MODE, hhmm, useChips, useNextEvent, useWeather } from "../components/TopBar";

/** «Nå»: four glanceable read-only tiles – who's home / mode, next event, what's on, security. Taps only navigate. */
const rel = (iso: string, now: number) => { const m = Math.round((new Date(iso).getTime() - now) / 60000); return m <= 0 ? "nå" : m < 60 ? `om ${m} min` : m < 24 * 60 ? `om ${Math.round(m / 60)} t` : new Date(iso).toLocaleDateString("nb-NO", { weekday: "long" }); };
const name = (e: EntityState) => String(e.attributes.friendly_name ?? e.entity_id);

function Tile({ icon: I, label, value, sub, tone = "", onClick }: { icon: LucideIcon; label: string; value: string; sub?: string; tone?: string; onClick?: () => void }) {
  const C = onClick ? "button" : "div";
  return (
    <C className={`now-tile ${tone}`} onClick={onClick}>
      <span className="now-top"><span className="now-ic"><I size={15} strokeWidth={1.8} aria-hidden /></span><span className="now-label">{label}</span>{onClick && <ChevronRight size={14} className="now-go" aria-hidden />}</span>
      <span className="now-value">{value}</span>
      {sub && <span className="now-sub">{sub}</span>}
    </C>
  );
}

export function NowCard() {
  const { entities } = useSnapshot();
  const now = useNow(30_000);
  const mode = useHomeMode();
  const rooms = useRooms();
  const next = useNextEvent();
  const c = useChips(entities);
  const all = Object.values(entities);
  const people = all.filter((e) => domainOf(e.entity_id) === "person");
  const home = people.filter((p) => p.state === "home");
  const playing = all.filter((e) => domainOf(e.entity_id) === "media_player" && e.state === "playing");
  const robots = all.filter((e) => /^(vacuum|lawn_mower)\./.test(e.entity_id) && /cleaning|mowing|returning/.test(e.state));
  const modeLabel = mode ? MODE[mode.current] ?? mode.current : "Hjemme";
  const who = people.length ? (home.length === 0 ? "Ingen hjemme" : home.length === people.length ? "Alle er hjemme" : `${home.length} av ${people.length} hjemme`) : undefined;
  const active = [c.lights ? `${c.lights} lys` : null, playing.length ? `${playing.length} spiller` : null, robots.length ? `${robots.length} robot${robots.length === 1 ? "" : "er"} i gang` : null].filter(Boolean) as string[];
  const indoor = rooms.filter((r) => r.temperature !== undefined && !/balcon|balkong|outdoor|ute/i.test(r.id + r.name));
  const hum = rooms.filter((r) => r.humidity !== undefined && !/balcon|balkong|outdoor|ute/i.test(r.id + r.name));
  const secureBad = c.alarm?.state === "triggered";
  const secWarn = c.unlocked > 0 || c.open.length > 0;
  const secValue = secureBad ? "Alarm utløst" : c.unlocked ? `${c.unlocked} ulåst` : c.open.length ? `${c.open.length} åpen` : c.locks ? (c.locks === 1 ? "Låst" : "Alt låst") : c.doors ? "Dører lukket" : c.alarm ? ALARM[c.alarm.state] ?? c.alarm.state : "Ingen låser";
  const secSub = [c.alarm && !secureBad ? ALARM[c.alarm.state] ?? c.alarm.state : null, c.open.length ? c.open.map(name).slice(0, 2).join(", ") : c.doors && (c.unlocked || c.locks) ? "Dører lukket" : null].filter(Boolean).join(" · ") || undefined;
  return (
    <section className="now" aria-label="Nå">
      <h2 className="section-title now-h">Nå</h2>
      <div className="now-grid">
        <Tile icon={people.length ? Users : HomeIcon} label="Hjemme" value={who ?? modeLabel} sub={who ? `Modus: ${modeLabel.toLowerCase()}` : undefined} tone={mode && mode.current !== "Home" ? "accent" : ""} />
        <Tile icon={CalendarDays} label="Neste" value={next ? (next.allDay ? "I dag" : hhmm(next.start)) : "Ingen avtaler"} sub={next ? `${next.allDay ? "" : rel(next.start, now) + " · "}${next.title}` : "Resten av dagen er fri"} onClick={() => { location.hash = "#/kalender"; }} />
        <Tile icon={active.length ? (playing.length && !c.lights ? Music2 : Lightbulb) : Lightbulb} label="Aktivt" value={active.length ? active[0]! : "Alt er av"} sub={active.slice(1).join(" · ") || (c.lights ? "Trykk for rom" : "Ingen lys på")} tone={c.lights ? "on" : ""} onClick={() => { location.hash = "#/rooms"; }} />
        {c.locks || c.doors || c.alarm ? <Tile icon={secureBad ? ShieldCheck : c.unlocked ? LockOpen : c.open.length ? DoorOpen : Lock} label="Sikkerhet" value={secValue} sub={secSub} tone={secureBad ? "bad" : secWarn ? "warn" : "good"} />
          : <Tile icon={Thermometer} label="Inne" value={indoor.length ? `${(indoor.reduce((a, r) => a + (r.temperature ?? 0), 0) / indoor.length).toFixed(1).replace(".", ",")}°` : "–"}
              sub={hum.length ? `${Math.round(hum.reduce((a, r) => a + (r.humidity ?? 0), 0) / hum.length)} % fukt i snitt` : `${indoor.length} rom`} onClick={() => { location.hash = "#/luft"; }} />}
      </div>
    </section>
  );
}

type Sug = { key: string; icon: LucideIcon; text: string; sub?: string; act?: { label: string; run: () => void } ; go?: () => void };

/** Contextual suggestions from time of day + state. Never acts on its own: a scene only runs when someone taps «Kjør». */
export function Suggestions({ unread = 0, openNotif }: { unread?: number; openNotif?: () => void }) {
  const { entities } = useSnapshot();
  const now = new Date(useNow(60_000));
  const h = now.getHours();
  const actions = useQuickActions();
  const call = useCall();
  const wx = useWeather();
  const next = useNextEvent();
  const c = useChips(entities);
  const still = useReducedMotion();
  const find = (re: RegExp) => actions.find((a) => re.test(`${a.id} ${a.name}`));
  const runIt = (a: (typeof actions)[number]) => () => void call({ domain: a.domain, service: "turn_on", target: { entity_id: a.id } });
  const out: Sug[] = [];
  if (h >= 18 && h < 23 && c.lights > 0) { const s = find(/kveld|evening|dim|koselig|cozy|relax/i); out.push({ key: "kveld", icon: Sunset, text: "Kveld: dim lysene", sub: `${c.lights} lys på`, act: s ? { label: "Kjør", run: runIt(s) } : undefined, go: s ? undefined : () => { location.hash = "#/rooms"; } }); }
  if ((h >= 23 || h < 5) && c.lights > 0) { const s = find(/god ?natt|good ?night|bedtime|leggetid|natt/i); out.push({ key: "natt", icon: Moon, text: "Sent: slå av lysene?", sub: `${c.lights} lys er fortsatt på`, act: s ? { label: "Kjør", run: runIt(s) } : undefined, go: s ? undefined : () => { location.hash = "#/rooms"; } }); }
  if (h >= 5 && h < 10) { const s = find(/morgen|morning/i); if (s) out.push({ key: "morgen", icon: Sun, text: "God morgen-scene", sub: "Lys og stemning for morgenen", act: { label: "Kjør", run: runIt(s) } }); }
  if ((h >= 22 || h < 6) && c.unlocked > 0) out.push({ key: "las", icon: LockOpen, text: `${c.unlocked} lås er ulåst`, sub: "Lås før natta", go: () => { location.hash = "#/rooms"; } });
  if (next && !next.allDay) { const m = (new Date(next.start).getTime() - now.getTime()) / 60000; if (m > 0 && m <= 90) out.push({ key: "ev", icon: CalendarDays, text: `${next.title} ${rel(next.start, now.getTime())}`, sub: `Kl. ${hhmm(next.start)}`, go: () => { location.hash = "#/kalender"; } }); }
  if (wx?.rainAt) out.push({ key: "regn", icon: CloudRain, text: `Regn fra kl. ${hhmm(wx.rainAt)}`, sub: "Husk regntøy til barna" });
  if (unread > 0) out.push({ key: "varsel", icon: Bell, text: `${unread} uleste ${unread === 1 ? "varsel" : "varsler"}`, sub: "Åpne varslene", go: openNotif });
  if (out.length === 0) return null;
  return (
    <section className="sug" aria-label="Forslag">
      <h2 className="section-title"><Sparkles size={13} aria-hidden /> Forslag <span className="sug-note">skjer aldri automatisk</span></h2>
      <div className="sug-row" role="list">
        {out.slice(0, 4).map((s, i) => { const Ic = s.icon; return (
          <motion.div key={s.key} role="listitem" className={`sug-item ${s.go ? "link" : ""}`} initial={still ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i, duration: 0.25 }}
            onClick={s.go} onKeyDown={(e) => { if (s.go && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); s.go(); } }} tabIndex={s.go ? 0 : undefined}>
            <span className="sug-ic"><Ic size={16} strokeWidth={1.8} aria-hidden /></span>
            <span className="sug-txt"><b>{s.text}</b>{s.sub && <span>{s.sub}</span>}</span>
            {s.act && <button className="btn sm sug-btn" onClick={(e) => { e.stopPropagation(); s.act!.run(); }}>{s.act.label}</button>}
          </motion.div>); })}
      </div>
    </section>
  );
}
