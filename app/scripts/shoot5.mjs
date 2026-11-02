#!/usr/bin/env node
// v5 responsive screenshots. Usage: node scripts/shoot5.mjs <url> <outDir>
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [base = process.env.HOME_WEB_URL ?? "http://127.0.0.1:8124/", out = "screenshots/v5"] = process.argv.slice(2);
const port = 9900 + Math.floor(Math.random() * 90);
const proc = spawn(process.env.BROWSER_BIN ?? "brave", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/home-shoot5-${port}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tab; for (let i = 0; i < 50 && !tab; i++) { await sleep(200); try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* retry */ } }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = (e) => send("Runtime.evaluate", { expression: e, awaitPromise: true });
mkdirSync(out, { recursive: true });
const sizes = [
  { n: "phone", w: 390, h: 844, s: 3, m: true },
  { n: "ipad-portrait", w: 1024, h: 1366, s: 2, m: true },
  { n: "ipad-landscape", w: 1366, h: 1024, s: 2, m: true },
  { n: "desktop", w: 1440, h: 900, s: 2, m: false },
];
const shots = [
  ["dashboard", "#/", 0], ["dashboard-scrolled", "#/", 900],
];
const extra = { phone: [["rooms", "#/rooms", 0]], desktop: [["room", "#/room/stue", 0]] };
for (const scheme of ["dark", "light"]) {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  for (const z of sizes) {
    if (scheme === "light" && !["phone", "desktop"].includes(z.n)) continue;
    await send("Emulation.setDeviceMetricsOverride", { width: z.w, height: z.h, deviceScaleFactor: z.s, mobile: z.m });
    for (const [name, hash, scroll] of [...shots, ...(scheme === "dark" ? extra[z.n] ?? [] : [])]) {
      await send("Page.navigate", { url: base + hash }); await send("Page.reload", {}); await sleep(3500);
      await ev(`document.querySelector('.main')?.scrollTo(0, ${scroll})`); await sleep(600);
      const r = await send("Page.captureScreenshot", { format: "png" });
      const f = `${out}/${z.n}-${name}${scheme === "light" ? "-light" : ""}.png`; writeFileSync(f, Buffer.from(r.result.data, "base64")); console.log(f);
    }
  }
}
proc.kill(); process.exit(0);
