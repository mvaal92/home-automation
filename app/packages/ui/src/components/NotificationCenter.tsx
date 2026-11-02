import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Baby, Bell, Bot, CheckCheck, Cpu, Info, WashingMachine, Wind, X } from "lucide-react";
import type { Notif } from "../lib/notify";
import type { useNotifications } from "../lib/notify";
const ICON: Record<string, typeof Bell> = { kids: Baby, device: Cpu, air: Wind, appliance: WashingMachine, robot: Bot };
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "nå" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} t` : `${Math.round(m / 1440)} d`; };
type N = ReturnType<typeof useNotifications>;
export function BellButton({ n, onClick }: { n: N; onClick: () => void }) {
  return <button className="icon-btn ghost bell" onClick={onClick} aria-label={`Varsler (${n.unread} uleste)`} title="Varsler"><Bell size={18} strokeWidth={1.75} />{n.unread > 0 && <span className="bell-badge">{n.unread > 9 ? "9+" : n.unread}</span>}</button>;
}
function Row({ i, n, close }: { i: Notif; n: N; close: () => void }) {
  const I = i.severity === "urgent" ? AlertTriangle : ICON[i.kind] ?? Info;
  return <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }} className={`notif ${i.severity} ${i.read_at ? "" : "unread"}`}>
    <span className="notif-ic"><I size={16} strokeWidth={1.75} /></span>
    <button className="notif-main" onClick={() => { void n.act(i.id, "read"); if (i.link) { location.hash = i.link; close(); } }}>
      <span className="notif-title">{i.title}</span>{i.body && <span className="notif-body">{i.body}</span>}<span className="notif-time">{ago(i.created_at)}</span>
    </button>
    <button className="icon-btn ghost sm" onClick={() => void n.act(i.id, "dismiss")} aria-label="Fjern"><X size={14} /></button>
  </motion.li>;
}
export function NotificationPanel({ n, open, close }: { n: N; open: boolean; close: () => void }) {
  return <AnimatePresence>{open && <div className="notif-scrim" onClick={close}>
    <motion.aside className="notif-panel" onClick={(e) => e.stopPropagation()} initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.16 }}>
      <header><h3 className="grow">Varsler</h3>{n.unread > 0 && <button className="btn sm ghost" onClick={() => void n.readAll()}><CheckCheck size={14} /> Merk alle lest</button>}<button className="icon-btn ghost" onClick={close} aria-label="Lukk"><X size={18} /></button></header>
      {n.items.length === 0 ? <div className="notif-empty"><Bell size={22} strokeWidth={1.5} /><span>Alt er rolig.</span></div> :
        <ul className="notif-list"><AnimatePresence initial={false}>{n.items.map((i) => <Row key={i.id} i={i} n={n} close={close} />)}</AnimatePresence></ul>}
    </motion.aside></div>}</AnimatePresence>;
}
export function UrgentBanner({ n }: { n: N }) {
  const u = n.urgent[0]; if (!u) return null;
  return <div className="urgent-banner" role="alert"><AlertTriangle size={16} /><span className="grow"><b>{u.title}</b>{u.body ? ` · ${u.body}` : ""}</span>
    {u.link && <button className="btn sm" onClick={() => { void n.act(u.id, "read"); location.hash = u.link!; }}>Åpne</button>}
    <button className="icon-btn ghost sm" onClick={() => void n.act(u.id, "read")} aria-label="Skjul"><X size={14} /></button></div>;
}
