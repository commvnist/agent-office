import { test } from "node:test";
import assert from "node:assert/strict";
import { planPack } from "./apply-pack.mjs";

const pack = { roles: { a: { agent: "a", count: 1 } }, agents: { a: "a.md" } };

test("merges roles and keeps unrelated ones", () => {
  const p = planPack(pack, { theme: "x", roles: { b: { agent: "b", count: 2 } } }, "/p", "/out", () => false);
  assert.deepEqual(Object.keys(p.config.roles), ["b", "a"]);
  assert.equal(p.config.theme, "x");
  assert.deepEqual(p.copies, [{ from: "/p/a.md", to: "/out/a.md" }]);
  assert.deepEqual(p.conflicts, []);
});

test("reports differing role and existing agent file as conflicts", () => {
  const p = planPack(pack, { roles: { a: { agent: "a", count: 9 } } }, "/p", "/out", () => true);
  assert.equal(p.conflicts.length, 2);
});

test("identical existing role is not a conflict", () => {
  assert.deepEqual(planPack(pack, { roles: pack.roles }, "/p", "/out", () => false).conflicts, []);
});
