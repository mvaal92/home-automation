// Login keeper: keeps every integration logged in, systematically.
//  - NO periodic polling (per the owner): checks run once daily + 15:30, and on demand when a feature (mykid.sync) detects expiry
//  - scheduled proactive re-login: 05:40 daily (fresh ~24 h MyKid session before the day starts) and 15:30
//    (guarantees a valid session before the 15:47 MyKid digest)
//  - Visma Flyt (BankID): cannot be automatic. Checked at 05:40/15:30 (activity nudge when alive); if expired a
//    «Godkjenn BankID» notification is raised at 07:30.
//  - Password logins use credentials in the encrypted auth vault (cred:<id>); values are never logged/returned.
//    Max 2 automatic password attempts per provider per day, then a notification.
// Root cause (13 Oct): MyKid has an absolute server session lifetime of ~24 h (login 12 Oct 16:13 → reset
// 13 Oct 16:09 with a new MYKIDUID); 10-min pings cannot extend it. Visma Flyt's SPA navigates to /logout after
// ~15 min of UI inactivity; API pings (v1/session) don't count as activity.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as mykid from "./mykid.mjs";
import * as skole from "./skole.mjs";
import * as odaLib from "./oda.mjs";
import { vault } from "./auth/vault.mjs";
import { Page, MAIN_CDP } from "./auth/cdp.mjs";
import { expand } from "./util.mjs";
const LOG_DIR = expand("~/home-automation/data/auth"); mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
const LOG = join(LOG_DIR, "keeper.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toLocaleDateString("sv-SE");
function log(ev) { const line = JSON.stringify({ at: new Date().toISOString(), ...ev }); try { appendFileSync(LOG, line + "\n", { mode: 0o600 }); } catch { /* */ } console.log("keeper", line); }
const meta = () => { const m = { ...(vault.get("_keeper") ?? {}) }; delete m._savedAt; return m; };
const setMeta = (patch) => vault.set("_keeper", { ...meta(), ...patch });
function attemptsToday(id) { const a = meta().attempts?.[id]; return a?.day === today() ? a.n : 0; }
function bump(id, ok) { const m = meta(); const all = { ...(m.attempts ?? {}) }; all[id] = ok ? { day: today(), n: 0 } : { day: today(), n: attemptsToday(id) + 1 }; setMeta({ attempts: all }); }

async function tabs() { return (await fetch(`${MAIN_CDP}/json`, { signal: AbortSignal.timeout(3000) })).json(); }

// ---- MyKid: mobile + password, fully automatic ----
const MYKID_LOGIN = "https://mykid.no/nb/logg_inn";
export async function mykidLogin({ reason, force = false }) {
  const cred = vault.get("cred:mykid");
  if (!cred?.username || !cred?.password) return { ok: false, need: "credential", msg: "Mangler lagret MyKid-passord" };
  if (attemptsToday("mykid") >= 2) return { ok: false, need: "attempts", msg: "Maks to automatiske passordforsøk i dag" };
  if (!force) { try { await mykid.ping(); return { ok: true, skipped: true }; } catch { /* needs login */ } }
  // Dedicated keeper tab (background, main Brave profile). Reuse an existing mykid tab if any; else open one.
  const t = (await tabs()).find((x) => x.type === "page" && /^https:\/\/mykid\.no\//.test(x.url));
  const page = t ? await Page.attach(MAIN_CDP, t.id) : await Page.open(MAIN_CDP, MYKID_LOGIN, { background: true });
  try {
    if (force) { await page.send("Page.navigate", { url: "https://mykid.no/forside/loggut" }); await sleep(2500); }
    await page.send("Page.navigate", { url: MYKID_LOGIN }); await sleep(3000);
    if (!(await page.exists("#login_form #password"))) {   // already logged in → redirected away from the login page
      try { await mykid.ping(); setMeta({ mykidLoginAt: Date.now() }); return { ok: true }; } catch { return { ok: false, msg: "Fant ikke innloggingsskjemaet" }; }
    }
    await page.fill("#username", cred.username); await page.fill("#password", cred.password);
    await page.eval(`document.querySelector("#login_form button[type=submit]").click()`);
    for (let i = 0; i < 10; i++) { await sleep(1500); try { await mykid.ping(); bump("mykid", true); setMeta({ mykidLoginAt: Date.now() }); return { ok: true }; } catch { /* wait */ } }
    const txt = String(await page.text().catch(() => ""));
    const sms = await page.eval(`(()=>{const e=document.querySelector("#ad_code");return !!(e&&e.offsetParent)})()`).catch(() => false);
    if (sms) return { ok: false, need: "sms", msg: "MyKid ber om SMS-kode" };
    bump("mykid", false);
    return { ok: false, need: "password", msg: /feil|ugyldig|wrong|incorrect/i.test(txt) ? "MyKid avviste passordet" : "Innloggingen ble ikke bekreftet" };
  } finally { await page.close({ closeTab: false }); }
}

// ---- Oda: email + password (vault cred:oda is saved by the in-app sheet) ----
export async function odaLogin() {
  const cred = vault.get("cred:oda"); if (!cred) return { ok: false, need: "credential", msg: "Logg inn én gang i appen" };
  if (attemptsToday("oda") >= 2) return { ok: false, need: "attempts", msg: "Maks to forsøk i dag" };
  try { const s = await odaLib.login(cred.username, cred.password); bump("oda", s.loggedIn); return { ok: !!s.loggedIn }; } catch { bump("oda", false); return { ok: false, need: "password", msg: "Oda avviste innloggingen" }; }
}

// ---- Visma Flyt: UI activity so the SPA's idle logout never fires ----
async function skoleActivity() {
  for (const t of (await tabs()).filter((x) => x.type === "page" && /^https:\/\/foresatt\.visma\.no\/(?!kommunen\/?$)/.test(x.url) && !/login|logout|error/.test(x.url))) {
    let p; try { p = await Page.attach(MAIN_CDP, t.id);
      await p.eval(`(()=>{for(const n of ["mousemove","mousedown","keydown","scroll","touchstart","visibilitychange"])document.dispatchEvent(new Event(n,{bubbles:true}));window.dispatchEvent(new Event("focus"));return true})()`);
      await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20 + Math.floor(Math.random() * 40), y: 20 }).catch(() => {});
    } catch { /* */ } finally { await p?.close({ closeTab: false }); }
  }
}

export function initKeeper({ notify, resolve, keepAlive, scan = async () => {} }) {
  const state = { last: {}, busy: false, firedDay: {} };
  const N = {
    mykid: (r) => r.need === "sms" ? notify({ key: "keeper:mykid", kind: "system", severity: "warning", title: "MyKid: skriv inn SMS-koden", body: "MyKid ba om en kode på SMS for å logge inn", link: "#/settings/login/mykid" })
      : notify({ key: "keeper:mykid", kind: "system", severity: "warning", title: "MyKid: automatisk innlogging feilet", body: `${r.msg}. Trykk for å logge inn.`, link: "#/settings/login/mykid" }),
    oda: (r) => notify({ key: "keeper:oda", kind: "system", severity: "warning", title: "Oda: automatisk innlogging feilet", body: r.msg, link: "#/settings/login/oda" }),
  };
  async function run(id, fn, opts) {
    let r; try { r = await fn(opts); } catch (e) { r = { ok: false, msg: String(e.message).slice(0, 120) }; }
    state.last[id] = { ...r, at: Date.now(), reason: opts?.reason }; if (!r.skipped) log({ id, reason: opts?.reason, ok: r.ok, need: r.need ?? null, msg: r.msg ?? null });
    if (r.ok) resolve(`keeper:${id}`); else if (r.need !== "credential" || id === "mykid") N[id]?.(r);
    if (r.ok && !r.skipped && id === "mykid") mykid.sync().catch(() => {});
    return r;
  }
  async function check(reason = "health") {
    if (state.busy) return; state.busy = true;
    try {
      let mk = true; try { await mykid.ping(); } catch (e) { mk = !e.loginRequired && !/utlogget/.test(e.message); }
      const age = Date.now() - (meta().mykidLoginAt ?? 0);
      if (!mk) await run("mykid", mykidLogin, { reason: `expired:${reason}` });
      else if (age > 20 * 3600e3 && reason !== "on-demand" && reason !== "startup") await run("mykid", mykidLogin, { reason: `proactive:${reason}`, force: true });
      if (vault.has("cred:oda") && !odaLib.status().loggedIn) await run("oda", odaLogin, { reason });
    } finally { state.busy = false; }
  }
  async function skoleCheck(notifyIfDown) {
    let ok = false; try { await skole.ping(); ok = true; } catch { /* */ }
    if (ok) { await skoleActivity(); resolve("keeper:skole"); }
    else if (notifyIfDown) { notify({ key: "keeper:skole", kind: "system", severity: "warning", title: "Skole: godkjenn BankID-innlogging", body: "Visma Flyt er logget ut. Trykk, skriv fødselsnummer og godkjenn i BankID-appen.", link: "#/settings/login/skole" }); log({ id: "skole", ok: false, need: "bankid", reason: "daily-07:30" }); }
    return ok;
  }
  function summary() { const m = meta(); log({ id: "summary", mykidLoginAt: m.mykidLoginAt ? new Date(m.mykidLoginAt).toISOString() : null, last: Object.fromEntries(Object.entries(state.last).map(([k, v]) => [k, { ok: v.ok, need: v.need ?? null, at: new Date(v.at).toISOString() }])) }); }
  const SCHEDULE = [["05:40", () => check("05:40").then(() => skoleCheck(false)).then(scan).then(summary)], ["07:30", () => skoleCheck(true)], ["15:30", () => check("15:30").then(() => skoleCheck(false)).then(scan)]];
  let lastOnDemand = 0;
  mykid.setOnLoginRequired(() => { if (Date.now() - lastOnDemand < 30 * 60e3) return; lastOnDemand = Date.now(); check("on-demand").catch(() => {}); });
  setInterval(() => {
    const hm = new Date().toTimeString().slice(0, 5);
    for (const [at, fn] of SCHEDULE) if (hm === at && state.firedDay[at] !== today()) { state.firedDay[at] = today(); fn().catch((e) => log({ id: "schedule", at, err: e.message })); }
  }, 20e3).unref();
  setTimeout(() => check("startup").catch(() => {}), 45e3).unref();
  return { check, status: () => ({ last: state.last, mykidLoginAt: meta().mykidLoginAt ?? null, hasCred: { mykid: vault.has("cred:mykid"), oda: vault.has("cred:oda") }, attempts: meta().attempts ?? {}, schedule: SCHEDULE.map((s) => s[0]) }),
    loginNow: (id) => id === "mykid" ? run("mykid", mykidLogin, { reason: "manual", force: true }) : id === "oda" ? run("oda", odaLogin, { reason: "manual" }) : Promise.resolve({ ok: false, msg: "ikke støttet" }) };
}
