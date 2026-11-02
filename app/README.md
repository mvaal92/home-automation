# Home

A fast, dark, glassy smart-home app for the owner, with **Home Assistant** as the engine.
One product on three surfaces: **desktop** (Electron; Linux/Hyprland now, macOS later), **iPhone** (Capacitor), and **voice** (HA Assist: Whisper + Piper).

![Dashboard](screenshots/mock-dashboard.png)

## Layout

```
app/
├─ packages/core   @home/core: typed HA WebSocket client, optimistic store, room/health model, mock backend + fixtures, tests
├─ packages/ui     @home/ui: React 19 + Vite UI shared by every surface (dashboard, rooms, control sheets, voice, settings)
├─ apps/desktop    @home/desktop: Electron shell (window, mic permission, safeStorage settings, screenshot mode)
├─ apps/ios        @home/ios: Capacitor shell (iOS Keychain via capacitor-secure-storage-plugin)
├─ scripts/        setup_voice.py, verify_voice.py, shoot.mjs (screenshots), install-desktop.sh
└─ screenshots/    mock-* (showcase), live-* / electron-live-* (against the real HA)
```

### Why these choices
- **Home Assistant under the hood.** It already handles device integrations (SmartThings, Sonos, WiZ…), history, automations and the voice pipeline. The app only talks to its WebSocket API, so nothing gets rebuilt.
- **`home-assistant-js-websocket`** is HA's own client. It handles auth, reconnects and the compressed `subscribe_entities` stream. `@home/core` wraps it behind a small `HomeBackend` interface, so the UI works the same against HA or the in-memory **mock**, and tests can inject a fake connection.
- **One React UI package, thin shells.** Nearly all code (UI and logic) is shared. Shells only provide window/native glue and secret storage.
- **Electron** gives a first-class Wayland/Hyprland app now and a macOS build later from the same code. **Capacitor** wraps the same Vite bundle in a native WKWebView project for iPhone, with access to the Keychain and mic. Native builds need Xcode, which is on the Mac mini.
- **Voice via HA Assist** (`assist_pipeline/run`) keeps STT, intent and TTS local and shared by every surface. When no STT/TTS engine is configured, the UI falls back to typed commands and on-device speech.

## Features
- Rooms built automatically from HA **areas** (entity → device → area). Empty areas are hidden, and unassigned entities go under “Whole home”.
- Live state over `subscribe_entities`, plus **optimistic updates**: the predicted state shows instantly and reverts on error or after a 5 s TTL.
- Quick **scenes/scripts**, energy/climate/security summaries, and **device health**: unavailable devices and batteries ≤ 20 %.
- Control sheets: dimmer + colour temperature, thermostat dial, media transport/volume/source, hold-to-unlock lock, vacuum, plugs with a power sparkline, and sensor history.
- 24 h **sparklines** from `history/history_during_period`.
- Voice overlay: **push-to-talk** (hold the orb, or hold Space), a **hands-free** toggle (client VAD plus HA VAD, re-listens after each reply), and typed commands. `Ctrl/Cmd+K` opens voice.

## Run

Prerequisites: Node 24 and pnpm (`pnpm install` at the repo root).

| What | Command |
| --- | --- |
| Web UI, demo data | `pnpm dev:mock` → http://127.0.0.1:5180 (or append `?mock`) |
| Web UI, real HA | `HOME_HA_TOKEN_FILE=~/home-automation/secrets/ha_token HOME_HA_URL=http://127.0.0.1:8123 pnpm dev` |
| Electron dev | `HOME_HA_TOKEN_FILE=~/home-automation/secrets/ha_token pnpm desktop:dev` (add `HOME_MOCK=1` for demo) |
| Electron package (Linux AppImage + dir) | `pnpm desktop:build` → `apps/desktop/release/` |
| Install launcher “Home” | `./scripts/install-desktop.sh` → `~/.local/opt/home` + `~/.local/share/applications/home.desktop` |
| iPhone | see `apps/ios/README.md` (on the Mac: `add:ios`, `sync`, `open`) |
| Tests / types / lint | `pnpm test` · `pnpm typecheck` · `pnpm lint` |
| Screenshots | `node scripts/shoot.mjs "http://127.0.0.1:5180/?mock" screenshots mock-` (headless Brave, DevTools protocol) |

## Pointing it at Home Assistant
Open **Settings** in the app and enter:
- **Server URL**: defaults to `http://<omarchy-tailscale-ip>:8123` (Tailscale, works from any device on the tailnet).
- **Long-lived token**: from HA → Profile → Security.

Storage per surface:
- **Desktop**: Electron `safeStorage`. On Hyprland it's forced to the Secret Service keyring (`gnome-libsecret`, the same one Brave uses), written to `~/.config/Home/config.json` encrypted.
- **iPhone**: iOS Keychain.
- **Web dev**: `localStorage`.

For local development, `HOME_HA_TOKEN_FILE` points at a token file instead. The Vite dev server serves it only to loopback clients and never in builds. Electron imports it into `safeStorage` on first run. The token is never stored in the repo.

## Voice pipeline
`~/home-automation/docker-compose.yml` runs `wyoming-whisper` (`base-int8`, en, :10300) and `wyoming-piper` (`en_US-lessac-medium`, :10200) on host networking.
`scripts/setup_voice.py` registers both through HA config flows (handler `wyoming`, host 127.0.0.1) and creates the preferred pipeline **“Home (Whisper + Piper)”**.
`uv run --with websockets scripts/verify_voice.py` checks text→intent→tts and a real audio round trip (Piper speech → PCM → stt → intent → tts).

The app streams 16 kHz PCM16 mic audio as binary frames prefixed with the run's `stt_binary_handler_id`, then plays `tts_output.url`.

## Notes
- Mock mode covers a Norwegian apartment: lights (dim + colour temperature), plugs with power, a heat pump and floor heating, temperature/humidity/CO₂/motion/door/window sensors, a front-door lock, a TV and Sonos, a Roborock, energy and spot price, and scenes. It also includes one unavailable sensor and one low battery, so the health view has something to show.
- Rooms update as HA areas are assigned (e.g. after SmartThings is linked).

## v2 (Oct 2026): hosting, design pass, MCP

### Web app over Tailscale — http://<omarchy-tailscale-ip>:8124
`apps/web-server/server.mjs` (systemd `--user` unit `deploy/home-web.service`, lingering is on, so it
runs without a login session) serves `packages/ui/dist` and a same-origin Home Assistant proxy:

- `/ha/*` → `http://127.0.0.1:8123` for HTTP **and** the `/ha/api/websocket` socket. The HA token is
  read from `secrets/ha_token` and injected server-side (HTTP `Authorization` header; for the websocket
  the proxy does HA's in-band auth itself and answers the browser's auth with the upstream `auth_ok`).
  The browser never sees the token.
- Injection happens **only** for connections that arrive on the Tailscale address (<omarchy-tailscale-ip>).
  Requests to the loopback listener get 403 on `/ha`.
- `/app-config.json` tells the UI whether the proxy is available; if so and nothing else is configured,
  the web app connects through it with zero setup. Settings → "Connect through this server" toggles
  it; switching it off lets you enter a URL + token (stored in localStorage on the web).
- Anyone on the tailnet gets full HA access through this proxy, exactly as if they had the token.

Rebuild + restart both services: `pnpm build:web && ./deploy/install-services.sh`.

### Design v2
Typography-first (Inter Variable), neutral palette with one warm accent, hairlines instead of cards,
150–250 ms motion, no animated backgrounds; dark and light follow the system. The dashboard reads
greeting → one status line → scenes as quiet pills → health line → rooms list (with a lights switch
per room) → active devices. Voice defaults to local Whisper + Piper; "Grok voice (coming soon)" is a
disabled toggle. Screenshots: `screenshots/v2/` (`before-*`, `after-mock-*`, `after-mock-light-*`,
`after-live-*`).

### MCP server — http://<omarchy-tailscale-ip>:8125/mcp
See [packages/mcp/README.md](packages/mcp/README.md). Bearer token: `~/home-automation/secrets/mcp_token`.

## v4 – live-data tidy

- **Scenes row**: the home's own scenes first, in day order (Morning, Dinner, Evening, Movie night, Good night, Away), then a hairline and the curated routines (Arrive home, Bedtime, Leave home). Internal/maintenance scripts are never shown; SmartThings cloud scenes are hidden when the home has its own.
- **Home mode** segmented control (Home/Away/Night/Vacation/Guest) driven by `input_select.home_mode`.
- **Visibility** everywhere (rooms, status line, active, health, MCP `home_overview`) respects the entity registry: `hidden_by`, `disabled_by`, `entity_category` (config/diagnostic) and system integrations (backup). Helpers (`input_*`, schedules) never appear as devices; they live in the **Automation** section at the bottom of Overview.
- **Health line**: one entry per physical device, top 3 + “+N”, dismiss known-offline devices with × (stored per device in localStorage; restore in Settings → Hidden alerts). Batteries only below 20 %.
- **Room rows** name the few non-light devices (“Samsung TV off · Sonos Arc idle”), collapse offline ones (“2 offline”); the Whole home bucket only shows things with real readings (Flexit fan, humidity).
- **HA registry tidy** (`scripts/ha-tidy.mjs`, idempotent; previous values in `scripts/ha-tidy.undo.json`, `--undo` restores): hides the SmartThings twins of the local WiZ bulbs and Sonos speakers, names the three basement WiZ ceiling bulbs, names the Arc “Sonos Arc” (alias “TV Room”), hides the TV's ambient light/sound toggles, renames area Inngangspart → Inngangsparti, deletes the empty TV Room area. No device states are changed.
