import { test } from "node:test";
import assert from "node:assert/strict";
import { FxBudget, MILESTONE_GAP_MS, scaled } from "./fx.ts";

test("routine: 2 per 500 ms window, then the window slides", () => {
  const b = new FxBudget();
  assert.deepEqual([0, 100, 200, 300, 450].map((t) => b.take("routine", `k${t}`, t)), [1, 1, 0, 0, 0]);
  assert.equal(b.take("routine", "x", 500), 1); // the first start left the window
});

test("milestones have their own budget: one per 1.5 s, independent of routine", () => {
  const b = new FxBudget();
  for (let i = 0; i < 2; i++) b.take("routine", `r${i}`, 0);
  assert.equal(b.take("milestone", "ship", 10), 1);
  assert.equal(b.take("milestone", "level", 20), 0);
  assert.equal(b.take("milestone", "ship", 10 + MILESTONE_GAP_MS), 1);
});

test("identical flair decays to half after 10 repeats within a minute, and recovers", () => {
  const b = new FxBudget();
  const r = Array.from({ length: 12 }, (_, i) => b.take("routine", "combo", i * 600));
  assert.deepEqual(r.slice(0, 10), Array(10).fill(1));
  assert.deepEqual(r.slice(10), [0.5, 0.5]);
  assert.equal(b.take("routine", "combo", 200_000), 1);
  assert.equal(b.take("routine", "other", 200_100), 1);
});

test("dropped effects do not count against the budget or the repeat tally; scaled keeps a pip", () => {
  const b = new FxBudget();
  for (let i = 0; i < 2; i++) b.take("routine", "a", 0);
  for (let i = 0; i < 50; i++) assert.equal(b.take("routine", "a", 10), 0);
  assert.equal(b.take("routine", "a", 600), 1);
  assert.equal(scaled(10, 0.5), 5);
  assert.equal(scaled(1, 0.5), 1);
  assert.equal(scaled(10, 0), 0);
});
