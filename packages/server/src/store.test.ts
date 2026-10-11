import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, reduce, type OfficeConfig, type OfficeEvent } from "@agent-office/core";
import { appendRotating, loadEvents, replay } from "./store.ts";
import { validateConfig, unknownKeys } from "./config.ts";
import { readUsage } from "./usage.ts";
import { publicState } from "./snapshot.ts";

const cfg: OfficeConfig = { roles: { qa: { agent: "qa-engineer", count: 1 } } };
const tmp = () => mkdtempSync(join(tmpdir(), "ao-"));

test("replay rebuilds state and sweeps ghosts", () => {
  const f = join(tmp(), "events.jsonl");
  const now = 10_000_000;
  const evs: OfficeEvent[] = [
    { type: "session_start", session: "old", project: "p", t: now - 3_600_000 },
    { type: "session_start", session: "live", project: "q", t: now - 1000 },
    { type: "agent_start", session: "live", agentId: "a1", agentType: "qa-engineer", t: now - 900 },
  ];
  for (const e of evs) appendRotating(f, JSON.stringify(e));
  appendRotating(f, "not json");
  assert.equal(statSync(f).mode & 0o777, 0o600);
  const s = replay(cfg, loadEvents(f), now, 45 * 60_000);
  assert.deepEqual(Object.keys(s.sessions), ["live"]);
  assert.ok(s.agents.a1);
  assert.equal(loadEvents(f, now - 2000).length, 2);
  assert.equal(loadEvents(f, 0, 1).length, 1);
  // until is inclusive and applied before the limit: the newest event at or before `until` wins.
  assert.deepEqual(loadEvents(f, now - 2000, 5000, now - 950).map((e) => e.type), ["session_start"]);
  assert.equal(loadEvents(f, 0, 1, now - 950)[0].session, "live");
});

test("log rotates at the size cap", () => {
  const f = join(tmp(), "e.log");
  appendRotating(f, "x".repeat(50), 100);
  appendRotating(f, "x".repeat(50), 100);
  appendRotating(f, "y", 100);
  assert.ok(existsSync(f + ".1"));
  assert.ok(statSync(f).size < 10);
});

test("validateConfig accepts good, rejects bad, strips control chars", () => {
  const ok = validateConfig({ roles: { qa: { agent: "qa", count: 2, names: ["A\x1b[31mb"], overflow: { max: 1 } } }, parallelism: "off", privacy: true, theme: "dark" });
  assert.deepEqual(ok.roles.qa.names, ["A[31mb"]);
  for (const bad of [null, { roles: [] }, { roles: { a: { agent: "x", count: 21 } } }, { roles: { a: { agent: "x y", count: 1 } } },
    { roles: { a: { agent: "x", count: 1, overflow: { max: 11 } } } }, { roles: {}, parallelism: "x" }, { roles: {}, privacy: "yes" }, { roles: {}, theme: "../x" }, { roles: { a: { agent: "x", count: 1, names: [1] } } },
    { roles: {}, protocol: "silent" }, { roles: {}, historyHours: 0 }, { roles: {}, historyHours: 1.5 }])
    assert.throws(() => validateConfig(bad));
  assert.ok(validateConfig(JSON.parse('{"roles":{"__proto__":{"agent":"x","count":1}}}')));
  assert.deepEqual([validateConfig({ roles: {}, protocol: "observe", historyHours: 2160 })].map((c) => [c.protocol, c.historyHours]), [["observe", 2160]]);
});

test("readUsage sums the last line per message id and respects path limits", () => {
  const home = tmp(), proj = join(home, ".claude", "projects", "p");
  mkdirSync(proj, { recursive: true });
  const f = join(proj, "t.jsonl");
  const line = (id: string, o: number) => JSON.stringify({ type: "assistant", message: { id, usage: { input_tokens: 10, output_tokens: o, cache_read_input_tokens: 5, cache_creation_input_tokens: 1 } } });
  writeFileSync(f, [line("m1", 3), line("m1", 7), line("m2", 2), JSON.stringify({ type: "user" }), "{bad"].join("\n"));
  assert.deepEqual(readUsage(f, undefined, home), { input: 20, output: 9, cacheRead: 10, cacheCreate: 2 });
  const other = join(tmp(), "t.jsonl");
  writeFileSync(other, line("m", 1));
  assert.equal(readUsage(other, undefined, home), undefined);
  assert.ok(readUsage(other, join(other, ".."), home));
  assert.equal(readUsage(join(proj, "t.txt"), undefined, home), undefined);
  const link = join(proj, "l.jsonl");
  symlinkSync(other, link);
  assert.equal(readUsage(link, undefined, home), undefined);
});

test("publicState strips track, and text in private mode", () => {
  let s = emptyState();
  s = reduce(cfg, s, { type: "session_start", session: "s", project: "p", t: 1 });
  s = reduce(cfg, s, { type: "prompt", session: "s", text: "secret plan", t: 2 });
  s = reduce(cfg, s, { type: "tool", session: "s", tool: "Bash", detail: "rm -rf", why: "Running rm", t: 3 });
  assert.ok(!("track" in publicState(s, false)));
  const p = publicState(s, true);
  assert.ok(!JSON.stringify(p).includes("secret plan") && !JSON.stringify(p).includes("rm -rf"));
  assert.equal(p.sessions.s.doing, "Bash");
});

test("a config without roles keeps the default roles", () => {
  const defaults = { qa: { agent: "qa", count: 1 } };
  assert.deepEqual(validateConfig({ privacy: true }, defaults).roles, defaults);
  assert.throws(() => validateConfig({ privacy: true }), /roles/);
});

import { summarize, toMarkdown } from "./digest.ts";
test("digest counts outcomes, tokens, errors per day", () => {
  const t = new Date(2026, 0, 5, 10).getTime();
  const rows = summarize([
    { type: "session_start", session: "s", project: "p", t },
    { type: "agent_start", session: "s", agentId: "a", agentType: "agent-office:qa-engineer", t: t + 1 },
    { type: "tool_end", session: "s", agentId: "a", tool: "Bash", ok: false, t: t + 2 },
    { type: "agent_stop", session: "s", agentId: "a", message: "PARTIAL: half", usage: { input: 5, output: 3, cacheRead: 100, cacheCreate: 2 }, t: t + 3 },
    { type: "usage", session: "s", usage: { input: 4, output: 3, cacheRead: 100, cacheCreate: 1 }, t: t + 4 },
    { type: "turn_end", session: "s", usage: { input: 5, output: 3, cacheRead: 100, cacheCreate: 2 }, t: t + 5 }, // running total: counted once (max)
  ]);
  assert.deepEqual(rows.map((r) => [r.sessions, r.agents["qa-engineer"], r.outcomes.partial, r.tokens, r.errors, r.hours]), [[1, 1, 1, 10, 1, 1]]);
  assert.match(toMarkdown(rows), /2026-01-05 \| 1 \| 1 \| 0 \| 0 \| 1 \| 10 \| 1 \| 1/);
});

test("unknownKeys flags typos at top, role and overflow level", () => {
  assert.deepEqual(unknownKeys({ paralelism: "auto", roles: { qa: { agent: "q", count: 1, nmes: [], overflow: { max: 1, nam: [] } } } }),
    ["paralelism", "roles.qa.nmes", "roles.qa.overflow.nam"]);
  assert.deepEqual(unknownKeys({ roles: {}, theme: "x" }), []);
});

import { pruneEvents } from "./store.ts";
import { fitEnvelope } from "./snapshot.ts";
test("pruneEvents drops lines older than the cutoff in the log and its backup", () => {
  const f = join(tmp(), "events.jsonl");
  writeFileSync(f + ".1", [JSON.stringify({ type: "prompt", t: 1 }), "junk"].join("\n") + "\n");
  writeFileSync(f, [JSON.stringify({ type: "prompt", t: 5 }), JSON.stringify({ type: "prompt", t: 50 })].join("\n") + "\n");
  assert.equal(pruneEvents(f, 10), 3);
  assert.deepEqual(loadEvents(f).map((e) => e.t), [50]);
  assert.equal(existsSync(f + ".1"), false);
  assert.equal(pruneEvents(f, 10), 0);
});

test("fitEnvelope keeps the update when too big: trims log/outcomes and marks it degraded", () => {
  let s = emptyState();
  s = reduce(cfg, s, { type: "session_start", session: "s", project: "p", t: 1 });
  for (let i = 0; i < 30; i++) s = reduce(cfg, s, { type: "message", session: "s", to: "user", text: "x".repeat(200), t: 2 + i });
  const st = publicState(s, false);
  const ok = JSON.parse(fitEnvelope({ rev: 1 }, st, 1e6));
  assert.equal(ok.degraded, undefined);
  const small = fitEnvelope({ rev: 2 }, st, 3000);
  const d = JSON.parse(small);
  assert.equal(d.degraded, true);
  assert.match(d.degradedReason, /trimmed/);
  assert.equal(d.rev, 2);
  assert.ok(d.state.sessions.s, "structure survives");
  assert.ok(d.state.log.length < 30);
});

test("publicState blanks outcome text and task in private mode", () => {
  let s = emptyState();
  s = reduce(cfg, s, { type: "delegate", session: "s", agentType: "qa-engineer", text: "TASK-SECRET", t: 1 });
  s = reduce(cfg, s, { type: "agent_start", session: "s", agentId: "a", agentType: "qa-engineer", t: 2 });
  s = reduce(cfg, s, { type: "agent_stop", session: "s", agentId: "a", message: "DONE: RESULT-SECRET", t: 3 });
  assert.equal(publicState(s, false).outcomes![0].task, "TASK-SECRET");
  const p = publicState(s, true);
  assert.ok(!JSON.stringify(p).includes("SECRET"));
  assert.equal(p.outcomes![0].outcome, "done");
});
