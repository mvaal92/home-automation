import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Link2, Link2Off, ListMusic, Music2, Pause, Play, Search, SkipBack, SkipForward, Speaker, Star, Tv, Volume1, Volume2, VolumeX } from "lucide-react";
import { domainOf, num, type EntityState } from "@home/core";
import { useCall, useSnapshot } from "../lib/home";
import { api, haImg, type BrowseItem } from "../lib/api";

const attr = (e: EntityState | undefined, k: string) => e?.attributes[k];
const playing = (e?: EntityState) => e?.state === "playing";

export function useSonos(): EntityState[] {
  const { entities } = useSnapshot();
  // Native Sonos integration entities expose group_members; SmartThings duplicates don't.
  return useMemo(() => Object.values(entities).filter((e) => domainOf(e.entity_id) === "media_player" && Array.isArray(e.attributes.group_members) && e.state !== "unavailable")
    .sort((a, b) => String(a.attributes.friendly_name).localeCompare(String(b.attributes.friendly_name))), [entities]);
}

export function NowPlaying({ e, big = false }: { e: EntityState; big?: boolean }) {
  const call = useCall();
  const svc = (service: string, data?: Record<string, unknown>) => call({ domain: "media_player", service, target: { entity_id: e.entity_id }, data });
  const art = haImg(attr(e, "entity_picture"));
  const title = String(attr(e, "media_title") ?? (e.state === "idle" || e.state === "paused" ? "Ingenting spilles" : e.state));
  const artist = [attr(e, "media_artist"), attr(e, "media_album_name")].filter(Boolean).join(" · ");
  const dur = num(attr(e, "media_duration")); const pos = num(attr(e, "media_position"));
  return (
    <div className={`now-playing ${big ? "big" : ""}`}>
      <div className="np-art" style={art ? { backgroundImage: `url(${art})` } : undefined}>{!art && <Music2 size={big ? 40 : 22} strokeWidth={1.5} />}</div>
      <div className="np-body">
        <div className="np-title">{title}</div>
        <div className="np-artist muted">{artist || (String(attr(e, "source") ?? "") !== title ? String(attr(e, "source") ?? attr(e, "app_name") ?? "") : "Sonos Arc · TV-lyd")}</div>
        {big && dur && pos !== undefined && <div className="np-progress"><span style={{ width: `${Math.min(100, (pos / dur) * 100)}%` }} /></div>}
        <div className="np-ctrl">
          <button className="icon-btn ghost" onClick={() => svc("media_previous_track")} aria-label="Forrige"><SkipBack size={18} /></button>
          <button className="play" onClick={() => svc(playing(e) ? "media_pause" : "media_play")} aria-label={playing(e) ? "Pause" : "Spill"}>{playing(e) ? <Pause size={20} /> : <Play size={20} />}</button>
          <button className="icon-btn ghost" onClick={() => svc("media_next_track")} aria-label="Neste"><SkipForward size={18} /></button>
        </div>
      </div>
    </div>
  );
}

function VolumeRow({ e }: { e: EntityState }) {
  const call = useCall();
  const vol = Math.round((num(attr(e, "volume_level")) ?? 0) * 100); const muted = attr(e, "is_volume_muted") === true;
  const [v, setV] = useState(vol); useEffect(() => setV(vol), [vol]);
  const Icon = muted || v === 0 ? VolumeX : v < 40 ? Volume1 : Volume2;
  return (
    <div className="vol-row">
      <button className="icon-btn ghost" onClick={() => call({ domain: "media_player", service: "volume_mute", target: { entity_id: e.entity_id }, data: { is_volume_muted: !muted } })} aria-label="Demp"><Icon size={16} /></button>
      <span className="vol-name">{String(attr(e, "friendly_name"))}</span>
      <input type="range" min={0} max={100} value={v} onChange={(x) => setV(Number(x.target.value))}
        onPointerUp={() => call({ domain: "media_player", service: "volume_set", target: { entity_id: e.entity_id }, data: { volume_level: v / 100 } })}
        onKeyUp={() => call({ domain: "media_player", service: "volume_set", target: { entity_id: e.entity_id }, data: { volume_level: v / 100 } })} />
      <span className="vol-val">{v}</span>
    </div>
  );
}

/** Generic HA media browser (Sonos favorites, playlists, Spotify library...). */
export function Browser({ entity, root, onPlay, title }: { entity: string; root?: { id: string; type: string }; onPlay?: (i: BrowseItem) => void; title?: string }) {
  const call = useCall();
  const [stack, setStack] = useState<Array<{ id?: string; type?: string; title: string }>>([{ id: root?.id, type: root?.type, title: title ?? "Bibliotek" }]);
  const [node, setNode] = useState<BrowseItem | null>(null); const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const cur = stack[stack.length - 1]!;
  useEffect(() => { setStack([{ id: root?.id, type: root?.type, title: title ?? "Bibliotek" }]); }, [entity, root?.id]); // eslint-disable-line
  useEffect(() => {
    setLoading(true); setErr(null);
    api<BrowseItem>("/api/media/browse", { json: { entity_id: entity, media_content_id: cur.id, media_content_type: cur.type } })
      .then(setNode).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, [entity, cur.id, cur.type]);
  const play = (i: BrowseItem) => { if (onPlay) onPlay(i); else call({ domain: "media_player", service: "play_media", target: { entity_id: entity }, data: { media_content_id: i.media_content_id, media_content_type: i.media_content_type } }); };
  return (
    <div className="browser">
      <div className="browser-head">{stack.length > 1 && <button className="icon-btn ghost" onClick={() => setStack((s) => s.slice(0, -1))} aria-label="Tilbake"><ChevronLeft size={18} /></button>}<span className="browser-title">{node?.title && stack.length > 1 ? node.title : cur.title}</span></div>
      {err && <p className="muted small">{err}</p>}
      <div className={`browse-grid ${loading ? "loading" : ""}`}>
        {(node?.children ?? []).map((c) => (
          <button key={c.media_content_id + c.title} className="browse-item" onClick={() => (c.can_expand ? setStack((s) => [...s, { id: c.media_content_id, type: c.media_content_type, title: c.title }]) : c.can_play && play(c))}>
            <span className="bi-art" style={c.thumbnail ? { backgroundImage: `url(${haImg(c.thumbnail)})` } : undefined}>{!c.thumbnail && (c.can_expand ? <ListMusic size={18} /> : <Music2 size={18} />)}</span>
            <span className="bi-title">{c.title}</span>
            {c.can_play && <span className="bi-play" onClick={(ev) => { ev.stopPropagation(); play(c); }}><Play size={14} /></span>}
          </button>
        ))}
        {!loading && node && (node.children ?? []).length === 0 && <p className="muted small">Tomt.</p>}
      </div>
    </div>
  );
}

export function SonosPage() {
  const speakers = useSonos();
  const call = useCall();
  const [sel, setSel] = useState<string | null>(null);
  const active = speakers.find((s) => s.entity_id === sel) ?? speakers.find(playing) ?? speakers[0];
  if (!active) return <div className="page"><h1 className="page-title">Sonos</h1><p className="muted">Fant ingen Sonos-høyttalere i Home Assistant.</p></div>;
  const members = (attr(active, "group_members") as string[] | undefined) ?? [active.entity_id];
  const leader = members[0]!;
  const sources = (attr(active, "source_list") as string[] | undefined) ?? [];
  const isArc = /arc|tv/i.test(`${active.entity_id} ${attr(active, "friendly_name")}`);
  return (
    <div className="page media-page">
      <h1 className="page-title">Sonos</h1>
      <div className="speaker-tabs">{speakers.map((s) => (
        <button key={s.entity_id} className={`speaker-pill ${s.entity_id === active.entity_id ? "active" : ""} ${playing(s) ? "playing" : ""}`} onClick={() => setSel(s.entity_id)}>
          {/arc|tv/i.test(s.entity_id) ? <Tv size={15} /> : <Speaker size={15} />}{String(attr(s, "friendly_name"))}{playing(s) && <span className="eq"><i /><i /><i /></span>}
        </button>))}
      </div>
      <div className="media-grid">
        <section className="card np-card"><NowPlaying e={active} big />
          {isArc && sources.includes("TV") && <div className="row-actions"><button className={`btn sm ${attr(active, "source") === "TV" ? "primary" : ""}`} onClick={() => call({ domain: "media_player", service: "select_source", target: { entity_id: active.entity_id }, data: { source: "TV" } })}><Tv size={14} /> TV-lyd</button></div>}
        </section>
        <section className="card">
          <h3>Volum og grupper</h3>
          {speakers.map((s) => {
            const inGroup = members.includes(s.entity_id);
            return (
              <div key={s.entity_id} className="group-row">
                <VolumeRow e={s} />
                {s.entity_id !== active.entity_id && (inGroup
                  ? <button className="btn sm ghost" onClick={() => call({ domain: "media_player", service: "unjoin", target: { entity_id: s.entity_id } })} title="Fjern fra gruppe"><Link2Off size={14} /> Fjern</button>
                  : <button className="btn sm" onClick={() => call({ domain: "media_player", service: "join", target: { entity_id: leader }, data: { group_members: [s.entity_id] } })} title="Spill samme her"><Link2 size={14} /> Grupper</button>)}
              </div>
            );
          })}
          {members.length > 1 && <p className="muted small">Gruppe: {members.map((m) => String(speakers.find((s) => s.entity_id === m)?.attributes.friendly_name ?? m)).join(" + ")}</p>}
        </section>
      </div>
      <section className="card"><h3><Star size={15} /> Favoritter og bibliotek</h3>
        <Browser entity={active.entity_id} root={{ id: "", type: "favorites" }} title="Sonos-favoritter" />
      </section>
      <section className="card"><h3><ListMusic size={15} /> Alle kilder</h3><Browser entity={active.entity_id} title="Bibliotek" /></section>
    </div>
  );
}

export function SpotifyPage({ openSonos }: { openSonos: () => void }) {
  const { entities } = useSnapshot();
  const call = useCall();
  const sp = Object.values(entities).find((e) => e.entity_id.startsWith("media_player.spotify"));
  const [cfg, setCfg] = useState<{ configured: boolean } | null>(null);
  const [q, setQ] = useState(""); const [results, setResults] = useState<BrowseItem | null>(null);
  useEffect(() => { api<{ configured: boolean }>("/api/media/spotify").then(setCfg).catch(() => setCfg({ configured: false })); }, []);
  if (!sp) return (
    <div className="page media-page">
      <h1 className="page-title">Spotify</h1>
      <section className="card setup-card">
        <span className="setup-ico"><Music2 size={22} /></span>
        <h3>{cfg?.configured ? "Spotify kobler til…" : "Koble til Spotify"}</h3>
        <p className="muted">Spotify-fanen bruker Home Assistants Spotify-integrasjon (søk, spillelister, likte sanger og Spotify Connect til Sonos og andre enheter). Den trenger en engangs-innlogging med Spotify-kontoen din.</p>
        <ol className="steps">
          <li>Lag en app på <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com</a> med redirect-URI <code>https://my.home-assistant.io/redirect/oauth</code>.</li>
          <li>Legg inn Client ID og Secret i Home Assistant → Application credentials → Spotify.</li>
          <li>Legg til Spotify-integrasjonen og logg inn.</li>
        </ol>
        <button className="btn" onClick={openSonos}><Speaker size={14} /> Bruk Sonos så lenge</button>
      </section>
    </div>
  );
  const sources = (attr(sp, "source_list") as string[] | undefined) ?? [];
  const search = async () => { if (!q.trim()) return; try { const r = await api<{ result: BrowseItem } | BrowseItem>("/api/media/search", { json: { entity_id: sp.entity_id, query: q } }); setResults(("result" in r ? r.result : r) as BrowseItem); } catch { setResults(null); } };
  return (
    <div className="page media-page">
      <h1 className="page-title">Spotify</h1>
      <div className="media-grid">
        <section className="card np-card"><NowPlaying e={sp} big />
          <div className="row-actions"><span className="muted small">Spill på</span>
            <select className="select" value={String(attr(sp, "source") ?? "")} onChange={(x) => call({ domain: "media_player", service: "select_source", target: { entity_id: sp.entity_id }, data: { source: x.target.value } })}>
              <option value="" disabled>Velg enhet</option>{sources.map((s) => <option key={s}>{s}</option>)}
            </select></div>
        </section>
        <section className="card"><h3>Volum</h3><VolumeRow e={sp} /></section>
      </div>
      <section className="card"><div className="search-bar"><Search size={16} /><input value={q} placeholder="Søk etter sanger, artister, spillelister" onChange={(x) => setQ(x.target.value)} onKeyDown={(x) => x.key === "Enter" && void search()} /></div>
        {results && <div className="browse-grid">{(results.children ?? []).map((c) => (
          <button key={c.media_content_id} className="browse-item" onClick={() => call({ domain: "media_player", service: "play_media", target: { entity_id: sp.entity_id }, data: { media_content_id: c.media_content_id, media_content_type: c.media_content_type } })}>
            <span className="bi-art" style={c.thumbnail ? { backgroundImage: `url(${haImg(c.thumbnail)})` } : undefined} /><span className="bi-title">{c.title}</span></button>))}</div>}
      </section>
      <section className="card"><h3>Ditt bibliotek</h3><Browser entity={sp.entity_id} title="Spotify" /></section>
    </div>
  );
}
