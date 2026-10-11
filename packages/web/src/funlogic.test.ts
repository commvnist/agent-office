import { test } from "node:test";
import assert from "node:assert/strict";
import { deltaBuckets, fuzzy, parseHighlight, rank, recapModel, ringMath, sparkBuckets, toastGate, toastKind } from "./funlogic.ts";

test("fuzzy: subsequence, word starts beat scattered hits", () => {
  assert.equal(fuzzy("zz", "Timeline"), -1);
  assert.ok(fuzzy("tl", "Timeline") >= 0);
  assert.ok(fuzzy("set", "Open Settings") > fuzzy("set", "Wall: reset view"));
  assert.deepEqual(rank("wal", ["Present", "Wall view", "Timeline"], (x) => x), ["Wall view"]);
  assert.equal(rank("", ["a", "b", "c"], (x) => x, 2).length, 2);
});

test("toasts: only delights toast, gate limits bursts", () => {
  assert.ok(toastKind("delight"));
  assert.ok(!toastKind("commentary") && !toastKind("highlight"));
  const gate = toastGate(2, 1000);
  assert.deepEqual([gate(0), gate(10), gate(20), gate(30, true), gate(1500)], [true, true, false, true, true]);
});

test("highlight text parses who / outcome / task / duration", () => {
  assert.deepEqual(parseHighlight("Dev done: implement DiscountCode (2m05s)"), { who: "Dev", outcome: "done", what: "implement DiscountCode", dur: "2m05s" });
  assert.equal(parseHighlight("plain text").outcome, "");
});

test("sparkline buckets: counts per minute, oldest first; cumulative deltas ignore drops", () => {
  const now = 10 * 60_000;
  const b = sparkBuckets([now - 5, now - 61_000, now - 61_500, now - 40 * 60_000], now, 5);
  assert.deepEqual(b, [0, 0, 0, 2, 1]);
  const d = deltaBuckets([{ t: now - 130_000, total: 100 }, { t: now - 70_000, total: 400 }, { t: now - 10_000, total: 50 }, { t: now - 5_000, total: 80 }], now, 4);
  assert.deepEqual(d, [0, 0, 300, 30]);
});

test("ring maths: arc is the share of the circumference, empty total draws nothing", () => {
  const r = ringMath([2, 1, 0], 4);
  assert.equal(r.length, 3);
  assert.ok(Math.abs(r[0].dash / r[0].circ - 0.5) < 1e-9 && r[2].dash === 0 && r[0].r > r[1].r);
  assert.equal(ringMath([3], 0)[0].dash, 0);
  assert.ok(ringMath([9], 3)[0].dash <= ringMath([9], 3)[0].circ);
});

test("recap model: sessions, busiest hour, longest tool, errors", () => {
  const t0 = new Date(2026, 0, 5, 14, 0, 0).getTime();
  const ev = [
    { type: "session_start", session: "s", project: "p", t: t0 },
    { type: "agent_start", session: "s", agentId: "a1", agentType: "x", t: t0 },
    { type: "tool", session: "s", tool: "Bash", id: "1", t: t0 + 1000 },
    { type: "tool_end", session: "s", tool: "Bash", ok: false, id: "1", t: t0 + 31_000 },
    { type: "tool", session: "s", tool: "Read", id: "2", t: t0 + 40_000 },
    { type: "tool_end", session: "s", tool: "Read", ok: true, id: "2", t: t0 + 41_000 },
  ] as Parameters<typeof recapModel>[0];
  const r = recapModel(ev);
  assert.deepEqual([r.sessions, r.agents, r.tools, r.errors, r.busiestHour], [1, 1, 2, 1, 14]);
  assert.deepEqual(r.longest, { tool: "Bash", ms: 30_000 });
  assert.equal(recapModel([]).busiestHour, null);
});
