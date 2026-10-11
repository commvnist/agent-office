import { test } from "node:test";
import assert from "node:assert/strict";
import { chipStack, pxTextW, staleK } from "./sprites.ts";

test("staleK: silent below 30 s, graded to 1 at 5 min, boolean stale falls back to full", () => {
  assert.equal(staleK(0, false), 0);
  assert.equal(staleK(29000), 0);
  assert.equal(staleK(300000), 1);
  assert.equal(staleK(9e9), 1);
  assert.ok(staleK(120000) > 0 && staleK(120000) < 1);
  assert.equal(staleK(undefined, true), 1);
  assert.equal(staleK(undefined, false), 0);
});

test("chipStack caps at 5 and flags overflow", () => {
  assert.deepEqual(chipStack(), { n: 0, more: false });
  assert.deepEqual(chipStack(3), { n: 3, more: false });
  assert.deepEqual(chipStack(5), { n: 5, more: false });
  assert.deepEqual(chipStack(9), { n: 5, more: true });
});

test("pxTextW counts glyph gaps", () => {
  assert.equal(pxTextW(""), 0);
  assert.equal(pxTextW("P1"), 7);
});
