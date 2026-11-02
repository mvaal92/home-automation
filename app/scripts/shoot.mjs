#!/usr/bin/env node
// Screenshot driver: headless Brave/Chromium over the DevTools protocol (no deps; Node >= 22 WebSocket).
// Usage: node scripts/shoot.mjs <baseUrl> <outDir> <prefix> [shot,...]
//   baseUrl e.g. "http://127.0.0.1:5180/?mock"  (append nothing for live)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const [base = "http://127.0.0.1:5180/?mock", out = "screenshots", prefix = "", onlyArg] = process.argv.slice(2);
const only = onlyArg?.split(",");
const BROWSER = process.env.BROWSER_BIN ?? "brave";
const port = 9333 + Math.floor(Math.random() * 500);
const profile = `/tmp/home-shoot-${port}`;
const say1 = process.env.SAY1 ?? "Turn off the kitchen lights";
const say2 = process.env.SAY2 ?? "What's the temperature in the bedroom?";
const typeJs = (t) => `(()=>{const i=document.querySelector('.voice-input input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(t)});i.dispatchEvent(new Event('input',{bubbles:true}));i.form.requestSubmit();})()`;
const shots = [
  { name: "dashboard", hash: "#/" },
  { name: "room", hash: `#/room/${process.env.ROOM ?? "stue"}` },
  { name: "device-light", hash: `#/device/${process.env.LIGHT ?? "light.stue_tak"}` },
  { name: "device-thermostat", hash: `#/device/${process.env.CLIMATE ?? "climate.stue_varmepumpe"}` },
  { name: "device-media", hash: `#/device/${process.env.MEDIA ?? "media_player.stue_tv"}` },
  { name: "device-lock", hash: `#/device/${process.env.LOCK ?? "lock.inngangsdor"}` },
  { name: "room2", hash: `#/room/${process.env.ROOM2 ?? "vaskerom"}` },
  { name: "room3", hash: `#/room/${process.env.ROOM3 ?? "gang"}` },
  { name: "device-camera", hash: `#/device/${process.env.CAMERA ?? "camera.gang_doorbell"}` },
  { name: "iphone-room", hash: `#/room/${process.env.ROOM ?? "stue"}`, mobile: true },
  { name: "voice", hash: "#/voice", steps: [typeJs(say1), 2500, typeJs(say2)], wait: 3500 },
  { name: "settings", hash: "#/settings" },
  { name: "iphone-dashboard", hash: "#/", mobile: true },
  { name: "iphone-device", hash: `#/device/${process.env.LIGHT ?? "light.stue_tak"}`, mobile: true },
  { name: "iphone-room2", hash: `#/room/${process.env.ROOM2 ?? "vaskerom"}`, mobile: true },
  { name: "iphone-thermostat", hash: `#/device/${process.env.CLIMATE ?? "climate.stue_varmepumpe"}`, mobile: true },
  { name: "iphone-voice", hash: "#/voice", steps: [typeJs(say1), 2500, typeJs(say2)], wait: 3500, mobile: true },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(BROWSER, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run",
  "--autoplay-policy=no-user-gesture-required", "--window-size=1440,920", "about:blank"], { stdio: "ignore" });
let tab;
for (let i = 0; i < 50 && !tab; i++) {
  await sleep(200);
  try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
}
if (!tab) { proc.kill("SIGKILL"); throw new Error("browser did not start"); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (method, params = {}, timeout = 15000) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(`${method} timed out (renderer hung?)`)); } }, timeout);
});
const evaluate = (expression) => send("Runtime.evaluate", { expression, awaitPromise: true });
const size = (mobile) => send("Emulation.setDeviceMetricsOverride", mobile
  ? { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } : { width: 1440, height: 920, deviceScaleFactor: 2, mobile: false });

mkdirSync(out, { recursive: true });
const done = [];
try {
  await send("Page.enable");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: process.env.SCHEME ?? "dark" }] });
  await size(false);
  await send("Page.navigate", { url: base + (base.includes("#") ? "" : "#/") });
  await sleep(3500);
  for (const s of shots) {
    if (only && !only.includes(s.name)) continue;
    await size(Boolean(s.mobile));
    await evaluate(`location.hash=${JSON.stringify(s.hash)}`);
    await sleep(1200);
    for (const st of s.steps ?? []) { if (typeof st === "number") await sleep(st); else await evaluate(st); }
    await sleep(s.wait ?? 1300);
    if (process.env.SHOOT_PROBE) console.log("probe", JSON.stringify((await send("Runtime.evaluate", { expression: "document.querySelector('.main')?.innerText.slice(0,200)" }, 5000)).result));
    const { result } = await send("Page.captureScreenshot", { format: "png" }, 20000);
    const file = join(out, `${prefix}${s.name}.png`);
    writeFileSync(file, Buffer.from(result.data, "base64"));
    done.push(file);
    console.log("saved", file);
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));location.hash='#/'`);
    await sleep(600);
  }
} finally {
  ws.close(); proc.kill("SIGKILL"); await sleep(300); rmSync(profile, { recursive: true, force: true });
}
