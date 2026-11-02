// Auth broker: one API for every integration login, driven from whichever device taps "Logg inn".
// Routes (all Tailscale-only via trusted(); state-changing calls need the CSRF header + same Origin):
//   GET  /api/auth/providers                  status of every provider (no secrets)
//   GET  /api/auth/csrf                       issues the CSRF token (cookie + body)
//   POST /api/auth/<provider>/start           -> { session, step }
//   GET  /api/auth/session/<id>               poll -> step
//   POST /api/auth/session/<id>/step          submit form values (used once, never stored/logged)
//   GET  /api/auth/session/<id>/frame         remote view: JPEG of the server-side login page
//   POST /api/auth/session/<id>/input         remote view: {type: tap|down|move|up, x, y} (0..1) or {key}
//   DELETE /api/auth/session/<id>             cancel
//   POST /api/auth/<provider>/refresh|logout
//   GET  /auth/callback/<provider>            OAuth redirect target (HTTPS tailnet origin), validated by state
//   GET  /api/auth/audit                      recent audit entries
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readBody, sendJson } from "../util.mjs";
import { audit, recent } from "./audit.mjs";
import { vault } from "./vault.mjs";
import oda from "./providers/oda.mjs";
import dreame from "./providers/dreame.mjs";
import { skoleProvider } from "./providers/bankid.mjs";
import mykidProvider from "./providers/mykidPw.mjs";
import { fabel, navimow } from "./providers/browserLogin.mjs";
import { spotify, smartthings, PUBLIC_ORIGIN } from "./providers/oauth.mjs";
import { mockSms, mockBankid, mockPassword } from "./providers/mock.mjs";
const SECURITY = { "x-content-type-options": "nosniff", "referrer-policy": "same-origin", "cache-control": "no-store" };
export function initAuth({ mock = process.env.HOME_AUTH_MOCK === "1", onChange = () => {} } = {}) {
  const providers = new Map([smartthings, spotify, skoleProvider, mykidProvider, oda, navimow, dreame, fabel, ...(mock ? [mockSms, mockBankid, mockPassword] : [])].map((p) => [p.id, p]));
  const sessions = new Map();            // id -> ctx
  const TTL = 10 * 60e3;
  const csrf = vault.get("_csrf")?.token ?? (() => { const t = randomBytes(24).toString("base64url"); vault.set("_csrf", { token: t }); return t; })();
  // --- limits
  const hits = new Map();
  const limited = (key, max, windowMs) => { const now = Date.now(); const a = (hits.get(key) ?? []).filter((t) => now - t < windowMs); a.push(now); hits.set(key, a); return a.length > max; };
  const attempts = (pid) => { const a = vault.get("_attempts")?.[pid]; return a && Date.now() - a.at < 12 * 3600e3 ? a.n : 0; };
  const bumpAttempt = (pid, ok) => { const all = { ...(vault.get("_attempts") ?? {}) }; delete all._savedAt; if (ok) delete all[pid]; else all[pid] = { n: attempts(pid) + 1, at: Date.now() }; vault.set("_attempts", all); };
  setInterval(() => { for (const [id, c] of sessions) if (Date.now() - c.touched > TTL) end(id, "expired"); }, 60e3).unref();
  async function end(id, reason) { const c = sessions.get(id); if (!c) return; sessions.delete(id); audit({ provider: c.provider.id, event: "end", session: id.slice(0, 6), reason }); try { await c.provider.cleanup?.(c); } catch { /* */ } }
  const view = (c, step) => {
    c.step = step; c.touched = Date.now();
    if (step.state === "done" || step.state === "error") { audit({ provider: c.provider.id, event: step.state, session: c.id.slice(0, 6) }); if (step.state === "done") onChange(c.provider.id); setTimeout(() => end(c.id, step.state), 30e3); }
    const { fields, insert, ...rest } = step; return { session: c.id, provider: c.provider.id, ...rest, fields, insert, remote: step.state === "remote" };
  };
  async function list() {
    return Promise.all([...providers.values()].map(async (p) => { let s; try { s = await p.status(); } catch (e) { s = { status: "unknown", detail: String(e.message).slice(0, 100) }; }
      const live = [...sessions.values()].find((c) => c.provider.id === p.id && !/done|error/.test(c.step?.state ?? ""));
      return { id: p.id, name: p.name, kind: p.kind, method: p.method, mock: !!p.mock, ...s, pending: live ? live.id : null, attemptsLeft: p.password ? Math.max(0, 2 - attempts(p.id)) : null,
        canLogout: !!p.logout, canRefresh: !!p.refresh, remoteCapable: !!p.remoteCapable }; }));
  }
  const origin = (req) => `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`;
  function csrfOk(req) {
    const o = req.headers.origin; if (o && o !== origin(req)) return false;
    const h = String(req.headers["x-home-csrf"] ?? ""); if (h.length !== csrf.length) return false;
    return timingSafeEqual(Buffer.from(h), Buffer.from(csrf));
  }
  async function routes(req, res, sub, trusted) {
    if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
    const peer = req.socket.remoteAddress; const url = new URL(req.url, "http://x");
    try {
      if (req.method === "GET" && sub === "csrf") { res.writeHead(200, { ...SECURITY, "content-type": "application/json", "set-cookie": `home_csrf=${csrf}; Path=/; SameSite=Strict${req.socket.encrypted ? "; Secure" : ""}` }); return res.end(JSON.stringify({ token: csrf, publicOrigin: PUBLIC_ORIGIN })); }
      if (req.method === "GET" && (sub === "" || sub === "providers")) return sendJson(res, 200, { providers: await list(), publicOrigin: PUBLIC_ORIGIN });
      if (req.method === "GET" && sub === "audit") return sendJson(res, 200, { entries: recent(40) });
      const sm = /^session\/([A-Za-z0-9_-]{16,})(?:\/(step|frame|input))?$/.exec(sub);
      if (sm) {
        const c = sessions.get(sm[1]); if (!c) return sendJson(res, 404, { error: "Innloggingen er utløpt – start på nytt" });
        if (req.method === "GET" && sm[2] === "frame") { if (!c.page) return sendJson(res, 409, { error: "ingen fjernvisning" }); const s = await c.page.screenshot(); c.touched = Date.now(); c.frame = s;
          res.writeHead(200, { ...SECURITY, "content-type": "image/jpeg", "x-frame-w": String(s.w), "x-frame-h": String(s.h) }); return res.end(Buffer.from(s.data, "base64")); }
        if (req.method === "GET" && !sm[2]) { const step = c.step.state === "waiting" || c.step.state === "remote" ? (c.provider.poll ? await c.provider.poll(c) : c.step) : c.step; return sendJson(res, 200, view(c, step)); }
        if (!csrfOk(req)) return sendJson(res, 403, { error: "CSRF" });
        if (req.method === "DELETE" && !sm[2]) { await end(c.id, "cancel"); return sendJson(res, 200, { ok: true }); }
        if (req.method === "POST" && sm[2] === "input") {
          if (limited(`in:${c.id}`, 600, 60e3)) return sendJson(res, 429, { error: "for mange" });
          const b = await readBody(req, 4096); if (!c.page) return sendJson(res, 409, { error: "ingen fjernvisning" });
          const f = c.frame ?? (await c.page.screenshot());
          if (b.key) await c.page.key(String(b.key).slice(0, 64)); else await c.page.pointer(String(b.type), Math.round(Number(b.x) * f.w), Math.round(Number(b.y) * f.h));
          c.touched = Date.now(); return sendJson(res, 200, { ok: true });
        }
        if (req.method === "POST" && sm[2] === "step") {
          if (limited(`step:${peer}`, 30, 60e3)) return sendJson(res, 429, { error: "For mange forsøk – vent litt" });
          const values = await readBody(req, 8192);
          if (c.provider.password && values.password !== undefined) {
            if (attempts(c.provider.id) >= 2) { audit({ provider: c.provider.id, event: "blocked", reason: "max-attempts" }); return sendJson(res, 429, { error: "Maks to passordforsøk – prøv igjen om 12 timer, eller sjekk passordet i Bitwarden." }); }
          }
          audit({ provider: c.provider.id, event: "step", session: c.id.slice(0, 6), step: Object.keys(values).filter((k) => !/^(nin|password|code|phone|text|email)$/.test(k)).join(",") || "form" });
          const step = await c.provider.step(c, values);
          if (c.provider.password && values.password !== undefined) bumpAttempt(c.provider.id, step.state === "done");
          return sendJson(res, 200, view(c, step));
        }
        return sendJson(res, 405, { error: "method" });
      }
      const pm = /^([a-z-]+)\/(start|refresh|logout)$/.exec(sub);
      if (pm && req.method === "POST") {
        const p = providers.get(pm[1]); if (!p) return sendJson(res, 404, { error: "ukjent tjeneste" });
        if (!csrfOk(req)) return sendJson(res, 403, { error: "CSRF" });
        audit({ provider: p.id, event: pm[2], peer });
        if (pm[2] === "refresh") return sendJson(res, 200, p.refresh ? await p.refresh() : { ok: false });
        if (pm[2] === "logout") { const r = p.logout ? await p.logout() : { ok: false }; onChange(p.id); return sendJson(res, 200, r); }
        if (limited(`start:${p.id}`, 6, 10 * 60e3)) return sendJson(res, 429, { error: "For mange innloggingsforsøk – vent noen minutter" });
        for (const [id, c] of sessions) if (c.provider.id === p.id) await end(id, "replaced");
        const c = { id: randomBytes(16).toString("base64url"), provider: p, data: {}, createdAt: Date.now(), touched: Date.now(), peer };
        sessions.set(c.id, c);
        try { return sendJson(res, 200, view(c, await p.start(c))); } catch (e) { return sendJson(res, 200, view(c, { state: "error", title: "Noe gikk galt", message: String(e.message).slice(0, 160) })); }
      }
      return sendJson(res, 404, { error: "not found" });
    } catch (e) { return sendJson(res, e.status ?? 502, { error: String(e.message).slice(0, 200) }); }
  }
  // OAuth redirect target: /auth/callback/<provider>?code&state  -> finishes in the session, then back into the app.
  async function callback(req, res, pid, trusted) {
    if (!trusted(req)) { res.writeHead(403).end(); return; }
    const q = Object.fromEntries(new URL(req.url, "http://x").searchParams);
    const c = [...sessions.values()].find((x) => x.provider.id === pid && x.data.state && x.data.state === q.state);
    let step; if (!c) step = { state: "error", message: "Innloggingen er utløpt" }; else { try { step = view(c, await c.provider.complete(c, q)); } catch (e) { step = view(c, { state: "error", title: "Feil", message: String(e.message).slice(0, 120) }); } }
    audit({ provider: pid, event: "callback", ok: step.state === "done" });
    res.writeHead(302, { ...SECURITY, location: `/#/settings/login/${pid}?result=${step.state === "done" ? "ok" : "error"}` }).end();
  }
  return { routes, callback, list, providers };
}
