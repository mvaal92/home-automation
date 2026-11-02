// /api/assistant: HA Assist fast path -> Grok CLI headless (home MCP only) -> OpenAI fallback.
// Streams NDJSON events: {type:"status"|"delta"|"action"|"confirm"|"done"|"error", ...}
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expand, secret, readBody, sendJson, SECURITY } from "./util.mjs";
import { haRest } from "./ha.mjs";
import { mcpCall, mcpTools } from "./mcp.mjs";
import * as oda from "./oda.mjs";
import { KG, SCHOOL, fill, nameRe } from "./family.mjs";

const GROK = expand(process.env.HOME_GROK_BIN ?? "~/.local/share/vite-plus/bin/grok");
const GROK_CWD = expand(process.env.HOME_GROK_CWD ?? "~/home-automation/grok-assistant");
const GROK_MODEL = process.env.HOME_GROK_MODEL ?? "grok-4.7-build-fast";
const TIMEOUT_MS = Number(process.env.HOME_ASSISTANT_TIMEOUT_MS ?? 25000);
const OPENAI_MODEL = process.env.HOME_OPENAI_MODEL ?? "gpt-4.1-mini";
const openaiKey = () => process.env.OPENAI_API_KEY || secret("openai_api_key");
const prompt = () => fill(readFileSync(`${GROK_CWD}/prompts/home.md`, "utf8"));
const KG_RE = new RegExp(`barnehage|${nameRe(KG)}`, "i");
const SCHOOL_RE = new RegExp(`(skole|${nameRe(SCHOOL)}|lekse|ukeplan|kontaktlærer)`, "i");
const KG_TODAY_RE = new RegExp(`(barnehage|${nameRe(KG)}).*(i dag|i morgen|denne uka|pakke)|hva skjer i barnehagen|hva (må|skal) ${nameRe(KG)}`, "i");
const GUARD_RE = /Refusing to act on security-sensitive|without confirm=true/;
const ODA_RE = /^\s*ODA_ADD:\s*(\{.*\})\s*$/gm;

export function initAssistantDb(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conv TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, meta TEXT, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS chat_conv ON chat_messages(conv, id);
    CREATE TABLE IF NOT EXISTS chat_convs (id TEXT PRIMARY KEY, title TEXT, grok_session TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS assistant_log (id INTEGER PRIMARY KEY AUTOINCREMENT, conv TEXT, provider TEXT, tool TEXT, args TEXT, ok INTEGER, ms INTEGER, created_at INTEGER NOT NULL);`);
  const q = {
    addMsg: db.prepare("INSERT INTO chat_messages (conv, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)"),
    msgs: db.prepare("SELECT id, role, content, meta, created_at FROM chat_messages WHERE conv = ? ORDER BY id DESC LIMIT 200"),
    conv: db.prepare("SELECT * FROM chat_convs WHERE id = ?"),
    convs: db.prepare("SELECT c.id, c.title, c.updated_at, (SELECT COUNT(*) FROM chat_messages m WHERE m.conv = c.id) AS n FROM chat_convs c ORDER BY updated_at DESC LIMIT 50"),
    upsertConv: db.prepare("INSERT INTO chat_convs (id, title, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at"),
    setSession: db.prepare("UPDATE chat_convs SET grok_session = ? WHERE id = ?"),
    delConv: db.prepare("DELETE FROM chat_convs WHERE id = ?"),
    delMsgs: db.prepare("DELETE FROM chat_messages WHERE conv = ?"),
    log: db.prepare("INSERT INTO assistant_log (conv, provider, tool, args, ok, ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  };
  return q;
}

const pendingConfirms = new Map(); // id -> {kind, ..., conv, expires}
function makeConfirm(c) { const id = randomUUID(); pendingConfirms.set(id, { ...c, expires: Date.now() + 10 * 60_000 }); return { id, ...c }; }

let busy = Promise.resolve(); // single-flight for the CLI
const single = (fn) => { const p = busy.then(fn, fn); busy = p.catch(() => undefined); return p; };

async function assistFast(text) {
  const r = await haRest("/conversation/process", { text, language: "nb", agent_id: "conversation.home_assistant" });
  const resp = r?.response ?? {};
  const speech = resp.speech?.plain?.speech ?? "";
  if (resp.response_type === "error") return { ok: false, code: resp.data?.code, speech };
  return { ok: true, speech, targets: (resp.data?.success ?? []).map((t) => t.name) };
}

function runGrok({ text, session, resume, emit, conv, q }) {
  return new Promise((resolve) => {
    const args = ["-p", text, "--output-format", "streaming-messages-json", "--include-partial-messages",
      ...(resume ? ["-r", session] : ["-s", session]),
      "--system-prompt-override", prompt(), "--disallowed-tools", "run_terminal_command,read_file,search_replace,list_dir,grep,write,edit,bash,web_search,web_fetch",
      "--disable-web-search", "--no-subagents", "--no-plan", "--max-turns", "8", "-m", GROK_MODEL, "--always-approve"];
    const child = spawn(GROK, args, { cwd: GROK_CWD, env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "", final = null, text_ = "", timedOut = false; const started = Date.now(); const toolIndex = new Map();
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      buf += d; let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === "stream_event" && m.event?.type === "content_block_delta" && m.event.delta?.type === "text_delta") { text_ += m.event.delta.text; emit({ type: "delta", text: m.event.delta.text }); }
        else if (m.type === "assistant") {
          for (const c of m.message?.content ?? []) if (c.type === "tool_use") {
            const tool = String(c.input?.tool_name ?? c.name).replace(/^home__/, ""); const input = c.input?.tool_input ?? c.input;
            toolIndex.set(c.id, { tool, input }); emit({ type: "action", tool, input, state: "running" });
          }
          if (text_ && !text_.endsWith("\n")) { text_ += "\n\n"; emit({ type: "delta", text: "\n\n" }); }
        } else if (m.type === "user") {
          for (const c of m.message?.content ?? []) if (c.type === "tool_result") {
            const t = toolIndex.get(c.tool_use_id); const content = typeof c.content === "string" ? c.content : JSON.stringify(c.content);
            if (!t) continue;
            const guarded = GUARD_RE.test(content);
            q.log.run(conv, "grok", t.tool, JSON.stringify(t.input), guarded || c.is_error ? 0 : 1, Date.now() - started, Date.now());
            emit({ type: "action", tool: t.tool, input: t.input, state: guarded ? "needs-confirm" : c.is_error ? "error" : "done" });
            if (guarded) emit({ type: "confirm", ...makeConfirm({ kind: "mcp", tool: t.tool, args: t.input, conv, title: describe(t.tool, t.input) }) });
          }
        } else if (m.type === "result") final = m;
      }
    });
    let err = ""; child.stderr.on("data", (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: !timedOut && final && !final.is_error, text: final?.result ?? text_, timedOut, code, err: err.slice(-300) }); });
  });
}

function describe(tool, a = {}) {
  const ids = [a.entity_id, a.entity_ids, a.target?.entity_id].flat().filter(Boolean).join(", ");
  return `${tool.replace(/_/g, " ")}${a.service ? ` (${a.domain ?? ""}.${a.service})` : a.action ? ` → ${a.action}` : ""}${ids ? `: ${ids}` : ""}`;
}

async function runOpenAI({ history, emit, conv, q }) {
  const key = openaiKey(); if (!key) return { ok: false, missingKey: true };
  const tools = (await mcpTools()).map((t) => ({ type: "function", function: { name: t.name, description: (t.description ?? "").slice(0, 1000), parameters: t.inputSchema ?? { type: "object", properties: {} } } }));
  const messages = [{ role: "system", content: prompt() }, ...history];
  for (let turn = 0; turn < 6; turn++) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ model: OPENAI_MODEL, messages, tools, temperature: 0.2 }) });
    if (!r.ok) return { ok: false, err: `OpenAI ${r.status}` };
    const msg = (await r.json()).choices[0].message; messages.push(msg);
    if (!msg.tool_calls?.length) { emit({ type: "delta", text: msg.content ?? "" }); return { ok: true, text: msg.content ?? "" }; }
    for (const tc of msg.tool_calls) {
      let args = {}; try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* */ }
      delete args.confirm; const tool = tc.function.name; const t0 = Date.now();
      emit({ type: "action", tool, input: args, state: "running" });
      let out; try { out = JSON.stringify((await mcpCall(tool, args)).content ?? ""); } catch (e) { out = `error: ${e.message}`; }
      const guarded = GUARD_RE.test(out);
      q.log.run(conv, "openai", tool, JSON.stringify(args), guarded ? 0 : 1, Date.now() - t0, Date.now());
      emit({ type: "action", tool, input: args, state: guarded ? "needs-confirm" : "done" });
      if (guarded) emit({ type: "confirm", ...makeConfirm({ kind: "mcp", tool, args, conv, title: describe(tool, args) }) });
      messages.push({ role: "tool", tool_call_id: tc.id, content: out.slice(0, 12000) });
    }
  }
  return { ok: true, text: "" };
}

async function odaConfirms(text, conv, emit) {
  for (const m of text.matchAll(ODA_RE)) {
    try {
      const { query, quantity = 1 } = JSON.parse(m[1]);
      const [p] = await oda.search(String(query), 4);
      if (!p) { emit({ type: "delta", text: `\n\nFant ikke «${query}» hos Oda.` }); continue; }
      emit({ type: "confirm", ...makeConfirm({ kind: "oda", productId: p.id, quantity: Math.max(1, Math.min(20, Number(quantity) || 1)), conv, title: `Legg ${quantity} × ${p.name} i Oda-handlekurven`, product: p }) });
    } catch { /* ignore malformed */ }
  }
}

const SIMPLE = /^(skru|slå|sett|tenn|slukk|dim|åpne|lukk|start|stopp|pause|spill|turn|switch|set|open|close|start|stop)\b/i;

export function assistantRoutes(db, trusted, notes, maintenance, kids, ext = {}) {
  const q = initAssistantDb(db);
  const save = (conv, role, content, meta) => q.addMsg.run(conv, role, content, meta ? JSON.stringify(meta) : null, Date.now());
  return async function handle(req, res, sub) {
    if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
    try {
      if (sub === "status" && req.method === "GET") {
        return sendJson(res, 200, { grok: true, model: GROK_MODEL, openai: Boolean(openaiKey()), oda: oda.status() });
      }
      if (sub === "conversations" && req.method === "GET") return sendJson(res, 200, { conversations: q.convs.all() });
      if (sub.startsWith("conversations/")) {
        const id = decodeURIComponent(sub.slice(14));
        if (req.method === "DELETE") { q.delMsgs.run(id); q.delConv.run(id); return sendJson(res, 200, { ok: true }); }
        return sendJson(res, 200, { messages: q.msgs.all(id).reverse().map((m) => ({ ...m, meta: m.meta ? JSON.parse(m.meta) : null })) });
      }
      if (sub === "stt" && req.method === "POST") return stt(req, res);
      if (req.method !== "POST" || (sub !== "" && sub !== "confirm")) return sendJson(res, 404, { error: "not found" });
      const body = await readBody(req);
      res.writeHead(200, { ...SECURITY, "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" });
      const emit = (e) => { try { res.write(JSON.stringify(e) + "\n"); } catch { /* client gone */ } };

      if (sub === "confirm") {
        const c = pendingConfirms.get(String(body.id));
        if (!c || c.expires < Date.now()) { emit({ type: "error", message: "Bekreftelsen er utløpt. Spør på nytt." }); return res.end(); }
        pendingConfirms.delete(String(body.id));
        if (!body.approve) { save(c.conv, "system", `Avbrutt: ${c.title}`); emit({ type: "done", text: "Avbrutt.", provider: "app" }); return res.end(); }
        const t0 = Date.now();
        try {
          if (c.kind === "mcp") { const r = await mcpCall(c.tool, { ...c.args, confirm: true }); if (r.isError) throw new Error(JSON.stringify(r.content).slice(0, 200)); }
          else if (c.kind === "oda") await oda.addToCart(c.productId, c.quantity);
          q.log.run(c.conv, "confirm", c.kind === "oda" ? "oda_add" : c.tool, JSON.stringify(c.args ?? { productId: c.productId }), 1, Date.now() - t0, Date.now());
          const txt = `Utført: ${c.title}`; save(c.conv, "assistant", txt, { provider: "app", confirmed: true }); emit({ type: "done", text: txt, provider: "app" });
        } catch (e) { emit({ type: "error", message: `Feilet: ${e.message}` }); }
        return res.end();
      }

      const text = String(body.text ?? "").trim().slice(0, 2000);
      if (!text) { emit({ type: "error", message: "Tom melding" }); return res.end(); }
      const conv = String(body.conversationId || randomUUID()).slice(0, 64);
      q.upsertConv.run(conv, text.slice(0, 60), Date.now(), Date.now());
      save(conv, "user", text);
      emit({ type: "start", conversationId: conv });
      const mode = body.mode ?? "auto"; // auto | local | grok
      const t0 = Date.now();

      // K0) «ta i bruk [id]» / «angre siste kodeendring»: apply a READY change (guards+typecheck+build passed) or roll back. Allowed by the owner 2026-10-12.
      const ap = text.match(/^\s*ta i bruk(?:\s+(?:kodeendring(?:en)?\s*)?([0-9]{8}-[0-9a-f]{6}))?\s*[.!]?\s*$/i);
      const rbk = /^\s*angre siste (kode)?endring(en)?\s*[.!]?\s*$/i.test(text) && !/dashboard|oppsett/i.test(text);
      if ((ap || rbk) && ext.code?.()) {
        let reply;
        try {
          if (rbk) { await ext.code().undoLast(); reply = "Angret siste kodeendring – bygget og startet på nytt."; }
          else { const id = ap[1] ?? ext.code().list().changes?.find((c) => c.status === "ready")?.id; if (!id) throw new Error("Ingen klar kodeendring å ta i bruk.");
            await ext.code().apply(id); reply = `Kodeendring ${id} er tatt i bruk (rollback-tag laget). «Angre siste kodeendring» ruller tilbake.`; }
        } catch (e) { reply = e.message; }
        emit({ type: "action", tool: rbk ? "code_rollback" : "code_apply", input: {}, state: "done" }); emit({ type: "delta", text: reply });
        save(conv, "assistant", reply, { provider: "app", ms: Date.now() - t0 }); emit({ type: "done", provider: "app", ms: Date.now() - t0 }); return res.end();
      }
      // K) Kode-modus: the assistant changes the app's own code in a separate worktree; the owner approves in the dashboard.
      const km = text.match(/^\s*kode\s*:\s*(.+)$/is);
      if ((mode === "kode" || km) && ext.code?.()) {
        const task = (km ? km[1] : text).trim();
        try {
          const { id } = ext.code().start(task);
          const reply = `Startet kodeendring ${id}. Jeg jobber i en egen kopi (git-worktree), kjører typecheck og build, og viser en forhåndsvisning her. Når typecheck og build er grønne kan du trykke «Ta i bruk» eller skrive «ta i bruk».`;
          emit({ type: "code", id }); emit({ type: "delta", text: reply });
          save(conv, "assistant", reply, { provider: "app", ms: Date.now() - t0, code: id });
        } catch (e) { emit({ type: "delta", text: e.message }); save(conv, "assistant", e.message, { provider: "app" }); }
        emit({ type: "done", provider: "app", ms: Date.now() - t0 }); return res.end();
      }
      // D) "angre (siste) dashboard-endring"
      if (ext.dashEdit && /^angre\b.*(dashboard|oppsett|festing|kort|fane|endring på hjem)/i.test(text)) {
        const r = ext.dashEdit.undo(); const reply = r.ok ? `Angret: ${r.undone}.` : r.error;
        emit({ type: "action", tool: "dashboard_undo", input: {}, state: r.ok ? "done" : "error" }); if (r.ok) emit({ type: "prefs" });
        emit({ type: "delta", text: reply }); save(conv, "assistant", reply, { provider: "local", ms: Date.now() - t0 });
        emit({ type: "done", provider: "local", ms: Date.now() - t0 }); return res.end();
      }

      // 0a) Notater: "legg til notat ..." / "notat: ..." / "vis notatene mine".
      const nm = text.match(/^(?:legg til (?:et )?notat(?: om)?|nytt notat|notat|husk(?: å)?)\s*:?\s+(.+)$/is);
      if (notes && nm) {
        const n = notes.add(nm[1].trim()); const reply = `Lagt til notat: «${n.text}».`;
        emit({ type: "action", tool: "notes_add", input: { text: n.text }, state: "done" });
        emit({ type: "delta", text: reply }); save(conv, "assistant", reply, { provider: "local", ms: Date.now() - t0 });
        emit({ type: "done", provider: "local", ms: Date.now() - t0 }); return res.end();
      }
      if (notes && /^(vis|list|hvilke|hva står i)\b.*notat/i.test(text)) {
        const open = notes.list().filter((n) => !n.done);
        const reply = open.length ? `Du har ${open.length} notat${open.length > 1 ? "er" : ""}:\n` + open.slice(0, 15).map((n) => `- ${n.pinned ? "📌 " : ""}${n.text.split("\n")[0]}`).join("\n") : "Du har ingen åpne notater.";
        emit({ type: "delta", text: reply }); save(conv, "assistant", reply, { provider: "local", ms: Date.now() - t0 });
        emit({ type: "done", provider: "local", ms: Date.now() - t0 }); return res.end();
      }
      // 0b) Vedlikehold: "hva må vedlikeholdes?" / "vedlikehold" / "hva må byttes?"
      if (maintenance && /vedlikehold|hva må (byttes|skiftes|rengjøres|renses)|filter.*bytt/i.test(text)) {
        const items = await maintenance.attention();
        const d = (i) => i.haFlag ? "varsler fra enheten" : i.daysLeft < 0 ? `${-i.daysLeft} dager over tiden` : i.daysLeft === 0 ? "i dag" : `om ${i.daysLeft} dager`;
        const reply = items.length ? `${items.length} ting trenger vedlikehold:\n` + items.slice(0, 15).map((i) => `- ${i.status === "overdue" ? "🔴" : "🟡"} ${i.name} (${d(i)})`).join("\n") + "\n\nMarker som utført i Vedlikehold-fanen." : "Alt vedlikehold er à jour 👍";
        emit({ type: "action", tool: "maintenance_list", input: {}, state: "done" });
        emit({ type: "delta", text: reply }); save(conv, "assistant", reply, { provider: "local", ms: Date.now() - t0 });
        emit({ type: "done", provider: "local", ms: Date.now() - t0 }); return res.end();
      }
      // 0a) Skole (Foresattportalen, read-only)
      if (kids && SCHOOL_RE.test(text) && !KG_RE.test(text)) {
        const reply = kids.school(text);
        emit({ type: "action", tool: "kids_school", input: {}, state: "done" });
        emit({ type: "delta", text: reply }); save(conv, "assistant", reply, { provider: "local", ms: Date.now() - t0 });
        emit({ type: "done", provider: "local", ms: Date.now() - t0 }); return res.end();
      }
      // 0b) Barn: "hva skjer i barnehagen i dag" (MyKid, read-only)
      if (kids && KG_TODAY_RE.test(text)) {
        const reply = kids.today(text);
        emit({ type: "action", tool: "kids_today", input: {}, state: "done" });
        emit({ type: "delta", text: reply }); save(conv, "assistant", reply, { provider: "local", ms: Date.now() - t0 });
        emit({ type: "done", provider: "local", ms: Date.now() - t0 }); return res.end();
      }
      // 0) Lydbøker: "hva leser jeg?" / "fortsett boka mi" – answered from the Fabel shelf in prefs.
      if (/hva leser jeg|(fortsett|min|mi) (lyd)?bok|lydbok(a|en) mi/i.test(text)) {
        let items = []; try { items = JSON.parse(db.prepare("SELECT value FROM prefs WHERE key='lydboker'").get()?.value ?? "{}").items ?? []; } catch { /* */ }
        const r = items.filter((i) => i.status === "leser");
        const reply = r.length ? `Du leser ${r.map((i) => `«${i.book.title}» av ${i.book.authors.join(", ")} (${i.progress} %)`).join(" og ")}. Åpne Lydbøker-fanen og trykk «Fortsett i Fabel» for å lytte videre.` : "Du har ingen bok markert som «Leser nå». Finn en i Lydbøker-fanen.";
        emit({ type: "delta", text: reply }); save(conv, "assistant", reply, { provider: "local", ms: Date.now() - t0 });
        emit({ type: "done", provider: "local", ms: Date.now() - t0 }); return res.end();
      }
      // 1) HA Assist fast path for short imperative commands (or local mode).
      if (mode === "local" || (mode === "auto" && SIMPLE.test(text) && text.length < 80 && !/oda|handlekurv|kjøp/i.test(text))) {
        emit({ type: "status", text: "Home Assistant…", provider: "assist" });
        try {
          const a = await assistFast(text);
          if (a.ok || mode === "local") {
            const reply = a.speech || (a.ok ? "Gjort." : "Det forsto jeg ikke.");
            emit({ type: "delta", text: reply });
            save(conv, "assistant", reply, { provider: "assist", ms: Date.now() - t0, targets: a.targets });
            emit({ type: "done", provider: "assist", ms: Date.now() - t0 }); return res.end();
          }
        } catch (e) { if (mode === "local") { emit({ type: "error", message: e.message }); return res.end(); } }
      }

      // 2) Grok CLI.
      const row = q.conv.get(conv);
      const resume = Boolean(row?.grok_session); const session = row?.grok_session ?? randomUUID();
      emit({ type: "status", text: "Grok tenker…", provider: "grok" });
      const actions = []; const confirms = [];
      const wrapped = (e) => { if (e.type === "action" && e.state === "done" && /^dashboard_(apply|undo)$/.test(e.tool)) emit({ type: "prefs" }); if (e.type === "action" && e.state !== "running") actions.push({ tool: e.tool, state: e.state }); if (e.type === "confirm") confirms.push({ id: e.id, title: e.title, kind: e.kind }); emit(e); };
      const g = await single(() => runGrok({ text, session, resume, emit: wrapped, conv, q }));
      if (g.ok) {
        if (!resume) q.setSession.run(session, conv);
        await odaConfirms(g.text, conv, wrapped);
        save(conv, "assistant", g.text.replace(ODA_RE, "").trim(), { provider: "grok", ms: Date.now() - t0, actions, confirms });
        emit({ type: "done", provider: "grok", ms: Date.now() - t0, text: g.text.replace(ODA_RE, "").trim() }); return res.end();
      }

      // 3) OpenAI fallback.
      emit({ type: "status", text: g.timedOut ? "Grok brukte for lang tid – prøver OpenAI…" : "Grok utilgjengelig – prøver OpenAI…", provider: "openai", reset: true });
      const history = q.msgs.all(conv).reverse().slice(-12).filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: m.content }));
      const o = await runOpenAI({ history, emit: wrapped, conv, q });
      if (o.ok) {
        await odaConfirms(o.text, conv, wrapped);
        save(conv, "assistant", o.text.replace(ODA_RE, "").trim(), { provider: "openai", ms: Date.now() - t0, actions, confirms });
        emit({ type: "done", provider: "openai", ms: Date.now() - t0, text: o.text.replace(ODA_RE, "").trim() }); return res.end();
      }
      // 4) Last resort: Assist.
      try { const a = await assistFast(text); if (a.ok) { emit({ type: "delta", text: a.speech }); save(conv, "assistant", a.speech, { provider: "assist" }); emit({ type: "done", provider: "assist" }); return res.end(); } } catch { /* */ }
      const msg = o.missingKey ? "Grok svarte ikke, og OpenAI-reserve mangler API-nøkkel." : `Assistenten feilet (${g.timedOut ? "tidsavbrudd" : "Grok"}${o.err ? `, ${o.err}` : ""}).`;
      save(conv, "assistant", msg, { provider: "error" }); emit({ type: "error", message: msg }); res.end();
    } catch (e) {
      if (!res.headersSent) sendJson(res, 500, { error: e.message }); else { res.write(JSON.stringify({ type: "error", message: e.message }) + "\n"); res.end(); }
    }
  };
}

/** Optional OpenAI Whisper STT: raw audio body (webm/ogg/mp4/wav) -> {text}. */
async function stt(req, res) {
  const key = openaiKey();
  if (!key) return sendJson(res, 501, { error: "OpenAI API key missing (secrets/openai_api_key)" });
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 20 * 1024 * 1024) return sendJson(res, 413, { error: "too large" }); chunks.push(c); }
  const type = req.headers["content-type"] ?? "audio/webm"; const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
  const form = new FormData(); form.append("file", new Blob([Buffer.concat(chunks)], { type }), `speech.${ext}`); form.append("model", "whisper-1"); form.append("language", "no");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(30000) });
  if (!r.ok) return sendJson(res, 502, { error: `OpenAI ${r.status}` });
  sendJson(res, 200, { text: (await r.json()).text ?? "" });
}
