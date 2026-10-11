import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyFun, stepFun, rarity } from "./fun.ts";
import type { FunMemory } from "./fun.ts";
import { emptyState } from "./state.ts";
import type { Agent, Interaction, OfficeState, Session } from "./types.ts";

const ag = (id: string, o: Partial<Agent> = {}): Agent => ({ id, session: "s", agentType: "x", role: "dev", seat: { id: "d1", role: "dev", kind: "permanent", index: 0, name: id.toUpperCase() }, parent: "lead:s", ...o });
const se = (o: Partial<Session> = {}): Session => ({ id: "s", project: "proj", waiting: false, startedAt: 0, ...o });
const st = (agents: Agent[] = [], sessions: Session[] = [se()], log: Interaction[] = []): OfficeState => ({
  ...emptyState(), agents: Object.fromEntries(agents.map((a) => [a.id, a])), sessions: Object.fromEntries(sessions.map((s) => [s.id, s])), log,
});
const rep = (id: number, from: string, o: Partial<Interaction> = {}): Interaction => ({ id, t: 1, kind: "report", session: "s", from, to: "lead:s", text: "", outcome: "done", durationMs: 30_000, toolCount: 3, ...o });
const base = (a: OfficeState) => stepFun(emptyFun(), null, a, 1000).mem;
const kinds = (r: { out: { kind: string }[] }) => r.out.map((e) => e.kind);

test("first load is a quiet baseline", () => {
  const s = st([ag("a", { toolCount: 50, errors: 2 })], [se({ files: { a: 1 } })], [rep(1, "a")]);
  const r = stepFun(emptyFun(), null, s, 1000);
  assert.deepEqual(r.out, []);
  assert.equal(r.mem.cursor, 1);
});

test("activity alone is never rewarded (no combos), errors emit nothing", () => {
  const a = (n: number, e = 0) => st([ag("a", { toolCount: n, errors: e })]);
  let r = stepFun(base(a(0)), a(0), a(25), 2000);
  assert.deepEqual(r.out, []);
  r = stepFun(r.mem, a(25), a(30, 1), 3000);
  assert.deepEqual(r.out, []);
});

test("determinism and dedupe", () => {
  const p = st([ag("a")]);
  const n = st([], [se()], [rep(1, "a")]);
  const m = base(p);
  const r1 = stepFun(m, p, n, 2000), r2 = stepFun(m, p, n, 2000);
  assert.deepEqual(r1, r2);
  assert.equal(m.seen.length, 0); // input not mutated
  assert.ok(r1.out.length > 0);
  const again = stepFun({ ...m, seen: r1.mem.seen }, p, n, 2000);
  assert.deepEqual(again.out, []);
});

test("highlight clips task and caps output", () => {
  const task = "x".repeat(200);
  const agents = [0, 1, 2, 3, 4].map((i) => ag(`a${i}`, { task }));
  const log = agents.map((a, i) => rep(i + 1, a.id, { durationMs: 90_000 }));
  const m = base(st(agents));
  const r = stepFun(m, st(agents), st([], [se()], log), 2000);
  const hl = r.out.filter((e) => e.kind === "highlight");
  assert.equal(hl.length, 5);
  assert.ok(hl[0].text.length <= "A0 done:  (1m30s)".length + 80 + 6);
  assert.ok(r.out.length <= 6);
});

test("session finish: shipped commentary, session memory dropped", () => {
  const three = [ag("a"), ag("b"), ag("c")];
  const run = st(three, [se()], []);
  let m = base(run);
  let r = stepFun(m, run, st(three, [se()], []), 1500);
  m = r.mem;
  const logs = three.map((a, i) => rep(i + 1, a.id));
  // the session's toolCounts include every agent's calls (the reducer bumps them for all tool events)
  const toolled = st(three.map((a) => ag(a.id, { toolCount: 2 })), [se({ toolCounts: { Edit: 6 } })], []);
  r = stepFun(m, run, toolled, 2000);
  r = stepFun(r.mem, toolled, st([], [], logs), 3000); // session ended
  assert.ok(r.out.some((e) => e.kind === "commentary" && /proj shipped: 3 agents, 6 tool calls/.test(e.text)));
  assert.deepEqual(r.mem.sessions, {});
});

test("commentary rate limit and per-actor repeat window", () => {
  const roll = (n: number) => st([ag("a", { doing: "Edit", toolCount: n })]);
  let r = stepFun(base(roll(0)), roll(0), roll(5), 10_000);
  assert.equal(r.out.filter((e) => e.kind === "commentary").length, 1);
  assert.match(r.out[r.out.length - 1].text, /A is on a roll/);
  r = stepFun(r.mem, roll(5), roll(10), 13_000); // within 6s
  assert.ok(!kinds(r).includes("commentary"));
  r = stepFun(r.mem, roll(10), roll(15), 21_000); // >6s but same template+actor <60s
  assert.ok(!kinds(r).includes("commentary"));
  r = stepFun(r.mem, roll(15), roll(20), 71_000);
  assert.ok(kinds(r).includes("commentary"));
});

test("all hands fires when the crew grows past 4", () => {
  const four = Array.from({ length: 4 }, (_, i) => ag(`a${i}`));
  const r = stepFun(base(st([])), st([]), st(four), 5000);
  assert.ok(r.out.some((e) => e.kind === "commentary" && /All hands: 4/.test(e.text)));
});

test("delights are seeded, rare, done-only", () => {
  assert.equal(rarity("x"), rarity("x"));
  assert.ok(rarity("x") >= 0 && rarity("x") < 1);
  let hits = 0;
  const p = st([ag("a")]);
  for (let i = 0; i < 400; i++) {
    const r = stepFun(base(p), p, st([], [se()], [rep(1, "a", { stoppedAt: i })]), 2000);
    const d = r.out.filter((e) => e.kind === "delight");
    if (d.length) { hits++; assert.ok(d[0].rare && /^(Golden|A cat)/.test(d[0].text)); }
  }
  assert.ok(hits > 0 && hits < 40, String(hits));
  const blocked = stepFun(base(p), p, st([], [se()], [rep(1, "a", { outcome: "blocked", stoppedAt: 1 })]), 2000);
  assert.ok(!kinds(blocked).includes("delight"));
  const hit = Array.from({ length: 400 }, (_, i) => i).find((i) => kinds(stepFun(base(p), p, st([], [se()], [rep(1, "a", { stoppedAt: i })]), 2000)).includes("delight"))!;
  const waiting = stepFun(base(p), p, st([], [se({ waiting: true, waitKind: "turn" })], [rep(1, "a", { stoppedAt: hit })]), 2000);
  assert.ok(!kinds(waiting).includes("delight"), "never while a session waits");
  const gaveUp = { ...st([], [se({ promptAt: 0 })], [rep(1, "a", { stoppedAt: hit })]), outcomes: [{ session: "s", agentId: "b", outcome: "blocked" as const, text: "", t: 5 }] };
  assert.ok(!kinds(stepFun(base(p), p, gaveUp, 2000)).includes("delight"), "never while a gave-up report stands");
});

test("memory stays bounded and caps output", () => {
  const many = Array.from({ length: 100 }, (_, i) => ag(`a${i}`, { toolCount: 0 }));
  const more = many.map((a) => ag(a.id, { toolCount: 25, task: "t" }));
  const log = many.map((a, i) => rep(i + 1, a.id));
  const p = st(many);
  let r = stepFun(base(p), p, st(more, [se()], log), 2000);
  assert.ok(r.out.length <= 6);
  assert.ok(Object.keys(r.mem.agents).length <= 64);
  let mem: FunMemory = r.mem;
  for (let i = 0; i < 300; i++) mem = { ...mem, seen: [...mem.seen, `x${i}`] };
  r = stepFun(mem, p, p, 3000);
  assert.ok(r.mem.seen.length <= 200 || r.mem.seen.length === mem.seen.length);
  assert.deepEqual(JSON.parse(JSON.stringify(r.mem)), r.mem);
});

test("the lead gets no 'on a roll' lines for work its agents did", () => {
  const s0 = st([ag("a", { toolCount: 0 })], [se({ toolCounts: {} })]);
  const s1 = st([ag("a", { toolCount: 25 })], [se({ toolCounts: { Read: 25 }, doing: "Edit" })]);
  const r = stepFun(base(s0), s0, s1, 10_000);
  assert.ok(r.out.every((e) => !/^Lead/.test(e.text)), JSON.stringify(r.out));
});
