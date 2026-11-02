import {
  Bath, BedDouble, Bot, Briefcase, CookingPot, DoorClosed, Fan, Flame, Gauge, House, Lamp, Lightbulb, Lock, Moon, Plug, Clapperboard,
  Sunrise, Speaker, Thermometer, Tv, Droplets, Activity, DoorOpen, PlaneTakeoff, Zap, Wind, Blinds, ToggleRight, Sparkles, Sun, AppWindow,
  WashingMachine, Cctv, BellRing, UtensilsCrossed, Warehouse, BedSingle, Popcorn, Sofa, Baby, Video, AudioLines, Gauge as Meter, SunDim, Volume2, LogIn, LogOut, Palmtree, Users, type LucideIcon,
} from "lucide-react";
import type { EntityState } from "@home/core";
import { domainOf } from "@home/core";

const AREA: Array<[RegExp, LucideIcon]> = [
  [/media|kino|cinema|theater/, Popcorn], [/tv[ _-]?(room|stue)|tv\b/, Tv], [/spisestue|dining|spise/, UtensilsCrossed],
  [/sofa|living|stue/, Sofa], [/stove|kitchen|kj[oø]kken|chef/, CookingPot], [/laundry|vaske|washing/, WashingMachine],
  [/gjeste|guest/, BedSingle], [/nursery|barnerom|kids/, Baby], [/bed|sov/, BedDouble], [/shower|bath|bad\b|toilet/, Bath],
  [/front door|inngang|entr|door|hall|gang/, DoorOpen], [/basement|kjeller|bod|storage|garage/, Warehouse],
  [/desk|office|kontor/, Briefcase], [/balcon|balkong|terrace|garden|hage/, Sun],
];

export function areaIcon(icon: string | null, name: string): LucideIcon {
  const s = `${icon ?? ""} ${name}`.toLowerCase();
  if (/whole home|__other/.test(s)) return House;
  return AREA.find(([re]) => re.test(s))?.[1] ?? DoorClosed;
}

export function sceneIcon(e: EntityState | undefined, name: string): LucideIcon {
  const s = `${String(e?.attributes.icon ?? "")} ${name}`.toLowerCase();
  if (/sunrise|morning|morgen|sunset-up/.test(s)) return Sunrise;
  if (/dinner|middag|silverware/.test(s)) return UtensilsCrossed;
  if (/leave|drar/.test(s)) return LogOut;
  if (/arrive|hjemme|welcome/.test(s)) return LogIn;
  if (/bedtime|leggetid/.test(s)) return BedDouble;
  if (/movie|film|cinema/.test(s)) return Clapperboard;
  if (/night|natt|bed|sleep/.test(s)) return Moon;
  if (/away|borte|export/.test(s)) return PlaneTakeoff;
  if (/evening|kveld/.test(s)) return Lamp;
  return Sparkles;
}

export function entityIcon(e: EntityState | undefined, id: string): LucideIcon {
  const dom = domainOf(id);
  const dc = String(e?.attributes.device_class ?? "");
  const n = String(e?.attributes.friendly_name ?? id).toLowerCase();
  switch (dom) {
    case "light": return /lamp|floor|bedside|desk|nattbord/.test(n) ? Lamp : Lightbulb;
    case "switch": return /tv|monitor|skjerm/.test(n) ? AppWindow : Plug;
    case "climate": return /floor|gulv/.test(n) ? Flame : Thermometer;
    case "media_player": return dc === "tv" || /tv|frame/.test(n) ? Tv : /lydplanke|soundbar|beam|arc/.test(n) ? AudioLines : Speaker;
    case "camera": return /door|ring|g4/.test(n) ? BellRing : Cctv;
    case "select": return /wash|vask/.test(n) ? WashingMachine : ToggleRight;
    case "lock": return Lock;
    case "vacuum": return Bot;
    case "fan": return Fan;
    case "cover": return Blinds;
    case "binary_sensor":
      if (dc === "motion" || dc === "occupancy") return Activity;
      if (dc === "doorbell") return BellRing;
      if (dc === "camera") return Video;
      if (dc === "door" || dc === "window" || dc === "opening") return e?.state === "on" ? DoorOpen : DoorClosed;
      return ToggleRight;
    case "sensor":
      if (dc === "temperature") return Thermometer;
      if (dc === "humidity") return Droplets;
      if (/wash|vask/.test(n) && dc === "enum") return WashingMachine;
      if (dc === "power") return Zap;
      if (dc === "energy") return Meter;
      if (dc === "illuminance") return SunDim;
      if (dc === "sound_pressure") return Volume2;
      if (dc === "carbon_dioxide") return Wind;
      return Gauge;
    default: return ToggleRight;
  }
}

const MODE: Array<[RegExp, LucideIcon]> = [[/away|borte/, PlaneTakeoff], [/night|natt/, Moon], [/vacation|ferie/, Palmtree], [/guest|gjest/, Users]];
export function modeIcon(mode: string): LucideIcon {
  return MODE.find(([re]) => re.test(mode.toLowerCase()))?.[1] ?? House;
}
