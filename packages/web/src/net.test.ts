import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, newCursor, type Envelope } from "./net.ts";

const env = (epoch: string, rev: number, ids: number[], extra: Partial<Envelope> = {}): Envelope =>
  ({ schema: 1, version: "x", epoch, rev, state: { log: ids.map((id) => ({ id })) } as any, config: { roles: {} }, ...extra });

test("first snapshot baselines the log, later ones deliver only newer ids", () => {
  const c = newCursor();
  assert.deepEqual(advance(c, env("e", 1, [1, 2, 3])), { fresh: true, items: [] });
  const r = advance(c, env("e", 2, [1, 2, 3, 4, 5]))!;
  assert.deepEqual(r.items.map((i) => i.id), [4, 5]);
});

test("stale or repeated rev is skipped", () => {
  const c = newCursor();
  advance(c, env("e", 5, [1]));
  assert.equal(advance(c, env("e", 5, [1, 2])), null);
  assert.equal(advance(c, env("e", 4, [1, 2])), null);
});

test("epoch change resets the cursor: low ids after a restart are not skipped", () => {
  const c = newCursor();
  advance(c, env("a", 9, [40, 41, 42]));
  assert.equal(advance(c, env("b", 1, [1]))!.fresh, true);
  assert.deepEqual(advance(c, env("b", 2, [1, 2]))!.items.map((i) => i.id), [2]);
});

test("config change does not replay history", () => {
  const c = newCursor();
  advance(c, env("e", 1, [1, 2]));
  const r = advance(c, env("e", 2, [1, 2], { config: { roles: { qa: {} } } as any }))!;
  assert.deepEqual(r.items, []);
});
