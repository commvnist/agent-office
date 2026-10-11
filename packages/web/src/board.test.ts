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

test("ledger: newest first, mark by outcome, clipped, privacy-blank falls back to the task then the outcome", async () => {
  const { ledgerLines } = await import("./board.ts");
  const o = (outcome: "done" | "blocked" | "partial" | undefined, text: string, task = "", project = "web") => ({ session: "s1", project, agentId: "a", outcome, text, task, t: 1 });
  assert.deepEqual(ledgerLines([o("done", "shipped cart"), o("blocked", "")], 5, 40), ["✓ web: shipped cart", "x web: gave up"]);
  assert.deepEqual(ledgerLines([o(undefined, ""), o(undefined, "notes")], 5, 40), ["· web: reported", "· web: notes"]); // C3: unknown is never ✓
  assert.deepEqual(ledgerLines([o("partial", "", "write tests")], 5, 40), ["~ web: write tests"]);
  assert.equal(ledgerLines([o("done", "a very long result that will not fit")], 5, 14)[0], "✓ web: a very…");
  assert.equal(ledgerLines([o("done", "x"), o("done", "y")], 1, 40).length, 1);
  assert.deepEqual(ledgerLines(undefined, 3, 40), []);
  assert.deepEqual(ledgerLines([o("done", "DONE: invoices migrated"), o("blocked", "blocked:  needs a key")], 5, 40), ["✓ web: invoices migrated", "x web: needs a key"]); // the mark already says it
});
