// Minimal CDP client for server-driven logins.
//  - "isolated": a dedicated headless Chromium owned by the broker (profile data/auth/browser, port 9333, loopback only).
//    Used for Fabel / Navimow / generic remote-view logins: invisible on the owner's desktop, separate cookies.
//  - "main": the owner's main Brave (127.0.0.1:9222). Used for BankID services because the Skole/MyKid read transports
//    run inside those logged-in tabs; tabs are opened in the background.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import WebSocket from "ws";
import { expand } from "../util.mjs";
const MAIN = process.env.HOME_CDP ?? "http://127.0.0.1:9222";
const ISO_PORT = Number(process.env.HOME_AUTH_CDP_PORT ?? 9333);
const ISO = `http://127.0.0.1:${ISO_PORT}`;
const PROFILE = expand("~/home-automation/data/auth/browser");
let isoProc = null;
async function up(base) { try { const r = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } }
export async function ensureIsolated() {
  if (await up(ISO)) return ISO;
  mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
  isoProc = spawn(process.env.HOME_AUTH_CHROMIUM ?? "/usr/bin/chromium", ["--headless=new", `--remote-debugging-port=${ISO_PORT}`, "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "--window-size=420,820", "--lang=nb-NO", "about:blank"], { stdio: "ignore", detached: false });
  isoProc.on("exit", () => { isoProc = null; });
  for (let i = 0; i < 40; i++) { if (await up(ISO)) return ISO; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error("innloggingsnettleser startet ikke");
}
export class Page {
  constructor(ws, target, base) { this.ws = ws; this.target = target; this.base = base; this.n = 0; this.cb = new Map(); this.events = [];
    ws.on("message", (m) => { const r = JSON.parse(m); if (r.id && this.cb.has(r.id)) { const [ok, ko] = this.cb.get(r.id); this.cb.delete(r.id); r.error ? ko(new Error(r.error.message)) : ok(r.result); } }); }
  static async open(base, url, { background = true } = {}) {
    const ver = await (await fetch(`${base}/json/version`)).json();
    const bws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((r, j) => { bws.once("open", r); bws.once("error", j); });
    const b = new Page(bws, null, base); const { targetId } = await b.send("Target.createTarget", { url, background }); bws.close();
    return Page.attach(base, targetId);
  }
  static async attach(base, targetId) {
    const t = (await (await fetch(`${base}/json`)).json()).find((x) => x.id === targetId); if (!t) throw new Error("fane forsvant");
    const ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 32 * 1024 * 1024 }); await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
    const p = new Page(ws, t, base); await p.send("Page.enable").catch(() => {}); return p;
  }
  send(method, params = {}) { const id = ++this.n; return new Promise((ok, ko) => { this.cb.set(id, [ok, ko]); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.cb.delete(id)) ko(new Error(method + " timeout")); }, 20000); }); }
  async eval(expr) { const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error("side-feil"); return r.result?.value; }
  url() { return this.eval("location.href"); }
  async screenshot() {
    const m = await this.eval("({w:innerWidth,h:innerHeight})");
    const r = await this.send("Page.captureScreenshot", { format: "jpeg", quality: 70 }); return { data: r.data, w: m.w, h: m.h };
  }
  /** Type text into the element matching selector WITHOUT the value passing through any log; uses Input.insertText. */
  async fill(selector, value) {
    const ok = await this.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.focus();e.value="";e.dispatchEvent(new Event("input",{bubbles:true}));return true})()`);
    if (!ok) return false; await this.send("Input.insertText", { text: String(value) }); return true;
  }
  click(selector) { return this.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`); }
  clickText(re) { return this.eval(`(()=>{const re=new RegExp(${JSON.stringify(re)},"i");const e=[...document.querySelectorAll("button,a,[role=button],input[type=submit]")].find(x=>re.test((x.innerText||x.value||"").trim()));if(!e)return false;e.click();return true})()`); }
  exists(selector) { return this.eval(`!!document.querySelector(${JSON.stringify(selector)})`); }
  text() { return this.eval("document.body?document.body.innerText.slice(0,4000):''"); }
  async pointer(type, x, y) {   // relay from the device: type = down|move|up|tap
    const ev = (t, buttons) => this.send("Input.dispatchMouseEvent", { type: t, x, y, button: "left", buttons, clickCount: 1 });
    if (type === "tap") { await ev("mousePressed", 1); await ev("mouseReleased", 0); return; }
    await ev(type === "down" ? "mousePressed" : type === "up" ? "mouseReleased" : "mouseMoved", type === "up" ? 0 : 1);
  }
  async key(text) { if (text === "Enter" || text === "Backspace" || text === "Tab") { const k = { Enter: 13, Backspace: 8, Tab: 9 }[text];
      await this.send("Input.dispatchKeyEvent", { type: "keyDown", key: text, windowsVirtualKeyCode: k, text: text === "Enter" ? "\r" : undefined }); await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: text, windowsVirtualKeyCode: k }); }
    else await this.send("Input.insertText", { text }); }
  async close({ closeTab = true } = {}) { try { if (closeTab && this.target) await fetch(`${this.base}/json/close/${this.target.id}`); } catch { /* */ } try { this.ws.close(); } catch { /* */ } }
}
export const MAIN_CDP = MAIN;
