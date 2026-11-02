import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
export const expand = (p) => p.replace(/^~/, homedir());
export const SECRETS = expand(process.env.HOME_SECRETS_DIR ?? "~/home-automation/secrets");
export function secret(name) {
  const f = `${SECRETS}/${name}`;
  return existsSync(f) ? readFileSync(f, "utf8").trim() : null;
}
export function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}
export const SECURITY = { "x-content-type-options": "nosniff", "referrer-policy": "same-origin", "x-frame-options": "DENY" };
export const sendJson = (res, code, body) => res.writeHead(code, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
