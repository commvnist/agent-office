import { test } from "node:test";
import assert from "node:assert/strict";
import { BUDGET, findChrome, pct, verdict } from "./perf.mjs";

test("pct is nearest-rank and safe on empty input", () => {
  const xs = Array.from({ length: 100 }, (_, i) => 100 - i); // 1..100 unsorted
  assert.equal(pct(xs, 95), 95);
  assert.equal(pct(xs, 50), 50);
  assert.equal(pct([7], 95), 7);
  assert.equal(pct([], 95), 0);
});

test("verdict fails on p95, objects and too few frames", () => {
  assert.deepEqual(verdict({ frames: 400, p95: 10, up95: 5, objects: 100 }, BUDGET), []);
  assert.equal(verdict({ frames: 400, p95: BUDGET.p95 + 1, up95: 5, objects: 100 }, BUDGET).length, 1);
  assert.equal(verdict({ frames: 60, p95: BUDGET.p95 + 1, up95: 5, objects: 100 }, BUDGET).length, 0, "too few frames to gate the full frame");
  assert.equal(verdict({ frames: 60, p95: 1, up95: BUDGET.p95 + 1, objects: 100 }, BUDGET).length, 1, "the update phase is always gated");
  assert.equal(verdict({ frames: 400, p95: 1, up95: 1, objects: BUDGET.objects + 1 }, BUDGET).length, 1);
  assert.equal(verdict({ frames: 3, p95: 1, up95: 1, objects: 1 }, BUDGET).length, 1);
});

test("findChrome honours CHROME, else the first existing known path", () => {
  assert.equal(findChrome({ CHROME: "/x/chrome" }, (p) => p === "/x/chrome"), "/x/chrome");
  assert.equal(findChrome({ CHROME: "/missing" }, () => false), null);
  assert.equal(findChrome({}, (p) => p === "/usr/bin/chromium"), "/usr/bin/chromium");
  assert.equal(findChrome({}, () => false), null);
});
