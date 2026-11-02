// Provider interface (all methods async, all optional except status/start):
//   status()              -> { status: ok|login-required|not-connected|needs-setup|error|unknown, expiresAt?, detail? }
//   start(ctx)            -> Step      first step of an interactive login (ctx = per-login session, ctx.data is server-only)
//   step(ctx, values)     -> Step      submit a form step; values are used immediately and never persisted/logged
//   poll(ctx)             -> Step      called while state === "waiting" (BankID approval etc.)
//   complete(ctx, query)  -> Step      OAuth redirect callback
//   refresh() / logout()  -> { ok }
//   cleanup(ctx)                       session ended/cancelled
// Step = { state: form|waiting|remote|redirect|done|error, title, message?, fields?: Field[], submit?, url?, pollMs?, insert? }
// Field = { name, label, type: text|tel|email|password|code|nin, autocomplete?, inputmode?, maxLength? }
export const form = (title, fields, extra = {}) => ({ state: "form", title, fields, submit: extra.submit ?? "Fortsett", ...extra });
export const waiting = (title, message, pollMs = 2000, extra = {}) => ({ state: "waiting", title, message, pollMs, ...extra });
export const done = (message = "Innlogget ✓") => ({ state: "done", title: "Ferdig", message });
export const fail = (message) => ({ state: "error", title: "Noe gikk galt", message });
export const remote = (title, message, extra = {}) => ({ state: "remote", title, message, pollMs: 2500, ...extra });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
