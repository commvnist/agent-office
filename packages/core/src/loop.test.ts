import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, reduce, hotFiles, topTools, usageTotalOf, LOOP_MIN } from "./state.ts";
import type { OfficeConfig, OfficeEvent } from "./types.ts";

const cfg: OfficeConfig = { roles: {} };
const tool = (tool: string, detail?: string, agentId?: string, i = 0): OfficeEvent => ({ type: "tool", session: "s1", agentId, tool, detail, t: i });
const run = (...evs: OfficeEvent[]) => evs.reduce((s, e) => reduce(cfg, s, e), emptyState());
const boot = [{ type: "agent_start", session: "s1", agentId: "a", agentType: "x", t: 0 }, { type: "agent_start", session: "s1", agentId: "b", agentType: "x", t: 0 }] as OfficeEvent[];

test("loop flags at LOOP_MIN consecutive identical calls, normalised detail", () => {
  assert.equal(LOOP_MIN, 4);
  const calls = ["ls  -l", " ls -l", "ls -l", "ls -l"].map((d) => tool("Bash", d, "a"));
  const three = run(...boot, ...calls.slice(0, 3));
  assert.equal(three.agents.a.loop, undefined);
  const four = run(...boot, ...calls);
  assert.deepEqual(four.agents.a.loop, { tool: "Bash", n: 4 });
  assert.equal(four.agents.b.loop, undefined);
  assert.equal(run(...boot, ...calls, tool("Bash", "pwd", "a")).agents.a.loop, undefined);
});

test("lead loops, absent detail counts, reducer does not mutate input", () => {
  const s0 = run(...boot, tool("Read"), tool("Read"), tool("Read"));
  const frozen = JSON.stringify(s0);
  const s1 = reduce(cfg, s0, tool("Read"));
  assert.equal(JSON.stringify(s0), frozen);
  assert.deepEqual(s1.sessions.s1.loop, { tool: "Read", n: 4 });
  assert.equal(reduce(cfg, s1, { type: "turn_end", session: "s1", t: 9 }).sessions.s1.loop, undefined);
});

test("hot files and tool totals, capped and proto-safe", () => {
  let s = run(tool("Edit", "a.ts"), tool("Write", "a.ts"), tool("Edit", "b.ts"), tool("Read", "a.ts"), tool("Edit", "__proto__"));
  assert.deepEqual(hotFiles(s).map((f) => [f.path, f.count]), [["a.ts", 2], ["__proto__", 1], ["b.ts", 1]]);
  assert.equal(hotFiles(s, "nope").length, 0);
  assert.deepEqual(topTools(s, 2), [{ tool: "Edit", count: 3 }, { tool: "Read", count: 1 }]);
  for (let i = 0; i < 60; i++) s = reduce(cfg, s, tool("Edit", `f${i}.ts`));
  assert.ok(Object.keys(s.sessions.s1.files!).length <= 50);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("usageTotalOf", () => {
  assert.equal(usageTotalOf({}), 0);
  assert.equal(usageTotalOf({ usage: { input: 1, output: 2, cacheRead: 100, cacheCreate: 3 } }), 6);
});
