import { motion } from "motion/react";
import { ChevronRight, Loader2 } from "lucide-react";
import type { CSSProperties } from "react";
import { brightnessPct, domainOf, isOn, UNAVAILABLE } from "@home/core";
import { useCall, useEntity, useSnapshot } from "../lib/home";
import { entityIcon } from "../lib/icons";
import { lightColor, stateLabel } from "../lib/format";
import { PinBadge } from "./EditMode";

const TOGGLEABLE = new Set(["light", "switch", "fan", "input_boolean"]);

/** Device tile: tap toggles (lights/plugs) or opens the control sheet. */
export function Tile({ id, name, onOpen }: { id: string; name: string; onOpen: (id: string) => void }) {
  const e = useEntity(id);
  const call = useCall();
  const pending = useSnapshot().pending.has(id);
  const dom = domainOf(id);
  const on = isOn(e);
  const unavailable = !e || UNAVAILABLE.has(e.state);
  const Icon = entityIcon(e, id);
  const tint = dom === "light" && on ? lightColor(e) : dom === "climate" && on ? "var(--warm)" : dom === "lock" ? (e?.state === "locked" ? "var(--good)" : "var(--warn)") : "var(--accent)";
  const fill = dom === "light" && on && e ? brightnessPct(e) : on ? 100 : 0;
  const style = { "--tint": tint, "--level": `${fill}%` } as CSSProperties;

  const primary = () => {
    if (unavailable) return onOpen(id);
    if (TOGGLEABLE.has(dom)) void call({ domain: dom, service: on ? "turn_off" : "turn_on", target: { entity_id: id } });
    else onOpen(id);
  };
  return (
    <motion.div className={`tile ${on ? "on" : ""} ${unavailable ? "unavailable" : ""} dom-${dom}`} style={style} whileTap={{ scale: 0.985 }} transition={{ duration: 0.15 }}>
      {dom === "light" && <div className="tile-level" />}
      <button className="tile-main" onClick={primary} aria-pressed={on} aria-label={`${name}: ${stateLabel(e)}`}>
        <span className="tile-icon"><Icon size={20} strokeWidth={1.8} /></span>
        <span className="tile-text">
          <span className="tile-name">{name}</span>
          <span className="tile-state">{pending ? <Loader2 size={12} className="spin" /> : null}{stateLabel(e)}</span>
        </span>
      </button>
      <button className="tile-more" onClick={() => onOpen(id)} aria-label={`${name} controls`}><ChevronRight size={16} /></button>
      <PinBadge id={id} />
    </motion.div>
  );
}
