// Starts the shared UI dev server, then Electron pointed at it.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const electron = require("electron");
const url = "http://127.0.0.1:5180/";
const vite = spawn("pnpm", ["--filter", "@home/ui", "dev"], { stdio: ["ignore", "pipe", "inherit"], env: process.env });
let started = false;
vite.stdout.on("data", (d) => {
  process.stdout.write(d);
  if (!started && /Local:|ready in/.test(String(d))) {
    started = true;
    const el = spawn(electron, ["."], { stdio: "inherit", env: { ...process.env, VITE_DEV_SERVER_URL: url } });
    el.on("exit", (code) => { vite.kill(); process.exit(code ?? 0); });
  }
});
process.on("SIGINT", () => { vite.kill(); process.exit(0); });
