import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interaction } from "@agent-office/core";
import { planInteraction, alertsFor, statusOf, isWorking, boardLines, pickBands, pickStroller, feedItem, type PlanCtx } from "./choreo.ts";

const it = (o: Partial<Interaction>): Interaction => ({ id: 1, t: 1000, kind: "delegate", session: "s", from: "lead:s", to: "a1", text: "do it", ...o });
const ctx = (log: Interaction[] = [], ids = ["lead:s", "a1", "a2"]): PlanCtx => ({ has: (i) => ids.includes(i), resolve: (h) => ids.find((i) => i === h), log });

test("delegate visits with a guess badge when attribution is ambiguous", () => {
  const a = planInteraction(it({ confidence: "guess" }), ctx());
  assert.deepEqual(a[1], { k: "visit", from: "lead:s", to: "a1", text: "do it", badge: "guess" });
});

test("two delegations within 4s become a huddle, spaced ones do not", () => {
  const log = [it({ id: 1, t: 1000, to: "a1" }), it({ id: 2, t: 3000, to: "a2" })];
  assert.equal(planInteraction(log[1], ctx(log))[1].k, "huddle");
  assert.equal(planInteraction(log[0], ctx(log))[1].k, "visit");
  const slow = [it({ id: 1, t: 1000 }), it({ id: 2, t: 9000, to: "a2" })];
  assert.equal(planInteraction(slow[1], ctx(slow))[1].k, "visit");
});

test("report: blocked stays, done leaves; prefixes stripped; no actor, no action", () => {
  const rep = (o: Partial<Interaction>) => it({ kind: "report", from: "a1", to: "lead:s", ...o });
  assert.deepEqual(planInteraction(rep({ outcome: "blocked", text: "BLOCKED: no creds" }), ctx()), [{ k: "block", id: "a1", text: "no creds", by: "lead:s" }]);
  assert.deepEqual(planInteraction(rep({ outcome: "done", text: "DONE: shipped" }), ctx()), [{ k: "report", from: "a1", to: "lead:s", text: "shipped" }]);
  assert.deepEqual(planInteraction(rep({ outcome: "empty", text: "" }), ctx()), [{ k: "report", from: "a1", to: "lead:s", text: "Done." }]);
  assert.deepEqual(planInteraction(rep({}), ctx([], ["lead:s"])), []);
});

test("message resolves hints and ignores self-talk", () => {
  const m = it({ kind: "message", from: "a1", to: "a2" });
  assert.equal(planInteraction(m, ctx())[0].k, "visit");
  assert.deepEqual(planInteraction(it({ kind: "message", from: "a1", to: "a1" }), ctx()), []);
});

test("alerts, status, working", () => {
  const s: any = { sessions: { s: { id: "s", waiting: true }, t: { id: "t", waiting: false } } };
  const m = alertsFor(s, ["a1"], (x) => `lead:${x}`);
  assert.equal(m.get("lead:s"), "waiting");
  assert.equal(m.get("a1"), "blocked");
  assert.equal(m.has("lead:t"), false);
  assert.equal(statusOf({ working: true, active: true, waiting: true }), "waiting");
  assert.equal(statusOf({ working: false, active: true }), "thinking");
  assert.equal(statusOf({ working: false, active: false }), "idle");
  assert.equal(isWorking(true, 0, 1_000_000), false);
  assert.equal(isWorking(true, 999_000, 1_000_000), true);
  assert.equal(isWorking(false, 996_000, 1_000_000), true);
  assert.equal(isWorking(false, 990_000, 1_000_000), false);
});

test("boardLines: newest first with status marks and owner", () => {
  const t: any[] = [{ id: "t1", role: "qa", text: "old", status: "done" }, { id: "t2", role: "qa", owner: "Quinn", text: "new", status: "blocked" }, { id: "t3", role: "be", text: "x", status: "pending" }];
  assert.deepEqual(boardLines(t, 2), ["o be: x", "! Quinn: new"]);
  assert.deepEqual(boardLines(undefined), []);
});

test("pickBands needs a margin to switch", () => {
  assert.equal(pickBands([2, 2.05, 1], 1), 1);
  assert.equal(pickBands([2, 2.4, 1], 1), 2);
  assert.equal(pickBands([2, 2.05, 1], null), 2);
  assert.equal(pickBands([1, 2], 3), 2); // stale current is ignored
});

test("pickStroller respects idle time and cooldown", () => {
  assert.equal(pickStroller([{ id: "a", lastActive: 90_000, strolledAt: 0 }], 100_000), null);
  assert.equal(pickStroller([{ id: "a", lastActive: 0, strolledAt: 90_000 }], 100_000), null);
  assert.equal(pickStroller([{ id: "b", lastActive: 90_000, strolledAt: 0 }, { id: "a", lastActive: 0, strolledAt: 0 }], 100_000)?.id, "a");
});

test("feedItem names the actors and carries confidence/outcome", () => {
  const f = feedItem(it({ kind: "report", outcome: "blocked", confidence: "guess" }), (i) => i.toUpperCase());
  assert.equal(f.from, "LEAD:S");
  assert.equal(f.outcome, "blocked");
  assert.equal(f.confidence, "guess");
});
