import { test } from "node:test";
import assert from "node:assert/strict";
import { violations } from "../../../plugin/scripts/verify-ownership.mjs";

test("flags unowned and overlapping files, ignores .office", () => {
  const owners = { be: ["server/**", "db.ts"], qa: ["tests/*.ts", "server/x.test.ts"] };
  const v = violations(owners, ["server/a/b.ts", "db.ts", "tests/a.ts", "tests/sub/a.ts", "server/x.test.ts", ".office/notes.md", "README.md"]);
  assert.deepEqual(v.map((x) => `${x.problem}:${x.file}`), ["unowned:tests/sub/a.ts", "overlap:server/x.test.ts", "unowned:README.md"]);
});
