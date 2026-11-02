import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Home as HomeIcon, Mic, Settings as SettingsIcon, AlertCircle, LayoutGrid, PanelLeftClose, PanelLeftOpen, Zap, MessageCircle, Speaker, Music2, ShoppingCart, MoreHorizontal, X, Sparkles, Headphones, StickyNote, Bot, Wrench , Baby, Wind, CalendarDays, MoonStar } from "lucide-react";
import { startHvile } from "./lib/hvile";
import { ChatPage, ChatView, useChat } from "./views/Chat";
import { SonosPage, SpotifyPage } from "./views/Media";
import { OdaPage } from "./views/Oda";
import { LydbokerPage } from "./views/Lydboker";
import { NotesPage } from "./views/Notes";
import { RobotsPage } from "./views/Robots";
import { BarnPage } from "./views/Barn";
import { LuftPage } from "./views/Luft";
import { useNotifications } from "./lib/notify";
import { BellButton, NotificationPanel, UrgentBanner } from "./components/NotificationCenter";
import { MaintenancePage } from "./views/Maintenance";
import { HaBackend, HomeStore, MockBackend } from "@home/core";
import { HomeProvider, useRooms, useSnapshot } from "./lib/home";
import { areaIcon } from "./lib/icons";
import { useVoice } from "./lib/voice";
import { loadConfig, saveConfig, type HomeConfig } from "./platform";
import { Dashboard, RoomsPage } from "./views/Dashboard";
import { RoomView } from "./views/RoomView";
import { Settings } from "./views/Settings";
import { EnergyPage } from "./views/Energy";
import { PrefsProvider, usePrefs } from "./lib/prefs";
import { EditProvider, TAB_DEFS, useEdit } from "./lib/layout";
import { EditBar, EditButton, useLongPressEdit } from "./components/EditMode";
import { DeviceSheet } from "./components/DeviceSheet";
import { VoiceOverlay } from "./components/VoiceOverlay";
import { AltNav, navTransition } from "./components/AltNav";
import { TopBar } from "./components/TopBar";
import { KalenderPage } from "./views/Kalender";
import { Hvileskjerm } from "./components/Hvileskjerm";

type Route = { kind: "home" } | { kind: "rooms" } | { kind: "room"; id: string } | { kind: "settings" } | { kind: "energy" } | { kind: "chat" } | { kind: "sonos" } | { kind: "spotify" } | { kind: "oda" } | { kind: "lydboker" } | { kind: "notater" } | { kind: "robots" } | { kind: "vedlikehold" } | { kind: "barn" } | { kind: "luft" } | { kind: "kalender" };
const SIMPLE_ROUTES = ["settings", "rooms", "energy", "chat", "sonos", "spotify", "oda", "lydboker", "notater", "robots", "vedlikehold", "barn", "luft", "kalender"] as const;

const TAB_ICON: Record<string, typeof HomeIcon> = { rooms: LayoutGrid, kalender: CalendarDays, barn: Baby, luft: Wind, energy: Zap, chat: MessageCircle, notater: StickyNote, robots: Bot, vedlikehold: Wrench, sonos: Speaker, spotify: Music2, lydboker: Headphones, oda: ShoppingCart, settings: SettingsIcon };

function parseHash(): { route: Route; device: string | null; voice: boolean } {
  const h = location.hash.replace(/^#\/?/, "");
  const [a, b] = h.split("/");
  const route: Route = a === "room" && b ? { kind: "room", id: decodeURIComponent(b) } : (SIMPLE_ROUTES as readonly string[]).includes(a ?? "") ? ({ kind: a } as Route) : { kind: "home" };
  return { route, device: a === "device" && b ? decodeURIComponent(b) : null, voice: a === "voice" };
}

function makeStore(cfg: HomeConfig): HomeStore {
  const backend = cfg.mock || !cfg.token ? new MockBackend() : new HaBackend({ url: cfg.url, token: cfg.token });
  return new HomeStore(backend);
}

export function App({ initial }: { initial: HomeConfig & { secureBackend?: string } }) {
  const [config, setConfig] = useState<HomeConfig>(initial);
  const [store, setStore] = useState<HomeStore | null>(null);
  useEffect(() => {
    const s = makeStore(config);
    setStore(s);
    s.start().catch(() => undefined);
    return () => s.stop();
  }, [config]);
  const onSave = useCallback(async (c: HomeConfig) => { await saveConfig(c); setConfig(await loadConfig()); }, []);
  if (!store) return null;
  return (
    <HomeProvider store={store}>
      <PrefsProvider>
        <EditProvider><Shell store={store} config={config} secureBackend={initial.secureBackend} onSave={onSave} /></EditProvider>
      </PrefsProvider>
    </HomeProvider>
  );
}

function Shell({ store, config, secureBackend, onSave }: { store: HomeStore; config: HomeConfig; secureBackend?: string; onSave: (c: HomeConfig) => Promise<void> }) {
  const init = parseHash();
  const [route, setRoute] = useState<Route>(init.route);
  const [device, setDevice] = useState<string | null>(init.device);
  const [voiceOpen, setVoiceOpen] = useState(init.voice);
  const voice = useVoice(store);
  const chat = useChat();
  const [chatOpen, setChatOpen] = useState(false);
  const [more, setMore] = useState(false);
  const notif = useNotifications(); const [notifOpen, setNotifOpen] = useState(false);
  const snap = useSnapshot();
  const rooms = useRooms();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const onHash = () => { const p = parseHash(); setRoute(p.route); setDevice(p.device); if (p.voice) setVoiceOpen(true); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // Global push-to-talk: hold Space (when not typing); Ctrl/Cmd+K opens voice.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setVoiceOpen(true); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setChatOpen((o) => !o); return; }
      if (e.key === "Escape") { setChatOpen(false); setMore(false); }
      if (e.code === "Space" && !typing(e) && !e.repeat && voiceOpen && !voice.handsFree) { e.preventDefault(); void voice.listen(); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space" && !typing(e) && voiceOpen && !voice.handsFree) voice.release(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [voice, voiceOpen]);

  const go = (r: Route) => navTransition(() => { setRoute(r); history.replaceState(null, "", r.kind === "room" ? `#/room/${r.id}` : r.kind === "home" ? "#/" : `#/${r.kind}`); setMore(false); document.querySelector(".main")?.scrollTo({ top: 0 }); }, route.kind, r.kind === "room" ? `room-${r.id}` : r.kind);
  const { prefs, update } = usePrefs();
  const ed = useEdit();
  const vis = ed.visibleTabs();
  const longPress = useLongPressEdit();
  const custom = !!ed.layout.tabOrder;
  const slots = (custom ? vis.filter((k) => k !== "rooms") : ["chat", "sonos"].filter((k) => vis.includes(k))).slice(0, 2);
  const label = (k: string) => TAB_DEFS.find((t) => t.key === k)?.label ?? k;
  const collapsed = prefs.sidebar === "rail";
  const toggleRail = () => update((p) => ({ ...p, sidebar: p.sidebar === "rail" ? "full" : "rail" }));
  const live = store.backend.kind === "live";
  const status = snap.status;

  return (
    <div className={`app ${collapsed ? "rail" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark" aria-hidden /><span className="lbl">Home</span><button className="rail-toggle" onClick={toggleRail} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand" : "Collapse"}>{collapsed ? <PanelLeftOpen size={16} strokeWidth={1.75} /> : <PanelLeftClose size={16} strokeWidth={1.75} />}</button></div>
        <nav>
          <button className={route.kind === "home" ? "active" : ""} onClick={() => go({ kind: "home" })} title="Hjem"><HomeIcon size={16} strokeWidth={1.75} /> <span className="lbl">Hjem</span></button>
          {vis.filter((k) => k !== "rooms").map((k) => { const I = TAB_ICON[k] ?? LayoutGrid; return <button key={k} className={route.kind === k ? "active" : ""} onClick={() => go({ kind: k } as Route)} title={label(k)}><I size={16} strokeWidth={1.75} /> <span className="lbl">{label(k)}</span></button>; })}
          <button onClick={() => setVoiceOpen(true)} title="Stemme (Ctrl+K)"><Mic size={16} strokeWidth={1.75} /> <span className="lbl">Stemme</span></button>
          <div className="nav-label">Rom</div>
          {rooms.filter((r) => r.controls.length + r.sensors.length > 0).map((r) => {
            const I = areaIcon(r.icon, r.name);
            return (
              <button key={r.id} className={route.kind === "room" && route.id === r.id ? "active" : ""} onClick={() => go({ kind: "room", id: r.id })} title={r.name}>
                <I size={16} strokeWidth={1.75} /> <span className="grow lbl">{r.name}</span>{r.lightsOn > 0 && <span className="nav-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <button className={route.kind === "settings" ? "active" : ""} onClick={() => go({ kind: "settings" })}><SettingsIcon size={16} strokeWidth={1.75} /> <span className="lbl">Innstillinger</span></button>
          <div className={`conn conn-${status}`} title={snap.statusDetail}>
            <span className="dot" /><span className="lbl">{status === "connected" ? (live ? "Tilkoblet" : "Demodata") : status === "auth-failed" ? "Token avvist" : status === "error" ? "Frakoblet" : "Kobler til …"}</span>
          </div>
        </div>
      </aside>

      <main className="main" {...longPress}>
        <EditBar routeKind={route.kind} />
        <header className={`topbar ${route.kind === "home" ? "home" : "slim"}`}>
          <div className="topbar-text">
            {route.kind === "home" && <TopBar now={now} unread={notif.unread} openNotif={() => setNotifOpen(true)} />}
          </div>
          <div className="topbar-right">
            {!live && <button className="tag" onClick={() => go({ kind: "settings" })}>Demo</button>}
            {route.kind !== "chat" && <button className="icon-btn ghost ask-btn" onClick={() => setChatOpen(true)} aria-label="Spør assistenten" title="Spør assistenten"><Sparkles size={17} strokeWidth={1.75} /><span className="lbl">Spør</span></button>}
            <button className="icon-btn ghost hvile-btn" onClick={() => startHvile()} aria-label="Hvilemodus" title="Hvilemodus"><MoonStar size={17} strokeWidth={1.75} /></button>
            <EditButton />
            <BellButton n={notif} onClick={() => setNotifOpen(true)} />
            <button className="icon-btn ghost" onClick={() => setVoiceOpen(true)} aria-label="Stemmeassistent" title="Stemme"><Mic size={18} strokeWidth={1.75} /></button>
          </div>
        </header>

        {(status === "error" || status === "auth-failed") && route.kind !== "settings" && (
          <div className="notice bad banner">
            <AlertCircle size={16} />
            {status === "auth-failed" ? "Home Assistant avviste tokenet." : `Får ikke kontakt med Home Assistant på ${config.url}.`}
            <button className="btn sm" onClick={() => go({ kind: "settings" })}>Innstillinger</button>
            <button className="btn sm" onClick={() => void onSave({ ...config, mock: true })}>Bruk demo</button>
          </div>
        )}
        {route.kind === "home" && <UrgentBanner n={notif} />}
        {snap.lastError && Date.now() - snap.lastError.at < 6000 && <div className="toast">{snap.lastError.message}</div>}

        <AnimatePresence mode="wait">
          <motion.div key={route.kind === "room" ? `room-${route.id}` : route.kind} data-route={route.kind === "room" ? `room-${route.id}` : route.kind} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: "easeOut" }}>
            {route.kind === "home" && <Dashboard openRoom={(id) => go({ kind: "room", id })} openDevice={setDevice} openSettings={() => go({ kind: "settings" })} openNotes={() => go({ kind: "notater" })} openMaintenance={() => go({ kind: "vedlikehold" })} unread={notif.unread} openNotif={() => setNotifOpen(true)} />}
            {route.kind === "rooms" && <RoomsPage openRoom={(id) => go({ kind: "room", id })} />}
            {route.kind === "room" && <RoomView roomId={route.id} back={() => go({ kind: window.innerWidth < 768 ? "rooms" : "home" })} openDevice={setDevice} />}
            {route.kind === "energy" && <EnergyPage openDevice={setDevice} />}
            {route.kind === "chat" && <ChatPage chat={chat} openVoice={() => setVoiceOpen(true)} />}
            {route.kind === "sonos" && <SonosPage />}
            {route.kind === "spotify" && <SpotifyPage openSonos={() => go({ kind: "sonos" })} />}
            {route.kind === "oda" && <OdaPage />}
            {route.kind === "lydboker" && <LydbokerPage />}
            {route.kind === "notater" && <NotesPage />}
            {route.kind === "robots" && <RobotsPage />}
            {route.kind === "barn" && <BarnPage />}
            {route.kind === "luft" && <LuftPage />}
            {route.kind === "kalender" && <KalenderPage />}
            {route.kind === "vedlikehold" && <MaintenancePage />}
            {route.kind === "settings" && <Settings config={config} secureBackend={secureBackend} onSave={onSave} voice={voice} live={live} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="tabbar">
        <button className={route.kind === "home" ? "active" : ""} onClick={() => go({ kind: "home" })}><HomeIcon size={22} strokeWidth={1.75} /><span>Hjem</span></button>
        {vis.includes("rooms") && <button className={route.kind === "rooms" || route.kind === "room" ? "active" : ""} onClick={() => go({ kind: "rooms" })}><LayoutGrid size={22} strokeWidth={1.75} /><span>Rom</span></button>}
        {slots.map((k) => { const I = TAB_ICON[k] ?? LayoutGrid; return <button key={k} className={route.kind === k ? "active" : ""} onClick={() => go({ kind: k } as Route)}><I size={22} strokeWidth={1.75} /><span>{label(k)}</span></button>; })}
        <button className={more || (route.kind !== "home" && route.kind !== "room" && !slots.includes(route.kind) && route.kind !== "rooms") ? "active" : ""} onClick={() => setMore((m) => !m)}><MoreHorizontal size={22} strokeWidth={1.75} /><span>Mer</span></button>
      </nav>
      {more && <div className="more-scrim" onClick={() => setMore(false)}>
        <div className="more-sheet" onClick={(e) => e.stopPropagation()}>
          {[...vis.filter((k) => k !== "rooms" && !slots.includes(k)), "settings"].map((k) => { const I = TAB_ICON[k] ?? SettingsIcon; return (
            <button key={k} className={route.kind === k ? "active" : ""} onClick={() => go({ kind: k } as Route)}><I size={20} strokeWidth={1.75} /><span>{k === "settings" ? "Innstillinger" : label(k)}</span></button>); })}
          <button onClick={() => { setMore(false); setVoiceOpen(true); }}><Mic size={20} strokeWidth={1.75} /><span>Stemme</span></button>
        </div>
      </div>}
      {chatOpen && route.kind !== "chat" && <div className="chat-scrim" onClick={() => setChatOpen(false)}>
        <aside className="chat-panel" onClick={(e) => e.stopPropagation()} aria-label="Assistent">
          <header><Sparkles size={16} strokeWidth={1.75} /><span className="grow">Assistent</span>
            <button className="btn sm ghost" onClick={() => { setChatOpen(false); go({ kind: "chat" }); }}>Åpne fullt</button>
            <button className="icon-btn ghost" onClick={() => setChatOpen(false)} aria-label="Lukk"><X size={18} /></button></header>
          <ChatView chat={chat} compact openVoice={() => setVoiceOpen(true)} />
        </aside>
      </div>}

      <AltNav routeKind={route.kind} routeKey={route.kind === "room" ? `room-${route.id}` : route.kind} go={(k, id) => go(k === "room" && id ? { kind: "room", id } : ({ kind: k } as Route))} openDevice={setDevice} openVoice={() => setVoiceOpen(true)} openChat={(q) => { setChatOpen(true); if (q) void chat.send(q); }} />
      <NotificationPanel n={notif} open={notifOpen} close={() => { setNotifOpen(false); void notif.reload(); }} />
      <DeviceSheet id={device} onClose={() => { setDevice(null); if (location.hash.startsWith("#/device")) history.replaceState(null, "", "#/"); }} />
      <Hvileskjerm blocked={voiceOpen} />
      <VoiceOverlay open={voiceOpen} onClose={() => { setVoiceOpen(false); if (location.hash === "#/voice") history.replaceState(null, "", "#/"); }} voice={voice} />
    </div>
  );
}
