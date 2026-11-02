# Grok CLI × Home — integration plan (2026-10-12)

## Status verified today
- home-mcp (systemd user) active. http://100.64.0.1:8125/mcp: initialize 3 ms, tools/list 9 ms, 20 tools. list_areas, search("kjøkken") and home_overview each take 6–9 ms and return the new Norwegian names (Kjeller, Soverom 1, Morgen/Middag/Filmkveld). entity_ids are unchanged.
- Grok CLI 1.0.50 at ~/.local/share/vite-plus/bin/grok. Signed in with grok.com. Models: grok-4.7 (default), grok-4.7-build-fast, grok-4.6.
- Sandboxed workspace `~/home-automation/grok-assistant/`:
  - `.grok/config.toml` (0600) has `[mcp_servers.home]` (http + bearer header). It stays project-scoped, so the user config holds no token.
  - The folder is added to `~/.grok/trusted_folders.toml`; project MCP servers don't start in untrusted folders.
  - `grok mcp doctor home` reports a healthy handshake and 20 tools.
- Read-only test: `grok -p "Which lights are on?" --disallowed-tools bash,edit,write --disable-web-search --no-subagents --no-plan --always-approve` gave a correct Norwegian answer (7 lights) in about 15 s end to end.

## Architecture
App text/voice → web-server `/api/assistant` → `grok -p` (cwd grok-assistant, home MCP only) → MCP → HA.
Voice: browser mic → Whisper (10300) → assistant → Piper (10200) → audio.
Fast path first: HA Assist conversation/process (Norwegian intents, under 300 ms). Grok is used only when Assist returns no match, or for open-ended questions.

## Components
1. **Assistant endpoint**: `apps/web-server/src/assistant.ts`
   - POST `{text, confirm?}`. Spawns `grok -p <text> --output-format json --json-schema <{reply, actions[], needs_confirm}> --system-prompt-override $(cat prompts/home.md) --disallowed-tools bash,edit,write,web --no-subagents --no-plan --max-turns 6 -m grok-4.7-build-fast`.
   - Tool permissions: `--allow home__*`, never `--always-approve` in production.
   - Timeout 25 s, then fall back to Assist.
   - Single-flight queue; reuse sessions with `-s` per device for follow-ups.
   - Reachable only on the Tailscale interface (same guard as /ha proxy).
2. **Safety layer** (enforced in the MCP server, not just the prompt):
   - Locks, alarms, garage, valves, water heater and camera privacy stay confirm-only. The MCP already requires `confirm=true`. The assistant must return `needs_confirm`, and the app shows a confirm sheet.
   - Quiet hours 23–07: no media volume above 20 %, no full-brightness lights in bedrooms unless explicitly asked.
   - Rate limit of 10 actions per request. All calls are logged to SQLite (`assistant_log`).
3. **Prompt**: `grok-assistant/prompts/home.md`. Norwegian-first, short answers, resolve names via `search`, never guess entity_ids, read state before acting, summarise what changed.
4. **App UI**: `packages/ui/src/assistant/` with an ⌘K / floating text box, a mic button (existing Whisper pipeline), streamed replies (`--output-format streaming-json`), and action chips with undo (reverse the logged prior state).
5. **Scheduled LLM jobs** (systemd user timers, `grok-assistant/jobs/`):
   - `digest.timer` runs at 07:00 and 21:00. It produces a daily digest (temps, ventilation, doors opened, energy, anomalies) and pushes it to the HA Companion app / notification.
   - `anomaly.sh` is triggered by HA automation webhooks (e.g. temp drift, device unavailable over 1 h, fan fault). Grok explains the likely cause.
   - `suggest.timer` runs weekly. It reads `get_history` and `list_automations`, then writes automation suggestions as YAML to the app's "Forslag" tab. They're applied only on tap.
6. **MCP server additions** (`packages/mcp`): `get_logbook`, `get_energy`, `suggest_automation` (dry-run validate), and a `readonly` token scope used by jobs.

## Latency
- Assist fast path: under 0.3 s.
- Grok headless: about 10–15 s now (CLI startup, MCP connect, 2–3 tool turns). This can be reduced to about 4–7 s with build-fast, `--max-turns`, the pre-fetched `home_overview` snapshot in the prompt, and a persistent leader process (already used by the CLI).
- Voice adds roughly 1 s for Whisper and 0.3 s for Piper.

## Cost
- Runs on the owner's grok.com subscription login. There are no per-call API fees; it's subject to plan rate limits.
- Usage can be tracked with `grok usage`.
- A switch to API key billing would be needed only for Grok realtime voice ($0.08/min).

## Privacy
- Prompts and entity states go to xAI. Audio stays local (Whisper/Piper).
- The context sent excludes camera feeds, codes and tokens.
- Opt-out toggle: "Lokal modus" makes the app use Assist only.

## Failure fallback
Grok timeout, auth expiry or network loss falls back to HA Assist (Norwegian), then to the plain UI. `grok mcp doctor home` runs in the health check and is shown in the app's Settings → Status.

## Implementation order
1. Prompt file + `assistant.ts` + Assist fallback.
2. UI command box + mic.
3. Confirm/undo + log.
4. Digest timer.
5. Anomaly webhooks.
6. Suggestions tab.
