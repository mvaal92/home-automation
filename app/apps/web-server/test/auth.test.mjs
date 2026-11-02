// Auth broker tests with mock providers only (no real SMS/BankID/devices). Run: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
const dir = mkdtempSync(`${tmpdir()}/authtest-`);
process.env.HOME_VAULT_FILE = `${dir}/vault.bin`; process.env.HOME_VAULT_KEY = `${dir}/key`;
const { initAuth } = await import("../lib/auth/broker.mjs");
const { vault } = await import("../lib/auth/vault.mjs");
const a = initAuth({ mock: true });
let trustedOk = true;
const srv = http.createServer((req, res) => a.routes(req, res, req.url.split("?")[0].replace(/^\/api\/auth\/?/, ""), () => trustedOk));
await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const base = `http://127.0.0.1:${srv.address().port}`;
const j = async (path, { method = "GET", body, csrf } = {}) => { const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(csrf ? { "x-home-csrf": csrf } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json() }; };
const { b: { token } } = await j("/api/auth/csrf");
test("untrusted is refused", async () => { trustedOk = false; assert.equal((await j("/api/auth/providers")).s, 403); trustedOk = true; });
test("CSRF required for start", async () => { assert.equal((await j("/api/auth/mock-sms/start", { method: "POST" })).s, 403); assert.equal((await j("/api/auth/mock-sms/start", { method: "POST", csrf: "x".repeat(token.length) })).s, 403); });
test("SMS flow", async () => {
  let { b } = await j("/api/auth/mock-sms/start", { method: "POST", csrf: token }); assert.equal(b.state, "form"); assert.equal(b.fields[0].type, "tel");
  ({ b } = await j(`/api/auth/session/${b.session}/step`, { method: "POST", csrf: token, body: { phone: "+4799999999" } })); assert.equal(b.fields[0].name, "code");
  ({ b } = await j(`/api/auth/session/${b.session}/step`, { method: "POST", csrf: token, body: { code: "123456" } })); assert.equal(b.state, "done");
});
test("BankID flow polls to done and never stores the nin", async () => {
  let { b } = await j("/api/auth/mock-bankid/start", { method: "POST", csrf: token }); const sid = b.session;
  ({ b } = await j(`/api/auth/session/${sid}/step`, { method: "POST", csrf: token, body: { nin: "01010112345" } })); assert.equal(b.state, "waiting");
  for (let i = 0; i < 5 && b.state === "waiting"; i++) ({ b } = await j(`/api/auth/session/${sid}`)); assert.equal(b.state, "done");
  const audit = readFileSync(`${process.env.HOME}/home-automation/data/auth/audit.log`, "utf8"); assert.ok(!audit.includes("01010112345"));
  assert.ok(!JSON.stringify(vault.get("_attempts") ?? {}).includes("01010112345"));
});
test("max 2 password attempts", async () => {
  for (const n of [1, 2]) { const { b } = await j("/api/auth/mock-password/start", { method: "POST", csrf: token }); const r = await j(`/api/auth/session/${b.session}/step`, { method: "POST", csrf: token, body: { email: "a@b", password: "feil" } }); assert.equal(r.b.state, "error", `attempt ${n}`); }
  const { b } = await j("/api/auth/mock-password/start", { method: "POST", csrf: token });
  const r = await j(`/api/auth/session/${b.session}/step`, { method: "POST", csrf: token, body: { email: "a@b", password: "riktig" } }); assert.equal(r.s, 429);
});
test("start rate limit", async () => { let last; for (let i = 0; i < 8; i++) last = await j("/api/auth/mock-sms/start", { method: "POST", csrf: token }); assert.equal(last.s, 429); });
test("vault encrypted + 0600", () => { assert.equal(statSync(process.env.HOME_VAULT_FILE).mode & 0o777, 0o600); assert.ok(!readFileSync(process.env.HOME_VAULT_FILE).includes(Buffer.from(token))); });
test("providers list has no secrets", async () => { const { b } = await j("/api/auth/providers"); assert.ok(b.providers.find((p) => p.id === "skole")); assert.ok(!JSON.stringify(b).includes(token)); });
test.after(() => srv.close());
