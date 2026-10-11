import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, reduce, sweep, capacityFor, childrenOf, parentChain, roleFor, LIMITS } from "./state.ts";
import { deskPos } from "./layout.ts";
import type { OfficeConfig, OfficeEvent } from "./types.ts";

const cfg: OfficeConfig = {
  roles: { qa: { agent: "qa-engineer", count: 2, names: ["Quinn", "Sam"], overflow: { max: 2, names: ["Temp"] } } },
};
const start = (id: string, session = "s1"): OfficeEvent => ({ type: "agent_start", session, agentId: id, agentType: "qa-engineer", t: 0 });
const stop = (id: string): OfficeEvent => ({ type: "agent_stop", session: "s1", agentId: id, t: 0 });
const run = (...evs: OfficeEvent[]) => evs.reduce((s, e) => reduce(cfg, s, e), emptyState());

test("core-team names first, then temps, all on one desk pool", () => {
  const s = run(start("a"), start("b"), start("c"), start("d"), start("e"));
  const ag = ["a", "b", "c", "d", "e"].map((id) => s.agents[id].seat!);
  assert.deepEqual(ag.map((x) => x.kind), ["permanent", "permanent", "overflow", "overflow", "overflow"]);
  assert.deepEqual(ag.slice(0, 2).map((x) => x.name), ["Quinn", "Sam"]);
  // temps are crew members, not "Temp N": distinct people, never a configured core name
  assert.equal(new Set(ag.map((x) => x.name)).size, 5);
  for (const x of ag.slice(2)) assert.ok(!["Quinn", "Sam", "Temp"].includes(x.name) && !/^Temp \d/.test(x.name), x.name);
  assert.equal(new Set(ag.map((x) => x.id)).size, 5);
  assert.deepEqual(s.queue, []);
});

test("a freed core slot is reused by the next agent of that role", () => {
  const s = run(start("a"), start("b"), start("c"), stop("a"), start("d"));
  assert.equal(s.agents.d.seat?.name, "Quinn");
});

test("unmapped agent types keep their bare type as role and sit at their own desk", () => {
  const ev = (i: number): OfficeEvent => ({ type: "agent_start", session: "s1", agentId: `x${i}`, agentType: i % 2 ? "plugin:Mystery" : "general-purpose", t: 0 });
  assert.equal(roleFor(cfg, "plugin:Mystery"), "mystery");
  assert.equal(roleFor(cfg, "agent-office:qa-engineer"), "qa");
  const s = Array.from({ length: 30 }, (_, i) => ev(i)).reduce((st, e) => reduce(cfg, st, e), emptyState());
  const seats = Object.values(s.agents).map((a) => a.seat!);
  assert.equal(seats.length, 30);
  assert.equal(new Set(seats.map((x) => x.id)).size, 30);
  assert.equal(new Set(seats.map((x) => JSON.stringify(deskPos(Number(x.id.slice(1)))))).size, 30);
  assert.equal(s.agents.x0.role, "general-purpose");
  assert.equal(s.agents.x0.seat?.kind, "overflow");
  const names = seats.map((x) => x.name);
  assert.equal(new Set(names).size, 30, "30 workers, 30 different people");
  assert.ok(names.every((n) => n !== "general-purpose" && n !== "mystery"));
});

test("same-session agents share a pod; a new session takes an empty pod", () => {
  const pod = (s: ReturnType<typeof run>, id: string) => Math.floor(Number(s.agents[id].seat!.id.slice(1)) / 4);
  const s = run(start("a"), start("b"), start("c"), start("d"), start("e", "s2"), start("f", "s2"), start("g"));
  assert.deepEqual(["a", "b", "c", "d"].map((i) => pod(s, i)), [0, 0, 0, 0]);
  assert.equal(pod(s, "e"), 1);
  assert.equal(pod(s, "f"), 1);
  assert.notEqual(pod(s, "g"), 0); // its pod is full, spills next to the mates
});

test("allocation is deterministic across replays", () => {
  const evs = ["a", "b", "c", "d", "e", "f"].map((id, i) => start(id, i % 2 ? "s2" : "s1"));
  const seats = (s: ReturnType<typeof run>) => Object.values(s.agents).map((a) => a.seat?.id);
  assert.deepEqual(seats(run(...evs, stop("c"), start("g"))), seats(run(...evs, stop("c"), start("g"))));
});

test("the 65th agent queues and a freed desk promotes it", () => {
  const ids = Array.from({ length: 65 }, (_, i) => `a${i}`);
  const s = run(...ids.map((id, i) => start(id, `s${i % 5}`)));
  assert.equal(s.agents.a64.seat, null);
  assert.deepEqual(s.queue, ["a64"]);
  assert.equal(capacityFor(cfg, s, "qa").canSpawn, false);
  const after = reduce(cfg, s, { type: "agent_stop", session: "s0", agentId: "a0", t: 0 });
  assert.equal(after.agents.a64.seat?.id, s.agents.a0.seat?.id);
  assert.deepEqual(after.queue, []);
});

test("session_end removes its agents and frees seats for others", () => {
  const s = run(start("a", "s1"), start("b", "s1"), start("c", "s2"), start("d", "s2"), start("e", "s2"),
    { type: "session_end", session: "s1", t: 0 });
  assert.equal(Object.keys(s.agents).length, 3);
  assert.deepEqual(s.queue, []);
  assert.equal(s.agents.e.seat?.kind, "overflow"); // seated agents keep their desk
});

test("namespaced plugin agent types map to their role", () => {
  const s = reduce(cfg, emptyState(), { type: "agent_start", session: "s1", agentId: "p", agentType: "agent-office:qa-engineer", t: 0 });
  assert.equal(s.agents.p.role, "qa");
  assert.equal(s.agents.p.seat?.name, "Quinn");
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
  const fill = Array.from({ length: 64 }, (_, i) => ({ ...start(`f${i}`), t: 0 }));
  const s = run(...fill, { ...start("e"), t: 10 },
    { type: "tool", session: "s1", agentId: "e", tool: "Bash", t: 11 }, { type: "agent_stop", session: "s1", agentId: "f1", t: 50 },
    { type: "agent_stop", session: "s1", agentId: "e", message: "BLOCKED: no db", t: 90 });
  const r = s.log.at(-1)!;
  assert.deepEqual([r.outcome, r.stoppedAt, r.durationMs, r.toolCount, r.queueWaitMs, r.text], ["blocked", 90, 80, 1, 40, "BLOCKED: no db"]);
});

test("outcome parsing", () => {
  const out = (m?: string) => run(start("a"), { type: "agent_stop", session: "s1", agentId: "a", message: m, t: 1 }).log.at(-1)!.outcome;
  assert.deepEqual([out("DONE: ok"), out("blocked - x"), out(""), out("whatever")], ["done", "blocked", "empty", undefined]);
  assert.equal(out("PARTIAL: half the tests"), "partial");
  const p = run(start("a"), { type: "agent_stop", session: "s1", agentId: "a", message: "partial: x", t: 1 });
  assert.notEqual(p.tasks?.at(-1)?.status ?? "done", "blocked");
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
  assert.deepEqual(capacityFor(cfg, s, "qa"), { free: 61, total: 64, canSpawn: true });
  assert.deepEqual(capacityFor(cfg, s, "mystery"), { free: 61, total: 64, canSpawn: true });
  assert.deepEqual(childrenOf(s, "lead:s1").map((a) => a.id), ["a", "b", "c"]);
  const t = run({ type: "delegate", session: "s1", agentType: "qa-engineer", text: "x", t: 1 }, start("a"),
    { type: "delegate", session: "s1", from: "a", agentType: "qa-engineer", text: "y", t: 1 }, start("b"));
  assert.deepEqual(parentChain(t, "b"), ["a", "lead:s1"]);
});

test("pod cohesion: 4 interleaved sessions x 6 same-role agents each own a pod; no desk is shared", () => {
  const ids = Array.from({ length: 24 }, (_, i) => ({ id: `a${i}`, s: `s${i % 4}` }));
  const run1 = () => run(...ids.map((x) => start(x.id, x.s)));
  const s = run1();
  const pod = (id: string) => Math.floor(Number(s.agents[id].seat!.id.slice(1)) / 4);
  for (let k = 0; k < 4; k++) {
    const mine = ids.filter((x) => x.s === `s${k}`).map((x) => x.id);
    assert.equal(new Set(mine.slice(0, 4).map(pod)).size, 1, `s${k} first 4 share a pod`);
  }
  const firstPods = [0, 1, 2, 3].map((k) => pod(ids.find((x) => x.s === `s${k}`)!.id));
  assert.equal(new Set(firstPods).size, 4);
  assert.equal(new Set(Object.values(s.agents).map((a) => a.seat!.id)).size, 24);
  assert.deepEqual(Object.values(run1().agents).map((a) => a.seat!.id), Object.values(s.agents).map((a) => a.seat!.id));
});

test("70 interleaved agents: 64 seated on distinct desks, 6 queued", () => {
  const s = run(...Array.from({ length: 70 }, (_, i) => start(`a${i}`, `s${i % 5}`)));
  assert.equal(new Set(Object.values(s.agents).filter((a) => a.seat).map((a) => a.seat!.id)).size, 64);
  assert.equal(s.queue.length, 6);
});

test("every seat the allocator hands out is a desk the layout actually builds (no one sits on open floor)", async () => {
  const { buildLayout } = await import("./layout.ts");
  const big: OfficeConfig = { roles: { qa: { agent: "qa-engineer", count: 2, names: ["Quinn", "Sam"] }, backend: { agent: "backend-dev", count: 2 } } };
  const mk = (id: string, session: string, type: string): OfficeEvent => ({ type: "agent_start", session, agentId: id, agentType: type, t: 0 });
  // the sample scenario that seated Sam at d24 (below Quinn) with only 16 desks built, then growth and shrink
  let s = emptyState();
  const check = (why: string) => {
    const agents = Object.keys(s.agents).length;
    let top = -1;
    for (const a of Object.values(s.agents)) if (a.seat) top = Math.max(top, Number(a.seat.id.slice(1)));
    const l = buildLayout(big, { demand: { agents }, minDesks: top + 1 });
    const built = new Set(l.props.map((p) => p.seat));
    for (const a of Object.values(s.agents)) if (a.seat) assert.ok(built.has(a.seat.id), `${why}: ${a.id} seat ${a.seat.id} has no desk (built ${l.props.length})`);
  };
  const steps: OfficeEvent[] = [
    mk("dev", "demo1", "backend-dev"), mk("maya", "demo1", "frontend-dev"), mk("quinn", "demo1", "qa-engineer"), mk("sam", "demo2", "qa-engineer"),
    ...Array.from({ length: 40 }, (_, i) => mk(`g${i}`, `s${i % 5}`, i % 3 ? "general-purpose" : "qa-engineer")),
  ];
  for (const [i, e] of steps.entries()) { s = reduce(big, s, e); check(`add ${i}`); }
  for (const id of ["g3", "g10", "g20", "quinn", "g30"]) { s = reduce(big, s, { type: "agent_stop", session: s.agents[id].session, agentId: id, t: 0 } as OfficeEvent); check(`stop ${id}`); }
});

test("crew names are deterministic per project|role|slot, unique among live agents, and need no stored data", () => {
  const start = (id: string, session: string, type = "general-purpose"): OfficeEvent => ({ type: "agent_start", session, agentId: id, agentType: type, t: 0 });
  const sess = (id: string, cwd: string): OfficeEvent => ({ type: "session_start", session: id, project: cwd.split("/").pop()!, cwd, t: 0 });
  const runA = [sess("sA", "/work/shop"), start("a1", "sA"), start("a2", "sA"), start("a3", "sA")].reduce((s, e) => reduce(cfg, s, e), emptyState());
  // a different run (new session id, new agent ids) in the same project gets the same crew in the same order
  const runB = [sess("sB", "/work/shop"), start("b1", "sB"), start("b2", "sB"), start("b3", "sB")].reduce((s, e) => reduce(cfg, s, e), emptyState());
  const n = (s: typeof runA, ids: string[]) => ids.map((id) => s.agents[id].seat!.name);
  assert.deepEqual(n(runA, ["a1", "a2", "a3"]), n(runB, ["b1", "b2", "b3"]));
  assert.equal(new Set(n(runA, ["a1", "a2", "a3"])).size, 3);
  // another project gets (very likely) different people for the same slots
  const runC = [sess("sC", "/work/landing-page"), start("c1", "sC"), start("c2", "sC"), start("c3", "sC")].reduce((s, e) => reduce(cfg, s, e), emptyState());
  assert.notDeepEqual(n(runA, ["a1", "a2", "a3"]), n(runC, ["c1", "c2", "c3"]));
  // 60 workers across projects: still all different
  let s = emptyState();
  for (let i = 0; i < 60; i++) s = reduce(cfg, s, start(`w${i}`, `s${i % 4}`, i % 2 ? "reviewer" : "general-purpose"));
  assert.equal(new Set(Object.values(s.agents).map((a) => a.seat!.name)).size, 60);
});

test("a retried event (same forwarder seq) is not reported as a gap", () => {
  const s = run(
    { ...sstart, seq: 1 } as OfficeEvent,
    { type: "turn_end", session: "s1", t: 1, seq: 2 },
    { type: "turn_end", session: "s1", t: 2, seq: 2 }, // retry
    { type: "turn_end", session: "s1", t: 3, seq: 3 },
  );
  assert.equal(s.sessions.s1.gaps ?? 0, 0);
});

test("allocator keeps a session in its own pod even when an earlier pod has emptied", () => {
  const big: OfficeConfig = { roles: {} };
  const mk = (id: string, session: string): OfficeEvent => ({ type: "agent_start", session, agentId: id, agentType: "general-purpose", t: 0 });
  let s = emptyState();
  for (let i = 0; i < 8; i++) s = reduce(big, s, mk(`a${i}`, "s1"));        // s1 fills pods 0 and 1
  s = reduce(big, s, mk("b0", "s2"));                                        // s2 opens pod 2
  const own = Number(s.agents.b0.seat!.id.slice(1));
  for (let i = 4; i < 8; i++) s = reduce(big, s, { type: "agent_stop", session: "s1", agentId: `a${i}`, t: 1 } as OfficeEvent); // pod 1 empties
  s = reduce(big, s, mk("b1", "s2"));
  const next = Number(s.agents.b1.seat!.id.slice(1));
  assert.equal(Math.floor(next / 4), Math.floor(own / 4), "second s2 agent shares s2's pod");
});

test("a stop that arrives before its start does not leave a ghost agent holding a desk", () => {
  const s = run(sstart, stop("g"), start("g"));
  assert.equal(s.agents.g, undefined);
  const live = run(sstart, start("h"), stop("h"), start("h")); // a replayed start after the stop
  assert.equal(live.agents.h, undefined);
  assert.equal(capacityFor(cfg, live).free, capacityFor(cfg, run(sstart)).free, "no desk is held");
});

test("a broken clock does not reap sessions and a backwards stop time never gives a negative duration", () => {
  const s = run(sstart, start("a"));
  const r = sweep(s, Number.NaN, 1000);
  assert.deepEqual(r.removed.sessions, []);
  assert.ok(r.state.sessions.s1);
  const back = run(sstart, { ...start("b"), t: 100 } as OfficeEvent, { type: "agent_stop", session: "s1", agentId: "b", message: "DONE: x", t: 40 } as OfficeEvent);
  const rep = back.log.find((i) => i.kind === "report");
  assert.ok(rep && (rep.durationMs ?? 0) >= 0, String(rep?.durationMs));
});

test("idle notification clears a tool and prompt whose end was never reported (interrupt)", () => {
  let s = emptyState();
  const run = (e: OfficeEvent) => { s = reduce(cfg, s, e); };
  run({ type: "session_start", session: "s", t: 1 } as OfficeEvent);
  run({ type: "prompt", session: "s", text: "go", t: 2 });
  run({ type: "tool", session: "s", tool: "Bash", t: 3 } as OfficeEvent);
  run({ type: "waiting", session: "s", text: "needs input", t: 4 });
  assert.equal(s.sessions.s.doing, "Bash"); // an ordinary notification changes nothing about the tool
  run({ type: "waiting", session: "s", idle: true, t: 5 });
  assert.equal(s.sessions.s.doing, undefined);
  assert.equal(s.sessions.s.prompt, undefined);
  assert.equal(s.sessions.s.waiting, true);
});

test("idle notification also clears a subagent's stuck tool in that session, and only that session", () => {
  let s = emptyState();
  const run = (e: OfficeEvent) => { s = reduce(cfg, s, e); };
  run({ type: "session_start", session: "a", t: 1 } as OfficeEvent);
  run({ type: "session_start", session: "b", t: 1 } as OfficeEvent);
  run({ type: "agent_start", session: "a", agentId: "x1", agentType: "qa-engineer", t: 2 } as OfficeEvent);
  run({ type: "agent_start", session: "b", agentId: "y1", agentType: "qa-engineer", t: 2 } as OfficeEvent);
  run({ type: "tool", session: "a", agentId: "x1", tool: "Bash", t: 3 } as OfficeEvent);
  run({ type: "tool", session: "b", agentId: "y1", tool: "Bash", t: 3 } as OfficeEvent);
  run({ type: "waiting", session: "a", idle: true, t: 4 });
  const doing = (id: string) => Object.values(s.agents).find((a) => a.id === id || a.id.endsWith(id))?.doing;
  assert.equal(doing("x1"), undefined);
  assert.equal(doing("y1"), "Bash");
});

const wait = (text: string, kind?: "permission" | "turn"): OfficeEvent => ({ type: "waiting", session: "s1", text, kind, t: 1 });
const lead = (o: object) => ({ session: "s1", t: 2, ...o }) as OfficeEvent;

test("Z4: the lead's tool_end, turn_end or prompt clears waiting and waitKind", () => {
  for (const e of [lead({ type: "tool_end", tool: "Bash", ok: true }), lead({ type: "turn_end" }), lead({ type: "prompt", text: "go" }), lead({ type: "tool", tool: "Read" })]) {
    const s = run(lead({ type: "session_start", project: "p" }), wait("Claude needs your permission to use Bash", "permission"), e);
    assert.equal(s.sessions.s1.waiting, false, e.type);
    assert.equal(s.sessions.s1.waitKind, undefined, e.type);
  }
});

test("Z5: a subagent's tool or tool_end never clears the lead's waiting", () => {
  const s = run(lead({ type: "session_start", project: "p" }), start("a"), wait("Claude needs your permission to use Bash", "permission"),
    lead({ type: "tool", agentId: "a", tool: "Read" }), lead({ type: "tool_end", agentId: "a", tool: "Read", ok: true }), lead({ type: "tool_end", agentId: "ghost", tool: "Read", ok: true }));
  assert.equal(s.sessions.s1.waiting, true);
  assert.equal(s.sessions.s1.waitKind, "permission");
});

test("waitKind: explicit kind wins; without one, only text naming a permission is a permission", () => {
  assert.equal(run(wait("x", "turn")).sessions.s1.waitKind, "turn");
  assert.equal(run(wait("Claude needs your permission to use Edit")).sessions.s1.waitKind, "permission");
  assert.equal(run(wait("Claude is waiting for your input")).sessions.s1.waitKind, "turn");
});

test("outcomes: newest first, one-line result plus task, bounded, kept after the session ends; agents carry lastAt", () => {
  let s = run(lead({ type: "session_start", project: "p" }), lead({ type: "delegate", agentType: "qa-engineer", text: "test checkout" }), { ...start("a"), t: 5 });
  assert.equal(s.agents.a.lastAt, 5);
  s = reduce(cfg, s, lead({ type: "tool", agentId: "a", tool: "Bash", t: 9 }));
  assert.equal(s.agents.a.lastAt, 9);
  s = reduce(cfg, s, { type: "agent_stop", session: "s1", agentId: "a", message: "DONE: checkout passes", t: 65_000 });
  assert.deepEqual(s.outcomes![0], { session: "s1", project: "p", agentId: "a", name: "Quinn", role: "qa", outcome: "done", text: "DONE: checkout passes", task: "test checkout", t: 65_000, durationMs: 64_995 });
  s = reduce(cfg, s, { type: "session_end", session: "s1", t: 70_000 });
  assert.equal(s.outcomes!.length, 1);
  for (let i = 0; i < 40; i++) s = reduce(cfg, reduce(cfg, s, { ...start(`b${i}`), t: i }), { type: "agent_stop", session: "s1", agentId: `b${i}`, message: `PARTIAL: ${i}`, t: 100 + i });
  assert.equal(s.outcomes!.length, LIMITS.outcomes);
  assert.equal(s.outcomes![0].text, "PARTIAL: 39");
});

test("a usage event updates the session's running total, never lowering it", () => {
  const u = { input: 1, output: 2, cacheRead: 3, cacheCreate: 4 };
  assert.deepEqual(run(lead({ type: "usage", usage: u })).sessions.s1.usage, u);
  const less = { input: 1, output: 0, cacheRead: 0, cacheCreate: 0 };
  assert.deepEqual(run(lead({ type: "usage", usage: u }), lead({ type: "usage", usage: less }), lead({ type: "turn_end", usage: less })).sessions.s1.usage, u, "never shrinks");
});
