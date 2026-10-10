import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, statSync, mkdirSync, existsSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  emptyState, reduce, sweep, capacityFor, roleFor, leadRoster, introFor, SCHEMA_VERSION,
  type OfficeConfig, type OfficeEvent, type OfficeState,
} from "@agent-office/core";
import { adapt } from "./adapter.ts";
import { validateConfig } from "./config.ts";
import { appendRotating, loadEvents, replay } from "./store.ts";
import { publicState } from "./snapshot.ts";
import { readUsage } from "./usage.ts";

const PORT = Number(process.env.AGENT_OFFICE_PORT ?? 4747);
const HOST = process.env.AGENT_OFFICE_HOST || "127.0.0.1";
const DIR = process.env.AGENT_OFFICE_HOME ?? join(homedir(), ".agent-office");
const CONFIG = join(DIR, "office.json");
const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const MAX_BODY = 256 * 1024, MAX_STATE = 2 * 1024 * 1024, MAX_CLIENTS = 20, MAX_BUFFERED = 1024 * 1024;
const EPOCH = randomBytes(6).toString("hex");
const log = (...a: unknown[]) => console.error("[agent-office]", ...a);

mkdirSync(DIR, { recursive: true, mode: 0o700 });
const TOKEN_FILE = join(DIR, "token");
if (!existsSync(TOKEN_FILE)) writeFileSync(TOKEN_FILE, randomBytes(32).toString("hex") + "\n", { mode: 0o600 });
const TOKEN = readFileSync(TOKEN_FILE, "utf8").trim();

const DEFAULT: OfficeConfig = {
  roles: {
    architect: { agent: "architect", count: 1, names: ["Ada"] },
    frontend: { agent: "frontend-dev", count: 2, names: ["Maya", "Leo"], overflow: { max: 1, names: ["Temp"] } },
    backend: { agent: "backend-dev", count: 2, names: ["Dev", "Priya"], overflow: { max: 1, names: ["Temp"] } },
    qa: { agent: "qa-engineer", count: 2, names: ["Quinn", "Sam"], overflow: { max: 2, names: ["Temp"] } },
    reviewer: { agent: "reviewer", count: 1, names: ["Rex"] },
    researcher: { agent: "researcher", count: 1, names: ["Ziv"], overflow: { max: 1, names: ["Temp"] } },
    devops: { agent: "devops", count: 1, names: ["Otto"] },
    "docs-writer": { agent: "docs-writer", count: 1, names: ["Wren"] },
    "security-auditor": { agent: "security-auditor", count: 1, names: ["Sloane"] },
  },
};

// Re-read office.json when its mtime changes. Invalid files keep the last good config and set configError.
let cfg = DEFAULT, cfgMtime = -1;
let configError: { message: string; t: number } | undefined;
function reloadConfig(): boolean {
  try {
    const m = statSync(CONFIG).mtimeMs;
    if (m === cfgMtime) return false;
    cfgMtime = m;
    try { cfg = validateConfig(JSON.parse(readFileSync(CONFIG, "utf8")), DEFAULT.roles); configError = undefined; }
    catch (e) { configError = { message: String((e as Error).message).slice(0, 200), t: Date.now() }; }
    return true;
  } catch { return false; /* missing file: keep what we have */ }
}
const ttlMs = () => ((cfg as OfficeConfig & { idleTtlMinutes?: number }).idleTtlMinutes ?? 45) * 60_000;
reloadConfig();

// State: rebuilt from the stored event log, then swept so quiet sessions do not come back.
const EVENTS = join(DIR, "events.jsonl");
let state: OfficeState = replay(cfg, loadEvents(EVENTS, Date.now() - 24 * 3600_000), Date.now(), ttlMs());
let rev = 0;
let lastProto: unknown;
type Client = { priv: boolean };
const clients = new Map<ServerResponse, Client>();
let cache: { rev: number; json?: string; priv?: string } = { rev: -1 };
function envelope(priv: boolean): string {
  if (cache.rev !== rev) cache = { rev };
  const k = priv ? "priv" : "json";
  const hide = priv || !!cfg.privacy;
  return (cache[k] ??= JSON.stringify({
    schema: SCHEMA_VERSION, version: VERSION, epoch: EPOCH, rev, theme: cfg.theme, privacy: hide,
    configError, state: publicState(state, hide), config: cfg,
  }));
}
const write = (res: ServerResponse, chunk: string) => {
  if (res.writableLength > MAX_BUFFERED) { clients.delete(res); res.destroy(); return; }
  res.write(chunk);
};
const push = () => { for (const [res, c] of clients) write(res, `id: ${EPOCH}-${rev}\ndata: ${envelope(c.priv)}\n\n`); };

/** Install a new state; refuse (keep the old one) when the snapshot would exceed the size guard. */
function commit(next: OfficeState): boolean {
  const prev = state;
  state = next; rev++;
  if (envelope(false).length > MAX_STATE) { state = prev; rev++; log("state too large, event dropped"); return false; }
  push();
  return true;
}

const WEB = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

function serve(url: string, res: ServerResponse): boolean {
  let rel: string;
  try { rel = normalize(decodeURIComponent(url.split("?")[0])).replace(/^(\.\.[/\\])+/, ""); } catch { return false; }
  const file = join(WEB, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(WEB) || !existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  return true;
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieOf = (req: IncomingMessage) => /(?:^|;\s*)ao_token=([\w-]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "";
const hasHeaderToken = (req: IncomingMessage) => { const t = req.headers["x-agent-office-token"]; return typeof t === "string" && same(t, TOKEN); };
const canRead = (req: IncomingMessage) => hasHeaderToken(req) || same(cookieOf(req), TOKEN);
const json = (res: ServerResponse, code: number, body: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));

const TEXTY = ["text", "detail", "why", "message", "error", "cwd", "branch"];
const strip = (e: OfficeEvent) => Object.fromEntries(Object.entries(e).filter(([k]) => !TEXTY.includes(k)));

/** Only text meant for the model, bounded, without control characters. */
const cleanContext = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").slice(0, 2000);
const denials = new Map<string, number>();

function onEvent(payload: any, res: ServerResponse) {
  if (payload && payload.ao_proto !== undefined) lastProto = payload.ao_proto;
  const c = (reloadConfig(), cfg);
  const evs = adapt(payload);
  for (const e of evs) {
    if (e.type === "agent_stop") e.usage = readUsage(payload.agent_transcript_path, payload.cwd);
    else if (e.type === "turn_end") e.usage = readUsage(payload.transcript_path, payload.cwd);
    if ("usage" in e && !e.usage) delete e.usage;
  }
  const hook = String(payload?.hook_event_name);
  // Seat enforcement: deny an Agent spawn whose role has no free seat, but never more than 3 times in a row.
  const del = evs.find((e) => e.type === "delegate");
  if (c.enforceSeats && hook === "PreToolUse" && del?.type === "delegate") {
    const role = roleFor(c, del.agentType), key = `${del.session}|${role}`;
    if (!capacityFor(c, state, role).canSpawn) {
      const n = denials.get(key) ?? 0;
      if (n < 3) {
        if (denials.size > 200) denials.clear();
        denials.set(key, n + 1);
        return json(res, 200, { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
          permissionDecisionReason: `All ${role} seats are busy; wait for one to free up or do other work first.` } });
      }
    }
    denials.delete(key);
  }
  let next = state, ctx: string | null = null;
  for (const e of evs) {
    next = reduce(c, next, e);
    // Hook stdout is parsed by Claude Code: this is how roster/identity reach the model.
    if (e.type === "session_start") ctx = leadRoster(c);
    else if (e.type === "agent_start") ctx = introFor(c, next, e.agentId);
    try { appendRotating(EVENTS, JSON.stringify({ v: SCHEMA_VERSION, ...e })); } catch (err) { log("event log:", (err as Error).message); }
  }
  if (evs.length) commit(next);
  const out = ctx && (hook === "SessionStart" || hook === "SubagentStart")
    ? { hookSpecificOutput: { hookEventName: hook, additionalContext: cleanContext(ctx) } } : undefined;
  res.writeHead(200, { "content-type": "application/json" }).end(out ? JSON.stringify(out) : "");
}

function themes() {
  const dir = join(DIR, "themes"), out = new Map<string, string>();
  try {
    for (const f of readdirSync(dir)) {
      const name = f.slice(0, -5);
      if (!f.endsWith(".json") || !/^[\w-]{1,40}$/.test(name)) continue;
      try {
        const p = join(dir, f);
        if (statSync(p).size > 64 * 1024) continue;
        const text = readFileSync(p, "utf8");
        const v = JSON.parse(text);
        if (typeof v === "object" && v && !Array.isArray(v)) out.set(name, text);
      } catch { /* skip invalid theme */ }
    }
  } catch { /* no themes dir */ }
  return out;
}

const NO_DIST = `<!doctype html><title>Agent Office</title><body style="font:14px monospace;background:#111;color:#ddd"><h3>Agent Office</h3><p>The web client is not built. Run <code>npm run build:web</code> in the repo and reload.</p><p>Live state (debug):</p><pre id=o>waiting…</pre><script>new EventSource("/stream").onmessage=e=>o.textContent=JSON.stringify(JSON.parse(e.data),null,2)</script>`;

function handle(req: IncomingMessage, res: ServerResponse, allowedHosts: Set<string>) {
  const host = req.headers.host ?? "";
  if (!allowedHosts.has(host.toLowerCase())) return void res.writeHead(403).end();
  let u: URL;
  try { u = new URL(req.url ?? "/", "http://x"); } catch { return void res.writeHead(400).end(); }
  const path = u.pathname, get = req.method === "GET";

  if (get && path === "/health") {
    const warning = lastProto !== undefined && lastProto !== SCHEMA_VERSION ? `forwarder protocol ${String(lastProto)} differs from daemon ${SCHEMA_VERSION}` : undefined;
    return json(res, 200, { ok: true, version: VERSION, pid: process.pid, schema: SCHEMA_VERSION, warning });
  }
  if (req.method === "POST" && (path === "/event" || path === "/shutdown")) {
    if (req.headers.origin !== undefined) return void res.writeHead(403).end();
    if (!hasHeaderToken(req)) return void res.writeHead(401).end();
    if (path === "/shutdown") { json(res, 200, { ok: true }); setTimeout(() => process.exit(0), 50); return; }
    let n = 0;
    const chunks: Buffer[] = [];
    req.on("data", (d: Buffer) => {
      n += d.length;
      if (n > MAX_BODY) { if (!res.headersSent) res.writeHead(413, { connection: "close" }).end(); req.destroy(); return; }
      chunks.push(d);
    });
    req.on("end", () => {
      if (n > MAX_BODY) return;
      try {
        let payload: unknown;
        try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return void res.writeHead(400).end(); }
        if (process.env.AGENT_OFFICE_LOG) appendRotating(join(DIR, "events.log"), `${new Date().toISOString()} ${Buffer.concat(chunks).toString("utf8").trim()}`);
        onEvent(payload, res);
      } catch (e) { log("event error:", e); if (!res.headersSent) res.writeHead(500).end(); }
    });
    return;
  }
  if (!get) return void res.writeHead(404).end();

  if (path === "/state" || path === "/stream" || path === "/history" || path === "/status" || path.startsWith("/themes")) {
    if (!canRead(req)) return void res.writeHead(401).end();
    const priv = u.searchParams.get("private") === "1" || !!cfg.privacy;
    if (path === "/state") { reloadConfig(); return void res.writeHead(200, { "content-type": "application/json" }).end(envelope(priv)); }
    if (path === "/stream") {
      if (clients.size >= MAX_CLIENTS) return void res.writeHead(503).end();
      reloadConfig();
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      // A reconnecting client that already has this revision gets no duplicate snapshot.
      if (req.headers["last-event-id"] !== `${EPOCH}-${rev}`) write(res, `id: ${EPOCH}-${rev}\ndata: ${envelope(priv)}\n\n`);
      else res.write(": up to date\n\n");
      clients.set(res, { priv });
      req.on("close", () => clients.delete(res));
      return;
    }
    if (path === "/history") {
      const since = Number(u.searchParams.get("since")) || 0;
      const limit = Math.min(Math.max(Number(u.searchParams.get("limit")) || 500, 1), 2000);
      const events = loadEvents(EVENTS, since, limit);
      return json(res, 200, { schema: SCHEMA_VERSION, epoch: EPOCH, events: priv ? events.map(strip) : events });
    }
    if (path === "/status") {
      const agents = Object.values(state.agents).filter((a) => a.seat);
      const working = agents.filter((a) => a.doing).length + Object.values(state.sessions).filter((s) => s.doing).length;
      const s = { working, waiting: Object.values(state.sessions).filter((x) => x.waiting).length, queued: state.queue.length,
        sessions: Object.keys(state.sessions).length, agents: agents.length };
      if (u.searchParams.get("format") === "json") return json(res, 200, s);
      return void res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(`${s.working} working, ${s.waiting} waiting, ${s.queued} queued\n`);
    }
    const all = themes();
    if (path === "/themes") return json(res, 200, { themes: [...all.keys()].sort() });
    const m = /^\/themes\/([\w-]{1,40})\.json$/.exec(path);
    const body = m && all.get(m[1]);
    return void (body ? res.writeHead(200, { "content-type": "application/json" }).end(body) : res.writeHead(404).end());
  }

  if (path === "/" || path === "/index.html") {
    // The browser tab gets read access for /stream and /state through this cookie (Host was already checked).
    res.setHeader("set-cookie", `ao_token=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`);
    if (!existsSync(WEB)) return void res.writeHead(200, { "content-type": "text/html" }).end(NO_DIST);
  }
  if (existsSync(WEB) && serve(req.url ?? "/", res)) return;
  res.writeHead(404).end();
}

process.on("uncaughtException", (e) => log("uncaught:", e));
process.on("unhandledRejection", (e) => log("unhandled rejection:", e));

const server = createServer();
server.on("error", async (e: NodeJS.ErrnoException) => {
  if (e.code !== "EADDRINUSE") { log("server error:", e.message); process.exit(1); }
  try {
    const h = await (await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1500) })).json() as { ok?: boolean; pid?: number };
    if (h.ok) { console.log(`agent-office already running (pid ${h.pid})`); process.exit(0); }
  } catch { /* not ours */ }
  log(`port ${PORT} is in use by another program; set AGENT_OFFICE_PORT`);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const port = (server.address() as { port: number }).port;
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `${HOST}:${port}`]);
  server.on("request", (req, res) => {
    try { handle(req, res, hosts); } catch (e) { log("request error:", e); if (!res.headersSent) res.writeHead(500).end(); else res.end(); }
  });
  for (const f of ["port", "pid"]) writeFileSync(join(DIR, f), String(f === "port" ? port : process.pid));
  process.on("exit", () => { for (const f of ["port", "pid"]) try { unlinkSync(join(DIR, f)); } catch { /* gone */ } });
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => process.exit(0));
  if (!["127.0.0.1", "localhost", "::1"].includes(HOST)) log(`WARNING: bound to ${HOST}, not loopback. Anyone who can reach it and has the token can send events; hooks and browser must use this host.`);
  console.log(`agent-office listening on http://${HOST}:${port}`);
  setInterval(() => { if (reloadConfig()) { rev++; push(); } }, 2000).unref();
  setInterval(() => {
    const r = sweep(state, Date.now(), ttlMs(), cfg);
    if (r.removed.sessions.length) { log("swept idle sessions:", r.removed.sessions.join(","), "agents:", r.removed.agents.length); commit(r.state); }
  }, 30_000).unref();
  setInterval(() => { for (const res of clients.keys()) write(res, ": ping\n\n"); }, 15_000).unref();
});
