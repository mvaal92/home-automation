// Server-side browser logins streamed to the device (isolated headless Chromium, data/auth/browser).
//  - Fabel: phone + SMS code typed in the app sheet; falls back to remote view if the page changes.
//  - Navimow: account login with slider captcha → remote view (screenshot + pointer relay) so the owner drags the
//    slider on his own phone/iPad. Credentials can be typed in the sheet (inserted into the focused field).
import { existsSync, writeFileSync } from "node:fs";
import { Page, ensureIsolated, MAIN_CDP } from "../cdp.mjs";
import { haRest } from "../../ha.mjs";
import { vault } from "../vault.mjs";
import { SECRETS } from "../../util.mjs";
import * as fabelLib from "../../fabel.mjs";
import { form, done, remote, fail, sleep } from "./_base.mjs";
const phoneField = [{ name: "phone", label: "Mobilnummer", type: "tel", autocomplete: "tel", inputmode: "tel" }];
const codeField = [{ name: "code", label: "Kode fra SMS", type: "code", autocomplete: "one-time-code", inputmode: "numeric", maxLength: 8 }];
const FABEL_URL = process.env.HOME_FABEL_LOGIN ?? "https://fabel.no/min-side";
export const fabel = { id: "fabel", name: "Fabel (lydbøker)", kind: "sms", method: "Mobilnummer + SMS-kode (Sist lyttet)", remoteCapable: true,
  status: async () => ({ status: fabelLib.status().account ? "ok" : "not-connected" }),
  async start(ctx) {
    ctx.page = await Page.open(await ensureIsolated(), FABEL_URL, { background: true });  // isolated headless browser; background anyway
    await ctx.page.send("Emulation.setDeviceMetricsOverride", { width: 400, height: 800, deviceScaleFactor: 2, mobile: true }).catch(() => {});
    for (let i = 0; i < 6 && !(await ctx.page.exists('input[type="tel"]')); i++) { await sleep(1000); await ctx.page.clickText("^(logg inn|logg inn med mobilnummer|min side)$"); }
    if (!(await ctx.page.exists('input[type="tel"]'))) return remote("Fabel", "Fant ikke innloggingsfeltet automatisk – fortsett på siden under.", { insert: phoneField[0] });
    return form("Logg inn på Fabel", phoneField, { submit: "Send kode", message: "Fabel sender en SMS-kode til nummeret.", alt: "Vis siden" });
  },
  async step(ctx, v) {
    if (v.view === "remote") return remote("Fabel", "Trykk på siden for å fortsette.", { insert: codeField[0] });
    if (v.insertFocused) { await ctx.page.key(String(v.phone ?? v.code ?? "")); return remote("Fabel", "Satt inn.", { insert: codeField[0] }); }
    if (!ctx.data.sent) {
      const ok = await ctx.page.fill('input[type="tel"]', String(v.phone ?? "").replace(/\s/g, "")); if (!ok) return remote("Fabel", "Fortsett på siden under.", { insert: phoneField[0] });
      if (!(await ctx.page.clickText("^(send kode|neste|fortsett|logg inn)$"))) await ctx.page.key("Enter");
      ctx.data.sent = true; await sleep(2500); return form("Skriv inn koden", codeField, { submit: "Logg inn", message: "Koden kommer på SMS om noen sekunder." });
    }
    const code = String(v.code ?? "").replace(/\D/g, "");
    const multi = await ctx.page.eval(`document.querySelectorAll('input[maxlength="1"]').length`);
    if (multi > 1) { await ctx.page.eval(`document.querySelector('input[maxlength="1"]').focus()`); for (const ch of code) await ctx.page.key(ch); }
    else if (!(await ctx.page.fill('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i], input[type="tel"]', code))) return remote("Fabel", "Skriv koden på siden under.", { insert: codeField[0] });
    await ctx.page.clickText("^(logg inn|bekreft|fortsett|neste)$"); await sleep(3500);
    return this.poll(ctx);
  },
  async poll(ctx) {
    const { cookies } = await ctx.page.send("Network.getAllCookies").catch(() => ({ cookies: [] }));
    const auth = cookies.filter((c) => /fabel/.test(c.domain) && /session|token|auth/i.test(c.name));
    const loggedOut = await ctx.page.exists('input[type="tel"]');
    if (auth.length && !loggedOut) { vault.set("fabel", { cookies: auth.map(({ name, value, domain, path, expires }) => ({ name, value, domain, path, expires })) });
      writeFileSync(`${SECRETS}/fabel_session.json`, JSON.stringify({ loggedIn: true, at: Date.now(), vault: "fabel" }), { mode: 0o600 }); return done("Fabel er koblet til ✓"); }
    return remote("Fabel", "Fullfør på siden under.", { insert: codeField[0] });
  },
  cleanup: async (ctx) => { await ctx.page?.close(); },
  logout: async () => { vault.del("fabel"); try { (await import("node:fs")).unlinkSync(`${SECRETS}/fabel_session.json`); } catch { /* */ } return { ok: true }; },
};
const NAVIMOW_URL = "https://navimow-h5-fra.willand.com/";
const mowers = async () => { try { return (await haRest("/states")).filter((s) => s.entity_id.startsWith("lawn_mower.")); } catch { return []; } };
export const navimow = { id: "navimow", name: "Navimow (robotklipper)", kind: "captcha", method: "Konto + glidebryter – løses på din skjerm", remoteCapable: true,
  status: async () => ({ status: (await mowers()).length ? "ok" : "not-connected" }),
  async start(ctx) {
    // Reuse the tab where the login is already prepared (main Brave), else open it there in the background.
    let tab = null; try { tab = (await (await fetch(`${MAIN_CDP}/json`)).json()).find((t) => t.type === "page" && /willand\.com|navimow/.test(t.url)); } catch { /* */ }
    ctx.page = tab ? await Page.attach(MAIN_CDP, tab.id) : await Page.open(MAIN_CDP, NAVIMOW_URL, { background: true }); ctx.keepTab = true;
    return remote("Navimow-innlogging", "Dra glidebryteren til brikken passer. Trykk i et felt og bruk «Sett inn» for å skrive.", { insert: { name: "text", label: "Tekst til valgt felt", type: "text" } });
  },
  async step(ctx, v) { if (v.insertFocused && v.text) await ctx.page.key(String(v.text)); return this.poll(ctx); },
  async poll(ctx) { if ((await mowers()).length) return done("Navimow er koblet til ✓"); return remote("Navimow-innlogging", "Dra glidebryteren til brikken passer.", { insert: { name: "text", label: "Tekst til valgt felt", type: "text" } }); },
  cleanup: async (ctx) => { await ctx.page?.close({ closeTab: false }); },
};
