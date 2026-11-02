# Home failover: omarchy (primary) + Mac mini (standby)

| | omarchy (primary) | Mac mini (standby) |
|---|---|---|
| Web app | http://100.64.0.1:8124 | http://100.64.0.2:8124 |
| MCP | http://100.64.0.1:8125/mcp | http://100.64.0.2:8125/mcp |
| Home Assistant | :8123 (docker, host net) | :8123 only while HA standby runs (docker, bridge) |

## Normal operation (single writer = omarchy)
The Mac's `com.home.front` (launchd, `~/home-standby/failover/front.mjs`) is a TCP proxy on the Mac Tailscale IP + loopback.
:8124/:8125 are forwarded verbatim to omarchy, so prefs/notes/chats are all written to omarchy's `data/home.db`.
The Mac HA container is NOT running; nothing on the Mac controls devices.

## Backups / replication (omarchy, systemd --user)
- `home-backup.timer` 03:15 nightly -> `failover/home-backup.sh`: HA config tar (incl .storage, custom_components, packages; via `docker exec` since files are root-owned),
  HA recorder db (sqlite backup), `home.db` (sqlite .backup), `data/`, `secrets/`, git bundle of the app repo (all branches), top-level files, SHA256SUMS.
  Pushed to `standby:~/home-standby/backups/home-YYYYmmdd-HHMMSS`, `latest` symlink, keep 14.
- `home-standby-sync.timer` every 5 min -> `failover/sync-standby.sh`: mirrors web-server, ui/dist, mcp/dist, data/, secrets/, failover/mac/ and a
  `home.db.replica` to `~/home-standby/`. Skipped while the Mac is in web failover (Mac owns the db then).
- Secrets: not encrypted at rest (the standby needs them in clear to run); dirs 0700, files 0600, only over ssh/Tailscale.
- Restore an app repo: `git clone ~/home-standby/backups/latest/app.bundle app`.

## Mac mini (launchd agents in ~/Library/LaunchAgents)
- `com.home.front` - always on (front proxy).
- `com.home.watchdog` - every 30 s runs `home-failover watchdog`.
- `com.home.standby-web` / `com.home.standby-mcp` - only loaded during failover (local web-server on 127.0.0.1:18124, home-mcp on :18125).
- `~/home-standby/failover/ha-compose.yml` - HA standby (`ha-standby` container).

## Failover rules (`home-failover`, on the Mac: `~/.local/bin/home-failover`)
- omarchy web /healthz fails 3x in a row (~90 s): **web failover** - copy replica -> `home.db`, start local web+MCP, front proxy switches to local.
  /ha still points at omarchy HA if it answers. Device automations are untouched.
- omarchy HA API down > 10 min AND omarchy not reachable/its container not running: **HA failover** - start `ha-standby` from the restored config
  (automations ON), local web/MCP restart pointing at it. If omarchy still runs its HA container, the standby is NOT started (avoids double control).
- omarchy back (web + HA): HA standby stopped, Mac db pushed back to omarchy (omarchy's copy kept as `data/home.db.pre-failover-*`), front proxy back to omarchy,
  macOS notification + `~/home-standby/failover.log`.
- Manual: `home-failover activate | deactivate [--force] | ha-start | ha-stop | restore | status`. Manual activate sets MANUAL so the watchdog won't auto-return;
  `deactivate` clears it.
- `home-failover restore` re-extracts `backups/latest/ha-config.tgz` (checksum verified) into `~/home-standby/ha-config`. Run after a new backup if you want the
  standby HA to have the newest config (do this from a cron/after-backup if desired).

## Clients
`packages/core/src/endpoints.ts` - `HOME_SERVERS` (omarchy then standby), `firstReachable()`. Electron/iOS direct mode picks the first reachable HA.
Browsers: bookmark both URLs; the Mac URL always works (it forwards to omarchy when it is up).

## Limitations
- Docker Desktop on the Mac must be running (`open -a Docker`; watchdog starts it). Bridge networking: WiZ/Sonos discovery by broadcast may be limited in HA standby.
- Assistant (Grok CLI) / Oda / Fabel features in Mac failover depend on those CLIs/sessions existing on the Mac.
- A plain browser tab on the omarchy URL cannot move itself to the Mac origin when omarchy is fully dead; use the Mac URL.
