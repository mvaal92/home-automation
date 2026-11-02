import { app, BrowserWindow, ipcMain, safeStorage, session, shell } from "electron";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Home desktop shell. The renderer is the shared @home/ui build; this process
 * only owns the window, mic permission and encrypted settings storage.
 */
const DEFAULT_URL = "http://homeassistant.local:8123";

interface StoredConfig { url?: string; mock?: boolean; tokenEnc?: string }
interface RendererConfig { url: string; token: string; mock: boolean }

app.setName("Home");
if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  // Hyprland isn't a DE Chromium recognises, so pick the Secret Service keyring explicitly
  // (same store Brave uses); override with HOME_PASSWORD_STORE=kwallet6 etc.
  if (!app.commandLine.hasSwitch("password-store")) app.commandLine.appendSwitch("password-store", process.env.HOME_PASSWORD_STORE ?? "gnome-libsecret");
}
app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations");

const cfgPath = () => join(app.getPath("userData"), "config.json");

function readStored(): StoredConfig {
  try { return JSON.parse(readFileSync(cfgPath(), "utf8")) as StoredConfig; } catch { return {}; }
}

function backend(): string {
  if (process.platform === "linux") {
    try { return safeStorage.getSelectedStorageBackend(); } catch { return "unknown"; }
  }
  return process.platform === "darwin" ? "keychain" : "dpapi";
}

function writeStored(cfg: RendererConfig) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS secret storage unavailable; refusing to store token in plaintext");
  const out: StoredConfig = { url: cfg.url, mock: cfg.mock, tokenEnc: cfg.token ? safeStorage.encryptString(cfg.token).toString("base64") : undefined };
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(cfgPath(), JSON.stringify(out, null, 2), { mode: 0o600 });
}

/** Optional dev/bootstrap: HOME_HA_TOKEN_FILE points at a token file (never copied into the repo). */
function tokenFromEnv(): string | null {
  const p = process.env.HOME_HA_TOKEN_FILE?.replace(/^~/, homedir());
  if (!p || !existsSync(p)) return null;
  try { return readFileSync(p, "utf8").trim() || null; } catch { return null; }
}

function loadConfig(): RendererConfig & { secureBackend: string } {
  const s = readStored();
  let token = "";
  if (s.tokenEnc && safeStorage.isEncryptionAvailable()) {
    try { token = safeStorage.decryptString(Buffer.from(s.tokenEnc, "base64")); } catch { token = ""; }
  }
  const envToken = tokenFromEnv();
  if (!token && envToken) {
    token = envToken;
    // Import into encrypted storage on first run so the env var is only needed once.
    try { writeStored({ url: s.url ?? process.env.HOME_HA_URL ?? DEFAULT_URL, token, mock: s.mock ?? false }); } catch { /* keep in memory only */ }
  }
  const forceMock = process.env.HOME_MOCK === "1";
  return { url: s.url ?? process.env.HOME_HA_URL ?? DEFAULT_URL, token, mock: forceMock || (s.mock ?? !token), secureBackend: backend() };
}

let win: BrowserWindow | null = null;

function createWindow() {
  const capturing = Boolean(process.env.HOME_CAPTURE_DIR);
  win = new BrowserWindow({
    show: !capturing,
    width: 1440, height: 920, minWidth: 380, minHeight: 560,
    title: "Home",
    backgroundColor: "#06080d",
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    icon: join(__dirname, "..", "build", "icon.png"),
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, offscreen: capturing, backgroundThrottling: !capturing },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  const dev = process.env.VITE_DEV_SERVER_URL;
  const hash = process.env.HOME_START_HASH ?? "";
  if (dev) void win.loadURL(dev + hash);
  else void win.loadFile(join(__dirname, "..", "renderer", "index.html"), { hash: hash.replace(/^#/, "") });
}

/**
 * Screenshot mode (used for docs/QA): HOME_CAPTURE_DIR=<dir> [HOME_CAPTURE_PREFIX=name-]
 * visits each route and writes PNGs, then quits.
 */
async function capture(w: BrowserWindow, dir: string) {
  const prefix = process.env.HOME_CAPTURE_PREFIX ?? "";
  const shots: Array<{ name: string; hash: string; size?: [number, number]; js?: string; wait?: number }> = [
    { name: "dashboard", hash: "#/" },
    { name: "room", hash: "#/room/" + (process.env.HOME_CAPTURE_ROOM ?? "stue") },
    { name: "device-light", hash: "#/device/" + (process.env.HOME_CAPTURE_LIGHT ?? "light.stue_tak") },
    { name: "device-thermostat", hash: "#/device/" + (process.env.HOME_CAPTURE_CLIMATE ?? "climate.stue_varmepumpe") },
    {
      name: "voice", hash: "#/voice", wait: 2600,
      js: `(async()=>{const s=(t)=>{const i=document.querySelector('.voice-input input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,t);i.dispatchEvent(new Event('input',{bubbles:true}));i.form.requestSubmit();};
        s(${JSON.stringify(process.env.HOME_CAPTURE_SAY ?? "Turn off the kitchen lights")});await new Promise(r=>setTimeout(r,1100));s(${JSON.stringify(process.env.HOME_CAPTURE_SAY2 ?? "What's the temperature in the bedroom?")});})()`,
    },
    { name: "settings", hash: "#/settings" },
    { name: "iphone-dashboard", hash: "#/", size: [390, 844] },
    { name: "iphone-device", hash: "#/device/" + (process.env.HOME_CAPTURE_LIGHT ?? "light.stue_tak"), size: [390, 844] },
  ];
  const only = process.env.HOME_CAPTURE_ONLY?.split(",");
  mkdirSync(dir, { recursive: true });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  if (w.webContents.isLoading()) await new Promise<void>((r) => w.webContents.once("did-finish-load", () => r()));
  w.webContents.setFrameRate(30);
  await sleep(2500);
  for (const s of shots) {
    if (only && !only.includes(s.name)) continue;
    w.setContentSize(...(s.size ?? [1440, 920]));
    await w.webContents.executeJavaScript(`location.hash=${JSON.stringify(s.hash)};`);
    await sleep(900);
    if (s.js) await w.webContents.executeJavaScript(s.js);
    await sleep(s.wait ?? 1400);
    console.log(`capture ${s.name}`);
    w.webContents.invalidate();
    await sleep(200);
    const img = await Promise.race([w.webContents.capturePage(), sleep(8000).then(() => null)]);
    if (!img) { console.error(`capture ${s.name}: timed out`); continue; }
    if (img.isEmpty()) console.error(`capture ${s.name}: empty image`);
    writeFileSync(join(dir, `${prefix}${s.name}.png`), img.toPNG());
    await w.webContents.executeJavaScript(`location.hash="#/"; document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));`);
    await sleep(500);
  }
  app.quit();
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

void app.whenReady().then(() => {
  // Microphone for voice; nothing else.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media" || permission === "speaker-selection"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  ipcMain.handle("home:get-config", () => loadConfig());
  ipcMain.handle("home:set-config", (_e, cfg: RendererConfig) => {
    writeStored({ url: String(cfg.url), token: String(cfg.token ?? ""), mock: Boolean(cfg.mock) });
    return { ok: true, secureBackend: backend() };
  });
  createWindow();
  if (process.env.HOME_CAPTURE_DIR && win) void capture(win, process.env.HOME_CAPTURE_DIR);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
