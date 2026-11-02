# Auth broker (native logins)

Every integration login runs from the device where «Logg inn» is tapped (iPhone/iPad/Mac) as a native sheet in the
dashboard. The server drives the login; secrets never reach the frontend.

- `broker.mjs` – sessions, `/api/auth/*`, OAuth callback `/auth/callback/<provider>`.
- `vault.mjs` – AES-256-GCM vault `data/auth/vault.bin` (0600), key `secrets/auth_vault.key` (0600).
- `audit.mjs` – `data/auth/audit.log` (allow-listed keys only, never values).
- `cdp.mjs` – isolated headless Chromium (`data/auth/browser`, 127.0.0.1:9333) or main Brave (9222).
- `providers/*` – interface `status, start, step, poll, complete, refresh, logout, cleanup`.

Steps: `form` (phone, SMS code, email+password, fødselsnummer), `waiting` (BankID approval, polled), `redirect`
(OAuth on the same device), `remote` (live view of the server-side page with tap/drag relay and «Sett inn» into the
focused field; used for sliders and as fallback when a page changes), `done`, `error`.

| Provider | Flow |
|---|---|
| SmartThings | HA owns OAuth + refresh; status and entry reload from the app; HA reauth page only if Samsung revokes |
| Spotify | OAuth Code+PKCE, redirect `https://home.example.com:8444/auth/callback/spotify`, vault tokens, refresh. Needs `secrets/spotify_client_id` |
| Oda | email + password → server session |
| Dreamehome | email + password stored encrypted for the Dreame HA integration |
| Fabel | phone + SMS code typed into isolated headless browser; cookies → vault |
| Navimow | remote view of the prepared login tab; slider dragged on the device |
| Visma Flyt / MyKid | fødselsnummer inserted into page once (never stored/logged) → BankID approval polling until the read transport answers |

Browser choice: BankID services and Navimow use a background tab in the owner's main Brave, because the Skole/MyKid read
transports and keep-alive run inside those logged-in tabs (and the profile survives restarts). Fabel and other
cookie logins use the isolated headless Chromium (invisible, separate cookies).

Security: Tailscale-only (`trusted()`, localhost refused), CSRF header + same-Origin check on every state change,
rate limits (6 starts/10 min per provider, 30 steps/min per peer), max 2 password attempts per provider per 12 h,
session TTL 10 min. HTTPS on the Tailscale IP only (`tailscale cert`, port 8444 since `tailscale serve` uses 443/8443),
renewed weekly by `home-tls-renew.timer`. No firewall changes. Tests: `node --test test/` (mock providers only).
