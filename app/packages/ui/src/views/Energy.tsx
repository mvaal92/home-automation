import { motion } from "motion/react";
import { Plug, Zap } from "lucide-react";
import { domainOf, num } from "@home/core";
import { useHistory, useSnapshot, useVisibleEntities } from "../lib/home";
import { item, list } from "../lib/motion";
import { Sparkline } from "../components/Sparkline";
import { EnergyCard } from "./Widgets";

const nm = (x: { entity_id: string; attributes: Record<string, unknown> }) => String(x.attributes.friendly_name ?? x.entity_id).replace(/ (Power|Effekt)$/i, "");

/** Dedicated energy tab: live draw, top consumers, every metered device and daily energy counters. */
export function EnergyPage({ openDevice }: { openDevice: (id: string) => void }) {
  const visible = useVisibleEntities();
  const { entities } = useSnapshot();
  const all = Object.values(visible).length ? Object.values(visible) : Object.values(entities);
  const meters = all.filter((x) => x.attributes.device_class === "power" && domainOf(x.entity_id) === "sensor")
    .sort((a, b) => (num(b.state) ?? -1) - (num(a.state) ?? -1));
  const counters = all.filter((x) => x.attributes.device_class === "energy" && num(x.state) !== undefined)
    .sort((a, b) => (num(b.state) ?? 0) - (num(a.state) ?? 0)).slice(0, 12);
  const h = useHistory(meters.slice(0, 8).map((m) => m.entity_id), 24);
  return (
    <motion.div className="page energy-page" variants={list} initial="hidden" animate="show">
      <motion.h1 variants={item} className="page-title">Strøm</motion.h1>
      <motion.div variants={item} className="energy-hero"><EnergyCard /></motion.div>
      <motion.section variants={item} className="section">
        <h2 className="section-title">Målte enheter <span className="count">{meters.length}</span></h2>
        {meters.length === 0 ? <p className="footnote">Ingen effektsensorer ennå. En Tibber Pulse eller AMS-leser gir forbruket for hele huset.</p> : (
          <div className="sensor-list">
            {meters.map((m) => {
              const v = num(m.state);
              return (
                <button key={m.entity_id} className={`sensor-row ${m.state === "unavailable" ? "unavailable" : ""}`} onClick={() => openDevice(m.entity_id)}>
                  <Plug size={16} strokeWidth={1.75} className="muted" />
                  <span className="sensor-name">{nm(m)}</span>
                  <span className="sensor-spark">{h[m.entity_id] && h[m.entity_id]!.length > 1 && <Sparkline points={h[m.entity_id]!} live={v} height={22} width={120} fill={false} color="var(--fg-3)" />}</span>
                  <span className="sensor-value">{v === undefined ? "–" : v >= 1000 ? `${(v / 1000).toFixed(2)} kW` : `${Math.round(v)} W`}</span>
                </button>
              );
            })}
          </div>
        )}
      </motion.section>
      {counters.length > 0 && (
        <motion.section variants={item} className="section">
          <h2 className="section-title">Energimålere</h2>
          <div className="sensor-list">
            {counters.map((c) => (
              <button key={c.entity_id} className="sensor-row" onClick={() => openDevice(c.entity_id)}>
                <Zap size={16} strokeWidth={1.75} className="muted" /><span className="sensor-name">{nm(c)}</span><span className="sensor-spark" />
                <span className="sensor-value">{(num(c.state) ?? 0).toFixed(1)} {String(c.attributes.unit_of_measurement ?? "kWh")}</span>
              </button>
            ))}
          </div>
        </motion.section>
      )}
    </motion.div>
  );
}
