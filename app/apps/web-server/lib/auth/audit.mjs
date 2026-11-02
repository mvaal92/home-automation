// Append-only audit log for auth events (no secrets: values are never passed in; only provider/event/meta).
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { expand } from "../util.mjs";
const DIR = expand("~/home-automation/data/auth"); mkdirSync(DIR, { recursive: true, mode: 0o700 });
const FILE = `${DIR}/audit.log`;
const SAFE = /^(provider|event|session|step|kind|ok|reason|peer|ms|attempt)$/;
export function audit(entry) {
  const e = { at: new Date().toISOString() };
  for (const [k, v] of Object.entries(entry)) if (SAFE.test(k)) e[k] = typeof v === "string" ? v.slice(0, 160) : v;
  appendFileSync(FILE, JSON.stringify(e) + "\n", { mode: 0o600 });
}
export function recent(n = 50) { if (!existsSync(FILE)) return []; return readFileSync(FILE, "utf8").trim().split("\n").slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse(); }
