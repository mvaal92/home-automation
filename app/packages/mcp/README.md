# @home/mcp — Home Assistant MCP server

An [MCP](https://modelcontextprotocol.io) server for the Home app, built on the official
`@modelcontextprotocol/sdk` and reusing `@home/core` (the same HA websocket client, room
model and health checks as the UI). One long-lived HA websocket keeps a live entity cache,
so reads are instant and every control tool returns the entity's *new* state.

| Mode | Endpoint | Auth |
|---|---|---|
| Streamable HTTP (persistent, systemd `home-mcp.service`) | `http://<omarchy-tailscale-ip>:8125/mcp` (Tailscale) and `http://127.0.0.1:8125/mcp` | `Authorization: Bearer <token>` — token in `~/home-automation/secrets/mcp_token` (0600) |
| stdio | `node packages/mcp/dist/home-mcp.mjs --stdio` | none (local process) |

The HTTP server is stateless (fresh MCP server per request, JSON responses, POST only).
The bearer token is compared in constant time and re-read on every request, so you can
rotate it without a restart:
`openssl rand -base64 36 | tr -d '/+=\n' > ~/home-automation/secrets/mcp_token`.

## Tools

| Tool | What it does |
|---|---|
| `home_overview` | Rooms (temp/humidity/what's on), active devices, counts per domain, health issues |
| `list_areas` | Areas with entity/device counts |
| `list_devices` | Device registry, filter by `area` / `query` (name, manufacturer, model) |
| `list_entities` | Entities with state, filter by `area`, `domain`, `state` |
| `get_state` | Full state + attributes for one or more entities |
| `search` | Accent-insensitive search over entities, devices, areas (`kjokken` → Kjøkken) |
| `get_history` | Downsampled history + min/max/avg for the last N hours |
| `set_light` | on/off/toggle, `brightness_pct`, `color_temp_kelvin`, `rgb_color`, `color_name`, `transition`; by entity or `area` |
| `set_switch` | switches, plugs, input_booleans |
| `set_fan` | on/off, `percentage`, `preset_mode`, oscillation, direction (e.g. Flexit) |
| `set_climate` | `hvac_mode`, `temperature` / range, `preset_mode`, `fan_mode` |
| `media_control` | play/pause/next/previous/volume/mute/source/power |
| `set_cover` | open/close/stop/position (garage & gate covers need `confirm=true`) |
| `vacuum_control` | start/pause/stop/return_to_base/locate/spot/fan speed |
| `run_scene`, `run_script` | activate scenes, run scripts with variables |
| `list_automations`, `trigger_automation`, `toggle_automation` | inspect, run, enable/disable |
| `call_service` | generic escape hatch, targets `entity_id`/`area_id`/`device_id`, `return_response` |

**Safety:** locks, alarm panels, valves and garage/gate/door covers refuse to act unless
`confirm=true`. `call_service` expands area/device targets and `data.entity_id` to concrete
entities before checking, so the guard can't be bypassed by targeting a whole room.

## Connect a client

Put the token in your environment first (on a tailnet machine):

```sh
export HOME_MCP_TOKEN="$(ssh omarchy cat ~/home-automation/secrets/mcp_token)"   # or copy it from omarchy
```

### Claude Code

```sh
claude mcp add --transport http home http://<omarchy-tailscale-ip>:8125/mcp \
  --header "Authorization: Bearer $HOME_MCP_TOKEN"
# or, on omarchy itself, stdio:
claude mcp add home -- node /home/owner/home-automation/app/packages/mcp/dist/home-mcp.mjs --stdio
```

### Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.home]
url = "http://<omarchy-tailscale-ip>:8125/mcp"
bearer_token_env_var = "HOME_MCP_TOKEN"

# stdio alternative (on omarchy)
# [mcp_servers.home]
# command = "node"
# args = ["/home/owner/home-automation/app/packages/mcp/dist/home-mcp.mjs", "--stdio"]
```

### Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "home": {
      "url": "http://<omarchy-tailscale-ip>:8125/mcp",
      "headers": { "Authorization": "Bearer ${env:HOME_MCP_TOKEN}" }
    }
  }
}
```

### Grok Bot

Add a custom MCP connector (streamable HTTP) with URL `http://<omarchy-tailscale-ip>:8125/mcp` and
header `Authorization: Bearer <token>`. The URL is only reachable from inside the tailnet: a
connector that runs in the cloud can't reach a `100.x` address, so either run the agent on a
tailnet machine (omarchy works, with the stdio command above) or expose the endpoint
deliberately (e.g. Tailscale Funnel on a separate path) — the bearer token is the only
protection in that case, so rotate it if it ever leaks.

### Anything else

Any MCP client that speaks streamable HTTP: POST JSON-RPC to `/mcp` with
`Accept: application/json, text/event-stream` and the bearer header. Health check: `GET /healthz`.

## Develop

```sh
pnpm --filter @home/mcp build        # bundle -> dist/home-mcp.mjs
pnpm --filter @home/mcp test         # unit tests (safety guards)
pnpm --filter @home/mcp test:live    # every tool against the LIVE HA over HTTP (restores devices)
./deploy/install-services.sh         # (re)build + restart home-web and home-mcp services
journalctl --user -u home-mcp -f
```

Env: `HOME_HA_URL` (default `http://127.0.0.1:8123`), `HOME_HA_TOKEN_FILE`, `HOME_MCP_TOKEN_FILE`,
`HOME_MCP_BIND` (default `<omarchy-tailscale-ip>,127.0.0.1`), `HOME_MCP_PORT` (8125).

The live test turns one *off* WiZ bulb on (30 % → 60 %) and back off, uses no-op values for
switches/fan/media (same as current), and creates a temporary automation, script and scene
that it deletes afterwards.
