// OAuth providers. Redirect URIs use the Tailscale HTTPS origin (tailscale cert, MagicDNS name, tailnet-only):
//   https://<host>.ts.net:8444/auth/callback/<provider>
// The authorize URL opens on the device that tapped the button, and the callback lands back in the app there.
import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { vault } from "../vault.mjs";
import { secret, expand } from "../../util.mjs";
import { haRest } from "../../ha.mjs";
import { done, fail } from "./_base.mjs";
export const PUBLIC_ORIGIN = process.env.HOME_PUBLIC_ORIGIN ?? "https://home.example.com:8444";
const b64u = (b) => b.toString("base64url");
// --- Spotify: Authorization Code + PKCE, tokens in the vault, refreshed server-side.
const SP_SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-recently-played playlist-read-private user-library-read";
const spRedirect = `${PUBLIC_ORIGIN}/auth/callback/spotify`;
async function spToken(params) {
  const r = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: secret("spotify_client_id") ?? "", ...params }), signal: AbortSignal.timeout(15000) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error_description ?? j.error ?? `Spotify ${r.status}`); return j;
}
const spSave = (j, prev = {}) => vault.set("spotify", { access_token: j.access_token, refresh_token: j.refresh_token ?? prev.refresh_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000, scope: j.scope });
export const spotify = { id: "spotify", name: "Spotify", kind: "oauth", method: "OAuth (PKCE) – tokens i appen, fornyes automatisk",
  async status() {
    if (!secret("spotify_client_id")) return { status: "needs-setup", detail: `Mangler Spotify-app (client id). Redirect-URI: ${spRedirect}` };
    const t = vault.get("spotify"); if (!t?.refresh_token) return { status: "not-connected" };
    return { status: "ok", expiresAt: t.expires_at, autoRenew: true };
  },
  async start(ctx) {
    if (!secret("spotify_client_id")) return fail(`Spotify-appen er ikke satt opp ennå. Legg inn client id (redirect: ${spRedirect}).`);
    ctx.data.verifier = b64u(randomBytes(48)); ctx.data.state = b64u(randomBytes(16));
    const u = new URL("https://accounts.spotify.com/authorize");
    u.search = new URLSearchParams({ client_id: secret("spotify_client_id"), response_type: "code", redirect_uri: spRedirect, scope: SP_SCOPES, state: ctx.data.state,
      code_challenge_method: "S256", code_challenge: b64u(createHash("sha256").update(ctx.data.verifier).digest()) });
    return { state: "redirect", title: "Logg inn hos Spotify", message: "Du sendes til Spotify og tilbake hit.", url: u.toString() };
  },
  async complete(ctx, q) {
    if (q.error) return fail(`Spotify: ${q.error}`);
    if (!q.code || q.state !== ctx.data.state) return fail("Ugyldig svar fra Spotify");
    spSave(await spToken({ grant_type: "authorization_code", code: q.code, redirect_uri: spRedirect, code_verifier: ctx.data.verifier })); return done("Spotify er koblet til ✓");
  },
  async refresh() { const t = vault.get("spotify"); if (!t?.refresh_token) return { ok: false }; spSave(await spToken({ grant_type: "refresh_token", refresh_token: t.refresh_token }), t); return { ok: true }; },
  logout: async () => { vault.del("spotify"); return { ok: true }; },
};
export async function spotifyAccessToken() { const t = vault.get("spotify"); if (!t) return null; if (t.expires_at - Date.now() < 120e3) { await spotify.refresh(); return vault.get("spotify").access_token; } return t.access_token; }
// --- SmartThings: OAuth lives in Home Assistant's config entry (HA refreshes it). We read health and can reload the
// entry (non-actuating). A full re-auth (only if Samsung revokes the refresh token) runs HA's reauth flow.
const ST_FILE = expand("~/home-automation/data/auth/smartthings.json");
const stEntry = async () => (await haRest("/config/config_entries/entry?domain=smartthings"))?.[0] ?? null;
export const smartthings = { id: "smartthings", name: "SmartThings", kind: "oauth", method: "OAuth i Home Assistant (fornyes automatisk)",
  async status() {
    let e = null; try { e = await stEntry(); } catch { return { status: "unknown" }; }
    if (!e) return { status: "not-connected" };
    let st = null; try { st = JSON.parse(readFileSync(ST_FILE, "utf8")); } catch { /* */ }
    const s = e.state === "loaded" ? "ok" : e.state === "setup_error" && /auth/i.test(e.reason ?? "") ? "login-required" : e.state === "loaded" ? "ok" : "error";
    return { status: s, expiresAt: st?.expires_at ? st.expires_at * 1000 : null, autoRenew: true, detail: e.title };
  },
  async start() {
    const e = await stEntry().catch(() => null);
    if (e?.state === "loaded") { return done("SmartThings er tilkoblet og fornyes automatisk av Home Assistant ✓"); }
    if (e) { await haRest(`/config/config_entries/entry/${e.entry_id}/reload`, {}); const n = await stEntry(); if (n?.state === "loaded") return done("SmartThings koblet til igjen ✓"); }
    const ha = process.env.HOME_HA_TAILNET ?? "http://100.64.0.1:8123";
    return { state: "redirect", title: "Godkjenn SmartThings", message: "Samsung krever ny godkjenning i Home Assistant. Åpnes på denne enheten.", url: `${ha}/config/integrations/integration/smartthings`, external: true };
  },
  async refresh() { const e = await stEntry(); if (!e) return { ok: false }; await haRest(`/config/config_entries/entry/${e.entry_id}/reload`, {}); return { ok: true }; },
};
