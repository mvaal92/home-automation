// Mock providers for tests (enabled with HOME_AUTH_MOCK=1). Exercise every step type without touching real services.
import { form, waiting, done, fail } from "./_base.mjs";
let mockOk = { "mock-sms": false, "mock-bankid": false, "mock-password": false };
export const mockSms = { id: "mock-sms", name: "Test: SMS", kind: "sms", method: "Mobil + SMS-kode (test)", mock: true,
  status: async () => ({ status: mockOk["mock-sms"] ? "ok" : "not-connected" }),
  start: async () => form("Logg inn", [{ name: "phone", label: "Mobilnummer", type: "tel", autocomplete: "tel", inputmode: "tel" }], { submit: "Send kode" }),
  step: async (ctx, v) => {
    if (!ctx.data.sent) { if (!/^\+?\d{8,12}$/.test(String(v.phone ?? "").replace(/\s/g, ""))) return { ...form("Logg inn", [{ name: "phone", label: "Mobilnummer", type: "tel" }]), message: "Ugyldig nummer" }; ctx.data.sent = true;
      return form("Skriv inn koden", [{ name: "code", label: "Kode fra SMS", type: "code", autocomplete: "one-time-code", inputmode: "numeric", maxLength: 6 }], { message: "Vi sendte en kode (test: 123456)", submit: "Logg inn" }); }
    if (v.code !== "123456") return fail("Feil kode"); mockOk["mock-sms"] = true; return done(); },
  logout: async () => { mockOk["mock-sms"] = false; return { ok: true }; } };
export const mockBankid = { id: "mock-bankid", name: "Test: BankID", kind: "bankid", method: "BankID (test)", mock: true,
  status: async () => ({ status: mockOk["mock-bankid"] ? "ok" : "login-required" }),
  start: async () => form("Logg inn med BankID", [{ name: "nin", label: "Fødselsnummer (11 siffer)", type: "nin", inputmode: "numeric", autocomplete: "off", maxLength: 11 }], { message: "Brukes bare til å fylle inn feltet. Lagres ikke." }),
  step: async (ctx, v) => { if (!/^\d{11}$/.test(String(v.nin ?? ""))) return fail("Fødselsnummer må være 11 siffer"); ctx.data.polls = 0; return waiting("Godkjenn i BankID-appen", "Åpne BankID-appen på telefonen og godkjenn.", 800); },
  poll: async (ctx) => { if (++ctx.data.polls < 3) return waiting("Godkjenn i BankID-appen", "Venter på godkjenning …", 800); mockOk["mock-bankid"] = true; return done(); } };
export const mockPassword = { id: "mock-password", name: "Test: Passord", kind: "password", method: "E-post + passord (test)", mock: true,
  status: async () => ({ status: mockOk["mock-password"] ? "ok" : "not-connected" }),
  start: async () => form("Logg inn", [{ name: "email", label: "E-post", type: "email", autocomplete: "username" }, { name: "password", label: "Passord", type: "password", autocomplete: "current-password" }]),
  password: true,
  step: async (ctx, v) => { if (v.password !== "riktig") return fail("Feil e-post eller passord"); mockOk["mock-password"] = true; return done(); } };
