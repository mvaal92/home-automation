import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

/**
 * Dev-only: if HOME_HA_TOKEN_FILE is set, serve that token to the local dev
 * page at /__dev/ha-config so `pnpm dev` works against real HA without pasting
 * the token. Never included in production builds; only answers loopback clients.
 */
function devToken(): Plugin {
  return {
    name: "home-dev-token",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev/ha-config", (req, res) => {
        const file = process.env.HOME_HA_TOKEN_FILE?.replace(/^~/, homedir());
        const remote = req.socket.remoteAddress ?? "";
        if (!file || !/^(::1|127\.|::ffff:127\.)/.test(remote)) { res.statusCode = 404; res.end(); return; }
        try {
          const token = readFileSync(file, "utf8").trim();
          res.setHeader("content-type", "application/json");
          res.setHeader("cache-control", "no-store");
          res.end(JSON.stringify({ token, url: process.env.HOME_HA_URL ?? null }));
        } catch { res.statusCode = 404; res.end(); }
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), devToken()],
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
  preview: { host: "127.0.0.1", port: 5181 },
  build: { target: "es2022", emptyOutDir: false, /* keep previous hashed assets so open tabs / cached PWAs never 404 mid-deploy */ chunkSizeWarningLimit: 900 },
});
