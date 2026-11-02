/**
 * Redundant Home endpoints (see /home/owner/home-automation/FAILOVER.md).
 * Clients try omarchy first, then the Mac mini standby.
 */
/** Servers come from VITE_HOME_SERVERS at build time ("name=host,name=host"; see .env.example). */
const RAW_SERVERS: string = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_HOME_SERVERS ?? "local=127.0.0.1";
export const HOME_SERVERS = RAW_SERVERS.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
  const [name, host] = p.includes("=") ? p.split("=") : [p, p];
  return { name, web: `http://${host}:8124`, mcp: `http://${host}:8125/mcp`, ha: `http://${host}:8123` };
});

export const HA_FALLBACK_URLS: readonly string[] = HOME_SERVERS.map((s) => s.ha);
export const WEB_FALLBACK_URLS: readonly string[] = HOME_SERVERS.map((s) => s.web);

/** Return the first URL whose `probe` path answers (any HTTP status counts as alive). */
export async function firstReachable(urls: readonly string[], probe = "/", timeoutMs = 2500): Promise<string | null> {
  for (const u of urls) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try { await fetch(u.replace(/\/$/, "") + probe, { signal: ac.signal, cache: "no-store", mode: "no-cors" }); return u; }
    catch { /* try next */ }
    finally { clearTimeout(t); }
  }
  return null;
}
