import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Eye, EyeOff, GripVertical, LayoutTemplate, Pencil, Pin, PinOff, Plus, RotateCcw, Smartphone, Trash2, Undo2, X, Rows3 } from "lucide-react";
import { useEdit, orderBy } from "../lib/layout";
import { pinnable, usePin, usePrefs, type CardSize } from "../lib/prefs";
import "./editmode.css";

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const SIZE_LABEL: Record<CardSize, string> = { s: "S", m: "M", l: "L", full: "Full bredde" };
const announce = (msg: string) => { const el = document.getElementById("eg-live"); if (el) el.textContent = msg; };

/* ── registry: what the "Legg til kort" drawer can offer on the current page ── */
interface Offer { tab: string; label: string; items: { key: string; label: string; hint?: string }[]; show: (key: string) => void }
let offers: Record<string, Offer> = {}; const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
function publish(o: Offer | null, tab: string) { const n = { ...offers }; if (o) n[tab] = o; else delete n[tab]; offers = n; emit(); }
const useOffers = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => offers);

export interface EgItem { key: string; label: string; node: ReactNode; hint?: string; titleKey?: string; size?: CardSize }

/**
 * Reorderable / resizable / hideable grid used by edit mode. Outside edit mode it renders the items in the
 * saved order with saved sizes. variant "cards" = 12-col grid (S/M/L/full), "flow" = auto grid (S/M/full).
 */
export function EditGrid({ tab, items, order, hidden, sizes, onChange, variant = "cards", className = "", label, available }: {
  tab: string; items: EgItem[]; order?: string[]; hidden?: string[]; sizes?: Record<string, CardSize>;
  onChange: (next: { order?: string[]; hidden?: string[]; size?: Record<string, CardSize> }, summary: string) => void;
  variant?: "cards" | "flow" | "chips"; className?: string; label: string;
  /** extra keys only offered in the drawer (optional cards not yet added) */
  available?: { key: string; label: string; hint?: string; add: () => void }[];
}) {
  const { editing } = useEdit();
  const keys = items.map((i) => i.key);
  const full = orderBy(keys, order);
  const hid = new Set(hidden ?? []);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [drag, setDrag] = useState<{ key: string; x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const visible = (draft ?? full).filter((k) => !hid.has(k) && items.some((i) => i.key === k));
  const byKey = useMemo(() => Object.fromEntries(items.map((i) => [i.key, i])), [items]);

  const hiddenList = full.filter((k) => hid.has(k)).map((k) => byKey[k]).filter(Boolean) as EgItem[];
  const offerSig = editing ? JSON.stringify([hiddenList.map((h) => h.key), (available ?? []).map((a) => a.key)]) : "";
  useEffect(() => {
    if (!editing) { publish(null, tab); return; }
    publish({ tab, label, items: [...hiddenList.map((h) => ({ key: h.key, label: h.label, hint: h.hint })), ...(available ?? []).map((a) => ({ key: `+${a.key}`, label: a.label, hint: a.hint }))],
      show: (k) => { if (k.startsWith("+")) available?.find((a) => `+${a.key}` === k)?.add(); else onChange({ hidden: [...hid].filter((x) => x !== k) }, `viste ${byKey[k]?.label ?? k}`); } }, tab);
    return () => publish(null, tab);
  }, [editing, offerSig, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitOrder = (vis: string[], why: string) => {
    const hiddenKeys = full.filter((k) => !vis.includes(k));
    const next = [...vis, ...hiddenKeys];
    if (next.join() !== full.join()) onChange({ order: next }, why);
  };
  const moveBy = (key: string, d: number) => {
    const v = [...visible]; const i = v.indexOf(key); const j = Math.max(0, Math.min(v.length - 1, i + d)); if (i === j) return;
    v.splice(i, 1); v.splice(j, 0, key); commitOrder(v, `flyttet ${byKey[key]?.label}`);
    announce(`${byKey[key]?.label} flyttet til plass ${j + 1} av ${v.length}`);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-eg="${CSS.escape(key)}"] .eg-grip`)?.focus());
  };

  // pointer drag (mouse + touch): the card reorders live under the pointer, a chip follows the finger
  const raf = useRef(0);
  const onDown = (key: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDraft(visible); setDrag({ key, x: e.clientX, y: e.clientY }); navigator.vibrate?.(8);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const { clientX: x, clientY: y } = e;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      setDrag((d) => (d ? { ...d, x, y } : d));
      const main = document.querySelector(".main"); if (main) { if (y < 90) main.scrollBy({ top: -14 }); else if (y > innerHeight - 90) main.scrollBy({ top: 14 }); }
      const el = document.elementsFromPoint(x, y).map((n) => (n as HTMLElement).closest<HTMLElement>("[data-eg]")).find((n) => n && gridRef.current?.contains(n) && n.dataset.eg !== drag.key);
      const over = el?.dataset.eg; if (!el || !over) return;
      // insert before/after the hovered card depending on which half the pointer is in (stable, no flip-flopping)
      const b = el.getBoundingClientRect(); const gw = gridRef.current?.getBoundingClientRect().width ?? b.width;
      const after = b.width > gw * 0.6 ? y > b.top + b.height / 2 : x > b.left + b.width / 2;
      setDraft((cur) => { const v = (cur ?? visible).filter((k) => k !== drag.key); const t = v.indexOf(over); if (t < 0) return cur; v.splice(after ? t + 1 : t, 0, drag.key); return (cur ?? []).join() === v.join() ? cur : v; });
    });
  };
  const onUp = () => { if (!drag) return; cancelAnimationFrame(raf.current); if (draft) commitOrder(draft, `flyttet ${byKey[drag.key]?.label}`); setDrag(null); setDraft(null); };

  const sizeOf = (it: EgItem): CardSize => sizes?.[it.key] ?? it.size ?? (variant === "flow" ? "s" : "full");
  const sizeOpts: CardSize[] = variant === "flow" ? ["s", "m", "full"] : variant === "cards" ? ["s", "m", "l", "full"] : [];
  const anim = !reduced();
  return (
    <div ref={gridRef} className={`eg-grid eg-${variant} ${editing ? "editing" : ""} ${drag ? "dragging" : ""} ${className}`} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role={editing ? "list" : undefined} aria-label={editing ? label : undefined}>
      {visible.map((k, idx) => {
        const it = byKey[k]!; const s = sizeOf(it);
        return (
          <motion.div key={k} data-eg={k} layout={anim ? "position" : false} transition={{ type: "spring", stiffness: 520, damping: 40 }}
            className={`eg-item sz-${s} ${drag?.key === k ? "lifted" : ""}`} role={editing ? "listitem" : undefined} style={{ "--jig": `${(idx % 3) * 0.11}s` } as React.CSSProperties}>
            {editing && <div className="eg-chrome eg-allow">
              <button className="eg-grip" onPointerDown={onDown(k)} aria-label={`Flytt ${it.label}. Bruk piltastene.`} title="Dra for å flytte"
                onKeyDown={(e) => { if (["ArrowUp", "ArrowLeft"].includes(e.key)) { e.preventDefault(); moveBy(k, -1); } else if (["ArrowDown", "ArrowRight"].includes(e.key)) { e.preventDefault(); moveBy(k, 1); } else if (e.key === "Home") { e.preventDefault(); moveBy(k, -99); } else if (e.key === "End") { e.preventDefault(); moveBy(k, 99); } }}>
                <GripVertical size={15} /></button>
              {it.titleKey ? <TitleEdit titleKey={it.titleKey} fallback={it.label} /> : <span className="eg-name">{it.label}</span>}
              <span className="grow" />
              {sizeOpts.length > 0 && <span className="eg-sizes" role="radiogroup" aria-label="Størrelse">
                {sizeOpts.map((o) => <button key={o} role="radio" aria-checked={s === o} className={s === o ? "on" : ""} title={SIZE_LABEL[o]} aria-label={SIZE_LABEL[o]}
                  onClick={() => onChange({ size: { ...(sizes ?? {}), [k]: o } }, `${it.label}: ${SIZE_LABEL[o]}`)}>{o === "full" ? "⬌" : SIZE_LABEL[o]}</button>)}
              </span>}
              <button className="eg-eye" onClick={() => { onChange({ hidden: [...hid, k] }, `skjulte ${it.label}`); announce(`${it.label} skjult`); }} aria-label={`Skjul ${it.label}`} title="Skjul"><EyeOff size={15} /></button>
            </div>}
            <div className="eg-body" onClickCapture={editing ? (e) => { if (!(e.target as HTMLElement).closest(".eg-allow")) { e.preventDefault(); e.stopPropagation(); } } : undefined}
              aria-hidden={editing && variant === "chips" ? true : undefined}>{it.node}</div>
          </motion.div>
        );
      })}
      {editing && visible.length === 0 && <p className="footnote">Alt er skjult her. Bruk «Legg til kort».</p>}
      {drag && <div className="eg-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden>{byKey[drag.key]?.label}</div>}
    </div>
  );
}

function TitleEdit({ titleKey, fallback }: { titleKey: string; fallback: string }) {
  const { title, patch, layout } = useEdit();
  const [v, setV] = useState<string | null>(null);
  const cur = title(titleKey, fallback);
  const save = () => {
    if (v === null) return; const t = v.trim(); setV(null);
    if (t === cur) return;
    const next = { ...(layout.titles ?? {}) }; if (!t || t === fallback) delete next[titleKey]; else next[titleKey] = t;
    void patch({ titles: next }, `ga nytt navn: ${t || fallback}`);
  };
  return v === null
    ? <button className="eg-name eg-rename" onClick={() => setV(cur)} title="Gi nytt navn" aria-label={`Gi nytt navn: ${cur}`}>{cur}<Pencil size={11} /></button>
    : <input className="eg-title-input" autoFocus value={v} maxLength={40} aria-label="Nytt navn" placeholder={fallback}
        onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { e.stopPropagation(); setV(null); } }} />;
}

/** Inline pin/unpin badge for lights, scenes and routines (only rendered in edit mode). */
export function PinBadge({ id }: { id: string }) {
  const [on] = usePin(id);
  const { editing } = useEdit();
  const { edit } = usePrefs();
  const toggle = () => void edit([{ op: on ? "unpin" : "pin", entity_id: id }], on ? `fjernet ${id} fra Festet` : `festet ${id}`);
  if (!editing || !pinnable(id)) return null;
  return <button className={`eg-pin eg-allow ${on ? "on" : ""}`} onClick={(e) => { e.stopPropagation(); toggle(); }} aria-pressed={on} aria-label={on ? "Fjern fra Festet" : "Fest på Hjem"} title={on ? "Fjern fra Festet" : "Fest på Hjem"}>{on ? <PinOff size={12} /> : <Pin size={12} />}</button>;
}

/** Pencil button in the top bar. */
export function EditButton() {
  const { editing, setEditing } = useEdit();
  return <button className={`icon-btn ghost edit-btn ${editing ? "on" : ""}`} onClick={() => setEditing(!editing)} aria-pressed={editing} aria-label={editing ? "Ferdig med å redigere" : "Rediger visning"} title={editing ? "Ferdig" : "Rediger visning"}>
    {editing ? <Check size={17} strokeWidth={1.9} /> : <Pencil size={16} strokeWidth={1.75} />}</button>;
}

/** Long-press on empty page space (touch) enters edit mode. Never fires on controls. */
export function useLongPressEdit() {
  const { editing, setEditing } = useEdit();
  const t = useRef<number | undefined>(undefined); const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (editing || e.pointerType === "mouse") return;
      if ((e.target as HTMLElement).closest("button, a, input, textarea, select, [role=slider], [role=switch], .tile, .room-card, .dock, .pill, video")) return;
      start.current = { x: e.clientX, y: e.clientY };
      t.current = window.setTimeout(() => { setEditing(true); start.current = null; }, 600);
    },
    onPointerMove: (e: React.PointerEvent) => { const s = start.current; if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) { clearTimeout(t.current); start.current = null; } },
    onPointerUp: () => { clearTimeout(t.current); start.current = null; },
    onPointerCancel: () => { clearTimeout(t.current); start.current = null; },
  };
}

/** Floating toolbar while editing + the drawers it opens. */
export function EditBar({ routeKind }: { routeKind: string }) {
  const { editing, setEditing, prefs, dev, tabs, patch, layout } = useEdit();
  const { edit, undo } = usePrefs();
  const [sheet, setSheet] = useState<null | "add" | "tabs" | "layouts">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const all = useOffers();
  useEffect(() => { if (!editing) setSheet(null); }, [editing]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2600); return () => clearTimeout(t); }, [msg]);
  const pageOffers = Object.values(all);
  const nHidden = pageOffers.reduce((a, o) => a + o.items.length, 0);
  const target = prefs.perDevice && dev === "phone" ? "phone" : "main";
  const doUndo = async () => { const r = await undo(); setMsg(r === null ? "Ingenting å angre" : `Angret: ${r}`); };
  const reset = async () => { if (!confirm(target === "phone" ? "Tilbakestille mobilvisningen til standard?" : "Tilbakestille visningen til standard? (Kan angres.)")) return; if (await edit([{ op: "layout_reset", target }], "tilbakestilt til standard")) setMsg("Tilbakestilt – trykk Angre for å gå tilbake"); };
  return (
    <>
      <div id="eg-live" className="sr-only" aria-live="polite" />
      <AnimatePresence>
        {editing && <motion.div className="edit-bar" role="toolbar" aria-label="Rediger visning" initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -16, opacity: 0 }} transition={{ duration: reduced() ? 0 : 0.18 }}>
          <span className="edit-bar-title"><Pencil size={14} /> Rediger{prefs.activeLayout ? <em> · {prefs.activeLayout}</em> : null}{prefs.perDevice ? <em> · {dev === "phone" ? "mobil" : "nettbrett/PC"}</em> : null}</span>
          <button className="eb-btn" onClick={() => setSheet("add")}><Plus size={15} /><span className="lbl-k">Legg til kort</span>{nHidden ? <span className="eb-n">{nHidden}</span> : null}</button>
          <button className="eb-btn" onClick={() => setSheet("tabs")}><Rows3 size={15} /><span className="lbl">Faner</span></button>
          <button className="eb-btn" onClick={() => setSheet("layouts")}><LayoutTemplate size={15} /><span className="lbl">Visninger</span></button>
          <span className="grow" />
          <button className="eb-btn icon" onClick={() => void doUndo()} title="Angre" aria-label="Angre"><Undo2 size={15} /><span className="lbl">Angre</span></button>
          <button className="eb-btn icon" onClick={() => void reset()} title="Tilbakestill til standard" aria-label="Tilbakestill til standard"><RotateCcw size={15} /><span className="lbl">Tilbakestill</span></button>
          <button className="eb-btn primary" onClick={() => setEditing(false)}><Check size={15} /> Ferdig</button>
        </motion.div>}
      </AnimatePresence>
      {msg && <div className="toast edit-toast" role="status">{msg}</div>}
      <AnimatePresence>
        {sheet && <motion.div className="eg-scrim" onClick={() => setSheet(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.aside className="eg-drawer" role="dialog" aria-modal="true" aria-label={sheet === "add" ? "Legg til kort" : sheet === "tabs" ? "Faner" : "Visninger"} onClick={(e) => e.stopPropagation()}
            initial={{ x: reduced() ? 0 : 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: reduced() ? 0 : 40, opacity: 0 }} transition={{ type: "spring", stiffness: 420, damping: 36 }}>
            <header><b>{sheet === "add" ? "Legg til kort" : sheet === "tabs" ? "Faner og rekkefølge" : "Visninger"}</b><button className="icon-btn ghost" onClick={() => setSheet(null)} aria-label="Lukk"><X size={18} /></button></header>
            {sheet === "add" && <AddList offers={pageOffers} routeKind={routeKind} />}
            {sheet === "tabs" && <TabsEditor tabs={tabs()} save={(order, hidden, why) => void patch({ tabOrder: order, hiddenTabs: hidden }, why)} />}
            {sheet === "layouts" && <Layouts layoutHas={Object.keys(layout).some((k) => (layout as Record<string, unknown>)[k] !== undefined)} setMsg={setMsg} />}
          </motion.aside>
        </motion.div>}
      </AnimatePresence>
    </>
  );
}

function AddList({ offers, routeKind }: { offers: Offer[]; routeKind: string }) {
  if (!offers.length) return <p className="muted small">Denne siden har ingen kort å tilpasse. Hjem, Rom og Barn kan tilpasses – faner styres under «Faner».</p>;
  return <div className="eg-add">
    {offers.map((o) => <section key={o.tab}>
      <h4>{o.label}</h4>
      {o.items.length === 0 ? <p className="muted small">Alt vises allerede.</p> :
        o.items.map((i) => <button key={i.key} className="eg-add-row" onClick={() => o.show(i.key)}><Plus size={15} /><span className="grow"><b>{i.label}</b>{i.hint && <span className="muted small">{i.hint}</span>}</span><Eye size={15} className="muted" /></button>)}
    </section>)}
    <p className="muted tiny">Skjul kort med øyet på kortet. Side: {routeKind === "home" ? "Hjem" : routeKind}</p>
  </div>;
}

function TabsEditor({ tabs, save }: { tabs: { key: string; label: string; hidden: boolean }[]; save: (order: string[], hidden: string[], why: string) => void }) {
  const order = tabs.map((t) => t.key); const hidden = tabs.filter((t) => t.hidden).map((t) => t.key);
  const move = (k: string, d: number) => { const v = [...order]; const i = v.indexOf(k), j = Math.max(0, Math.min(v.length - 1, i + d)); if (i === j) return; v.splice(i, 1); v.splice(j, 0, k); save(v, hidden, `fane ${k} flyttet`);
    announce(`${tabs.find((t) => t.key === k)?.label} flyttet til plass ${j + 1}`); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-tab-row="${k}"] .eg-grip`)?.focus()); };
  return <div className="eg-tabs">
    <p className="muted small">Gjelder sidemeny, Mer-menyen, mobilfeltet og Flyt-docken. Hjem og Innstillinger er alltid med.</p>
    <motion.ul layout={!reduced()}>
      {tabs.map((t, i) => <motion.li layout={!reduced()} key={t.key} data-tab-row={t.key} className={t.hidden ? "off" : ""}>
        <button className="eg-grip" aria-label={`Flytt ${t.label}. Piltaster opp/ned.`} onKeyDown={(e) => { if (e.key === "ArrowUp") { e.preventDefault(); move(t.key, -1); } if (e.key === "ArrowDown") { e.preventDefault(); move(t.key, 1); } }}><GripVertical size={15} /></button>
        <span className="grow">{t.label}</span>
        <button className="eb-mini" disabled={i === 0} onClick={() => move(t.key, -1)} aria-label={`Flytt ${t.label} opp`}>↑</button>
        <button className="eb-mini" disabled={i === tabs.length - 1} onClick={() => move(t.key, 1)} aria-label={`Flytt ${t.label} ned`}>↓</button>
        <button className={`eg-eye ${t.hidden ? "" : "on"}`} role="switch" aria-checked={!t.hidden} aria-label={`Vis ${t.label}`}
          onClick={() => save(order, t.hidden ? hidden.filter((x) => x !== t.key) : [...hidden, t.key], `${t.hidden ? "viste" : "skjulte"} fane ${t.label}`)}>{t.hidden ? <EyeOff size={15} /> : <Eye size={15} />}</button>
      </motion.li>)}
    </motion.ul>
  </div>;
}

function Layouts({ layoutHas, setMsg }: { layoutHas: boolean; setMsg: (m: string) => void }) {
  const { prefs, edit } = usePrefs();
  const [name, setName] = useState("");
  const names = Object.keys(prefs.layouts ?? {});
  const save = async (n: string) => { const t = n.trim(); if (!t) return; if (await edit([{ op: "layout_save", name: t }], `lagret visning «${t}»`)) { setName(""); setMsg(`Lagret «${t}»`); } };
  return <div className="eg-layouts">
    <section>
      <h4><Smartphone size={14} /> Mobil og nettbrett/PC</h4>
      <div className="seg" role="radiogroup" aria-label="Visning per enhet">
        <button role="radio" aria-checked={!prefs.perDevice} className={!prefs.perDevice ? "on" : ""} onClick={() => void edit([{ op: "layout_mode", perDevice: false }], "samme visning overalt")}>Samme overalt</button>
        <button role="radio" aria-checked={!!prefs.perDevice} className={prefs.perDevice ? "on" : ""} onClick={() => void edit([{ op: "layout_mode", perDevice: true }], "egen mobilvisning")}>Egen for mobil</button>
      </div>
      <p className="muted tiny">{prefs.perDevice ? "Endringer på mobil lagres separat fra nettbrett og PC." : "Én visning for alle enheter."}</p>
    </section>
    <section>
      <h4><LayoutTemplate size={14} /> Lagrede visninger</h4>
      {names.length === 0 && <p className="muted small">Lagre for eksempel «Morgen» og «Kveld» og bytt med ett trykk.</p>}
      {names.map((n) => <div key={n} className={`eg-layout-row ${prefs.activeLayout === n ? "on" : ""}`}>
        <button className="grow eg-layout-use" onClick={() => void edit([{ op: "layout_use", name: n }], `byttet til «${n}»`).then((ok) => ok && setMsg(`Byttet til «${n}»`))}>{prefs.activeLayout === n ? <Check size={14} /> : <span className="dot-sp" />}{n}</button>
        {prefs.activeLayout === n && <button className="eb-mini" onClick={() => void save(n)} title="Oppdater med nåværende">Oppdater</button>}
        <button className="eb-mini" onClick={() => { if (confirm(`Slette «${n}»?`)) void edit([{ op: "layout_delete", name: n }], `slettet «${n}»`); }} aria-label={`Slett ${n}`}><Trash2 size={13} /></button>
      </div>)}
      <form className="eg-layout-new" onSubmit={(e) => { e.preventDefault(); void save(name); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={names.includes("Morgen") ? "Kveld" : "Morgen"} maxLength={24} aria-label="Navn på visning" />
        <button className="eb-btn primary" disabled={!name.trim()}>Lagre nåværende</button>
      </form>
      {!layoutHas && <p className="muted tiny">Nåværende visning er standard.</p>}
    </section>
  </div>;
}
