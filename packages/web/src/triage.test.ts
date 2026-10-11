import { test } from "node:test";
import assert from "node:assert/strict";
import { aggLine, clipWords, doneRows, dropOutcome, nextStep, permLine, sessionAgg, statusKey, statusWord, topTools, tree, waitKindOf } from "./triage.ts";

test("one status key per actor; waitKind wins, else the text decides", () => {
  assert.equal(statusKey("blocked"), "blocked");
  assert.equal(statusKey("waiting", { waitKind: "turn", waitingText: "needs your permission" }), "turn");
  assert.equal(statusKey("waiting", { waitingText: "Claude needs your permission to use Bash" }), "permission");
  assert.equal(statusKey("waiting", { waitingText: "Claude is waiting for your input" }), "turn");
  assert.equal(statusKey("thinking"), "working");
  assert.equal(statusKey("queued"), "idle");
  assert.equal(waitKindOf(undefined), "turn");
  assert.equal(statusWord("permission"), "! needs permission");
  assert.equal(statusWord("working"), "working");
});

test("clipWords cuts at a word boundary and keeps short text", () => {
  assert.equal(clipWords("needs a  database\npassword", 40), "needs a database password");
  assert.equal(clipWords("the migration needs a database password", 24), "the migration needs a…");
  assert.equal(clipWords("supercalifragilistic", 10), "supercali…");
  assert.equal(dropOutcome("BLOCKED: no password"), "no password");
  assert.equal(dropOutcome("blockedness is fine"), "blockedness is fine");
});

test("next step names the terminal; tree runs lead -> self -> helpers", () => {
  assert.match(nextStep("permission", "api"), /api terminal/);
  assert.match(nextStep("blocked", "api", "Ava"), /^Ava has the report/);
  const a = (id: string, chain: string[], children: string[]) => ({ id, label: id, role: "r", lead: !chain.length, status: "working", chain, children });
  const acts = [a("lead:s", [], ["x"]), a("x", ["lead:s"], ["y", "gone"]), a("y", ["x", "lead:s"], [])];
  const t = tree(acts, "y");
  assert.deepEqual(t.up.map((x) => x.id), ["lead:s", "x"]);
  assert.deepEqual(tree(acts, "x").down.map((x) => x.id), ["y"]);
  assert.deepEqual(tree(acts, "nope"), { up: [], down: [] });
});

test("done rows prefer state.outcomes and fall back to feed reports", () => {
  const o = [{ session: "s", agentId: "a1", name: "Priya", outcome: "done", text: "DONE: shipped", task: "ship", t: 2 }];
  assert.deepEqual(doneRows(o, [], () => "proj")[0], { key: "a1@2", agentId: "a1", name: "Priya", project: "proj", outcome: "done", text: "shipped", task: "ship", t: 2 });
  const feed = [{ kind: "report", fromId: "b", from: "Bo", text: "BLOCKED: no key", t: 1, outcome: "blocked", session: "s" }, { kind: "prompt", from: "you", text: "x", t: 0 }];
  assert.deepEqual(doneRows(undefined, feed, (s) => s.toUpperCase()).map((r) => [r.name, r.project, r.text]), [["Bo", "S", "no key"]]);
});

test("permLine counts completed waits and the open one; topTools ranks by calls", () => {
  const f = (ms: number) => `${Math.round(ms / 1000)}s`;
  assert.equal(permLine(undefined, 0, f), "");
  assert.equal(permLine({ n: 0, totalMs: 0 }, 0, f), "");
  assert.equal(permLine({ n: 2, totalMs: 20_000 }, 0, f), "2 permission waits · avg 10s");
  assert.equal(permLine({ n: 0, totalMs: 0, since: 1000 }, 41_000, f), "permission: waiting now");
  assert.equal(permLine({ n: 0, totalMs: 0, since: 1000 }, 151_000, f), "permission: waiting 120s", "whole minutes, so the card is not rebuilt every second");
  const stat = (n: number) => ({ n, fail: 0, p50: 1, p95: 2 });
  assert.deepEqual(topTools({ Read: stat(3), Bash: stat(9), Edit: stat(3) }, 2).map((x) => x.tool), ["Bash", "Edit"]);
});

test("session aggregate: counts per bucket, worst by STATUS_ORDER, non-zero line", () => {
  const a = sessionAgg(["working", "blocked", "turn", "working", "idle"]);
  assert.deepEqual(a, { agents: 5, working: 2, waiting: 1, blocked: 1, worst: "turn" });
  assert.equal(aggLine(a), "2 working · 1 waiting · 1 blocked");
  assert.deepEqual(sessionAgg([]), { agents: 0, working: 0, waiting: 0, blocked: 0, worst: "idle" });
  assert.equal(aggLine(sessionAgg(["idle"])), "");
  assert.equal(sessionAgg(["blocked", "working"]).worst, "blocked");
});
