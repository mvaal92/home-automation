#!/usr/bin/env node
// Screenshots of the native login sheet. /api/auth/* is intercepted with mock responses (no real logins, no devices).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const [base = "http://127.0.0.1:8124/", out = "screenshots/auth", frame = "/tmp/authframe.jpg"] = process.argv.slice(2);
const port = 9900 + Math.floor(Math.random() * 90);
const proc = spawn(process.env.BROWSER_BIN ?? "brave", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/home-shoot-auth-${port}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tab; for (let i = 0; i < 50 && !tab; i++) { await sleep(200); try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* */ } }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); let scenario = "list";
const P = (id, name, kind, status, method, extra = {}) => ({ id, name, kind, status, method, canLogout: status === "ok", canRefresh: kind === "oauth", remoteCapable: kind !== "oauth", ...extra });
const providers = [P("smartthings", "SmartThings", "oauth", "ok", "OAuth i Home Assistant (fornyes automatisk)", { expiresAt: Date.now() + 20 * 3600e3, autoRenew: true }), P("spotify", "Spotify", "oauth", "needs-setup", "OAuth (PKCE) – tokens i appen"),
  P("skole", "Visma Flyt (Skole – Kid2)", "bankid", "login-required", "BankID-økt, holdes i live hvert 10. min"), P("mykid", "MyKid (Barnehage)", "bankid", "ok", "BankID-økt, holdes i live hvert 10. min"),
  P("oda", "Oda", "password", "ok", "E-post + passord → server-økt", { attemptsLeft: 2 }), P("navimow", "Navimow (robotklipper)", "captcha", "not-connected", "Konto + glidebryter – løses på din skjerm"),
  P("dreame", "Dreamehome (kart/forbruk)", "password", "not-connected", "Dreamehome-konto (lagres kryptert)", { attemptsLeft: 2 }), P("fabel", "Fabel (lydbøker)", "sms", "not-connected", "Mobilnummer + SMS-kode")];
const S = { session: "mocksession0000000000", provider: "x" };
const steps = {
  "sms-phone": { ...S, provider: "fabel", state: "form", title: "Logg inn på Fabel", message: "Fabel sender en SMS-kode til nummeret.", fields: [{ name: "phone", label: "Mobilnummer", type: "tel" }], submit: "Send kode", alt: "Vis siden" },
  "sms-code": { ...S, provider: "fabel", state: "form", title: "Skriv inn koden", message: "Koden kommer på SMS om noen sekunder.", fields: [{ name: "code", label: "Kode fra SMS", type: "code", maxLength: 8 }], submit: "Logg inn" },
  "bankid-nin": { ...S, provider: "skole", state: "form", title: "Logg inn med BankID", message: "Nummeret skrives rett inn i BankID-feltet og lagres ikke.", fields: [{ name: "nin", label: "Fødselsnummer (11 siffer)", type: "nin", maxLength: 11 }], submit: "Fortsett", alt: "Vis innloggingssiden" },
  "bankid-wait": { ...S, provider: "skole", state: "waiting", title: "Godkjenn i BankID-appen", message: "Åpne BankID-appen på telefonen og godkjenn innloggingen.", pollMs: 60000 },
  remote: { ...S, provider: "navimow", state: "remote", title: "Navimow-innlogging", message: "Dra glidebryteren til brikken passer. Trykk i et felt og bruk «Sett inn» for å skrive.", pollMs: 60000, insert: { name: "text", label: "Tekst til valgt felt", type: "text" } },
  "oda-form": { ...S, provider: "oda", state: "form", title: "Logg inn på Oda", fields: [{ name: "email", label: "E-post", type: "email" }, { name: "password", label: "Passord", type: "password" }], submit: "Logg inn" },
  done: { ...S, provider: "skole", state: "done", title: "Ferdig", message: "Visma Flyt er innlogget ✓" },
};
const openFor = { "sms-phone": "fabel", "sms-code": "fabel", "bankid-nin": "skole", "bankid-wait": "skole", remote: "navimow", "oda-form": "oda", done: "skole" };
const img = readFileSync(frame).toString("base64");
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); return; }
  if (d.method === "Fetch.requestPaused") { const u = d.params.request.url; let body, ct = "application/json";
    if (u.includes("/frame")) { body = img; ct = "image/jpeg"; }
    else if (u.includes("/csrf")) body = Buffer.from(JSON.stringify({ token: "x" })).toString("base64");
    else if (u.includes("/providers")) body = Buffer.from(JSON.stringify({ providers })).toString("base64");
    else body = Buffer.from(JSON.stringify(steps[scenario] ?? { ok: true })).toString("base64");
    send("Fetch.fulfillRequest", { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: ct }], body }); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/auth/*" }] });
mkdirSync(out, { recursive: true });
const sizes = [{ n: "phone", w: 390, h: 844, s: 3, m: true }, { n: "ipad", w: 1180, h: 820, s: 2, m: true }];
for (const z of sizes) {
  await send("Emulation.setDeviceMetricsOverride", { width: z.w, height: z.h, deviceScaleFactor: z.s, mobile: z.m });
  for (const sc of (process.env.ONLY ?? ["list", ...Object.keys(steps)].join(",")).split(",")) {
    scenario = sc; const hash = sc === "list" ? "#/settings" : `#/settings/login/${openFor[sc]}`;
    await send("Page.navigate", { url: base.replace(/\/$/, "") + "/" + hash }); await sleep(3500);
    if (sc === "list") await send("Runtime.evaluate", { expression: "document.querySelector('.connections')?.scrollIntoView({block:'start'})" });
    await sleep(1200);
    const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${out}/${z.n}-${sc}.png`, Buffer.from(r.result.data, "base64"));
    await send("Page.navigate", { url: "about:blank" }); await sleep(300);
  }
}
proc.kill(); process.exit(0);
