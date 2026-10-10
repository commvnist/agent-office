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
  const h = JSON.parse((await call(d.port, "/history?limit=5", { headers: { "x-agent-office-token": d.token } })).body);
  assert.equal(h.events[0].type, "session_start");
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
  await post(d, { hook_event_name: "PreToolUse", session_id: "s", tool_name: "Agent", tool_input: { subagent_type: "qa-engineer", description: "x" } });
  await post(d, { hook_event_name: "SubagentStart", session_id: "s", agent_id: "a1", agent_type: "qa-engineer" });
  const spawnTry = () => post(d, { hook_event_name: "PreToolUse", session_id: "s", tool_name: "Agent", tool_input: { subagent_type: "qa-engineer", description: "y" } });
  for (let i = 0; i < 3; i++) {
    const o = JSON.parse((await spawnTry()).body).hookSpecificOutput;
    assert.equal(o.permissionDecision, "deny");
    assert.match(o.permissionDecisionReason, /All qa seats are busy/);
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
