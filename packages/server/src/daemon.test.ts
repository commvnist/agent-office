import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));
const FORWARD = fileURLToPath(new URL("../../../plugin/hooks/forward.mjs", import.meta.url));
const procs: ChildProcess[] = [];
after(() => procs.forEach((p) => p.kill()));

async function boot(config?: object, port = 0) {
  const home = mkdtempSync(join(tmpdir(), "ao-d-"));
  if (config) writeFileSync(join(home, "office.json"), JSON.stringify(config));
  const p = spawn(process.execPath, [MAIN], { env: { ...process.env, AGENT_OFFICE_HOME: home, AGENT_OFFICE_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(p);
  const out: string = await new Promise((res) => p.stdout!.on("data", (d) => /listening on/.test(String(d)) && res(String(d))));
  const url = new URL(/http:\/\/\S+/.exec(out)![0]);
  return { p, home, port: Number(url.port), token: readFileSync(join(home, "token"), "utf8").trim() };
}
type R = { status: number; body: string; headers: Record<string, any> };
const call = (port: number, path: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
  new Promise<R>((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port, path, method: o.method ?? "GET", headers: o.headers }, (res) => {
      let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode!, body: b, headers: res.headers }));
    });
    r.on("error", reject); r.end(o.body);
  });
const post = (d: Awaited<ReturnType<typeof boot>>, ev: object) =>
  call(d.port, "/event", { method: "POST", headers: { "x-agent-office-token": d.token }, body: JSON.stringify(ev) });

test("auth, host and origin checks; cookie grants read access", async () => {
  const d = await boot();
  assert.equal(statSync(join(d.home, "token")).mode & 0o777, 0o600);
  assert.equal((await call(d.port, "/event", { method: "POST", body: "{}" })).status, 401);
  assert.equal((await call(d.port, "/event", { method: "POST", headers: { "x-agent-office-token": d.token, origin: "http://evil" }, body: "{}" })).status, 403);
  assert.equal((await call(d.port, "/health", { headers: { host: "evil.example" } })).status, 403);
  assert.equal((await call(d.port, "/state")).status, 401);
  const page = await call(d.port, "/");
  const cookie = String(page.headers["set-cookie"]);
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const ev = { hook_event_name: "SessionStart", session_id: "s1", cwd: "/w/proj" };
  const r = await post(d, ev);
  const reply = JSON.parse(r.body).hookSpecificOutput;
  assert.equal(reply.hookEventName, "SessionStart");
  assert.ok(reply.additionalContext.length <= 2000);
  const st = JSON.parse((await call(d.port, "/state", { headers: { cookie: cookie.split(";")[0] } })).body);
  assert.equal(st.schema, 1);
  assert.ok(st.epoch && st.rev >= 1);
  assert.equal(st.state.track, undefined);
  assert.ok(st.state.sessions.s1);
  assert.deepEqual(Object.keys(st.config.roles).slice(-3), ["devops", "docs-writer", "security-auditor"]);
  assert.match((await call(d.port, "/status", { headers: { "x-agent-office-token": d.token } })).body, /^\d+ working, \d+ waiting, \d+ queued\n$/);
  const tk = { "x-agent-office-token": d.token };
  const sj = JSON.parse((await call(d.port, "/status?format=json&session=proj", { headers: tk })).body);
  assert.deepEqual([sj.events, sj.sessions.map((x: any) => x.project)], [1, ["proj"]]);
  assert.deepEqual(sj.desks, { used: 0, total: 64, cap: 64 });
  assert.equal(JSON.parse((await call(d.port, "/outcomes?days=1", { headers: tk })).body).days[0].sessions, 1);
  const h = JSON.parse((await call(d.port, "/history?limit=5", { headers: { "x-agent-office-token": d.token } })).body);
  assert.equal(h.events[0].type, "session_start");
  assert.equal(JSON.parse((await call(d.port, "/history?until=0", { headers: tk })).body).events.length, 0);
  assert.equal(JSON.parse((await call(d.port, "/history?until=abc", { headers: tk })).body).events.length, 1);
  const priv = await call(d.port, "/state?private=1", { headers: { "x-agent-office-token": d.token } });
  assert.equal(JSON.parse(priv.body).privacy, true);
});

test("bad input never kills the daemon", async () => {
  const d = await boot();
  const h = { "x-agent-office-token": d.token };
  assert.equal((await call(d.port, "/event", { method: "POST", headers: h, body: "{nope" })).status, 400);
  assert.equal((await call(d.port, "/event", { method: "POST", headers: h, body: "null" })).status, 200);
  await call(d.port, "/%", { headers: h }).catch(() => {});
  await call(d.port, "/event", { method: "POST", headers: h, body: "x".repeat(300 * 1024) }).then((r) => assert.equal(r.status, 413)).catch(() => {});
  assert.equal((await call(d.port, "/health")).status, 200);
});

test("seat enforcement denies, then allows after 3 denials", async () => {
  const d = await boot({ roles: { qa: { agent: "qa-engineer", count: 1 } }, enforceSeats: true });
  await post(d, { hook_event_name: "SessionStart", session_id: "s" });
  for (let i = 0; i < 64; i++) await post(d, { hook_event_name: "SubagentStart", session_id: "s", agent_id: `a${i}`, agent_type: i % 2 ? "qa-engineer" : "general-purpose" });
  const spawnTry = () => post(d, { hook_event_name: "PreToolUse", session_id: "s", tool_name: "Agent", tool_input: { subagent_type: "qa-engineer", description: "y" } });
  for (let i = 0; i < 3; i++) {
    const o = JSON.parse((await spawnTry()).body).hookSpecificOutput;
    assert.equal(o.permissionDecision, "deny");
    assert.match(o.permissionDecisionReason, /office is full/);
  }
  assert.equal((await spawnTry()).body, "");
});

test("second daemon on the same port reports already running and exits 0", async () => {
  const d = await boot();
  const r = spawnSync(process.execPath, [MAIN], { env: { ...process.env, AGENT_OFFICE_HOME: mkdtempSync(join(tmpdir(), "ao-d-")), AGENT_OFFICE_PORT: String(d.port) }, encoding: "utf8", timeout: 10000 });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /already running \(pid \d+\)/);
});

test("invalid office.json keeps last good config and reports configError", async () => {
  const d = await boot();
  writeFileSync(join(d.home, "office.json"), JSON.stringify({ roles: { a: { agent: "x", count: 99 } } }));
  const st = JSON.parse((await call(d.port, "/state", { headers: { "x-agent-office-token": d.token } })).body);
  assert.match(st.configError.message, /count/);
  assert.ok(st.config.roles.frontend);
});

test("forwarder: sends allowlisted payload with seq, prints only a valid reply, autostarts daemon", async () => {
  const d = await boot();
  const env = { ...process.env, AGENT_OFFICE_HOME: d.home, AGENT_OFFICE_PORT: String(d.port) };
  const run = (e: object, extra = {}) => spawnSync(process.execPath, [FORWARD], { input: JSON.stringify(e), encoding: "utf8", env: { ...env, ...extra }, timeout: 8000 });
  const a = run({ hook_event_name: "SessionStart", session_id: "f1", cwd: "/w/p", secret_field: "nope" });
  assert.equal(a.status, 0);
  assert.equal(JSON.parse(a.stdout).hookSpecificOutput.hookEventName, "SessionStart");
  const b = run({ hook_event_name: "UserPromptSubmit", session_id: "f1", prompt: "hi" });
  assert.equal(b.stdout, "");
  const st = JSON.parse((await call(d.port, "/state", { headers: { "x-agent-office-token": d.token } })).body);
  assert.equal(st.state.sessions.f1.seq, 2);
  assert.equal(st.state.sessions.f1.gaps, 0);
  assert.equal(run({ hook_event_name: "SessionStart", session_id: "f2" }, { AGENT_OFFICE_DISABLED: "1" }).stdout, "");
  // Unreachable daemon: exits 0 silently.
  const dead = run({ hook_event_name: "SessionStart", session_id: "f3" }, { AGENT_OFFICE_PORT: "1", AGENT_OFFICE_DAEMON: "/nonexistent/main.ts" });
  assert.equal(dead.status, 0);
  assert.equal(dead.stdout, "");
});

test("forwarder reply schema rejects extra keys and oversized text", async () => {
  const { checkReply } = await import(FORWARD);
  const ok = { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "hi" } };
  assert.ok(checkReply(JSON.stringify(ok)));
  assert.equal(checkReply(JSON.stringify({ ...ok, extra: 1 })), undefined);
  assert.equal(checkReply(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "x".repeat(2001) } })), undefined);
  assert.equal(checkReply(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } })), undefined);
  assert.equal(checkReply("junk"), undefined);
});

test("an office.json edit reaches /state whichever request sees it first; unknown session is 404", async () => {
  const d = await boot();
  const get = async () => JSON.parse((await call(d.port, "/state", { headers: { "x-agent-office-token": d.token } })).body);
  assert.equal((await get()).privacy, false);
  writeFileSync(join(d.home, "office.json"), JSON.stringify({ privacy: true }));
  await new Promise((r) => setTimeout(r, 50)); // mtime resolution
  assert.equal((await get()).privacy, true, "the very next request sees the edit");
  assert.equal((await get()).privacy, true);
  const miss = await call(d.port, "/status?session=nope", { headers: { "x-agent-office-token": d.token } });
  assert.equal(miss.status, 404);
  assert.match(miss.body, /no such session/);
});

test("boot replays more than 5000 recent events: sessions older than a burst survive a restart", async () => {
  const home = mkdtempSync(join(tmpdir(), "ao-d-"));
  const now = Date.now();
  const lines = [1, 2, 3].map((i) => JSON.stringify({ type: "session_start", session: `s${i}`, project: `p${i}`, t: now - 600_000 }));
  for (let i = 0; i < 5200; i++) lines.push(JSON.stringify({ type: "tool", session: "s1", tool: "Bash", t: now - 300_000 + i }));
  writeFileSync(join(home, "events.jsonl"), lines.join("\n") + "\n");
  const p = spawn(process.execPath, [MAIN], { env: { ...process.env, AGENT_OFFICE_HOME: home, AGENT_OFFICE_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(p);
  const out: string = await new Promise((res) => p.stdout!.on("data", (x) => /listening on/.test(String(x)) && res(String(x))));
  const port = Number(new URL(/http:\/\/\S+/.exec(out)![0]).port), token = readFileSync(join(home, "token"), "utf8").trim();
  const st = JSON.parse((await call(port, "/status?format=json", { headers: { "x-agent-office-token": token } })).body);
  assert.equal(st.sessions, 3);
});

const st = async (d: Awaited<ReturnType<typeof boot>>) => JSON.parse((await call(d.port, "/state", { headers: { "x-agent-office-token": d.token } })).body);
const transcript = (dir: string, name: string, lines: object[]) => { const f = join(dir, name); writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n"); return f; };
const said = (id: string, text: string, out: number) => ({ type: "assistant", message: { id, content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: out, cache_creation_input_tokens: 0 } } });

test("privacy: no free text reaches events.jsonl, and the transcript is never read (no narration, no usage)", async () => {
  const d = await boot({ privacy: true });
  const cwd = mkdtempSync(join(tmpdir(), "ao-cwd-"));
  const tp = transcript(cwd, "t.jsonl", [said("m1", "TRANSCRIPT-SECRET", 5)]);
  await post(d, { hook_event_name: "SessionStart", session_id: "p1", cwd });
  await post(d, { hook_event_name: "UserPromptSubmit", session_id: "p1", prompt: "PROMPT-SECRET", transcript_path: tp, cwd });
  await post(d, { hook_event_name: "PreToolUse", session_id: "p1", tool_name: "Bash", tool_input: { command: "echo CMD-SECRET" }, transcript_path: tp, cwd });
  writeFileSync(tp, [said("m1", "TRANSCRIPT-SECRET", 5), said("m2", "MORE-SECRET", 7)].map((l) => JSON.stringify(l)).join("\n") + "\n");
  await post(d, { hook_event_name: "Stop", session_id: "p1", transcript_path: tp, cwd, last_assistant_message: "FINAL-SECRET" });
  const disk = readFileSync(join(d.home, "events.jsonl"), "utf8");
  for (const x of ["PROMPT-SECRET", "CMD-SECRET", "FINAL-SECRET", "SECRET", cwd]) assert.ok(!disk.includes(x), x);
  assert.match(disk, /"tool":"Bash"/);
  const s = await st(d);
  assert.equal(s.state.sessions.p1.usage, undefined, "usage is not read in privacy mode");
  assert.ok(!s.state.log.some((i: { kind: string }) => i.kind === "message"), "no narration in privacy mode");
  assert.ok(!JSON.stringify(s).includes("SECRET"));
});

test("spend: the session total includes subagent transcripts and refreshes during the turn", async () => {
  const d = await boot();
  const cwd = mkdtempSync(join(tmpdir(), "ao-cwd-"));
  const lead = transcript(cwd, "lead.jsonl", [said("m1", "hi", 5)]);
  await post(d, { hook_event_name: "SessionStart", session_id: "u1", cwd });
  await post(d, { hook_event_name: "PostToolUse", session_id: "u1", tool_name: "Read", transcript_path: lead, cwd });
  assert.equal((await st(d)).state.sessions.u1.usage.output, 5, "refreshed mid-turn");
  await post(d, { hook_event_name: "SubagentStart", session_id: "u1", agent_id: "a1", agent_type: "qa-engineer" });
  const sub = transcript(cwd, "agent-a1.jsonl", [said("s1", "x", 100)]);
  await post(d, { hook_event_name: "SubagentStop", session_id: "u1", agent_id: "a1", transcript_path: lead, agent_transcript_path: sub, cwd, last_assistant_message: "DONE: ok" });
  const s = await st(d);
  assert.equal(s.state.sessions.u1.usage.output, 105);
  assert.equal(s.state.outcomes[0].text, "DONE: ok");
  await post(d, { hook_event_name: "Stop", session_id: "u1", transcript_path: lead, cwd });
  assert.equal((await st(d)).state.sessions.u1.usage.output, 105, "Stop keeps the subagent share");
});

test("observe protocol injects no context and never denies a spawn; the envelope names the protocol", async () => {
  const d = await boot({ roles: { qa: { agent: "qa-engineer", count: 1 } }, enforceSeats: true, protocol: "observe" });
  assert.equal((await post(d, { hook_event_name: "SessionStart", session_id: "o" })).body, "");
  for (let i = 0; i < 64; i++) await post(d, { hook_event_name: "SubagentStart", session_id: "o", agent_id: `a${i}`, agent_type: "qa-engineer" });
  assert.equal((await post(d, { hook_event_name: "PreToolUse", session_id: "o", tool_name: "Agent", tool_input: { subagent_type: "qa-engineer", description: "y" } })).body, "");
  assert.equal((await st(d)).protocol, "observe");
  const d2 = await boot();
  assert.equal((await st(d2)).protocol, "office");
});

test("a non-loopback AGENT_OFFICE_HOST is refused without AGENT_OFFICE_ALLOW_REMOTE=1", () => {
  const r = spawnSync(process.execPath, [MAIN], { env: { ...process.env, AGENT_OFFICE_HOME: mkdtempSync(join(tmpdir(), "ao-d-")), AGENT_OFFICE_PORT: "0", AGENT_OFFICE_HOST: "0.0.0.0" }, encoding: "utf8", timeout: 10000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refusing to bind 0\.0\.0\.0.*AGENT_OFFICE_ALLOW_REMOTE=1/);
});

test("retention: events older than historyHours are pruned at boot", async () => {
  const home = mkdtempSync(join(tmpdir(), "ao-d-"));
  writeFileSync(join(home, "office.json"), JSON.stringify({ historyHours: 1 }));
  writeFileSync(join(home, "events.jsonl"), [Date.now() - 2 * 3600_000, Date.now()].map((t, i) => JSON.stringify({ type: "session_start", session: `r${i}`, project: "p", t })).join("\n") + "\n");
  const p = spawn(process.execPath, [MAIN], { env: { ...process.env, AGENT_OFFICE_HOME: home, AGENT_OFFICE_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(p);
  await new Promise((res) => p.stdout!.on("data", (x) => /listening on/.test(String(x)) && res(x)));
  const left = readFileSync(join(home, "events.jsonl"), "utf8");
  assert.ok(!left.includes('"r0"') && left.includes('"r1"'));
});
