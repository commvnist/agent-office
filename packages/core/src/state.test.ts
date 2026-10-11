import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, reduce, sweep, capacityFor, childrenOf, parentChain, roleFor, LIMITS } from "./state.ts";
import { deskPos, FLOOR_DESKS, MAX_DESKS } from "./layout.ts";
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

test("the agent past the last floor queues and a freed desk promotes it", () => {
  const ids = Array.from({ length: MAX_DESKS + 1 }, (_, i) => `a${i}`);
  const s = run(...ids.map((id, i) => start(id, `s${i % 5}`)));
  const last = `a${MAX_DESKS}`;
  assert.equal(s.agents[last].seat, null);
  assert.deepEqual(s.queue, [last]);
  assert.equal(capacityFor(cfg, s, "qa").canSpawn, false);
  const after = reduce(cfg, s, { type: "agent_stop", session: "s0", agentId: "a0", t: 0 });
  assert.equal(after.agents[last].seat?.id, s.agents.a0.seat?.id);
  assert.deepEqual(after.queue, []);
});

test("floors: demand past 64 desks opens floor 2 (d64..), seated agents never move, a session keeps to its floor", () => {
  const floor = (s: ReturnType<typeof run>, id: string) => Math.floor(Number(s.agents[id].seat!.id.slice(1)) / FLOOR_DESKS);
  // 8 sessions x 8 agents fill floor 1, then more arrive: every earlier seat stays where it was
  const evs = Array.from({ length: 64 }, (_, i) => start(`a${i}`, `s${i % 8}`));
  let s = run(...evs);
  const before = Object.fromEntries(Object.values(s.agents).map((a) => [a.id, a.seat!.id]));
  assert.ok(Object.values(before).every((d) => Number(d.slice(1)) < FLOOR_DESKS));
  for (let i = 0; i < 12; i++) {
    s = reduce(cfg, s, start(`b${i}`, i < 6 ? "s9" : "s0"));
    for (const [id, d] of Object.entries(before)) assert.equal(s.agents[id].seat!.id, d, `${id} moved`);
  }
  for (let i = 0; i < 6; i++) assert.equal(floor(s, `b${i}`), 1, "a new session opens floor 2");
  assert.deepEqual(new Set(Array.from({ length: 6 }, (_, i) => floor(s, `b${i}`))).size, 1);
  // a desk frees on floor 1: the floor-2 session still grows on floor 2, a floor-1 session takes the floor-1 desk
  s = reduce(cfg, s, { type: "agent_stop", session: "s1", agentId: "a1", t: 0 });
  s = reduce(cfg, s, start("c0", "s9"));
  assert.equal(floor(s, "c0"), 1);
  s = reduce(cfg, s, start("c1", "s1"));
  assert.equal(floor(s, "c1"), 0);
  assert.equal(s.queue.length, 0);
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
  assert.deepEqual(["a", "b", "c", "z"].map((i) => s.agents[i].confidence), ["exact", "guess", "guess", "guess"], "S6: the last of parallel delegations is still a guess");
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
  const fill = Array.from({ length: MAX_DESKS }, (_, i) => ({ ...start(`f${i}`), t: 0 }));
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
  assert.deepEqual(capacityFor(cfg, s, "qa"), { free: MAX_DESKS - 3, total: MAX_DESKS, canSpawn: true });
  assert.deepEqual(capacityFor(cfg, s, "mystery"), { free: MAX_DESKS - 3, total: MAX_DESKS, canSpawn: true });
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

test("interleaved agents past the last floor: every desk seated once, 6 queued", () => {
  const s = run(...Array.from({ length: MAX_DESKS + 6 }, (_, i) => start(`a${i}`, `s${i % 5}`)));
  assert.equal(new Set(Object.values(s.agents).filter((a) => a.seat).map((a) => a.seat!.id)).size, MAX_DESKS);
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
  for (const e of [lead({ type: "tool_end", tool: "Bash", ok: true }), lead({ type: "prompt", text: "go" }), lead({ type: "tool", tool: "Read" })]) {
    const s = run(lead({ type: "session_start", project: "p" }), wait("Claude needs your permission to use Bash", "permission"), e);
    assert.equal(s.sessions.s1.waiting, false, e.type);
    assert.equal(s.sessions.s1.waitKind, undefined, e.type);
    assert.deepEqual(s.sessions.s1.waits, [], e.type);
  }
  const s = run(lead({ type: "session_start", project: "p" }), wait("Claude needs your permission to use Bash", "permission"), lead({ type: "turn_end" }));
  assert.deepEqual([s.sessions.s1.waitKind, s.sessions.s1.waitSoft], ["turn", true], "S9: turn_end ends the permission and opens a calm your-turn");
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
  assert.equal(run(wait("Claude needs your permission to use AskUserQuestion")).sessions.s1.waitKind, "turn", "a question asks for an answer");
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

test("a stop without a message takes the report the agent handed back", () => {
  let s = run(lead({ type: "session_start", project: "p" }), { ...start("a"), t: 5 });
  s = reduce(cfg, s, lead({ type: "tool", agentId: "a", tool: "SubagentHandback", message: "BLOCKED: no access", t: 9 }));
  s = reduce(cfg, s, { type: "agent_stop", session: "s1", agentId: "a", t: 10 });
  assert.equal(s.outcomes![0].outcome, "blocked");
  assert.equal(s.outcomes![0].text, "BLOCKED: no access");
});

test("a usage event updates the session's running total, never lowering it", () => {
  const u = { input: 1, output: 2, cacheRead: 3, cacheCreate: 4 };
  assert.deepEqual(run(lead({ type: "usage", usage: u })).sessions.s1.usage, u);
  const less = { input: 1, output: 0, cacheRead: 0, cacheCreate: 0 };
  assert.deepEqual(run(lead({ type: "usage", usage: u }), lead({ type: "usage", usage: less }), lead({ type: "turn_end", usage: less })).sessions.s1.usage, u, "never shrinks");
});

test("permWait counts permission waits until the lead's next event; turn waits are not counted", () => {
  const s0 = run({ type: "session_start", session: "s1", project: "p", t: 0 },
    { type: "waiting", session: "s1", kind: "permission", t: 100 },
    { type: "waiting", session: "s1", kind: "permission", t: 150 }); // a repeated prompt keeps its start
  assert.deepEqual(s0.sessions.s1.permWait, { n: 0, totalMs: 0, since: 100 });
  const s1 = reduce(cfg, reduce(cfg, s0, { type: "tool", session: "s1", agentId: "x", tool: "Read", t: 200 }), { type: "tool", session: "s1", tool: "Bash", t: 400 });
  assert.deepEqual(s1.sessions.s1.permWait, { n: 1, totalMs: 300, lastMs: 300 }, "a helper's event does not end it, the lead's does");
  const s2 = [{ type: "waiting", session: "s1", kind: "turn", t: 500 }, { type: "prompt", session: "s1", text: "go", t: 900 },
    { type: "waiting", session: "s1", kind: "permission", t: 1000 }, { type: "turn_end", session: "s1", t: 1100 }]
    .reduce((s, e) => reduce(cfg, s, e as OfficeEvent), s1);
  assert.deepEqual(s2.sessions.s1.permWait, { n: 2, totalMs: 400, lastMs: 100 });
});

test("toolStats: p50/p95 and failures per tool from finished calls, bounded", () => {
  let s = run({ type: "session_start", session: "s1", project: "p", t: 0 });
  for (let i = 1; i <= 100; i++) {
    s = reduce(cfg, s, { type: "tool", session: "s1", tool: "Bash", id: `b${i}`, t: i * 1000 });
    s = reduce(cfg, s, { type: "tool_end", session: "s1", tool: "Bash", id: `b${i}`, ok: i % 10 !== 0, t: i * 1000 + i });
  }
  assert.deepEqual(s.sessions.s1.toolStats!.Bash, { n: 64, fail: 7, p50: 68, p95: 97 }, "last 64 calls: 37..100 ms, 40..100 by 10 failed");
  for (let i = 0; i < 40; i++) {
    s = reduce(cfg, s, { type: "tool", session: "s1", tool: `T${i}`, id: `t${i}`, t: 200_000 });
    s = reduce(cfg, s, { type: "tool_end", session: "s1", tool: `T${i}`, id: `t${i}`, ok: true, t: 200_005 });
  }
  const st = s.sessions.s1.toolStats!;
  assert.equal(Object.keys(st).length, LIMITS.toolStats);
  assert.ok(st.Bash, "the well-sampled tool survives eviction");
  assert.equal(Object.keys(s.track!.runs!.s1.tools).length, LIMITS.toolStats);
});

test("an ended session leaves an after-action summary with no free text", () => {
  const evs: OfficeEvent[] = [
    { type: "session_start", session: "s1", project: "p", cwd: "/w/proj", t: 1000 },
    { type: "delegate", session: "s1", agentType: "qa-engineer", text: "SECRET TASK", t: 1100 },
    { ...start("a"), t: 1150 }, { ...start("b"), t: 1150 },
    { type: "tool", session: "s1", agentId: "a", tool: "Bash", detail: "SECRET CMD", id: "x", t: 1200 },
    { type: "tool_end", session: "s1", agentId: "a", tool: "Bash", ok: false, error: "SECRET ERR", id: "x", t: 1300 },
    { type: "agent_stop", session: "s1", agentId: "a", message: "DONE: SECRET RESULT", t: 1400 },
    { type: "agent_stop", session: "s1", agentId: "b", outcome: "partial", t: 1500 }, // stored line without text
    { type: "waiting", session: "s1", kind: "permission", t: 1600 },
    { type: "tool", session: "s1", tool: "Read", t: 1700 },
    { type: "usage", session: "s1", usage: { input: 1, output: 2, cacheRead: 0, cacheCreate: 0 }, t: 1800 },
    { type: "session_end", session: "s1", t: 2000 },
  ];
  const s = run(...evs);
  assert.equal(s.track!.runs!.s1, undefined);
  const [sum] = s.summaries!;
  assert.deepEqual({ ...sum, tree: sum.tree.map((x) => [x.id, x.name, x.role, x.parent]) }, {
    session: "s1", project: "proj", startedAt: 1000, endedAt: 2000, durationMs: 1000, agents: 2,
    tree: [["a", "Quinn", "qa", "lead:s1"], ["b", "Sam", "qa", "lead:s1"]], errors: 1,
    permission: { n: 1, totalMs: 100 }, outcomes: { done: 1, blocked: 0, partial: 1, empty: 0 }, usage: { input: 1, output: 2, cacheRead: 0, cacheCreate: 0 },
  });
  assert.ok(!JSON.stringify(s.summaries).includes("SECRET"));
  const swept = sweep(run({ type: "session_start", session: "s9", project: "q", t: 0 }), 10_000, 1000).state;
  assert.equal(swept.summaries![0].session, "s9", "the idle sweep writes one too");
  const many = Array.from({ length: 25 }, (_, i) => [{ type: "session_start", session: `z${i}`, project: "p", t: i }, { type: "session_end", session: `z${i}`, t: i }] as OfficeEvent[]).flat();
  assert.equal(run(...many).summaries!.length, LIMITS.summaries);
});

test("S1: a helper's permission wait is attributed to it (waitBy); only that helper's next event or stop ends it", () => {
  const helperWait: OfficeEvent = { type: "waiting", session: "s1", agentId: "a", kind: "permission", t: 100 };
  let s = run(lead({ type: "session_start", project: "p" }), start("a"), start("b"), helperWait);
  assert.equal(s.sessions.s1.waitBy, "a");
  s = reduce(cfg, s, lead({ type: "tool", tool: "Read", t: 150 }));
  s = reduce(cfg, s, lead({ type: "tool", agentId: "b", tool: "Read", t: 160 }));
  assert.equal(s.sessions.s1.waiting, true, "neither the lead nor another helper answers a helper's prompt");
  s = reduce(cfg, s, lead({ type: "tool_end", agentId: "a", tool: "Bash", ok: true, t: 400 }));
  assert.equal(s.sessions.s1.waiting, false);
  assert.equal(s.sessions.s1.waitBy, undefined);
  assert.deepEqual(s.sessions.s1.permWait, { n: 1, totalMs: 300, lastMs: 300 }, "latency is the helper's");
  const stopped = reduce(cfg, reduce(cfg, s, { ...helperWait, t: 500 }), { type: "agent_stop", session: "s1", agentId: "a", t: 600 });
  assert.equal(stopped.sessions.s1.waiting, false, "the helper's stop ends its wait");
  const leadWait = run(lead({ type: "session_start", project: "p" }), wait("Claude needs your permission to use Bash", "permission"));
  assert.equal(leadWait.sessions.s1.waitBy, undefined);
});

test("S2: a helper with no SubagentStart is created as recovered (never drawn as the lead) and its stop files an outcome", () => {
  let s = run(lead({ type: "session_start", project: "p" }), lead({ type: "delegate", agentType: "qa-engineer", text: "find it", t: 1 }),
    lead({ type: "tool", agentId: "h9", tool: "Grep", t: 3 }));
  assert.equal(s.sessions.s1.doing, undefined, "the lead is not doing the helper's tool");
  assert.equal(s.agents.h9.recovered, true);
  assert.equal(s.agents.h9.role, "qa");
  assert.equal(s.agents.h9.task, "find it");
  assert.equal(s.agents.h9.doing, "Grep");
  s = reduce(cfg, s, { type: "agent_stop", session: "s1", agentId: "h9", message: "BLOCKED: no access", t: 9 });
  assert.equal(s.outcomes![0].agentId, "h9");
  assert.equal(s.outcomes![0].outcome, "blocked");
  assert.equal(reduce(cfg, s, lead({ type: "tool_end", agentId: "h9", tool: "Grep", ok: true, t: 10 })).agents.h9, undefined, "a late tool_end does not bring it back");
  assert.equal(reduce(cfg, s, { type: "agent_stop", session: "s1", agentId: "h9", t: 11 }).outcomes!.length, 1, "a repeated stop files nothing");
  const bare = run(lead({ type: "session_start", project: "p" }), lead({ type: "tool", agentId: "z", tool: "Read" }));
  assert.equal(bare.agents.z.role, "unknown");
});

test("C4: a lead's finished turn keeps its prompt and result and files a lead outcome; an unprefixed answer is neutral", () => {
  let s = run(lead({ type: "session_start", project: "p" }), lead({ type: "prompt", text: "fix the build", t: 1000 }));
  assert.equal(s.sessions.s1.promptAt, 1000);
  s = reduce(cfg, s, lead({ type: "turn_end", message: "The build passes now.\nDetails...", t: 4000 }));
  const x = s.sessions.s1;
  assert.deepEqual([x.prompt, x.lastPrompt, x.result, x.turnAt], [undefined, "fix the build", "The build passes now.", 4000]);
  assert.deepEqual(s.outcomes![0], { session: "s1", project: "p", agentId: "lead:s1", lead: true, outcome: undefined, text: "The build passes now.", task: "fix the build", t: 4000, durationMs: 3000 });
  s = reduce(cfg, s, lead({ type: "turn_end", outcome: "blocked", t: 5000 })); // a stored line without text keeps its stamped outcome
  assert.equal(s.outcomes!.length, 1, "no prompt and no message: nothing to file");
  s = reduce(cfg, s, lead({ type: "prompt", text: "next", t: 6000 }));
  assert.deepEqual([s.sessions.s1.lastPrompt, s.sessions.s1.result], ["next", undefined]);
  s = reduce(cfg, s, lead({ type: "turn_end", message: "BLOCKED: no network", t: 7000 }));
  assert.equal(s.outcomes![0].outcome, "blocked");
  s = reduce(cfg, s, { type: "session_end", session: "s1", t: 8000 });
  assert.deepEqual([s.summaries![0].prompt, s.summaries![0].result], ["next", "BLOCKED: no network"]);
});

test("C5: a question is your turn without ending the turn (prompt and helpers keep running)", () => {
  const s = run(lead({ type: "session_start", project: "p" }), lead({ type: "prompt", text: "go" }), start("a"), lead({ type: "tool", agentId: "a", tool: "Bash" }),
    { type: "waiting", session: "s1", kind: "turn", text: "Claude needs your permission to use AskUserQuestion", t: 3 });
  assert.deepEqual([s.sessions.s1.waiting, s.sessions.s1.waitKind, s.sessions.s1.prompt, s.agents.a.doing], [true, "turn", "go", "Bash"]);
});

test("S6 + C7: the sweep ends a summary at the last event, and reaps a ghost helper once its lead finished a later turn", () => {
  const ttl = 45 * 60_000;
  const swept = sweep(run({ type: "session_start", session: "s9", project: "q", t: 0 }, { type: "turn_end", session: "s9", t: 6 * 60_000 }), 2 * 3600_000, ttl).state;
  assert.equal(swept.summaries![0].endedAt, 6 * 60_000);
  assert.equal(swept.summaries![0].durationMs, 6 * 60_000);
  const s = run(lead({ type: "session_start", project: "p", t: 0 }), { ...start("ghost"), t: 0 }, { ...start("busy"), t: 0 },
    lead({ type: "turn_end", t: 60_000 }), lead({ type: "tool", agentId: "busy", tool: "Read", t: 70_000 }), lead({ type: "tool", tool: "Read", t: 19 * 60_000 }));
  const early = sweep(s, 10 * 60_000, ttl);
  assert.ok(early.state.agents.ghost, "not yet silent for ttl/3");
  const r = sweep(s, 20 * 60_000, ttl);
  assert.deepEqual(r.removed, { sessions: [], agents: ["ghost"] });
  assert.ok(r.state.agents.busy, "a helper active after the lead's last turn_end stays");
  assert.ok(r.state.sessions.s1);
});

// ---- Pass 5 ----
const h = (o: object) => ({ session: "s1", t: 0, ...o }) as OfficeEvent;
const perm = (agentId: string | undefined, t: number) => h({ type: "waiting", agentId, kind: "permission", text: "Claude needs your permission to use Bash", t });
const waitsOf = (s: ReturnType<typeof run>) => (s.sessions.s1.waits ?? []).map((w) => `${w.agent}:${w.kind}${w.soft ? "~" : ""}`);

test("S3: waits per agent; each agent's own event closes only its own (probes 1, 1b, 11)", () => {
  // 1: two helpers ask; approving h2 leaves h1's prompt open
  let s = run(h({ type: "session_start", project: "p" }), start("h1"), start("h2"), perm("h1", 1), perm("h2", 2), h({ type: "tool", agentId: "h2", tool: "Bash", t: 3 }));
  assert.deepEqual(waitsOf(s), ["h1:permission"]);
  assert.deepEqual([s.sessions.s1.waiting, s.sessions.s1.waitKind, s.sessions.s1.waitBy], [true, "permission", "h1"]);
  // 1b: a helper's prompt, then the lead's; the lead is approved, the helper still waits
  s = run(h({ type: "session_start", project: "p" }), start("h1"), perm("h1", 1), perm(undefined, 2));
  assert.deepEqual(waitsOf(s), ["h1:permission", "lead:s1:permission"]);
  assert.equal(s.sessions.s1.waitBy, "h1", "most urgent: the oldest permission");
  s = reduce(cfg, s, h({ type: "tool", tool: "Bash", t: 3 }));
  assert.deepEqual(waitsOf(s), ["h1:permission"]);
  // 11: the lead's Stop leaves a helper's open permission (and opens no turn of its own while that helper runs)
  s = reduce(cfg, s, h({ type: "turn_end", t: 4 }));
  assert.deepEqual(waitsOf(s), ["h1:permission"]);
  assert.deepEqual([s.sessions.s1.waitKind, s.sessions.s1.waitBy, s.sessions.s1.waitSoft], ["permission", "h1", undefined]);
  assert.equal(s.sessions.s1.permWait?.since, 1, "permWait runs while any permission is open");
  s = reduce(cfg, s, { type: "agent_stop", session: "s1", agentId: "h1", t: 9 });
  assert.deepEqual([waitsOf(s), s.sessions.s1.waitSoft, s.sessions.s1.permWait], [[], undefined, { n: 1, totalMs: 8, lastMs: 8 }]);
});

test("S9: a finished turn is a soft your-turn; idle_prompt keeps it; a prompt closes it; a question stays a question", () => {
  let s = run(h({ type: "session_start", project: "p" }), h({ type: "prompt", text: "go", t: 1 }), h({ type: "turn_end", message: "done", t: 2 }));
  assert.deepEqual([s.sessions.s1.waiting, s.sessions.s1.waitKind, s.sessions.s1.waitSoft], [true, "turn", true]);
  s = reduce(cfg, s, h({ type: "waiting", idle: true, kind: "turn", text: "Claude is waiting for your input", t: 60 }));
  assert.deepEqual(s.sessions.s1.waits, [{ agent: "lead:s1", kind: "turn", since: 2, soft: true }], "idle_prompt after a Stop stays calm");
  s = reduce(cfg, s, h({ type: "prompt", text: "next", t: 70 }));
  assert.deepEqual([s.sessions.s1.waiting, s.sessions.s1.waits, s.sessions.s1.waitSoft], [false, [], undefined]);
  const idleOnly = run(h({ type: "session_start", project: "p" }), h({ type: "waiting", idle: true, kind: "turn", t: 5 }));
  assert.equal(idleOnly.sessions.s1.waitSoft, undefined, "an idle_prompt with no Stop (interrupt) is a plain your-turn");
  const bg = run(h({ type: "session_start", project: "p" }), h({ type: "prompt", text: "audit", t: 1 }), start("h1"), h({ type: "turn_end", message: "Three audits are still running", t: 3 }));
  assert.deepEqual([bg.sessions.s1.waiting, bg.sessions.s1.waits], [false, []], "background helpers still run: Claude resumes by itself, not your turn");
  const done = run(h({ type: "session_start", project: "p" }), h({ type: "prompt", text: "audit", t: 1 }), start("h1"), { type: "agent_stop", session: "s1", agentId: "h1", t: 2 } as OfficeEvent, h({ type: "turn_end", t: 3 }));
  assert.equal(done.sessions.s1.waitSoft, true, "once they have reported, the next Stop is your turn");
  const q = run(h({ type: "session_start", project: "p" }), h({ type: "waiting", kind: "question", text: "Claude needs your permission to use AskUserQuestion", t: 5 }));
  assert.deepEqual([q.sessions.s1.waits![0].kind, q.sessions.s1.waitKind, q.sessions.s1.waitSoft], ["question", "turn", undefined]);
});

test("S2: the idle TTL never removes a permission or question wait; a soft turn still expires", () => {
  const ttl = 45 * 60_000, later = 46 * 60_000;
  const p = run(h({ type: "session_start", project: "p" }), perm(undefined, 1));
  assert.ok(sweep(p, later, ttl).state.sessions.s1);
  assert.equal(sweep(p, later, ttl).state, p, "nothing removed: the same state (the daemon commits only a change)");
  const soft = run(h({ type: "session_start", project: "p" }), h({ type: "turn_end", t: 1 }));
  assert.deepEqual(sweep(soft, later, ttl).removed.sessions, ["s1"]);
});

test("S1: a sweep that removes only ghost helpers returns a new state and drops their waits", () => {
  const s = run(h({ type: "session_start", project: "p" }), start("g"), perm("g", 1), h({ type: "turn_end", t: 60_000 }), h({ type: "tool", tool: "Read", t: 19 * 60_000 }));
  const r = sweep(s, 20 * 60_000, 45 * 60_000);
  assert.notEqual(r.state, s);
  assert.deepEqual([r.removed.agents, (r.state.sessions.s1.waits ?? []).map((w) => w.agent)], [["g"], []]);
});

test("S4: an unseen gave-up of a live session survives other sessions' outcomes", () => {
  let s = [h({ type: "session_start", project: "b", session: "B" }), start("hb", "B"), h({ type: "agent_stop", session: "B", agentId: "hb", message: "BLOCKED: no db", t: 1 }),
    h({ type: "session_start", project: "a", session: "A" }),
    ...Array.from({ length: 40 }, (_, i) => [h({ type: "prompt", session: "A", text: `q${i}`, t: 2 + i }), h({ type: "turn_end", session: "A", message: `a${i}`, t: 2 + i })]).flat()]
    .reduce((x, e) => reduce(cfg, x, e), emptyState());
  assert.ok(s.outcomes!.some((o) => o.agentId === "hb"), "kept past the cap");
  assert.equal(s.outcomes!.length, LIMITS.outcomes + 1);
  s = reduce(cfg, s, { type: "session_end", session: "B", t: 99 });
  s = reduce(cfg, s, h({ type: "turn_end", session: "A", message: "z", t: 100 }));
  assert.equal(s.outcomes!.length, LIMITS.outcomes, "an ended session's gave-up ages out as before");
});

test("L2: at the session cap the quietest non-waiting session makes way; with every session waiting the new one is dropped; both counted", () => {
  const evs = Array.from({ length: LIMITS.sessions }, (_, i) => h({ type: "session_start", session: `x${i}`, project: "p", t: 10 + i }));
  let s = run(perm(undefined, 0), ...evs.slice(1)); // s1 waits on a permission and is the quietest
  assert.equal(Object.keys(s.sessions).length, LIMITS.sessions);
  s = reduce(cfg, s, h({ type: "tool", session: "new", tool: "Read", t: 100 }));
  assert.ok(s.sessions.new && s.sessions.s1 && !s.sessions.x1, "x1 (oldest non-waiting) evicted");
  assert.equal(s.track!.dropped, 1);
  const all = run(...Array.from({ length: LIMITS.sessions }, (_, i) => perm(undefined, i)).map((e, i) => ({ ...e, session: `w${i}` }) as OfficeEvent));
  const n = reduce(cfg, all, h({ type: "tool", session: "new", tool: "Read", t: 100 }));
  assert.deepEqual([n.sessions.new, n.track!.dropped], [undefined, 1]);
});

test("S5: parallel tools of one actor: doing stays until the last open start ends", () => {
  let s = run(h({ type: "session_start", project: "p" }), h({ type: "tool", tool: "Read", id: "r1", t: 1 }), h({ type: "tool", tool: "Bash", id: "b1", t: 2 }), h({ type: "tool_end", tool: "Read", id: "r1", ok: true, t: 3 }));
  assert.equal(s.sessions.s1.doing, "Bash");
  s = reduce(cfg, s, h({ type: "tool_end", tool: "Bash", id: "b1", ok: true, t: 4 }));
  assert.equal(s.sessions.s1.doing, undefined);
  // a start whose end never came (interrupt) is dropped at turn_end and does not hold later tools
  s = run(h({ type: "session_start", project: "p" }), h({ type: "tool", tool: "Bash", id: "lost", t: 1 }), h({ type: "turn_end", t: 2 }),
    h({ type: "tool", tool: "Read", id: "r2", t: 3 }), h({ type: "tool_end", tool: "Read", id: "r2", ok: true, t: 4 }));
  assert.equal(s.sessions.s1.doing, undefined);
});

test("S7: a cleared session that returns keeps its name and start, with no premature summary; any event's cwd names a recovered one", () => {
  let s = run(h({ type: "session_start", project: "billing", cwd: "/w/billing", t: 1 }), h({ type: "prompt", text: "go", t: 2 }), { type: "session_end", session: "s1", t: 3 });
  assert.equal(s.summaries!.length, 1);
  s = reduce(cfg, s, h({ type: "tool", tool: "Bash", t: 4 }));
  assert.deepEqual([s.sessions.s1.project, s.sessions.s1.startedAt, s.sessions.s1.recovered, s.summaries!.length], ["billing", 1, undefined, 0]);
  const r = run(h({ type: "tool", tool: "Bash", cwd: "/w/api", t: 4 }));
  assert.deepEqual([r.sessions.s1.project, r.sessions.s1.cwd, r.sessions.s1.recovered], ["api", "/w/api", true]);
});

test("S11: compaction is a running note, ended by SessionStart source compact", () => {
  let s = run(h({ type: "session_start", project: "p" }), h({ type: "prompt", text: "go", t: 1 }), h({ type: "compact", t: 2 }));
  assert.deepEqual([s.sessions.s1.doing, s.sessions.s1.busyAt, s.log.at(-1)!.text], ["Compact", 2, "Compacting the conversation"]);
  s = reduce(cfg, s, h({ type: "session_start", project: "p", source: "compact", t: 90 }));
  assert.deepEqual([s.sessions.s1.doing, s.sessions.s1.prompt], [undefined, "go"]);
});
