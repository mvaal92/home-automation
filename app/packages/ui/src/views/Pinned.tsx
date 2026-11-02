import { motion } from "motion/react";
import { BedDouble, ChevronDown, ChevronLeft, ChevronRight, LogIn, LogOut, Pin, PinOff, Plus, Power, Sparkles, Clapperboard, Check } from "lucide-react";
import { useState } from "react";
import { domainOf, friendlyName } from "@home/core";
import { useCall, useSnapshot, useVisibleEntities } from "../lib/home";
import { moveIn, useCollapsed, usePrefs } from "../lib/prefs";
import { useEdit } from "../lib/layout";
import { Tile } from "../components/Tile";

const R_ICON: Record<string, typeof Power> = { "script.leave_home": LogOut, "script.arrive_home": LogIn, "script.bedtime": BedDouble, "script.all_off": Power, "script.movie_mode": Clapperboard };
const R_LABEL: Record<string, string> = { "script.leave_home": "Dra hjemmefra", "script.arrive_home": "Kom hjem", "script.bedtime": "Leggetid", "script.all_off": "Alt av", "script.movie_mode": "Filmkveld" };
const clean = (n: string) => n.replace(/^.*? · /, "").replace(/ \(WiZ\)$/, "");
export const routineLabel = (id: string, name: string) => R_LABEL[id] ?? clean(name);

/** Section header that can collapse (state stored in prefs DB). */
export function SectionHead({ id, title, count, children }: { id: string; title: string; count?: number; children?: React.ReactNode }) {
  const [c, toggle] = useCollapsed(id);
  return (
    <h2 className="section-title">
      <button className="collapse-btn" onClick={toggle} aria-expanded={!c}><ChevronDown size={14} className={c ? "rot" : ""} />{title}</button>
      {count !== undefined && <span className="count">{count}</span>}
      {children}
    </h2>
  );
}

export function Pinned({ openDevice, title = "Festet" }: { openDevice: (id: string) => void; title?: string }) {
  const { prefs, update } = usePrefs();
  const { entities } = useSnapshot();
  const visible = useVisibleEntities();
  const call = useCall();
  const [localEdit, setEdit] = useState(false);
  const { editing } = useEdit();
  const edit = localEdit || editing;
  const [collapsed] = useCollapsed("pinned");
  const routines = prefs.pinnedRoutines.filter((id) => entities[id]);
  const lights = prefs.pinnedLights.filter((id) => entities[id]);
  const move = (k: "pinnedRoutines" | "pinnedLights", id: string, d: -1 | 1) => update((p) => ({ ...p, [k]: moveIn(p[k], id, d) }));
  const unpin = (k: "pinnedRoutines" | "pinnedLights", id: string) => update((p) => ({ ...p, [k]: p[k].filter((x) => x !== id) }));
  const pin = (id: string) => { const k = id.startsWith("light.") ? "pinnedLights" : "pinnedRoutines"; update((p) => ({ ...p, [k]: [...p[k], id] })); };
  const candidates = Object.values(visible).filter((e) => ["light", "script", "scene"].includes(domainOf(e.entity_id))
    && !prefs.pinnedLights.includes(e.entity_id) && !prefs.pinnedRoutines.includes(e.entity_id) && e.state !== "unavailable")
    .sort((a, b) => domainOf(a.entity_id).localeCompare(domainOf(b.entity_id)) || friendlyName(a).localeCompare(friendlyName(b)));
  const Controls = ({ k, id }: { k: "pinnedRoutines" | "pinnedLights"; id: string }) => edit ? (
    <span className="pin-edit eg-allow">
      <button aria-label="Move left" onClick={() => move(k, id, -1)}><ChevronLeft size={14} /></button>
      <button aria-label="Unpin" onClick={() => unpin(k, id)}><PinOff size={13} /></button>
      <button aria-label="Move right" onClick={() => move(k, id, 1)}><ChevronRight size={14} /></button>
    </span>
  ) : null;
  return (
    <section className={`section pinned ${edit ? "editing" : ""}`}>
      <SectionHead id="pinned" title={title}>
        {!editing && <button className="section-action" onClick={() => setEdit(!edit)}>{edit ? <><Check size={13} /> Ferdig</> : <><Pin size={13} /> Endre</>}</button>}
      </SectionHead>
      {!collapsed && <>
        {routines.length > 0 && (
          <div className="routines" role="list" aria-label="Pinned routines">
            {routines.map((id) => {
              const e = entities[id]!;
              const I = R_ICON[id] ?? Sparkles;
              const dom = domainOf(id);
              return (
                <div key={id} className="pin-wrap">
                  <motion.button layout role="listitem" className={`routine ${e.state === "on" ? "running" : ""}`} whileTap={{ scale: 0.95 }} disabled={edit}
                    onClick={() => void call({ domain: dom, service: "turn_on", target: { entity_id: id } })}>
                    <span className="routine-ic"><I size={18} strokeWidth={1.75} /></span><span>{routineLabel(id, friendlyName(e))}</span>
                  </motion.button>
                  <Controls k="pinnedRoutines" id={id} />
                </div>
              );
            })}
          </div>
        )}
        {lights.length > 0 && (
          <div className="tiles pinned-lights">
            {lights.map((id) => (
              <motion.div layout key={id} className="pin-wrap">
                <Tile id={id} name={clean(friendlyName(entities[id]!))} onOpen={openDevice} />
                <Controls k="pinnedLights" id={id} />
              </motion.div>
            ))}
          </div>
        )}
        {routines.length + lights.length === 0 && !edit && <p className="footnote">Ingenting festet. Trykk Endre, eller nålen på et lys.</p>}
        {edit && (
          <div className="pin-add eg-allow">
            <span className="muted small"><Plus size={12} /> Fest på Hjem</span>
            <div className="pin-add-list">
              {candidates.map((e) => (
                <button key={e.entity_id} className="pill-btn" onClick={() => pin(e.entity_id)}><Pin size={12} /> {clean(friendlyName(e))} <span className="muted">{domainOf(e.entity_id) === "light" ? "light" : domainOf(e.entity_id)}</span></button>
              ))}
            </div>
          </div>
        )}
      </>}
    </section>
  );
}
