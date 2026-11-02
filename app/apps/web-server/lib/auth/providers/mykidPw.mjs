// MyKid: mobile + password. The credential is kept in the encrypted vault (cred:mykid) so the login keeper
// (lib/keeper.mjs) can re-login automatically. The sheet only asks when no/invalid credential, or for an SMS code.
import * as mykid from "../../mykid.mjs";
import { vault } from "../vault.mjs";
import { mykidLogin } from "../../keeper.mjs";
import { form, done, fail } from "./_base.mjs";
const fields = [{ name: "username", label: "Mobilnummer", type: "tel", autocomplete: "username", inputmode: "tel" }, { name: "password", label: "Passord", type: "password", autocomplete: "current-password" }];
export default { id: "mykid", name: "MyKid (Barnehage)", kind: "password", password: true, method: "Mobil + passord – logges inn automatisk hver dag",
  status: async () => { try { await mykid.ping(); return { status: "ok", detail: vault.has("cred:mykid") ? "Automatisk innlogging aktiv" : "Mangler lagret passord" }; } catch (e) { return { status: e.loginRequired || /utlogget/.test(e.message) ? "login-required" : "unknown" }; } },
  async start() {
    if (vault.has("cred:mykid")) { const r = await mykidLogin({ reason: "sheet" }); if (r.ok) return done("MyKid er innlogget ✓"); }
    return form("Logg inn på MyKid", fields, { submit: "Logg inn", message: "Lagres kryptert på omarchy, så appen kan logge inn automatisk hver dag." });
  },
  async step(_ctx, v) {
    const prev = vault.get("cred:mykid");
    vault.set("cred:mykid", { username: String(v.username ?? "").replace(/\D/g, ""), password: String(v.password ?? "") });
    const r = await mykidLogin({ reason: "sheet-new-cred" });
    if (r.ok) { mykid.sync().catch(() => {}); return done("MyKid er innlogget ✓ – logges inn automatisk fra nå"); }
    if (prev) vault.set("cred:mykid", prev);
    return fail(r.msg ?? "Innloggingen feilet");
  } };
