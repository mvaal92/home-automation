#!/usr/bin/env node
// v8 responsive screenshots. Usage: node scripts/shoot5.mjs <url> <outDir>
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [base = process.env.HOME_WEB_URL ?? "http://127.0.0.1:8124/", out = "screenshots/v8"] = process.argv.slice(2);
const port = 9900 + Math.floor(Math.random() * 90);
const proc = spawn(process.env.BROWSER_BIN ?? "brave", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/home-shoot8-${port}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tab; for (let i = 0; i < 50 && !tab; i++) { await sleep(200); try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* retry */ } }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = (e) => send("Runtime.evaluate", { expression: e, awaitPromise: true });
mkdirSync(out, { recursive: true });
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const sizes = [
  { n: "phone", w: 390, h: 844, s: 3, m: true },
    { n: "ipad-landscape", w: 1366, h: 1024, s: 2, m: true },
  { n: "desktop", w: 1440, h: 900, s: 2, m: false },
];
const CONV = process.env.CONV ?? "";
const SEED = `localStorage.setItem('home.lydboker.v1', JSON.stringify({items:[{status:'leser',progress:38,updatedAt:1,book:{isbn:'9788203450839',title:'Minnesota',authors:['Jo Nesbø'],readers:['Fridtjov Såheim'],cover:'https://media.crystallize.com/fabel-prod/26/5/25/0daf3ca7/9788203450839.jpg',coverSmall:'https://media.crystallize.com/fabel-prod/26/5/25/0daf3ca7/@200/9788203450839.webp',minutes:676,series:null,seriesPart:null,category:'Krim og spenning',publisher:'Aschehoug AS',released:null,inSubscription:true,subscriptionFrom:null,price:299,themes:['Krim: politi'],url:'https://fabel.no/sjangere/krim-og-spenning/minnesota',sample:''}}]}))`;
const shots = [
  ["dashboard", "#/", 0, ""], ["dashboard-notes", "#/", 420, ""], ["notater", "#/notater", 0, ""],
  ["lydboker", "#/lydboker", 0, SEED], ["lydboker-scroll", "#/lydboker", 700, ""],
  ["lydboker-search", "#/lydboker", 0, "setTimeout(()=>{const i=document.querySelector('.search-bar input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'Jo Nesbø');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))},1500)"],
  ["lydboker-book", "#/lydboker", 0, "setTimeout(()=>document.querySelectorAll('.book-scroll .book')[0]?.click(),3500)"],
  ["spotify", "#/spotify", 0, ""],
];
const extra = { phone: [["more", "#/", 0, "setTimeout(()=>[...document.querySelectorAll('.tabbar button')].pop().click(),1500)"]] };
for (const scheme of ["dark", "light"]) {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  for (const z of sizes) {
    if (scheme === "light" && z.n !== "desktop") continue;
    await send("Emulation.setDeviceMetricsOverride", { width: z.w, height: z.h, deviceScaleFactor: z.s, mobile: z.m });
    for (const [name, hash, scroll, pre] of ((x) => ONLY ? x.filter((y) => ONLY.includes(y[0])) : x)(scheme === "dark" ? [...shots, ...(extra[z.n] ?? [])] : shots.filter((x) => ["lydboker", "lydboker-book", "dashboard", "notater"].includes(x[0])))) {
      await send("Page.navigate", { url: "about:blank" }); await sleep(300); await send("Page.navigate", { url: base + hash }); await sleep(800); if (pre) { await ev((pre.startsWith("localStorage")||pre===SEED) ? pre + ";location.reload()" : pre); } await sleep(name.startsWith("lydboker") || name.includes("sonos") ? 5500 : 4000);
      await ev(`document.querySelector('.main')?.scrollTo(0, ${scroll})`); await sleep(600);
      const r = await send("Page.captureScreenshot", { format: "png" });
      const f = `${out}/${z.n}-${name}${scheme === "light" ? "-light" : ""}.png`; writeFileSync(f, Buffer.from(r.result.data, "base64")); console.log(f);
    }
  }
}
proc.kill(); process.exit(0);
