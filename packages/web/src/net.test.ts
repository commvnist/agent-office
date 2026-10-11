import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, applyPatch, newCursor, type Envelope } from "./net.ts";

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

test("applyPatch: maps set and delete keys, keys replace, log drops and appends, head merges; the input is not mutated", () => {
  const e0 = { ...env("e", 3, [1, 2, 3]), state: { sessions: { a: { id: "a" }, b: { id: "b" } }, agents: {}, pending: {}, log: [{ id: 1 }, { id: 2 }, { id: 3 }], tasks: [] } as any };
  const e1 = applyPatch(e0, { epoch: "e", rev: 5, base: 3, head: { privacy: true }, maps: { sessions: { a: null, c: { id: "c" } } }, keys: { tasks: [{ id: 1 }] }, log: { drop: 1, add: [{ id: 4 } as any] } })!;
  assert.equal(e1.rev, 5);
  assert.equal(e1.privacy, true);
  assert.deepEqual(Object.keys(e1.state.sessions), ["b", "c"]);
  assert.deepEqual(e1.state.log.map((i) => i.id), [2, 3, 4]);
  assert.deepEqual(e1.state.tasks, [{ id: 1 }]);
  assert.equal(e1.state.agents, e0.state.agents); // untouched maps keep their identity
  assert.deepEqual(Object.keys(e0.state.sessions), ["a", "b"]);
  assert.equal(e0.state.log.length, 3);
});

test("applyPatch refuses a patch that does not fit: no envelope, other epoch, other base", () => {
  const e0 = env("e", 3, [1]);
  assert.equal(applyPatch(null, { epoch: "e", rev: 4, base: 3 }), null);
  assert.equal(applyPatch(e0, { epoch: "x", rev: 4, base: 3 }), null);
  assert.equal(applyPatch(e0, { epoch: "e", rev: 5, base: 4 }), null);
  assert.equal(applyPatch(e0, { epoch: "e", rev: 4, base: 3 })!.rev, 4);
});

test("L1: a closed stream reopens after 1 s, doubling, capped at 30 s", async () => {
  const { backoff } = await import("./net.ts");
  assert.deepEqual([0, 1, 2, 4, 5, 9, 1000].map(backoff), [1000, 2000, 4000, 16_000, 30_000, 30_000, 30_000]);
});
