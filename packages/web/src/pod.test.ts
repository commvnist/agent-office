import { test } from "node:test";
import assert from "node:assert/strict";
import { promptCaption } from "./pod.ts";

test("caption: clipped to 28, whitespace collapsed, control chars gone, blank under privacy", () => {
  assert.equal(promptCaption("fix\nthe   flaky\ttest", false), "fix the flaky test");
  const c = promptCaption("x".repeat(60), false);
  assert.equal(c.length, 28);
  assert.ok(c.endsWith("…"));
  assert.equal(promptCaption("secret", true), "");
  assert.equal(promptCaption(undefined, false), "");
});
