#!/usr/bin/env node
// Claude Code hook forwarder: stdin hook payload -> allowlisted JSON -> local Agent Office daemon.
// Zero dependencies. Always exits 0 and never prints anything except a schema-checked daemon reply.
import { readFileSync, appendFileSync, mkdirSync, statSync, unlinkSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { request } from "node:http";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const PROTO = 1; // matches SCHEMA_VERSION in packages/core
const TIMEOUT = 1500;
const home = () => process.env.AGENT_OFFICE_HOME ?? join(homedir(), ".agent-office");
const read = (f) => { try { return readFileSync(join(home(), f), "utf8").trim(); } catch { return ""; } };

/** Daemon address: env, else the port file the daemon wrote, else 4747. */
export const endpoint = () => ({
  host: process.env.AGENT_OFFICE_HOST || "127.0.0.1",
  port: Number(process.env.AGENT_OFFICE_PORT) || Number(read("port")) || 4747,
});

const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : undefined);
const INPUT = ["command", "description", "file_path", "pattern", "url", "query", "subagent_type", "prompt", "to", "message", "content"];
const TOP = ["session_id", "cwd", "hook_event_name", "agent_id", "agent_type", "tool_name", "tool_use_id", "branch", "source",
  "prompt", "message", "last_assistant_message", "transcript_path", "agent_transcript_path", "error", "notification_type"];

/** Only what the daemon needs, each string clipped. */
export function allowlist(p) {
  const out = {};
  for (const k of TOP) { const v = clip(p[k], k.endsWith("path") ? 600 : 1000); if (v !== undefined) out[k] = v; }
  if (p.tool_input && typeof p.tool_input === "object") {
    out.tool_input = {};
    for (const k of INPUT) { const v = clip(p.tool_input[k], 500); if (v !== undefined) out.tool_input[k] = v; }
  }
  const r = p.tool_response;
  if (r && typeof r === "object") {
    out.tool_response = {};
    if (typeof r.success === "boolean") out.tool_response.success = r.success;
    if (typeof r.is_error === "boolean") out.tool_response.is_error = r.is_error;
    const e = clip(r.error, 300); if (e !== undefined) out.tool_response.error = e;
  }
  return out;
}

/** Per-session counter: one byte appended per event, the file size is the sequence number. */
// shortcut: concurrent hooks can read the same size (rare duplicate seq, shows as a gap), switch to a lock if that matters.
function nextSeq(session) {
  if (!/^[\w.:-]{1,64}$/.test(session)) return undefined;
  try {
    const dir = join(home(), "seq");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const f = join(dir, session.replace(/:/g, "_"));
    appendFileSync(f, "x", { mode: 0o600 });
    return statSync(f).size;
  } catch { return undefined; }
}

/** Accept only the exact reply shape the daemon is allowed to send. */
export function checkReply(text) {
  try {
    const o = JSON.parse(text), h = o?.hookSpecificOutput;
    if (Object.keys(o).length !== 1 || !h || typeof h !== "object") return undefined;
    const allowed = ["hookEventName", "additionalContext", "permissionDecision", "permissionDecisionReason"];
    if (Object.keys(h).some((k) => !allowed.includes(k))) return undefined;
    if (!["SessionStart", "SubagentStart", "PreToolUse"].includes(h.hookEventName)) return undefined;
    if (h.additionalContext !== undefined && (typeof h.additionalContext !== "string" || h.additionalContext.length > 2000)) return undefined;
    if (h.permissionDecision !== undefined && h.permissionDecision !== "deny") return undefined;
    if (h.permissionDecisionReason !== undefined && (typeof h.permissionDecisionReason !== "string" || h.permissionDecisionReason.length > 300)) return undefined;
    return JSON.stringify(o);
  } catch { return undefined; }
}

function post(path, body, wantReply, method = "POST") {
  return new Promise((resolve) => {
    const { host, port } = endpoint();
    const req = request({ host, port, path, method, timeout: TIMEOUT, headers: {
      "content-type": "application/json", "x-agent-office-token": read("token"), "content-length": Buffer.byteLength(body) } }, (res) => {
      if (res.statusCode !== 200 || !wantReply) { res.destroy(); return resolve({ ok: res.statusCode === 200 }); }
      let t = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { t += d; if (t.length > 8192) res.destroy(); });
      res.on("end", () => resolve({ ok: true, text: t }));
      res.on("close", () => resolve({ ok: true, text: t.length > 8192 ? "" : t }));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", (e) => resolve({ ok: false, refused: e.code === "ECONNREFUSED" }));
    req.end(body);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let note; // why autostart gave up, recorded in last-hook.json for `doctor`

/** Start the daemon detached when its entry is known; wait up to 2 s for /health. */
async function autostart() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 6)) return false;
  // `npm run setup` records the daemon entry in $AGENT_OFFICE_HOME/daemon, because an installed plugin lives in
  // Claude Code's plugin cache, away from the repo. The relative path only works with --plugin-dir ./plugin.
  const entry = process.env.AGENT_OFFICE_DAEMON || read("daemon") || join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "packages", "server", "src", "main.ts");
  if (!existsSync(entry)) { note = `daemon entry missing: ${entry} (rerun npm run setup)`; return false; }
  const args = major === 22 && minor < 18 ? ["--experimental-strip-types", entry] : [entry];
  spawn(process.execPath, args, { detached: true, stdio: "ignore", env: process.env, windowsHide: true }).unref(); // no console window on Windows
  for (let i = 0; i < 13; i++) {
    await sleep(150);
    if (await healthy()) return true;
  }
  return false;
}
const healthy = () => new Promise((resolve) => {
  const { host, port } = endpoint();
  const r = request({ host, port, path: "/health", timeout: 300 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
  r.on("error", () => resolve(false)); r.on("timeout", () => r.destroy()); r.end();
});

async function main() {
  if (process.env.AGENT_OFFICE_DISABLED === "1") return;
  let raw = "";
  for await (const c of process.stdin) { raw += c; if (raw.length > 5_000_000) return; }
  const p = JSON.parse(raw);
  if (!p || typeof p !== "object") return;
  const ev = p.hook_event_name;
  const body = allowlist(p);
  body.ao_proto = PROTO;
  const seq = typeof body.session_id === "string" ? nextSeq(body.session_id) : undefined;
  if (seq !== undefined) body.ao_seq = seq;
  const wantReply = ev === "SessionStart" || ev === "SubagentStart" || (ev === "PreToolUse" && (p.tool_name === "Agent" || p.tool_name === "Task"));
  const json = JSON.stringify(body);
  let r = await post("/event", json, wantReply);
  if (!r.ok && r.refused && ev === "SessionStart" && (await autostart())) r = await post("/event", json, wantReply);
  if (ev === "SessionEnd" && typeof body.session_id === "string") try { unlinkSync(join(home(), "seq", body.session_id.replace(/:/g, "_"))); } catch { /* none */ }
  // Marker for `doctor`: proves hooks fire inside real sessions. Names and outcome only, no content.
  // Temp file (exclusive create, no symlink follow) then rename, so a planted link at the fixed path is replaced, not written through.
  const last = join(home(), "last-hook.json"), tmp = `${last}.${process.pid}.tmp`;
  try { mkdirSync(home(), { recursive: true }); writeFileSync(tmp, JSON.stringify({ t: Date.now(), event: ev, delivered: !!r.ok, note, session: String(body.session_id ?? "").slice(0, 8) }), { flag: "wx", mode: 0o600 }); renameSync(tmp, last); } catch { /* best effort */ }
  const out = r.text ? checkReply(r.text) : undefined;
  if (out) process.stdout.write(out);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const guard = setTimeout(() => process.exit(0), 4000); // never hold Claude Code
  main().catch(() => {}).finally(() => clearTimeout(guard));
}
