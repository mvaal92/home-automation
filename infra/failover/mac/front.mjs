#!/usr/bin/env node
// Mac mini front door for the Home app. TCP-level proxy (HTTP, WebSocket and MCP pass through untouched).
//   :8124 -> omarchy 100.64.0.1:8124   (normal)   | 127.0.0.1:18124 local web-server (when state/WEB_FAILOVER)
//   :8125 -> omarchy 100.64.0.1:8125   (normal)   | 127.0.0.1:18125 local home-mcp
// Binds only the Mac's Tailscale IP + loopback.
import net from "node:net";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
const ST = `${homedir()}/home-standby/state`;
const OMARCHY = process.env.HOME_PRIMARY ?? "100.64.0.1";
const BIND = (process.env.HOME_BIND ?? "100.64.0.2,127.0.0.1").split(",");
const ROUTES = [{ port: 8124, local: 18124 }, { port: 8125, local: 18125 }];
const log = (...a) => console.log(new Date().toISOString(), ...a);
const failover = () => existsSync(`${ST}/WEB_FAILOVER`);
for (const r of ROUTES) for (const host of BIND) {
  const srv = net.createServer((c) => {
    const fo = failover();
    const up = net.connect(fo ? { host: "127.0.0.1", port: r.local } : { host: OMARCHY, port: r.port });
    up.setTimeout(10000, () => { if (!up.connecting) return; up.destroy(); });
    up.once("connect", () => up.setTimeout(0));
    c.pipe(up).pipe(c);
    const end = () => { c.destroy(); up.destroy(); };
    up.on("error", (e) => { log(`:${r.port} upstream ${fo ? "local" : "omarchy"} error ${e.code}`); end(); });
    c.on("error", end);
  });
  srv.on("error", (e) => { console.error(`listen ${host}:${r.port}: ${e.message}`); process.exit(1); });
  srv.listen(r.port, host, () => log(`front ${host}:${r.port}`));
}
