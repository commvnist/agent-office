import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, reduce, sweep, capacityFor, childrenOf, parentChain, LIMITS } from "./state.ts";
import type { OfficeConfig, OfficeEvent } from "./types.ts";

const cfg: OfficeConfig = {
  roles: { qa: { agent: "qa-engineer", count: 2, names: ["Quinn", "Sam"], overflow: { max: 2, names: ["Temp"] } } },
};
const start = (id: string, session = "s1"): OfficeEvent => ({ type: "agent_start", session, agentId: id, agentType: "qa-engineer", t: 0 });
const stop = (id: string): OfficeEvent => ({ type: "agent_stop", session: "s1", agentId: id, t: 0 });
const run = (...evs: OfficeEvent[]) => evs.reduce((s, e) => reduce(cfg, s, e), emptyState());

test("fills permanent desks, then overflow tiers, then queues", () => {
  const s = run(start("a"), start("b"), start("c"), start("d"), start("e"));
  const seats = ["a", "b", "c", "d", "e"].map((id) => s.agents[id].seat?.id ?? null);
  assert.deepEqual(seats, ["qa#0", "qa#1", "qa+0", "qa+1", null]);
  assert.equal(s.agents.a.seat?.name, "Quinn");
  assert.equal(s.agents.c.seat?.name, "Temp 1");
  assert.deepEqual(s.queue, ["e"]);
});

test("a freed seat is handed to the oldest queued agent", () => {
  const s = run(start("a"), start("b"), start("c"), start("d"), start("e"), stop("b"));
  assert.equal(s.agents.e.seat?.id, "qa#1");
  assert.deepEqual(s.queue, []);
});

test("unmapped agent types become guests instead of vanishing", () => {
  const s = reduce(cfg, emptyState(), { type: "agent_start", session: "s1", agentId: "x", agentType: "mystery", t: 0 });
  assert.equal(s.agents.x.role, "guest");
  assert.equal(s.agents.x.seat?.kind, "overflow");
});

test("session_end removes its agents and frees seats for others", () => {
  const s = run(start("a", "s1"), start("b", "s1"), start("c", "s2"), start("d", "s2"), start("e", "s2"),
    { type: "session_end", session: "s1", t: 0 });
  assert.equal(Object.keys(s.agents).length, 3);
  assert.deepEqual(s.queue, []);
  assert.equal(s.agents.e.seat?.kind, "permanent");
});

test("namespaced plugin agent types map to their role", () => {
  const s = reduce(cfg, emptyState(), { type: "agent_start", session: "s1", agentId: "p", agentType: "agent-office:qa-engineer", t: 0 });
  assert.equal(s.agents.p.role, "qa");
  assert.equal(s.agents.p.seat?.id, "qa#0");
});

test("a delegation is matched to the subagent it spawns and the report goes back to the parent", () => {
  const s = run(
    { type: "session_start", session: "s1", project: "shop", t: 0 },
    { type: "delegate", session: "s1", agentType: "qa-engineer", text: "Test the cart", t: 1 },
    start("a"),
    { type: "tool", session: "s1", agentId: "a", tool: "Bash", detail: "npm test", t: 2 },
    { type: "agent_stop", session: "s1", agentId: "a", message: "DONE: 12 tests pass", t: 3 },
  );
  const [d, r] = s.log;
  assert.deepEqual([d.kind, d.from, d.to, d.text], ["delegate", "lead:s1", "a", "Test the cart"]);
  assert.deepEqual([r.kind, r.from, r.to, r.text], ["report", "a", "lead:s1", "DONE: 12 tests pass"]);
  assert.deepEqual(s.pending, {});
});

test("parallel delegations of one type are matched first-in-first-out", () => {
  const s = run(
    { type: "delegate", session: "s1", agentType: "qa-engineer", text: "first", t: 1 },
    { type: "delegate", session: "s1", agentType: "qa-engineer", text: "second", t: 1 },
    start("a"), start("b"),
  );
  assert.deepEqual([s.agents.a.task, s.agents.b.task], ["first", "second"]);
});

test("lead tool calls update the session, not an agent", () => {
  const s = run(
    { type: "session_start", session: "s1", project: "shop", t: 0 },
    { type: "tool", session: "s1", tool: "Edit", detail: "cart.ts", t: 5 },
  );
  assert.equal(s.sessions.s1.detail, "cart.ts");
});

const tool = (t: number, extra: Partial<Extract<OfficeEvent, { type: "tool" }>> = {}): OfficeEvent => ({ type: "tool", session: "s1", tool: "Edit", t, ...extra });
const sstart: OfficeEvent = { type: "session_start", session: "s1", project: "shop", cwd: "/w/shop", t: 0 };

test("ids that are Object.prototype names or spoof the lead are rejected", () => {
  for (const id of ["constructor", "__proto__", "toString", "lead:x", "a|b", ""]) {
    const s = reduce(cfg, emptyState(), { type: "agent_start", session: "s1", agentId: id, agentType: "qa-engineer", t: 0 });
    assert.deepEqual(s.agents, {});
  }
  assert.deepEqual(reduce(cfg, emptyState(), { type: "prompt", session: "__proto__", text: "x", t: 0 }).sessions, {});
});

test("events for an unknown session create a recovered one, capped", () => {
  const s = run({ type: "prompt", session: "s9", text: "hi", t: 1 });
  assert.equal(s.sessions.s9.recovered, true);
  let big = emptyState();
  for (let i = 0; i < LIMITS.sessions + 5; i++) big = reduce(cfg, big, { type: "turn_end", session: `s${i}`, t: 1 });
  assert.equal(Object.keys(big.sessions).length, LIMITS.sessions);
});

test("session_start merges: keeps startedAt, prompt and agents; records source", () => {
  const s = run(sstart, { type: "prompt", session: "s1", text: "go", t: 3 }, start("a"),
    { type: "session_start", session: "s1", project: "shop", source: "compact", t: 9 });
  assert.equal(s.sessions.s1.startedAt, 0);
  assert.equal(s.sessions.s1.prompt, "go");
  assert.equal(s.sessions.s1.source, "compact");
  assert.ok(s.agents.a);
  const r = run(tool(5), { ...sstart, t: 8 });
  assert.equal(r.sessions.s1.recovered, undefined);
  assert.equal(r.sessions.s1.startedAt, 8);
});

test("confidence: exact for a lone delegation, guess for parallel or unmatched", () => {
  const d = (text: string): OfficeEvent => ({ type: "delegate", session: "s1", agentType: "qa-engineer", text, t: 1 });
  const s = run(d("one"), start("a"), d("x"), d("y"), start("b"), start("c"), start("z"));
  assert.deepEqual(["a", "b", "c", "z"].map((i) => s.agents[i].confidence), ["exact", "guess", "exact", "guess"]);
  assert.equal(s.log[0].confidence, "exact");
});

test("pending delegations expire and a failed Agent call is consumed", () => {
  const d = (text: string, t: number, id?: string): OfficeEvent => ({ type: "delegate", session: "s1", agentType: "qa-engineer", text, id, t });
  let s = run(d("old", 0), { ...start("a"), t: LIMITS.pendingTtlMs + 1 });
  assert.equal(s.agents.a.task, undefined);
  assert.deepEqual(s.tasks, []);
  s = run(d("denied", 0, "u1"), { type: "tool_end", session: "s1", tool: "Agent", ok: false, id: "u1", t: 1 }, start("b"));
  assert.equal(s.agents.b.task, undefined);
  assert.deepEqual(s.pending, {});
});

test("tool_end records duration and errors and clears doing", () => {
  let s = run(sstart, start("a"), { type: "tool", session: "s1", agentId: "a", tool: "Bash", id: "u1", t: 100 });
  assert.equal(s.agents.a.doing, "Bash");
  s = reduce(cfg, s, { type: "tool_end", session: "s1", agentId: "a", tool: "Bash", ok: false, error: "exit 1", id: "u1", t: 350 });
  assert.deepEqual([s.agents.a.doing, s.agents.a.lastDurationMs, s.agents.a.errors, s.agents.a.lastError, s.agents.a.toolCount], [undefined, 250, 1, "exit 1", 1]);
  s = reduce(cfg, reduce(cfg, s, tool(400)), { type: "tool_end", session: "s1", tool: "Edit", ok: true, t: 430 });
  assert.deepEqual([s.sessions.s1.lastDurationMs, s.sessions.s1.doing], [30, undefined]);
});

test("agent timing: queue wait and report metrics", () => {
  const s = run({ ...start("a"), t: 0 }, { ...start("b"), t: 0 }, { ...start("c"), t: 0 }, { ...start("d"), t: 0 }, { ...start("e"), t: 10 },
    { type: "tool", session: "s1", agentId: "e", tool: "Bash", t: 11 }, { type: "agent_stop", session: "s1", agentId: "b", t: 50 },
    { type: "agent_stop", session: "s1", agentId: "e", message: "BLOCKED: no db", t: 90 });
  const r = s.log.at(-1)!;
  assert.deepEqual([r.outcome, r.stoppedAt, r.durationMs, r.toolCount, r.queueWaitMs, r.text], ["blocked", 90, 80, 1, 40, "BLOCKED: no db"]);
});

test("outcome parsing", () => {
  const out = (m?: string) => run(start("a"), { type: "agent_stop", session: "s1", agentId: "a", message: m, t: 1 }).log.at(-1)!.outcome;
  assert.deepEqual([out("DONE: ok"), out("blocked - x"), out(""), out("whatever")], ["done", "blocked", "empty", undefined]);
});

test("tasks follow delegate -> start -> stop and are bounded", () => {
  let s = run({ type: "delegate", session: "s1", agentType: "qa-engineer", text: "T", t: 1 });
  assert.equal(s.tasks![0].status, "pending");
  s = reduce(cfg, s, start("a"));
  assert.deepEqual([s.tasks![0].status, s.tasks![0].agentId, s.tasks![0].owner], ["running", "a", "Quinn"]);
  s = reduce(cfg, s, { type: "agent_stop", session: "s1", agentId: "a", message: "DONE", t: 5 });
  assert.deepEqual([s.tasks![0].status, s.tasks![0].endedAt], ["done", 5]);
  let b = emptyState();
  for (let i = 0; i < 50; i++) b = reduce(cfg, b, { type: "delegate", session: "s1", agentType: "qa-engineer", text: `${i}`, t: 1 });
  assert.equal(b.tasks!.length, LIMITS.tasks);
});

test("sweep ends idle sessions with their agents; busy ones survive", () => {
  const s = run(sstart, start("a"), { type: "session_start", session: "s2", project: "x", t: 500 });
  const r = sweep(s, 1000, 600, cfg);
  assert.deepEqual(r.removed, { sessions: ["s1"], agents: ["a"] });
  assert.deepEqual(Object.keys(r.state.sessions), ["s2"]);
});

test("duplicate tool_use_id events are ignored; seq gaps counted", () => {
  const s = run(sstart, start("a"), tool(1, { id: "u", agentId: "a" }), tool(2, { id: "u", agentId: "a" }), { type: "turn_end", session: "s1", t: 3, seq: 1 }, { type: "turn_end", session: "s1", t: 4, seq: 2 }, { type: "turn_end", session: "s1", t: 5, seq: 5 });
  assert.equal(s.sessions.s1.gaps, 1);
  assert.equal(s.sessions.s1.seq, 7);
  assert.equal(s.agents.a.toolCount, 1);
});

test("project labels gain the parent folder only on collision", () => {
  const a: OfficeEvent = { type: "session_start", session: "a", project: "shop", cwd: "/w/one/shop", t: 0 };
  let s = run(a);
  assert.equal(s.sessions.a.project, "shop");
  s = reduce(cfg, s, { type: "session_start", session: "b", project: "shop", cwd: "/w/two/shop", t: 1 });
  assert.deepEqual([s.sessions.a.project, s.sessions.b.project], ["one/shop", "two/shop"]);
  s = reduce(cfg, s, { type: "session_end", session: "b", t: 2 });
  assert.equal(s.sessions.a.project, "shop");
});

test("log is capped per session and pruned on session end", () => {
  let s = run(sstart, { type: "session_start", session: "s2", project: "x", t: 0 }, { type: "prompt", session: "s2", text: "mine", t: 0 });
  for (let i = 0; i < 60; i++) s = reduce(cfg, s, { type: "prompt", session: "s1", text: `${i}`, t: i });
  assert.equal(s.log.filter((i) => i.session === "s1").length, LIMITS.logPerSession);
  assert.equal(s.log.some((i) => i.session === "s2"), true);
  assert.equal(reduce(cfg, s, { type: "session_end", session: "s1", t: 9 }).log.every((i) => i.session === "s2"), true);
});

test("same-file writes by two agents within the window record a possible conflict", () => {
  const w = (agentId: string, t: number, detail = "cart.ts") => tool(t, { agentId, detail });
  let s = run(sstart, start("a"), start("b"), w("a", 1), w("b", 2));
  assert.deepEqual(s.conflicts, [{ file: "cart.ts", a: "a", b: "b", t: 2, kind: "possible" }]);
  s = run(sstart, start("a"), start("b"), w("a", 1), w("b", 1 + LIMITS.conflictWindowMs + 1), w("b", 3, "other.ts"));
  assert.deepEqual(s.conflicts, []);
});

test("capacityFor, childrenOf, parentChain", () => {
  const s = run(start("a"), start("b"), start("c"));
  assert.deepEqual(capacityFor(cfg, s, "qa"), { free: 1, total: 4, canSpawn: true });
  assert.equal(capacityFor(cfg, run(start("a"), start("b"), start("c"), start("d")), "qa").canSpawn, false);
  assert.deepEqual(capacityFor(cfg, s, "guest"), { free: Infinity, total: Infinity, canSpawn: true });
  assert.deepEqual(childrenOf(s, "lead:s1").map((a) => a.id), ["a", "b", "c"]);
  const t = run({ type: "delegate", session: "s1", agentType: "qa-engineer", text: "x", t: 1 }, start("a"),
    { type: "delegate", session: "s1", from: "a", agentType: "qa-engineer", text: "y", t: 1 }, start("b"));
  assert.deepEqual(parentChain(t, "b"), ["a", "lead:s1"]);
});
