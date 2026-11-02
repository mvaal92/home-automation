import { useEffect, useState } from "react";
import { Sun, Moon, Cloud, CloudSun, CloudRain, CloudSnow, CloudFog, CloudLightning, Wind, Droplets } from "lucide-react";
import { domainOf, type EntityState } from "@home/core";
import { api } from "../lib/api";
import "./topbar.css";

/** Shared family top bar for Hjem: clock, date, outdoor weather and read-only status chips. No personal names. */
export type Wx = { condition: string; temp: number | null; high: number | null; low: number | null; precipNext6h: number; rainAt: string | null; wind: number | null; windUnit: string;
  hourly: { t: string; temp: number; cond: string; precip: number }[]; tomorrow: { cond: string; high: number; low: number | null } | null };
export const WX_LABEL: Record<string, string> = { "clear-night": "Klart", sunny: "Sol", partlycloudy: "Delvis skyet", cloudy: "Skyet", rainy: "Regn", pouring: "Kraftig regn", snowy: "Snø", "snowy-rainy": "Sludd",
  fog: "Tåke", windy: "Vind", "windy-variant": "Vind", lightning: "Torden", "lightning-rainy": "Torden og regn", hail: "Hagl", exceptional: "Ekstremvær" };
export const wxIcon = (s?: string) => !s ? CloudSun : s === "clear-night" ? Moon : s === "sunny" ? Sun : s === "partlycloudy" ? CloudSun : /lightning/.test(s) ? CloudLightning : /rain|pour|hail/.test(s) ? CloudRain : /snow/.test(s) ? CloudSnow : s === "fog" ? CloudFog : /wind/.test(s) ? Wind : Cloud;
export const MODE: Record<string, string> = { Home: "Hjemme", Away: "Borte", Night: "Natt", Vacation: "Ferie", Guest: "Gjest" };
export const ALARM: Record<string, string> = { disarmed: "Alarm av", armed_home: "Alarm hjemme", armed_away: "Alarm på", armed_night: "Nattalarm", armed_vacation: "Feriealarm", triggered: "Alarm utløst!", pending: "Alarm venter", arming: "Alarm slås på" };
export function hello(d: Date) { const h = d.getHours(); return h < 5 ? "God natt" : h < 10 ? "God morgen" : h < 12 ? "God formiddag" : h < 18 ? "God ettermiddag" : h < 23 ? "God kveld" : "God natt"; }
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });

export function useWeather() {
  const [wx, setWx] = useState<Wx | null>(null);
  useEffect(() => { let on = true; const load = () => api<Wx>("/api/home/weather").then((w) => on && w && "temp" in w && setWx(w)).catch(() => undefined);
    void load(); const t = setInterval(load, 10 * 60_000); return () => { on = false; clearInterval(t); }; }, []);
  return wx;
}
export type NextEv = { title: string; start: string; allDay: boolean; color: string };
export function useNextEvent() {
  const [ev, setEv] = useState<NextEv | null>(null);
  useEffect(() => { let on = true; const load = () => api<{ events: NextEv[] }>("/api/calendar/upcoming?days=1&limit=4").then((r) => on && setEv(r.events.find((e) => !e.allDay) ?? r.events[0] ?? null)).catch(() => undefined);
    void load(); const t = setInterval(load, 5 * 60_000); return () => { on = false; clearInterval(t); }; }, []);
  return ev;
}

export function useChips(entities: Record<string, EntityState>) {
  const all = Object.values(entities);
  const lights = all.filter((e) => domainOf(e.entity_id) === "light" && e.state === "on").length;
  const locks = all.filter((e) => domainOf(e.entity_id) === "lock" && e.state !== "unavailable");
  const unlocked = locks.filter((l) => l.state !== "locked").length;
  const doors = all.filter((e) => domainOf(e.entity_id) === "binary_sensor" && ["door", "garage_door", "opening", "window"].includes(String(e.attributes.device_class)) && e.state !== "unavailable");
  const open = doors.filter((d) => d.state === "on");
  const alarm = all.find((e) => domainOf(e.entity_id) === "alarm_control_panel" && e.state !== "unavailable");
  return { lights, locks: locks.length, unlocked, doors: doors.length, open, alarm };
}

/** Time-of-day phase for the ambient hero gradient. */
export function phase(d: Date): "dawn" | "day" | "dusk" | "night" { const h = d.getHours(); return h >= 5 && h < 9 ? "dawn" : h >= 9 && h < 17 ? "day" : h >= 17 && h < 22 ? "dusk" : "night"; }

export function TopBar({ now }: { now: Date; unread?: number; openNotif?: () => void }) {
  const wx = useWeather();
  const W = wxIcon(wx?.condition);
  const rain = wx && wx.rainAt ? `Regn fra kl. ${hhmm(wx.rainAt)}` : wx ? (wx.precipNext6h > 0 ? `${wx.precipNext6h} mm neste 6 t` : "Opphold neste 6 t") : null;
  const date = now.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" });
  const time = now.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="tb hero" data-phase={phase(now)}>
      <div className="hero-clock">
        <span className="hero-hello">{hello(now)}</span>
        <time className="hero-time" aria-label={`Klokken er ${time}`}>{time}</time>
        <span className="hero-day">{date}</span>
      </div>
      {wx && wx.temp != null ? (
        <button className="hero-wx" onClick={() => { location.hash = "#/luft"; }} aria-label={`Været: ${Math.round(wx.temp)} grader, ${WX_LABEL[wx.condition] ?? wx.condition}`}>
          <span className="hero-wx-now">
            <W size={34} strokeWidth={1.3} className="hero-wx-i" aria-hidden />
            <span className="hero-wx-t tb-wx-t">{Math.round(wx.temp)}°</span>
            <span className="hero-wx-d">
              <span className="hero-wx-c">{WX_LABEL[wx.condition] ?? wx.condition}</span>
              <span className="hero-wx-hl">↑ {wx.high != null ? Math.round(wx.high) : "–"}° &nbsp;↓ {wx.low != null ? Math.round(wx.low) : "–"}°</span>
              {rain && <span className="hero-rain"><Droplets size={12} aria-hidden />{rain}</span>}
            </span>
          </span>
          {wx.hourly.length > 0 && <span className="hero-hours" aria-hidden>{wx.hourly.filter((_, i) => i % 2 === 1).slice(0, 5).map((h) => { const I = wxIcon(h.cond); return (
            <span key={h.t} className="hero-hour"><span className="hero-hour-h">{String(new Date(h.t).getHours()).padStart(2, "0")}</span><I size={15} strokeWidth={1.5} /><span>{Math.round(h.temp)}°</span><i className="hero-p" style={{ opacity: h.precip > 0 ? 1 : 0, height: Math.min(12, 3 + h.precip * 4) }} /></span>); })}</span>}
        </button>
      ) : (
        <span className="hero-wx hero-wx-sk" aria-busy="true" aria-label="Henter været"><span className="sk" style={{ width: 120, height: 34 }} /><span className="sk sk-line sm" style={{ width: 160 }} /></span>
      )}
    </div>
  );
}
