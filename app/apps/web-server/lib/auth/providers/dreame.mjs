// Dreamehome cloud account. The vacuum already works durably via SmartThings; the full Dreame integration
// (maps/consumables) needs the Dreamehome login, which we keep encrypted in the vault for the HA integration setup.
import { vault } from "../vault.mjs";
import { form, done } from "./_base.mjs";
export default { id: "dreame", name: "Dreamehome (kart/forbruk)", kind: "password", method: "Dreamehome-konto (lagres kryptert)", password: true,
  status: async () => ({ status: vault.has("dreame") ? "ok" : "not-connected", detail: vault.has("dreame") ? "Lagret – brukes når Dreame-integrasjonen installeres" : null }),
  start: async () => form("Dreamehome-konto", [{ name: "email", label: "E-post", type: "email", autocomplete: "username" }, { name: "password", label: "Passord", type: "password", autocomplete: "current-password" }], { submit: "Lagre", message: "Lagres kryptert på omarchy og brukes bare til Dreame-integrasjonen." }),
  step: async (_ctx, v) => { vault.set("dreame", { email: String(v.email ?? ""), password: String(v.password ?? "") }); return done("Lagret ✓"); },
  logout: async () => { vault.del("dreame"); return { ok: true }; } };
