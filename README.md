# Home

Self-hosted smart-home app for our house: Home Assistant + a custom React dashboard (web, Electron, iOS), voice/chat assistant and an MCP server. All UI text is Norwegian.

## Architecture
```
 Browser / Electron / iOS ──► home-web (Node, :8124) ──► Home Assistant (Docker, :8123)
                                  │  ├─ prefs/notes/maintenance → SQLite (data/home.db, not in git)
                                  │  ├─ Kids hub (MyKid, Visma Flyt – read-only)
                                  │  ├─ Spotify / Sonos / Oda / Fabel / SmartThings
                                  │  └─ Assistant: HA Assist → Grok CLI → OpenAI
 Grok CLI / agents ──────────► home-mcp (MCP server, :8125/mcp)
```
Everything is reachable over Tailscale only. omarchy is primary; the Mac mini is a hot standby (see `docs/FAILOVER.md`).

## Layout
| Path | What |
|---|---|
| `app/` | pnpm monorepo: `packages/ui` (React), `apps/web-server`, `packages/mcp`, `apps/desktop` (Electron), `apps/ios`, `deploy/` (systemd units), `ha-packages/` |
| `ha-config/` | HA YAML: `configuration.yaml`, automations, scripts, scenes, `packages/` (no secrets/.storage/DB) |
| `infra/failover/` | backup + standby sync, Mac mini launchd/failover scripts |
| `infra/systemd/` | user units: backup, standby-sync, SmartThings token sync, web, mcp |
| `infra/tools/` | HA build/registry helpers, `st_token_sync.py` |
| `scripts/` | SmartThings rename + undo |
| `grok-assistant/` | Grok CLI prompts + `config.example.toml` |
| `docs/` | AUTOMATIONS, FAILOVER, GROK_CLI_PLAN, infra notes |

## Services & ports
| Service | Port |
|---|---|
| Home Assistant (Docker) | 8123 |
| home-web (dashboard + API) | 8124 |
| home-mcp (MCP) | 8125 |

## Run
```sh
docker compose up -d                       # Home Assistant
cd app && pnpm install && pnpm build
./deploy/install-services.sh               # installs + starts home-web / home-mcp user units
cp ../infra/systemd/*.{service,timer} ~/.config/systemd/user/ && systemctl --user daemon-reload
```
Secrets live outside git in `secrets/` (0600) and `ha-config/secrets.yaml`; runtime data in `data/`. Copy `grok-assistant/.grok/config.example.toml` to `config.toml` and set the MCP token.

## Private configuration (not in git)
Family names, school and Tailscale addresses are **not** in the source. They are loaded at runtime:
- `data/family.json` (0600, gitignored) – children, kindergarten/school, owner. Template: `app/apps/web-server/family.example.json`. Prompts use `{{school.name}}`-style placeholders filled by `lib/family.mjs`.
- `app/packages/ui/.env.local` – `VITE_HOME_SERVERS`, `VITE_HA_URL` (see `.env.example`); server binds via `HOME_BIND`, `HOME_MCP_BIND`, `HOME_PROXY_TRUSTED_LOCAL`, `HOME_PREVIEW_HOST`, `HOME_WEB_URL` in the systemd units.

## How this repo is kept up to date
The live source of truth is `~/home-automation` on omarchy (the app's own git repo plus infra). This repo is an **export**:
`home-repo-sync.timer` runs `infra/tools/home-repo-sync.sh` every 15 min. It copies the app's committed tree (`git archive HEAD`, no screenshots), docs, HA YAML, failover scripts and `home-*` systemd units here, redacts personal strings with `secrets/redact.txt` (kept outside git), and only commits + pushes if the staged tree passes: no forbidden paths (secrets/, data/, *.db, .env, family.json, config.toml), no hit for `secrets/redact.grep`, and a clean `gitleaks` scan. One commit per sync: `sync: app@<sha> (<subject>)`. Logs: `journalctl --user -u home-repo-sync`.
History was purged once with `git filter-repo --replace-text secrets/redact.txt --replace-message secrets/redact.txt`.
