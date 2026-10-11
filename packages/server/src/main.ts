import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, statSync, mkdirSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  reduce, sweep, emptyState, capacityFor, roleFor, leadRoster, introFor, outcomeOf, pseudonym, safeId, SCHEMA_VERSION,
  type OfficeConfig, type OfficeEvent, type OfficeState,
} from "@agent-office/core";
import { adapt, clip } from "./adapter.ts";
import { validateConfig, unknownKeys } from "./config.ts";
import { summarize } from "./digest.ts";
import { appendRotating, appendEvent, bootEvents, readEvents, pruneEvents, pruneDays, replay, strip } from "./store.ts";
import { fit, publicState, lodState, diffEnvelope, type Snap } from "./snapshot.ts";
import { readNarration, readUsage, newLedger, tallyUsage, ledgerTotal, type Ledger } from "./usage.ts";
import { createShare } from "./share.ts";

const PORT = Number(process.env.AGENT_OFFICE_PORT ?? 4747);
const HOST = process.env.AGENT_OFFICE_HOST || "127.0.0.1";
const LOOPBACK = ["127.0.0.1", "localhost", "::1"].includes(HOST);
// Loopback only unless the operator opts in explicitly: a typo'd or copied HOST must not expose the office.
if (!LOOPBACK && process.env.AGENT_OFFICE_ALLOW_REMOTE !== "1") {
  console.error(`[agent-office] refusing to bind ${HOST}: not loopback. Set AGENT_OFFICE_ALLOW_REMOTE=1 as well to allow it.`);
  process.exit(1);
}
const DIR = process.env.AGENT_OFFICE_HOME ?? join(homedir(), ".agent-office");
const CONFIG = join(DIR, "office.json");
const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const MAX_BODY = 256 * 1024, MAX_STATE = 2 * 1024 * 1024, MAX_CLIENTS = 20, MAX_BUFFERED = 1024 * 1024;
const EPOCH = randomBytes(6).toString("hex");
const log = (...a: unknown[]) => console.error("[agent-office]", ...a);

mkdirSync(DIR, { recursive: true, mode: 0o700 });
/** A token file holding anything but 64 hex characters (missing, empty, truncated) gets a fresh token: an empty one would turn auth off. */
const tokenFrom = (f: string) => {
  const t = existsSync(f) ? readFileSync(f, "utf8").trim() : "";
  if (/^[0-9a-f]{64}$/.test(t)) return t;
  const fresh = randomBytes(32).toString("hex");
  writeFileSync(f, fresh + "\n", { mode: 0o600 });
  return fresh;
};
const TOKEN = tokenFrom(join(DIR, "token"));
// The browser's cookie is a separate UI token: reads and the local share controls, never /event or /shutdown (S0).
const UI_TOKEN = tokenFrom(join(DIR, "ui-token"));

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
let configWarning: string | undefined;
function reloadConfig(): boolean {
  try {
    const m = statSync(CONFIG).mtimeMs;
    if (m === cfgMtime) return false;
    cfgMtime = m;
    try {
      const raw = JSON.parse(readFileSync(CONFIG, "utf8"));
      cfg = validateConfig(raw, DEFAULT.roles); configError = undefined;
      const u = unknownKeys(raw);
      configWarning = u.length ? `office.json: unknown key${u.length > 1 ? "s" : ""} ignored: ${u.join(", ")}` : undefined;
    } catch (e) { configError = { message: `${String((e as Error).message).slice(0, 200)} (${CONFIG}; the last good config stays active)`, t: Date.now() }; }
    return true;
  } catch { return false; /* missing file: keep what we have */ }
}
const ttlMs = () => (cfg.idleTtlMinutes ?? 45) * 60_000;
reloadConfig();

// State: rebuilt from the stored events (day files under events/, plus the legacy events.jsonl), then swept so quiet sessions do not come back.
const EVENTS = join(DIR, "events.jsonl");
const historyMs = () => (cfg.historyHours ?? 168) * 3600_000;
const textMs = () => Math.min(cfg.textHours ?? Infinity, cfg.historyHours ?? 168) * 3600_000;
/** Retention: delete stored events older than historyHours and stored text older than textHours (boot and hourly). */
const RAW_LOG = join(DIR, "events.log");
const prune = () => {
  try {
    pruneEvents(RAW_LOG, Date.now() - historyMs(), (l) => Date.parse(l.slice(0, 24))); // the opt-in raw log (AGENT_OFFICE_LOG): ISO time prefix
    const n = pruneEvents(EVENTS, Date.now() - historyMs());
    const f = pruneDays(DIR, Date.now() - historyMs(), Date.now() - textMs());
    if (n || f) log(`history: pruned ${n} legacy events and ${f} day files (historyHours ${cfg.historyHours ?? 168}, textHours ${cfg.textHours ?? cfg.historyHours ?? 168})`);
  } catch (e) { log("history prune:", (e as Error).message); }
};
prune();
// Filled from the stored events once the server listens (end of file), so hooks sent meanwhile wait instead of being refused.
let state: OfficeState = emptyState(), booting = true;
const waiters: (() => void)[] = [];
let rev = 0, events = 0, lastEventAt = 0;
/** Re-read office.json; a change must reach clients (and the envelope cache) whichever request noticed it first. */
const refreshConfig = () => { if (!reloadConfig()) return false; rev++; push(); return true; };
let lastProto: unknown;
/** What a client sees: free text blanked (`priv`), and the level of detail (`lod`: summary counts; `session` in full). */
type View = { priv: boolean; lod: boolean; session?: string; remote?: boolean };
const viewKey = (v: View) => `${+v.priv}|${+v.lod}|${v.session ?? ""}|${+!!v.remote}`;
const viewOf = (u: URL, remote: boolean): View => {
  const q = u.searchParams.get("session"), session = q && safeId(q) ? q : undefined;
  return { priv: u.searchParams.get("private") === "1" || !!cfg.privacy, lod: u.searchParams.get("lod") === "summary" || session !== undefined, session, remote };
};
type Sent = Snap & { json: string; degraded: boolean };
const clients = new Map<ServerResponse, View>();
let cache: { rev: number; m: Map<string, Sent> } = { rev: -1, m: new Map() };
function snap(v: View): Sent {
  if (cache.rev !== rev) cache = { rev, m: new Map() };
  let x = cache.m.get(viewKey(v));
  if (!x) {
    const hide = v.priv || !!cfg.privacy, pub = publicState(state, hide);
    // a paired device sees the office, not the host: no config error/warning text (it names the host's file path) and no
    // share settings; it gets the roles it needs to draw the office
    const head = v.remote
      ? { schema: SCHEMA_VERSION, version: VERSION, epoch: EPOCH, rev, privacy: hide, protocol: cfg.protocol ?? "office", config: { ...cfg, share: undefined }, remote: true }
      : { schema: SCHEMA_VERSION, version: VERSION, epoch: EPOCH, rev, privacy: hide, protocol: cfg.protocol ?? "office", configError, configWarning, config: cfg };
    const st = v.lod ? lodState(pub, v.session) : pub;
    cache.m.set(viewKey(v), (x = { head, st, ...fit(head, st, MAX_STATE) }));
  }
  return x;
}
const write = (res: ServerResponse, chunk: string) => {
  if (res.writableLength > MAX_BUFFERED) { clients.delete(res); res.destroy(); return; }
  res.write(chunk);
};
/** Per view: the last snapshot its clients hold, so the next push can be a patch against it. */
const lastSent = new Map<string, Sent>();
const full = (x: Sent) => `id: ${EPOCH}-${rev}\ndata: ${x.json}\n\n`;
// shortcut: the full envelope is still serialized on every commit (to know whether it is degraded); skip it when CPU shows up in profiles.
const push = () => {
  const frames = new Map<string, string>();
  for (const [res, v] of clients) {
    const k = viewKey(v);
    let f = frames.get(k);
    if (f === undefined) {
      const cur = snap(v), prev = lastSent.get(k);
      f = !prev || prev.degraded || cur.degraded ? full(cur) : `id: ${EPOCH}-${rev}\nevent: patch\ndata: ${JSON.stringify(diffEnvelope(prev, cur))}\n\n`;
      frames.set(k, f); lastSent.set(k, cur);
    }
    write(res, f);
  }
};

/** Install a new state and push it (an oversized envelope is trimmed and marked degraded, never dropped: fitEnvelope). */
function commit(next: OfficeState) {
  state = next; rev++;
  push();
}

const WEB = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

function serve(url: string, res: ServerResponse): boolean {
  let rel: string;
  try { rel = normalize(decodeURIComponent(url.split("?")[0])).replace(/^(\.\.[/\\])+/, ""); } catch { return false; }
  const file = join(WEB, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(WEB) || !existsSync(file) || !statSync(file).isFile()) return false;
  // hashed build output never changes under its name; the page and everything else is always fetched fresh
  const cache = /^[/\\]assets[/\\]/.test(rel) ? "public, max-age=31536000, immutable" : "no-store";
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": cache }).end(readFileSync(file));
  return true;
}

const same = (a: string, b: string) => a.length > 0 && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieOf = (req: IncomingMessage) => /(?:^|;\s*)ao_ui=([\w-]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "";
const hasHeaderToken = (req: IncomingMessage) => { const t = req.headers["x-agent-office-token"]; return typeof t === "string" && same(t, TOKEN); };
const canRead = (req: IncomingMessage) => hasHeaderToken(req) || same(cookieOf(req), UI_TOKEN);
const json = (res: ServerResponse, code: number, body: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));


/** Only text meant for the model, bounded, without control characters. */
const cleanContext = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").slice(0, 2000);
const denials = new Map<string, number>();

// What the lead says between tool calls, read from its own transcript (assistant `text` blocks only; see usage.ts).
// Per session: ids already shown (a session's history is never replayed on first sight), a throttle, and recent texts
// so a turn's final message (also sent as `last_assistant_message` on Stop) is shown once.
const narrated = new Map<string, { seen: Set<string>; primed: boolean; at: number; texts: string[] }>();
const NARRATE_EVERY_MS = 1500, NARRATE_MAX_SESSIONS = 64, NARRATE_MAX_IDS = 200;
function narrationEvents(payload: any, now: number): OfficeEvent[] {
  if (cfg.privacy) return []; // privacy mode: the transcript is never opened
  const hook = String(payload?.hook_event_name);
  if (!["PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit"].includes(hook) || payload?.agent_id) return []; // the lead only
  const session = typeof payload?.session_id === "string" ? payload.session_id : "";
  if (!session || session.length > 64) return [];
  let st = narrated.get(session);
  if (!st) {
    if (narrated.size >= NARRATE_MAX_SESSIONS) narrated.delete(narrated.keys().next().value as string);
    narrated.set(session, (st = { seen: new Set(), primed: false, at: 0, texts: [] }));
  }
  if (hook !== "Stop" && now - st.at < NARRATE_EVERY_MS) return [];
  st.at = now;
  const items = readNarration(payload.transcript_path, payload.cwd);
  const out: OfficeEvent[] = [];
  const push = (raw: string) => {
    const text = clip(raw, 160);
    if (!text || st!.texts.includes(text)) return;
    st!.texts.push(text);
    if (st!.texts.length > 32) st!.texts.shift();
    out.push({ type: "message", session, to: "user", text, t: now });
  };
  if (!st.primed) { // first sight: remember what is already there, show only what comes next
    for (const it of items) st.seen.add(it.id);
    st.primed = true;
  } else {
    for (const it of items) {
      if (st.seen.has(it.id)) continue;
      st.seen.add(it.id);
      if (st.seen.size > NARRATE_MAX_IDS) st.seen.delete(st.seen.values().next().value as string);
      push(it.text);
    }
  }
  if (hook === "Stop" && typeof payload.last_assistant_message === "string") push(payload.last_assistant_message);
  return out.slice(-3);
}

// Spend: one running ledger per session over every transcript it names (lead + subagents), read incrementally
// (token usage fields only, see usage.ts), refreshed at most every USAGE_EVERY_MS during the turn and always at Stop/SubagentStop.
const ledgers = new Map<string, { l: Ledger; paths: Map<string, unknown>; at: number }>();
const USAGE_EVERY_MS = 5000, LEDGER_SESSIONS = 64;
function sessionUsage(payload: any, now: number, force: boolean) {
  if (cfg.privacy) return undefined; // privacy mode: no transcript reads at all
  const session = payload?.session_id;
  if (typeof session !== "string" || session.length > 64) return undefined;
  let b = ledgers.get(session);
  if (!b) {
    if (ledgers.size >= LEDGER_SESSIONS) ledgers.delete(ledgers.keys().next().value as string);
    ledgers.set(session, (b = { l: newLedger(), paths: new Map(), at: 0 }));
  }
  for (const k of ["transcript_path", "agent_transcript_path"]) if (typeof payload[k] === "string" && b.paths.size < 256) b.paths.set(payload[k], payload.cwd);
  if (!force && now - b.at < USAGE_EVERY_MS) return undefined;
  b.at = now;
  for (const [p, cwd] of b.paths) tallyUsage(b.l, p, cwd);
  return ledgerTotal(b.l);
}

function onEvent(payload: any, res: ServerResponse) {
  if (payload && payload.ao_proto !== undefined) lastProto = payload.ao_proto;
  const c = (refreshConfig(), cfg);
  const evs = adapt(payload);
  evs.unshift(...narrationEvents(payload, Date.now())); // the lead's words come before the tool call they introduce
  if (evs.length) { events++; lastEventAt = Date.now(); }
  const hook = String(payload?.hook_event_name);
  const total = ["PostToolUse", "Stop", "SubagentStop"].includes(hook) ? sessionUsage(payload, Date.now(), hook !== "PostToolUse") : undefined;
  for (const e of evs) {
    if (e.type === "agent_stop" && !c.privacy) e.usage = readUsage(payload.agent_transcript_path, payload.cwd);
    else if (e.type === "turn_end") {
      e.usage = total;
      e.outcome = outcomeOf(e.message); // stamped like agent_stop's, so a replay without text keeps it
      if (c.privacy) delete e.message; // privacy: the lead's answer never enters state or disk
    }
    if ("usage" in e && !e.usage) delete e.usage;
  }
  const sid = evs[0]?.session;
  if (total && hook !== "Stop" && sid && JSON.stringify(state.sessions[sid]?.usage) !== JSON.stringify(total)) evs.push({ type: "usage", session: sid, usage: total, t: Date.now() });
  if (hook === "SessionEnd" && typeof payload?.session_id === "string") ledgers.delete(payload.session_id);
  // Seat enforcement: deny an Agent spawn when every desk is taken, but never more than 3 times in a row.
  const del = evs.find((e) => e.type === "delegate");
  const office = c.protocol !== "observe"; // observe: nothing injected, nothing denied
  if (office && c.enforceSeats && hook === "PreToolUse" && del?.type === "delegate") {
    const role = roleFor(c, del.agentType), key = `${del.session}|${role}`;
    if (!capacityFor(c, state, role).canSpawn) {
      const n = denials.get(key) ?? 0;
      if (n < 3) {
        if (denials.size > 200) denials.clear();
        denials.set(key, n + 1);
        return json(res, 200, { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
          permissionDecisionReason: "The office is full (every desk is taken); wait for one to free up or do other work first." } });
      }
    }
    denials.delete(key);
  }
  let next = state, ctx: string | null = null;
  for (const e of evs) {
    const before = next;
    if (e.type !== "session_start" && next.sessions[e.session]?.cwd) delete e.cwd; // only a session without one needs it (state and disk)
    next = reduce(c, next, e);
    // Hook stdout is parsed by Claude Code: this is how roster/identity reach the model.
    if (e.type === "session_start") ctx = leadRoster(c);
    else if (e.type === "agent_start") ctx = introFor(c, next, e.agentId);
    // Privacy mode: free text never reaches disk (same fields /history blanks). The outcome is stamped so a replay without text keeps it.
    const stored = e.type === "agent_stop" ? { ...e, outcome: outcomeOf(e.message ?? before.agents[e.agentId]?.report) } : e;
    try { appendEvent(DIR, stored, !!c.privacy); } catch (err) { log("event log:", (err as Error).message); }
  }
  if (evs.length) commit(next);
  const out = office && ctx && (hook === "SessionStart" || hook === "SubagentStart")
    ? { hookSpecificOutput: { hookEventName: hook, additionalContext: cleanContext(ctx) } } : undefined;
  res.writeHead(200, { "content-type": "application/json" }).end(out ? JSON.stringify(out) : "");
}

/** GET /state, /stream, /history: the same handlers and views for the loopback page and a paired LAN device (`remote`). */
function readRoute(path: string, req: IncomingMessage, res: ServerResponse, u: URL, remote: boolean) {
  const view = viewOf(u, remote), priv = view.priv;
  const fail = (e: unknown) => { log("read error:", e); if (!res.headersSent) res.writeHead(500).end(); else res.end(); };
  if (path === "/state") { refreshConfig(); return void res.writeHead(200, { "content-type": "application/json" }).end(snap(view).json); }
  if (path === "/stream") {
    if (clients.size >= MAX_CLIENTS) return void res.writeHead(503).end();
    refreshConfig();
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    // A reconnecting client that already has this revision gets no duplicate snapshot. Either way it holds `snap(view)` now.
    const cur = snap(view), k = viewKey(view);
    if (req.headers["last-event-id"] !== `${EPOCH}-${rev}`) write(res, full(cur));
    else res.write(": up to date\n\n");
    clients.set(res, view);
    lastSent.set(k, cur);
    req.on("close", () => { clients.delete(res); if (![...clients.values()].some((v) => viewKey(v) === k)) lastSent.delete(k); });
    return;
  }
  // Never older than the retention window (day files are deleted whole, so disk may hold up to a day more).
  const since = Math.max(Number(u.searchParams.get("since")) || 0, Date.now() - historyMs());
  const limit = Math.min(Math.max(Number(u.searchParams.get("limit")) || 500, 1), 20_000);
  const untilParam = u.searchParams.get("until");
  const until = untilParam && Number.isFinite(+untilParam) ? +untilParam : Infinity;
  // Streamed out in slices of 500 events, waiting for the socket to drain: a 20k-event page never builds one big string.
  readEvents(DIR, { since, until, limit, text: !priv }).then(async ({ events, more }) => {
    res.writeHead(200, { "content-type": "application/json" });
    const closed = new Promise((r) => res.once("close", r)); // one listener per response, not one per slice
    res.write(`{"schema":${SCHEMA_VERSION},"epoch":${JSON.stringify(EPOCH)},"more":${more},"events":[`);
    for (let i = 0; i < events.length && !res.destroyed; i += 500) {
      const part = events.slice(i, i + 500).map((e) => JSON.stringify(priv ? strip(e) : e)).join(",");
      if (!res.write((i ? "," : "") + part)) await Promise.race([new Promise((r) => res.once("drain", r)), closed]); // a closed client must not leave this waiting
    }
    res.end("]}");
  }).catch(fail);
}

// Share on the local network (share.ts): a separate HTTPS listener with its own route table; controlled only from here.
const share = createShare({
  dir: DIR, log, settings: () => cfg.share ?? {},
  read: (path, req, res, u) => readRoute(path, req, res, u, true),
  serve: (url, res) => existsSync(WEB) && serve(url, res),
});
/**
 * Clear sessions from the office by hand (Sessions view): POST {ids: string[]} ends each one as if it had sent SessionEnd,
 * stored like any event so a restart keeps it gone. Loopback only (the LAN viewer has no such route), same guard as the
 * share controls. A cleared session that sends another event comes back on its own; nothing touches Claude.
 */
function clearRoute(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${req.headers.host}`) return void res.writeHead(403).end();
  if (!canRead(req)) return void res.writeHead(401).end();
  if (req.method !== "POST") return void res.writeHead(405).end();
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (d: string) => { body += d; if (body.length > 8192 && !res.headersSent) { res.writeHead(413, { connection: "close" }).end(); req.destroy(); } });
  req.on("end", () => {
    if (res.headersSent) return;
    let ids: unknown;
    try { ids = JSON.parse(body).ids; } catch { return void res.writeHead(400).end(); }
    if (!Array.isArray(ids) || ids.length > 64) return void res.writeHead(400).end();
    // Never clear what is working or waiting on you: a cleared permission prompt would never come back (Claude is blocked on it).
    const busy = (id: string) => { const x = state.sessions[id]; return !!x.doing || x.waits?.some((w) => !w.soft) || Object.values(state.agents).some((a) => a.session === id && a.doing); };
    const asked = ids.filter((x): x is string => typeof x === "string" && x in state.sessions);
    const known = asked.filter((x) => !busy(x)), skipped = asked.filter(busy);
    const c = (refreshConfig(), cfg), t = Date.now();
    let next = state;
    for (const session of known) {
      const e: OfficeEvent = { type: "session_end", session, t };
      next = reduce(c, next, e);
      try { appendEvent(DIR, e, !!c.privacy); } catch (err) { log("event log:", (err as Error).message); }
    }
    if (known.length) commit(next);
    json(res, 200, { cleared: known, skipped });
  });
}

/** Local share controls (S5): the UI cookie or the master header, and no foreign Origin. */
function shareRoute(req: IncomingMessage, res: ServerResponse, path: string) {
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${req.headers.host}`) return void res.writeHead(403).end();
  if (!canRead(req)) return void res.writeHead(401).end();
  const route = `${req.method} ${path}`, id = /^\/share\/devices\/([0-9a-f]{8})$/.exec(path)?.[1];
  if (route === "GET /share") return json(res, 200, share.status());
  if (route === "POST /share/code") { const c = share.newCode(); return json(res, "error" in c ? 409 : 200, c); }
  if (route === "DELETE /share/devices") { share.revoke(); return json(res, 200, share.status()); }
  if (req.method === "DELETE" && id) return share.revoke(id) ? json(res, 200, share.status()) : json(res, 404, { error: "no such device" });
  if (route !== "POST /share") return void res.writeHead(404).end();
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (d: string) => { body += d; if (body.length > 1024 && !res.headersSent) { res.writeHead(413, { connection: "close" }).end(); req.destroy(); } });
  req.on("end", async () => {
    if (res.headersSent) return;
    let on: unknown;
    try { on = JSON.parse(body).on; } catch { /* below */ }
    if (typeof on !== "boolean") return json(res, 400, { error: "body must be {\"on\": true|false}" });
    if (!on) { share.stop(); return json(res, 200, share.status()); }
    refreshConfig();
    const error = await share.start();
    json(res, error ? 409 : 200, error ? { ...share.status(), error } : share.status());
  });
}

const NO_DIST = `<!doctype html><title>Agent Office</title><body style="font:14px monospace;background:#111;color:#ddd"><h3>Agent Office</h3><p>The web client is not built. Run <code>npm run build:web</code> in the repo and reload.</p><p>Live state (debug):</p><pre id=o>waiting…</pre><script>new EventSource("/stream").onmessage=e=>o.textContent=JSON.stringify(JSON.parse(e.data),null,2)</script>`;

function handle(req: IncomingMessage, res: ServerResponse, allowedHosts: Set<string>) {
  const host = req.headers.host ?? "";
  if (!allowedHosts.has(host.toLowerCase())) return void res.writeHead(403).end();
  let u: URL;
  try { u = new URL(req.url ?? "/", "http://x"); } catch { return void res.writeHead(400).end(); }
  const path = u.pathname, get = req.method === "GET";

  if (get && path === "/health") {
    const warning = lastProto !== undefined && lastProto !== SCHEMA_VERSION ? `forwarder protocol ${String(lastProto)} differs from daemon ${SCHEMA_VERSION}` : configWarning;
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
        if (process.env.AGENT_OFFICE_LOG && !cfg.privacy) appendRotating(RAW_LOG, `${new Date().toISOString()} ${Buffer.concat(chunks).toString("utf8").trim()}`);
        onEvent(payload, res);
      } catch (e) { log("event error:", e); if (!res.headersSent) res.writeHead(500).end(); }
    });
    return;
  }
  if (path === "/share" || path.startsWith("/share/")) return shareRoute(req, res, path);
  if (path === "/sessions/clear") return clearRoute(req, res);
  if (!get) return void res.writeHead(404).end();

  if (path === "/state" || path === "/stream" || path === "/history") {
    if (!canRead(req)) return void res.writeHead(401).end();
    return readRoute(path, req, res, u, false);
  }
  if (path === "/status" || path === "/outcomes") {
    if (!canRead(req)) return void res.writeHead(401).end();
    const priv = viewOf(u, false).priv;
    const fail = (e: unknown) => { log("read error:", e); if (!res.headersSent) res.writeHead(500).end(); else res.end(); };
    if (path === "/status") {
      const agents = Object.values(state.agents).filter((a) => a.seat);
      const working = agents.filter((a) => a.doing).length + Object.values(state.sessions).filter((s) => s.doing).length;
      const s = { working, waiting: Object.values(state.sessions).filter((x) => x.waiting && !x.waitSoft).length, queued: state.queue.length,
        sessions: Object.keys(state.sessions).length, agents: agents.length,
        desks: (({ free, total }) => ({ used: total - free, total, cap: total }))(capacityFor(cfg, state)), events, lastEventAt: lastEventAt || undefined,
        dropped: state.track?.dropped ?? 0 }; // sessions evicted or refused at the 50-session cap
      // ?session=<id prefix or project> narrows to matching sessions: one line each, or `sessions` in JSON.
      const q = u.searchParams.get("session");
      const per = Object.values(state.sessions).filter((x) => !q || x.id.startsWith(q) || (priv ? pseudonym(x.id) : x.project) === q).map((x) => {
        const own = agents.filter((a) => a.session === x.id);
        return { session: x.id, project: priv ? pseudonym(x.id) : x.project, state: x.waiting && !x.waitSoft ? "waiting" : x.doing || own.some((a) => a.doing) ? "working" : "idle",
          agents: own.length, errors: x.errors ?? 0, lastAt: x.lastAt, tokens: x.usage ? x.usage.input + x.usage.output : undefined };
      });
      if (q && !per.length) return json(res, 404, { error: "no such session" });
      if (u.searchParams.get("format") === "json") return json(res, 200, q ? { ...s, sessions: per } : { ...s, detail: per });
      if (q) return void res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(per.map((x) => `${x.project} ${x.state} ${x.agents} agents ${x.errors} errors`).join("\n") + "\n");
      return void res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(`${s.working} working, ${s.waiting} waiting, ${s.queued} queued\n`);
    }
    if (path === "/outcomes") {
      const days = Math.min(Math.max(Number(u.searchParams.get("days")) || 7, 1), 90);
      readEvents(DIR, { since: Date.now() - days * 86_400_000, limit: 50_000 }).then(({ events }) => json(res, 200, { schema: SCHEMA_VERSION, days: summarize(events) }), fail);
      return;
    }
  }

  if (path === "/" || path === "/index.html") {
    // The browser tab gets read access for /stream and /state through this cookie (Host was already checked).
    // and expire the pre-split ao_token cookie, which held the master (write) token, in browsers that still have it
    res.setHeader("set-cookie", [`ao_ui=${UI_TOKEN}; HttpOnly; SameSite=Strict; Path=/`, "ao_token=; Max-Age=0; Path=/"]);
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
    const go = () => { try { handle(req, res, hosts); } catch (e) { log("request error:", e); if (!res.headersSent) res.writeHead(500).end(); else res.end(); } };
    if (booting && req.url !== "/health") waiters.push(go); else go(); // during the boot replay, requests wait for it
  });
  for (const f of ["port", "pid"]) writeFileSync(join(DIR, f), String(f === "port" ? port : process.pid));
  process.on("exit", () => { for (const f of ["port", "pid"]) try { unlinkSync(join(DIR, f)); } catch { /* gone */ } });
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => process.exit(0));
  if (!LOOPBACK) log(`WARNING: bound to ${HOST}, not loopback (AGENT_OFFICE_ALLOW_REMOTE=1). Anyone who can reach it and has the token can send events; hooks and browser must use this host.`);
  console.log(`agent-office listening on http://${HOST}:${port}`);
  setInterval(() => { refreshConfig(); }, 2000).unref();
  if (cfg.share?.enabled) void share.start().then((e) => e && log("share:", e));
  setInterval(prune, 3600_000).unref();
  setInterval(() => {
    const r = sweep(state, Date.now(), ttlMs(), cfg);
    if (r.state !== state) { log("swept idle sessions:", r.removed.sessions.join(",") || "none", "agents:", r.removed.agents.join(",")); commit(r.state); } // ghost helpers alone count too (S1)
  }, 30_000).unref();
  setInterval(() => { for (const res of clients.keys()) write(res, ": ping\n\n"); }, 15_000).unref();
});
// The last 50k events of the retention window, preceded by every older start/stop/prompt in it (bootEvents).
state = replay(cfg, await bootEvents(DIR, Date.now() - historyMs(), !cfg.privacy), Date.now(), ttlMs());
booting = false; rev++; push();
for (const go of waiters.splice(0)) go();
