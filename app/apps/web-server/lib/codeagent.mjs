// "Kode"-modus: the assistant changes the app's own code in an isolated git worktree on a branch.
// Flow: request -> worktree + branch -> coding agent (Grok CLI, file tools only, deny rules) -> commit ->
// guardrail checks -> typecheck+build -> preview on :8127 (Tailscale-only) -> the owner taps «Ta i bruk»
// (merge to main, rollback tag, rebuild, restart) or «Forkast». «Angre siste endring» reverts the last merge.
// Nothing is ever deployed without an explicit POST /api/code/:id/apply from the dashboard.
import { spawn } from "node:child_process";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, symlinkSync, readdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, dirname } from "node:path";
import { expand, readBody, sendJson, SECURITY } from "./util.mjs";

const REPO = expand(process.env.HOME_REPO ?? "~/home-automation/app");
const ROOT = expand("~/home-automation");
const WT_ROOT = expand(process.env.HOME_CODE_WORKTREES ?? "~/home-automation/worktrees");
const GROK = expand(process.env.HOME_GROK_BIN ?? "~/.local/share/vite-plus/bin/grok");
const PNPM = expand(process.env.HOME_PNPM_BIN ?? "~/.local/share/vite-plus/bin/pnpm");
const MODEL = process.env.HOME_CODE_MODEL ?? "grok-4.7-build-fast";
const AGENT_TIMEOUT = Number(process.env.HOME_CODE_TIMEOUT_MS ?? 10 * 60_000);
// Preview binds to the Tailscale address only (same one the main server trusts); never 0.0.0.0/localhost.
const tsAddr = () => [process.env.HOME_PREVIEW_HOST, ...(process.env.HOME_PROXY_TRUSTED_LOCAL ?? "").split(","), ...(process.env.HOME_BIND ?? "").split(",")]
  .map((s) => (s ?? "").trim()).find((s) => s && !/^(127\.|::1$|0\.0\.0\.0$|localhost$)/.test(s)) ?? null;
const PREVIEW_HOST = tsAddr();
const PREVIEW_PORT = Number(process.env.HOME_PREVIEW_PORT ?? 8127);
const HOMEDIR = expand("~");

/** Paths the coding agent may never read or write, plus files it may never edit. */
const DENY_RW = [`${ROOT}/secrets`, `${ROOT}/data`, `${ROOT}/ha-config`, `${ROOT}/voice-data`, `${HOMEDIR}/.grok`, `${HOMEDIR}/.ssh`, `${HOMEDIR}/.config`, `${HOMEDIR}/.local/share/keyrings`, `${HOMEDIR}/.dashlane`];
/** Device-safety rules (locks/alarms/valves/water heater/garage confirm-only) and repo plumbing. */
const PROTECTED = [/^packages\/mcp\/src\/safety\.ts$/, /^apps\/web-server\/lib\/codeagent\.mjs$/, /^apps\/web-server\/lib\/util\.mjs$/, /(^|\/)\.grok\//, /(^|\/)\.git/, /^secrets\//, /^data\//];
const DEPS = /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc)$/;
const SAFETY_TOKENS = /GUARDED_DOMAINS|GUARDED_COVER|isGuarded|ConfirmationRequired|GUARD_RE|confirm\s*[:=]\s*true|guard\(|alarm_control_panel|water_heater|"valve"|"lock"/;

const RULES = `Du endrer kildekoden til eierens Home-app (React/TypeScript-monorepo med pnpm) i en egen git-worktree.
Regler (absolutte):
- Jobb KUN i gjeldende arbeidsmappe (worktreen). Ikke rør andre mapper.
- Ikke les eller nevn hemmeligheter, tokens, ~/home-automation/secrets eller ~/home-automation/data.
- Endre aldri sikkerhetsregler for enheter (låser, alarmer, ventiler, varmtvannsbereder, garasje/porter er bekreft-kun): ikke rør packages/mcp/src/safety.ts, GUARD_RE eller confirm-logikk.
- Ikke legg til eller oppgrader avhengigheter (package.json/lockfile). Ingen nettverkskall.
- Du kan ikke kjøre kommandoer; appen kjører typecheck og build selv etterpå.
- Gjør den minste endringen som løser oppgaven, i eksisterende stil. Brukervendt tekst på norsk.
- Avslutt med 1–3 setninger på norsk som oppsummerer hva du endret.`;

const sh = (cmd, args, opts = {}) => new Promise((resolve) => {
  const c = spawn(cmd, args, { cwd: opts.cwd ?? REPO, env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`, NO_COLOR: "1", CI: "1", ...(opts.env ?? {}) }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; const add = (d) => { out += d; if (out.length > 200_000) out = out.slice(-100_000); };
  c.stdout.on("data", add); c.stderr.on("data", add);
  const t = opts.timeout ? setTimeout(() => c.kill("SIGTERM"), opts.timeout) : null;
  c.on("close", (code) => { if (t) clearTimeout(t); resolve({ code, out }); });
  c.on("error", (e) => { if (t) clearTimeout(t); resolve({ code: -1, out: String(e.message) }); });
});
const git = (args, cwd) => sh("git", args, { cwd });

export function initCodeAgent(db, mainHandler, mainServer) {
  db.exec(`CREATE TABLE IF NOT EXISTS code_changes (id TEXT PRIMARY KEY, request TEXT NOT NULL, branch TEXT, worktree TEXT, status TEXT NOT NULL,
    summary TEXT, files TEXT, diffstat TEXT, diff TEXT, warnings TEXT, log TEXT, base TEXT, merge_commit TEXT, rollback_tag TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  const q = {
    ins: db.prepare("INSERT INTO code_changes (id, request, status, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?)"),
    get: db.prepare("SELECT * FROM code_changes WHERE id = ?"),
    list: db.prepare("SELECT id, request, status, summary, files, diffstat, warnings, merge_commit, rollback_tag, created_at, updated_at FROM code_changes ORDER BY created_at DESC LIMIT 20"),
    lastApplied: db.prepare("SELECT * FROM code_changes WHERE status = 'applied' ORDER BY updated_at DESC LIMIT 1"),
  };
  const set = (id, patch) => {
    const cols = Object.keys(patch); if (!cols.length) return;
    db.prepare(`UPDATE code_changes SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...cols.map((c) => patch[c] == null ? null : typeof patch[c] === "string" ? patch[c] : JSON.stringify(patch[c])), Date.now(), id);
  };
  const logs = new Map(); // id -> live log lines
  const log = (id, line) => { const l = logs.get(id) ?? []; l.push(`${new Date().toLocaleTimeString("nb-NO")} ${line}`); logs.set(id, l.slice(-200)); set(id, { log: l.slice(-60).join("\n") }); };
  // Running preview (one at a time).
  let preview = null; // { id, dir, server }
  let busy = null;   // id of change currently running the agent/build/apply

  function startPreview(id, dir) {
    stopPreview();
    const handler = async (req, res) => {
      const p = (req.url ?? "/").split("?")[0];
      if (p.startsWith("/api/") || p === "/ha" || p.startsWith("/ha/") || p === "/app-config.json" || p === "/healthz") return mainHandler(req, res);
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
      let rel = decodeURIComponent(p); if (rel.endsWith("/")) rel += "index.html";
      let file = normalize(join(dir, rel)); if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
      try { if (!(await stat(file)).isFile()) throw 0; } catch { file = join(dir, "index.html"); }
      const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
      res.writeHead(200, { ...SECURITY, "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : await readFile(file));
    };
    const server = http.createServer((req, res) => { handler(req, res).catch(() => { if (!res.headersSent) res.writeHead(500).end(); }); });
    server.on("upgrade", (...a) => mainServer.emit("upgrade", ...a)); // HA websocket relay (trusted check uses the Tailscale local address)
    server.on("error", (e) => { console.error("preview listen failed", e.message); });
    if (!PREVIEW_HOST) { log(id, "Ingen Tailscale-adresse konfigurert (HOME_PROXY_TRUSTED_LOCAL) – forhåndsvisning av"); return; }
    server.listen(PREVIEW_PORT, PREVIEW_HOST); // Tailscale address only: never 0.0.0.0, never localhost
    preview = { id, dir, server };
  }
  function stopPreview() { if (preview) { try { preview.server.close(); preview.server.closeAllConnections?.(); } catch { /* */ } preview = null; } }

  function linkNodeModules(wt) {
    // Reuse the main checkout's installed deps (no network). pnpm links are relative inside the store, so
    // symlinking each package's node_modules directory keeps resolution working.
    const dirs = ["", ...["packages", "apps"].flatMap((g) => existsSync(join(REPO, g)) ? readdirSync(join(REPO, g)).map((d) => `${g}/${d}`) : [])];
    for (const d of dirs) { const src = join(REPO, d, "node_modules"), dst = join(wt, d, "node_modules"); if (existsSync(src) && existsSync(join(wt, d)) && !existsSync(dst)) symlinkSync(src, dst); }
  }

  async function runAgent(id, text, wt) {
    const deny = DENY_RW.flatMap((p) => ["--deny", `Read(${p}/**)`, "--deny", `Edit(${p}/**)`, "--deny", `Write(${p}/**)`, "--deny", `Grep(${p}/**)`])
      .concat(["--deny", `Edit(${REPO}/**)`, "--deny", `Write(${REPO}/**)`, "--deny", `Edit(${wt}/packages/mcp/src/safety.ts)`, "--deny", `Write(${wt}/packages/mcp/src/safety.ts)`]);
    const args = ["-p", `Oppgave fra eieren: ${text}`, "--output-format", "streaming-messages-json", "--rules", RULES,
      "--tools", "read_file,list_dir,grep,search_replace,write", "--disallowed-tools", "run_terminal_command,bash,search_tool,use_tool,web_search,web_fetch",
      ...deny, "--disable-web-search", "--no-subagents", "--no-plan", "--max-turns", "40", "-m", MODEL, "--always-approve"];
    return new Promise((resolve) => {
      const c = spawn(GROK, args, { cwd: wt, env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
      let buf = "", result = null;
      const t = setTimeout(() => { log(id, "Tidsavbrudd for kodeagenten"); c.kill("SIGTERM"); }, AGENT_TIMEOUT);
      c.stdout.on("data", (d) => {
        buf += d; let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.type === "assistant") for (const b of m.message?.content ?? []) { if (b.type === "tool_use") log(id, `agent: ${b.name} ${String(b.input?.target_file ?? b.input?.file_path ?? b.input?.path ?? b.input?.query ?? "").replace(wt, ".")}`.slice(0, 200)); }
          if (m.type === "user") for (const b of m.message?.content ?? []) if (b.type === "tool_result" && /Denied by permission policy/.test(JSON.stringify(b.content))) log(id, "agent: blokkert av sperreregel");
          if (m.type === "result") result = m;
        }
      });
      c.on("close", () => { clearTimeout(t); resolve({ ok: !!result && !result.is_error, summary: String(result?.result ?? "").trim().slice(0, 1500) }); });
    });
  }

  function check(files, diff) {
    const blocked = [], warnings = [];
    for (const f of files) {
      if (PROTECTED.some((r) => r.test(f))) blocked.push(`Beskyttet fil: ${f}`);
      if (DEPS.test(f)) blocked.push(`Endrer avhengigheter (${f}) – krever eget godkjenningsnotat`);
    }
    const changed = diff.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
    if (changed.some((l) => SAFETY_TOKENS.test(l))) blocked.push("Endringen berører enhetssikkerhet (lås/alarm/ventil/varmtvann/bekreftelse)");
    if (changed.some((l) => /secrets\/|home\.db|\/data\//.test(l))) warnings.push("Nevner secrets/ eller data/ – sjekk diffen nøye");
    if (files.some((f) => f.startsWith("apps/web-server/") || f.startsWith("packages/mcp/"))) warnings.push("Serverkode endret: forhåndsvisningen viser bare UI; serveren tas i bruk ved omstart");
    return { blocked, warnings };
  }

  async function pipeline(id, text) {
    busy = id;
    const branch = `assistant/${id}`, wt = join(WT_ROOT, id);
    try {
      mkdirSync(WT_ROOT, { recursive: true });
      const base = (await git(["rev-parse", "main"])).out.trim();
      set(id, { status: "running", branch, worktree: wt, base });
      log(id, `Lager worktree på ${branch} fra main@${base.slice(0, 7)}`);
      const w = await git(["worktree", "add", "-b", branch, wt, "main"]); if (w.code) throw new Error(`worktree: ${w.out.slice(-300)}`);
      linkNodeModules(wt);
      log(id, "Kodeagent (Grok CLI) jobber…");
      const a = await runAgent(id, text, wt);
      set(id, { summary: a.summary });
      await git(["add", "-A", "--", ".", ":(exclude)**/node_modules"], wt);
      const files = (await git(["diff", "--cached", "--name-only"], wt)).out.split("\n").filter(Boolean).filter((f) => !f.endsWith("node_modules"));
      if (!files.length) { set(id, { status: "failed", files: [] }); log(id, a.ok ? "Agenten gjorde ingen endringer" : "Agenten feilet uten endringer"); return; }
      const msg = `assistant: ${text.slice(0, 72)}\n\n${a.summary}\n\nRequested in the Home dashboard (kode-modus), change ${id}.`;
      const cm = await git(["-c", "user.name=Home Assistant (kode)", "-c", "user.email=home-assistant@omarchy.local", "commit", "-q", "-m", msg], wt); if (cm.code) throw new Error(`commit: ${cm.out.slice(-300)}`);
      const diff = (await git(["diff", `${base}..HEAD`], wt)).out;
      const diffstat = (await git(["diff", "--stat", `${base}..HEAD`], wt)).out.trim();
      const { blocked, warnings } = check(files, diff);
      set(id, { files, diff: diff.slice(0, 200_000), diffstat, warnings: [...blocked, ...warnings] });
      if (blocked.length) { set(id, { status: "blocked" }); log(id, `Stoppet av sikkerhetsregel: ${blocked.join("; ")}`); return; }
      log(id, "Typecheck + build (packages/ui)…");
      // Run the package's own binaries (pnpm refuses symlinked node_modules for task state).
      const ui = join(wt, "packages/ui"), bin = (n) => join(ui, "node_modules/.bin", n);
      let b = await sh(join(wt, "node_modules/.bin/tsc"), ["-p", "."], { cwd: ui, timeout: 3 * 60_000 });
      if (!b.code) b = await sh(bin("vite"), ["build"], { cwd: ui, timeout: 5 * 60_000 });
      if (b.code) { set(id, { status: "failed" }); log(id, `Build feilet:\n${b.out.slice(-1500)}`); return; }
      for (const f of files.filter((f) => f.endsWith(".mjs"))) { const c = await sh(process.execPath, ["--check", join(wt, f)]); if (c.code) { set(id, { status: "failed" }); log(id, `Syntaksfeil i ${f}: ${c.out.slice(-400)}`); return; } }
      if (files.some((f) => f.startsWith("packages/mcp/"))) { const t = await sh(join(wt, "node_modules/.bin/tsc"), ["-p", "."], { cwd: join(wt, "packages/mcp"), timeout: 3 * 60_000 }); if (t.code) { set(id, { status: "failed" }); log(id, `MCP typecheck feilet:\n${t.out.slice(-1200)}`); return; } }
      startPreview(id, join(wt, "packages/ui/dist"));
      set(id, { status: "ready" });
      log(id, `Klar. Forhåndsvisning: http://${PREVIEW_HOST}:${PREVIEW_PORT}`);
    } catch (e) { set(id, { status: "failed" }); log(id, `Feil: ${e.message}`); }
    finally { busy = null; }
  }

  async function cleanup(row) {
    if (preview?.id === row.id) stopPreview();
    if (row.worktree && existsSync(row.worktree)) await git(["worktree", "remove", "--force", row.worktree]);
    await git(["worktree", "prune"]);
  }

  async function rebuildAndRestart(id, files) {
    log(id, "Bygger main…");
    const b = await sh(PNPM, ["--filter", "@home/ui", "run", "build"], { timeout: 5 * 60_000 });
    if (b.code) return { ok: false, out: b.out.slice(-1500) };
    if (files.some((f) => f.startsWith("packages/mcp/"))) {
      const m = await sh(PNPM, ["--filter", "@home/mcp", "run", "build"], { timeout: 3 * 60_000 }); if (m.code) return { ok: false, out: m.out.slice(-1500) };
      await sh("systemctl", ["--user", "restart", "home-mcp"]);
    }
    if (files.some((f) => f.startsWith("apps/web-server/"))) {
      log(id, "Starter home-web på nytt om 2 s…");
      await sh("systemd-run", ["--user", "--collect", "--on-active=2", "systemctl", "--user", "restart", "home-web"]);
    }
    return { ok: true };
  }

  const api = {
    list: () => ({ changes: q.list.all().map((r) => ({ ...r, files: JSON.parse(r.files ?? "[]"), warnings: JSON.parse(r.warnings ?? "[]") })), preview: preview ? { id: preview.id, url: `http://${PREVIEW_HOST}:${PREVIEW_PORT}` } : null, busy }),
    get: (id) => { const r = q.get.get(id); return r && { ...r, files: JSON.parse(r.files ?? "[]"), warnings: JSON.parse(r.warnings ?? "[]"), liveLog: logs.get(id) ?? (r.log ?? "").split("\n"), preview: preview?.id === id ? `http://${PREVIEW_HOST}:${PREVIEW_PORT}` : null }; },
    start(text) {
      if (busy) throw new Error("En kodeendring kjører allerede – vent til den er ferdig.");
      const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex")}`;
      q.ins.run(id, String(text).slice(0, 2000), Date.now(), Date.now());
      void pipeline(id, String(text).slice(0, 2000));
      return { id };
    },
    async discard(id) {
      const r = q.get.get(id); if (!r) throw new Error("ukjent endring");
      if (busy === id) throw new Error("Endringen kjører fortsatt");
      if (!["ready", "failed", "blocked", "queued"].includes(r.status)) throw new Error(`kan ikke forkaste (${r.status})`);
      await cleanup(r); if (r.branch) await git(["branch", "-D", r.branch]);
      set(id, { status: "discarded" }); log(id, "Forkastet");
      return { ok: true };
    },
    async apply(id) {
      const r = q.get.get(id); if (!r) throw new Error("ukjent endring");
      if (r.status !== "ready") throw new Error(`kan bare ta i bruk en klar endring (${r.status})`);
      if (busy) throw new Error("Opptatt – prøv igjen om litt");
      busy = id;
      try {
        const files = JSON.parse(r.files ?? "[]");
        const head = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).out.trim(); if (head !== "main") throw new Error(`hovedrepoet står på ${head}, ikke main`);
        const tag = `home-rollback/${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${id.slice(-6)}`;
        await git(["tag", tag, "HEAD"]);
        log(id, `Rollback-punkt ${tag}; fletter ${r.branch} inn i main`);
        const m = await git(["-c", "user.name=Home Assistant (kode)", "-c", "user.email=home-assistant@omarchy.local", "merge", "--no-ff", "-m", `Ta i bruk assistentendring ${id}: ${r.request.slice(0, 60)}`, r.branch]);
        if (m.code) { await git(["merge", "--abort"]); throw new Error(`merge feilet (andre ulagrede endringer i samme filer?): ${m.out.slice(-300)}`); }
        const merge = (await git(["rev-parse", "HEAD"])).out.trim();
        set(id, { status: "applied", merge_commit: merge, rollback_tag: tag });
        const rb = await rebuildAndRestart(id, files);
        if (!rb.ok) {
          log(id, `Build på main feilet – reverterer:\n${rb.out}`);
          await git(["-c", "user.name=Home Assistant (kode)", "-c", "user.email=home-assistant@omarchy.local", "revert", "-m", "1", "--no-edit", merge]);
          await rebuildAndRestart(id, files); set(id, { status: "reverted" }); throw new Error("Build feilet på main; endringen er reversert");
        }
        await cleanup(r); await git(["branch", "-d", r.branch]);
        log(id, "Tatt i bruk ✓");
        return { ok: true, merge, tag };
      } finally { busy = null; }
    },
    async undoLast() {
      const r = q.lastApplied.get(); if (!r) throw new Error("Ingen tatt-i-bruk-endring å angre");
      if (busy) throw new Error("Opptatt – prøv igjen om litt");
      busy = r.id;
      try {
        const v = await git(["-c", "user.name=Home Assistant (kode)", "-c", "user.email=home-assistant@omarchy.local", "revert", "-m", "1", "--no-edit", r.merge_commit]);
        if (v.code) { await git(["revert", "--abort"]); throw new Error(`revert feilet: ${v.out.slice(-300)}`); }
        const rb = await rebuildAndRestart(r.id, JSON.parse(r.files ?? "[]"));
        set(r.id, { status: "reverted" }); log(r.id, rb.ok ? "Angret ✓" : `Angret, men build feilet: ${rb.out}`);
        return { ok: rb.ok, id: r.id, request: r.request };
      } finally { busy = null; }
    },
  };
  return api;
}

export function codeRoutes(code, trusted) {
  return async (req, res, sub) => {
    if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
    try {
      const [id, action] = sub.split("/");
      if (!id && req.method === "GET") return sendJson(res, 200, code.list());
      if (id === "request" && req.method === "POST") { const b = await readBody(req); const t = String(b.text ?? "").trim(); if (!t) return sendJson(res, 400, { error: "tom" }); return sendJson(res, 200, code.start(t)); }
      if (id === "undo-last" && req.method === "POST") return sendJson(res, 200, await code.undoLast());
      if (id && !action && req.method === "GET") { const r = code.get(id); return r ? sendJson(res, 200, r) : sendJson(res, 404, { error: "ukjent" }); }
      if (id && action === "apply" && req.method === "POST") return sendJson(res, 200, await code.apply(id));
      if (id && action === "discard" && req.method === "POST") return sendJson(res, 200, await code.discard(id));
      return sendJson(res, 404, { error: "not found" });
    } catch (e) { return sendJson(res, 409, { error: e.message }); }
  };
}
