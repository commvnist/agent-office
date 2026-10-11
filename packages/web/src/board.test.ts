import { test } from "node:test";
import assert from "node:assert/strict";
import { boardModel, SUMMARY_MS, type Memo } from "./board.ts";
import { shadeTo } from "./color.ts";

const t = (id: string, status: "pending" | "running" | "done" | "blocked") => ({ id, session: "s", role: "qa", text: id, status });

test("boardModel groups by status", () => {
  const b = boardModel([t("a", "done"), t("b", "running"), t("c", "done")], { counts: null, at: 0 }, 1);
  assert.deepEqual(b.counts, { pending: 0, running: 1, done: 2, blocked: 0 });
  assert.equal(b.summary, "");
});

test("a finished run keeps a summary for two minutes, then falls back to empty", () => {
  const memo: Memo = { counts: null, at: 0 };
  boardModel([t("a", "done"), t("b", "done"), t("c", "blocked")], memo, 1000);
  assert.equal(boardModel([], memo, 1000 + 5000).summary, "2 done, 1 blocked");
  assert.equal(boardModel([], memo, 1000 + SUMMARY_MS).summary, "");
  assert.equal(boardModel([], { counts: null, at: 0 }, 5).summary, "");
});

test("shadeTo blends toward the tint", () => {
  assert.equal(shadeTo("#ffffff", "#000000", 0.5), "#808080");
  assert.equal(shadeTo("#102030", "#abcdef", 0), "#102030");
});
