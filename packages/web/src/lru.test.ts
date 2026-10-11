import { test } from "node:test";
import assert from "node:assert/strict";
import { Lru, lookKey } from "./lru.ts";

test("evicts the least recently used and reports it", () => {
  const dead: number[] = [];
  const c = new Lru<number>(2, (v) => dead.push(v));
  c.set("a", 1); c.set("b", 2);
  c.get("a"); // a is now newest
  c.set("c", 3);
  assert.deepEqual(dead, [2]);
  assert.equal(c.get("b"), undefined);
  assert.equal(c.get("a"), 1);
  assert.equal(c.size, 2);
  c.clear();
  assert.deepEqual(dead, [2, 3, 1]);
});

test("look key changes with pants and any other field", () => {
  const l = { skin: "#1", pants: "#33384d", acc: "none" };
  assert.notEqual(lookKey(l), lookKey({ ...l, pants: "#1d2444" }));
  assert.equal(lookKey(l), lookKey({ ...l }));
});
