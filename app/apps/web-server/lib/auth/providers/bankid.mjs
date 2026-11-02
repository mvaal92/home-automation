// BankID logins (Visma Flyt / ID-porten, MyKid). Driven server-side in a background tab of the owner's main Brave
// (the Skole/MyKid read transports run inside those logged-in tabs, so the session must live there; it also
// survives restarts via the profile). The app sheet collects the fødselsnummer ONCE; it is inserted straight
// into the page with CDP Input.insertText and dropped — never stored, logged or returned.
// If the page layout is unknown (or the field sits in a cross-origin iframe) the sheet switches to remote view:
// The owner sees the login page on his device, taps to interact, and can insert the number into the focused field.
import * as skole from "../../skole.mjs";
import * as mykid from "../../mykid.mjs";
import { SCHOOL } from "../../family.mjs";
import { Page, MAIN_CDP } from "../cdp.mjs";
import { form, waiting, done, remote, fail, sleep } from "./_base.mjs";
const NIN_SEL = ['input[name="nnin"]', 'input#nnin', 'input[name*="ssn" i]', 'input[name*="nin" i]', 'input[autocomplete="off"][inputmode="numeric"]', 'input[type="tel"]', 'input[inputmode="numeric"]'];
const NEXT = "^(neste|fortsett|logg inn|continue|next)$";
const ninField = [{ name: "nin", label: "Fødselsnummer (11 siffer)", type: "nin", inputmode: "numeric", autocomplete: "off", maxLength: 11 }];
function make({ id, name, url, lib, hostRe }) {
  async function findNin(page) { for (const s of NIN_SEL) if (await page.exists(s)) return s; return null; }
  async function closeOld() { try { const tabs = await (await fetch(`${MAIN_CDP}/json`)).json(); for (const t of tabs.filter((t) => t.type === "page" && hostRe.test(t.url) && /login|logg_inn|idporten|bankid/i.test(t.url))) await fetch(`${MAIN_CDP}/json/close/${t.id}`); } catch { /* */ } }
  return { id, name, kind: "bankid", method: "BankID-økt i Brave på omarchy, holdes i live hvert 10. min", remoteCapable: true,
    status: async () => { try { await lib.ping(); return { status: "ok", detail: lib.load()?.syncedAt ? "Synkronisert" : null }; } catch (e) { return { status: e.loginRequired ? "login-required" : "unknown", detail: String(e.message).slice(0, 120) }; } },
    async start(ctx) {
      try { await lib.ping(); return done("Allerede innlogget ✓"); } catch { /* need login */ }
      await closeOld(); ctx.page = await Page.open(MAIN_CDP, url, { background: true }); ctx.keepTab = true;
      // Walk to the BankID choice (ID-porten / Visma Connect) without entering anything.
      for (let i = 0; i < 8; i++) { await sleep(1200); if (await findNin(ctx.page)) break; await ctx.page.clickText("^(BankID|BankID-app|BankID på mobil|Logg inn med BankID|ID-porten|Logg inn)$"); }
      return form("Logg inn med BankID", ninField, { message: "Nummeret skrives rett inn i BankID-feltet og lagres ikke.", submit: "Fortsett", alt: "Vis innloggingssiden" });
    },
    async step(ctx, v) {
      if (v.view === "remote") return remote("Innloggingssiden", "Trykk på siden for å fortsette. Du kan sette inn fødselsnummeret i feltet som er valgt.", { insert: ninField[0] });
      const nin = String(v.nin ?? "").replace(/\D/g, ""); if (nin.length !== 11) return { ...form("Logg inn med BankID", ninField), message: "Fødselsnummer må være 11 siffer" };
      if (v.insertFocused) { await ctx.page.key(nin); return remote("Innloggingssiden", "Satt inn. Trykk Neste på siden.", { insert: ninField[0] }); }
      const sel = await findNin(ctx.page);
      if (!sel) return remote("Innloggingssiden", "Fant ikke feltet automatisk. Trykk i fødselsnummer-feltet og bruk «Sett inn».", { insert: ninField[0] });
      await ctx.page.fill(sel, nin); await sleep(300);
      if (!(await ctx.page.clickText(NEXT))) await ctx.page.key("Enter");
      ctx.data.since = Date.now();
      return waiting("Godkjenn i BankID-appen", "Åpne BankID-appen på telefonen og godkjenn innloggingen.", 2500);
    },
    async poll(ctx) {
      try { await lib.ping(); try { await lib.sync?.(); } catch { /* */ } return done(`${name} er innlogget ✓`); } catch { /* not yet */ }
      if (ctx.step?.state === "remote") return ctx.step;
      if (Date.now() - (ctx.data.since ?? ctx.createdAt) > 4 * 60e3) return fail("Tidsavbrudd – BankID ble ikke godkjent innen 4 minutter.");
      const t = (await ctx.page?.text().catch(() => "")) ?? "";
      if (/avbrutt|cancelled|feil fødselsnummer|ugyldig/i.test(t)) return { ...remote("Innloggingssiden", "BankID meldte en feil. Se siden under."), insert: ninField[0] };
      return waiting("Godkjenn i BankID-appen", "Venter på godkjenning i BankID-appen …", 2500);
    },
    cleanup: async (ctx) => { await ctx.page?.close({ closeTab: false }); },   // keep the logged-in tab: the read transport uses it
  };
}
export const skoleProvider = make({ id: "skole", name: `Visma Flyt (Skole – ${SCHOOL.name})`, url: "https://foresatt.visma.no/kommunen", lib: skole, hostRe: /foresatt\.visma\.no|connect\.visma\.com|idporten|bankid/ });
export const mykidProvider = make({ id: "mykid", name: "MyKid (Barnehage)", url: "https://mykid.no/nb/logg_inn", lib: mykid, hostRe: /mykid\.no|idporten|bankid/ });
