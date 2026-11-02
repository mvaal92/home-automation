import * as oda from "../../oda.mjs";
import { form, done, fail } from "./_base.mjs";
import { vault } from "../vault.mjs";
export default { id: "oda", name: "Oda", kind: "password", method: "E-post + passord → server-økt (fornyes ved bruk)", password: true,
  status: async () => { const s = oda.status(); if (!s.loggedIn) return { status: "login-required" }; try { await oda.cart(); return { status: "ok", detail: s.user }; } catch (e) { return { status: e.status === 401 || e.status === 403 ? "login-required" : "unknown" }; } },
  start: async () => form("Logg inn på Oda", [{ name: "email", label: "E-post", type: "email", autocomplete: "username" }, { name: "password", label: "Passord", type: "password", autocomplete: "current-password" }], { submit: "Logg inn" }),
  step: async (_ctx, v) => { try { const s = await oda.login(String(v.email ?? ""), String(v.password ?? "")); if (s.loggedIn) vault.set("cred:oda", { username: String(v.email), password: String(v.password) }); return s.loggedIn ? done(`Innlogget som ${s.user}`) : fail("Oda godtok ikke innloggingen"); } catch { return fail("Feil e-post eller passord"); } },
  logout: async () => { await oda.logout(); return { ok: true }; } };
