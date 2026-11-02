// Tilkoblinger: auth health for every integration + keep-alive + expiry notifications + re-login actions.
// Never returns secrets. Routes are Tailscale-only (trusted()). Login actions only OPEN pages in the owner's main
// Brave on omarchy (CDP 127.0.0.1:9222) – legacy; the UI now uses the auth broker (lib/auth/) for native logins; identity/passwords are entered via secure-fill or by the owner, never here.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as skole from "./skole.mjs";
import * as mykid from "./mykid.mjs";
import * as odaLib from "./oda.mjs";
import { haRest } from "./ha.mjs";
import { SECRETS, expand, sendJson } from "./util.mjs";
import { SCHOOL } from "./family.mjs";
import * as fabelLib from "./fabel.mjs";
import { initKeeper } from "./keeper.mjs";
const CDP = process.env.HOME_CDP ?? "http://127.0.0.1:9222";
const AUTH = expand("~/home-automation/data/auth");
const HA_PUBLIC = process.env.HOME_HA_PUBLIC ?? "http://127.0.0.1:8123";
const H = 3600e3;
const LOGIN = {
  skole: { url: "https://foresatt.visma.no/kommunen", kind: "bankid", host: /foresatt\.visma\.no|connect\.visma\.com|bankid/ },
  mykid: { url: "https://mykid.no/nb/logg_inn", kind: "bankid", host: /mykid\.no|bankid/ },
  navimow: { url: "https://navimow-h5-fra.willand.com/", kind: "captcha", host: /willand\.com|navimow/ },
  dreame: { url: "https://www.dreame.tech/", kind: "password", host: /dreame/ },
  fabel: { url: "https://fabel.no/min-side", kind: "sms", host: /fabel\.no/ },
};
const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };

export function initConnections(notify, resolve) {
  const live = { skole: { ok: null, at: 0, err: null, since: 0 }, mykid: { ok: null, at: 0, err: null, since: 0 }, oda: { ok: null, at: 0 } };
  const pending = {};   // id -> {startedAt}
  async function keepAlive() {
    for (const [id, lib] of [["skole", skole], ["mykid", mykid]]) {
      const l = live[id];
      try { await lib.ping(); if (!l.ok) l.since = Date.now(); l.ok = true; l.err = null; delete pending[id]; }
      catch (e) { l.ok = e.loginRequired ? false : l.ok; l.err = e.message; }
      l.at = Date.now();
    }
    try { await odaLib.cart(); live.oda.ok = true; } catch (e) { live.oda.ok = /40[13]/.test(e.message) ? false : live.oda.ok; live.oda.err = e.message; }
    live.oda.at = Date.now();
  }
  async function list() {
    const now = Date.now(); const out = [];
    const st = readJson(join(AUTH, "smartthings.json"));
    out.push({ id: "smartthings", name: "SmartThings", method: "OAuth via Home Assistant (fornyes automatisk)", durable: true,
      status: st && st.checked_at * 1000 > now - 2 * H ? (st.expires_at * 1000 > now ? "ok" : "expired") : "unknown",
      expiresAt: st ? st.expires_at * 1000 : null, autoRenew: true, checkedAt: st ? st.checked_at * 1000 : null,
      action: { type: "link", label: "Koble til på nytt", url: `${HA_PUBLIC}/config/integrations/integration/smartthings` } });
    let states = []; try { states = await haRest("/states"); } catch { /* */ }
    const has = (re) => states.filter((s) => re.test(s.entity_id));
    const sp = has(/^media_player\..*spotify/);
    out.push({ id: "spotify", name: "Spotify", method: "OAuth i Home Assistant (refresh-token)", durable: true, autoRenew: true,
      status: sp.length ? (sp.every((s) => s.state === "unavailable") ? "error" : "ok") : "not-connected",
      action: { type: "link", label: sp.length ? "Koble til på nytt" : "Koble til", url: `${HA_PUBLIC}/config/integrations/dashboard/add?domain=spotify` } });
    for (const id of ["skole", "mykid"]) {
      const l = live[id]; const s = (id === "skole" ? skole : mykid).load();
      out.push({ id, name: id === "skole" ? `Visma Flyt (Skole – ${SCHOOL.name})` : "MyKid (Barnehage)", method: id === "skole" ? "BankID-økt i Brave – sjekkes 05:40/15:30, BankID-varsel 07:30 ved utløp" : "Mobil + passord (krypteres i hvelvet) – automatisk ny innlogging 05:40/15:30 og ved utløp", durable: id === "mykid", autoRenew: id === "mykid", keeper: id === "mykid" ? keeper?.status() : undefined,
        status: pending[id] ? "login-pending" : l.ok === true ? "ok" : l.ok === false ? "login-required" : "unknown", aliveSince: l.since || null, checkedAt: l.at || null,
        error: l.ok ? null : l.err, cachedAt: s?.syncedAt ?? null, action: id === "skole" ? { type: "login", label: "Logg inn med BankID", kind: "bankid" } : { type: "login", label: "Logg inn", kind: "password" } });
    }
    const od = odaLib.status(); let odaAge = null; try { odaAge = statSync(join(SECRETS, "oda_session.json")).mtimeMs; } catch { /* */ }
    out.push({ id: "oda", name: "Oda", method: "Server-økt (sessionid, fornyes ved bruk)", durable: true, autoRenew: true,
      status: !od.loggedIn ? "login-required" : live.oda.ok === false ? "login-required" : live.oda.ok ? "ok" : "unknown", checkedAt: live.oda.at || null, savedAt: odaAge,
      action: { type: "tab", label: "Logg inn i Oda-fanen", url: "#/oda" } });
    const mow = has(/^lawn_mower\./);
    out.push({ id: "navimow", name: "Navimow (robotklipper)", method: "Konto-innlogging med glidebryter-captcha", durable: true, autoRenew: true,
      status: mow.length ? "ok" : "not-connected", action: { type: "login", label: "Åpne innlogging", kind: "captcha", note: "Dra glidebryteren i Brave på omarchy (arbeidsområde 2) eller via fjernvisning" } });
    const dv = states.find((s) => s.entity_id === "vacuum.dreame_x50_ultra");
    out.push({ id: "dreame", name: "Dreame X50 (støvsuger)", method: dv?.attributes?.source === "smartthings" ? "Via SmartThings (varig)" : "Dreamehome-sky", durable: true, autoRenew: true,
      status: dv && dv.state !== "unavailable" ? "ok" : "error", note: "Full Dreamehome-integrasjon (kart/forbruk) krever Dreamehome-innlogging", action: { type: "login", label: "Dreamehome-innlogging", kind: "password" } });
    const fb = fabelLib.status();
    out.push({ id: "fabel", name: "Fabel (lydbøker)", method: "Mobilnummer + SMS-kode (Sist lyttet)", durable: true, autoRenew: false,
      status: fb.account ? "ok" : "not-connected", note: "Katalogen virker uten innlogging. «Sist lyttet» krever innlogging med SMS-kode.",
      action: { type: "login", label: "Logg inn (SMS-kode)", kind: "sms", note: "Åpner Fabel i Brave på omarchy – skriv inn mobilnummer og koden fra SMS selv" } });
    for (const c of out) if (c.expiresAt) c.expiresInH = Math.round((c.expiresAt - now) / H * 10) / 10;
    return out;
  }
  async function notifyScan() {
    try {
      await keepAlive();
      for (const c of await list()) {
        const key = `conn:${c.id}`;
        if (c.status === "login-required" && !pending[c.id]) notify({ key, kind: "system", severity: "warning", title: `${c.name}: må logges inn igjen`, body: c.cachedAt ? "Viser lagrede data til du logger inn" : "Trykk for å koble til", link: `#/settings/login/${c.id}` });
        else if (c.expiresAt && !c.autoRenew && c.expiresAt - Date.now() < 12 * H) notify({ key, kind: "system", severity: "info", title: `${c.name} utløper snart`, body: `Om ca. ${Math.max(0, Math.round((c.expiresAt - Date.now()) / H))} t`, link: `#/settings/login/${c.id}` });
        else if (c.expiresAt && c.autoRenew && c.expiresAt < Date.now()) notify({ key, kind: "system", severity: "warning", title: `${c.name}: fornyelse feilet`, body: "Sjekk Tilkoblinger", link: `#/settings/login/${c.id}` });
        else if (c.status === "ok") resolve(key);
      }
    } catch (e) { console.error("connections scan", e.message); }
  }
  async function openLogin(id) {
    const L = LOGIN[id]; if (!L) throw Object.assign(new Error("ingen innlogging for " + id), { status: 400 });
    const tabs = await (await fetch(`${CDP}/json`, { signal: AbortSignal.timeout(3000) })).json();
    for (const t of tabs.filter((t) => t.type === "page" && L.host.test(t.url) && !/\/foreldre|kontaktinfo/.test(t.url))) await fetch(`${CDP}/json/close/${t.id}`).catch(() => {});
    // Background tab in the existing Brave window: never a new window, never steals focus.
    { const v = await (await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(3000) })).json(); const ws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((ok, ko) => { const t = setTimeout(() => ko(new Error("CDP timeout")), 5000); ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Target.createTarget", params: { url: L.url, newWindow: false, background: true } }));
        ws.onmessage = (e) => { const r = JSON.parse(e.data); if (r.id === 1) { clearTimeout(t); ws.close(); r.error ? ko(new Error(r.error.message)) : ok(); } }; ws.onerror = () => { clearTimeout(t); ko(new Error("CDP feil")); }; }); }
    pending[id] = { startedAt: Date.now() }; setTimeout(() => { if (pending[id] && Date.now() - pending[id].startedAt >= 9 * 60e3) delete pending[id]; }, 10 * 60e3);
    return { ok: true, kind: L.kind, message: L.kind === "bankid" ? "Innloggingen er åpnet i Brave på omarchy. Velg BankID og godkjenn i BankID-appen." : L.kind === "sms" ? "Fabel er åpnet i Brave på omarchy. Skriv inn mobilnummer og koden du får på SMS." : "Innloggingen er åpnet i Brave på omarchy." };
  }
  // No periodic keep-alive (the owner, 13 Oct): one status scan at startup; the keeper runs it daily 05:40 + 15:30.
  setTimeout(notifyScan, 20e3);
  const keeper = initKeeper({ notify, resolve, keepAlive, scan: () => notifyScan() });
  async function routes(req, res, sub, trusted) {
    if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
    try {
      if (req.method === "GET" && (sub === "" || sub === "status")) return sendJson(res, 200, { connections: await list(), pending: Object.keys(pending) });
      if (req.method === "GET" && sub === "keeper") return sendJson(res, 200, keeper.status());
      const k = /^keeper\/([a-z]+)\/login$/.exec(sub); if (k && req.method === "POST") return sendJson(res, 200, await keeper.loginNow(k[1]));
      const m = /^([a-z]+)\/(login|check)$/.exec(sub);
      if (m && req.method === "POST" && m[2] === "login") return sendJson(res, 200, await openLogin(m[1]));
      if (m && req.method === "POST" && m[2] === "check") { await keepAlive(); return sendJson(res, 200, (await list()).find((c) => c.id === m[1]) ?? null); }
      return sendJson(res, 404, { error: "not found" });
    } catch (e) { return sendJson(res, e.status ?? 502, { error: e.message }); }
  }
  return { routes, list, keepAlive, keeper };
}
