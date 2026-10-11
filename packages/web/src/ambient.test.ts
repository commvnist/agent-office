import { test } from "node:test";
import assert from "node:assert/strict";
import { activity, ledNoise } from "./sprites.ts";

test("activity: 0 when empty, grows with working seats, caps at 1", () => {
  assert.equal(activity(0, 0), 0);
  assert.equal(activity(0, 3), 0);
  assert.ok(activity(1, 4) < activity(3, 4));
  assert.ok(activity(3, 6) < activity(6, 6));
  assert.equal(activity(20, 20), 1);
  assert.equal(activity(5, 2), activity(2, 2)); // working never exceeds seated
});

test("ledNoise is deterministic and in [0,1)", () => {
  assert.equal(ledNoise(3, 10), ledNoise(3, 10));
  for (let i = 0; i < 50; i++) { const n = ledNoise(i, i * 7); assert.ok(n >= 0 && n < 1); }
});
