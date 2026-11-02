// Encrypted credential/session vault (AES-256-GCM). Key: secrets/auth_vault.key (32 random bytes, 0600).
// File: data/auth/vault.bin (0600). Values never leave the server; the broker only exposes derived status.
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { SECRETS, expand } from "../util.mjs";
const KEY_FILE = process.env.HOME_VAULT_KEY ?? `${SECRETS}/auth_vault.key`;
const FILE = expand(process.env.HOME_VAULT_FILE ?? "~/home-automation/data/auth/vault.bin");
function key() {
  if (!existsSync(KEY_FILE)) { writeFileSync(KEY_FILE, randomBytes(32), { mode: 0o600 }); }
  chmodSync(KEY_FILE, 0o600);
  const k = readFileSync(KEY_FILE); if (k.length !== 32) throw new Error("vault key invalid"); return k;
}
let cache = null;
function load() {
  if (cache) return cache;
  if (!existsSync(FILE)) return (cache = {});
  const b = readFileSync(FILE); const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
  return (cache = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8")));
}
function save() {
  mkdirSync(dirname(FILE), { recursive: true, mode: 0o700 });
  const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(cache), "utf8"), c.final()]);
  writeFileSync(FILE + ".tmp", Buffer.concat([iv, c.getAuthTag(), body]), { mode: 0o600 }); renameSync(FILE + ".tmp", FILE); chmodSync(FILE, 0o600);
}
export const vault = {
  get: (ns) => load()[ns] ?? null,
  set: (ns, value) => { load(); cache[ns] = { ...value, _savedAt: Date.now() }; save(); },
  del: (ns) => { load(); delete cache[ns]; save(); },
  has: (ns) => Boolean(load()[ns]),
};
