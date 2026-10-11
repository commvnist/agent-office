import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, reduce, type OfficeConfig, type OfficeEvent } from "@agent-office/core";
import { appendRotating, readEvents, replay } from "./store.ts";
const loadEvents = async (f: string, since?: number, limit?: number, until?: number) => (await readEvents(join(f, ".."), { since, limit, until })).events;
import { validateConfig, unknownKeys } from "./config.ts";
import { readUsage } from "./usage.ts";
import { publicState } from "./snapshot.ts";

const cfg: OfficeConfig = { roles: { qa: { agent: "qa-engineer", count: 1 } } };
const tmp = () => mkdtempSync(join(tmpdir(), "ao-"));

test("replay rebuilds state and sweeps ghosts", async () => {
  const f = join(tmp(), "events.jsonl");
  const now = 10_000_000;
  const evs: OfficeEvent[] = [
    { type: "session_start", session: "old", project: "p", t: now - 3_600_000 },
    { type: "session_start", session: "live", project: "q", t: now - 1000 },
    { type: "agent_start", session: "live", agentId: "a1", agentType: "qa-engineer", t: now - 900 },
  ];
  for (const e of evs) appendRotating(f, JSON.stringify(e));
  appendRotating(f, "not json");
  if (process.platform !== "win32") assert.equal(statSync(f).mode & 0o777, 0o600); // no POSIX modes on Windows
  const s = replay(cfg, await loadEvents(f), now, 45 * 60_000);
  assert.deepEqual(Object.keys(s.sessions), ["live"]);
  assert.ok(s.agents.a1);
  assert.equal((await loadEvents(f, now - 2000)).length, 2);
  assert.equal((await loadEvents(f, 0, 1)).length, 1);
  // until is inclusive and applied before the limit: the newest event at or before `until` wins.
  assert.deepEqual((await loadEvents(f, now - 2000, 5000, now - 950)).map((e) => e.type), ["session_start"]);
  assert.equal((await loadEvents(f, 0, 1, now - 950))[0].session, "live");
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
test("pruneEvents drops lines older than the cutoff in the log and its backup", async () => {
  const f = join(tmp(), "events.jsonl");
  writeFileSync(f + ".1", [JSON.stringify({ type: "prompt", t: 1 }), "junk"].join("\n") + "\n");
  writeFileSync(f, [JSON.stringify({ type: "prompt", t: 5 }), JSON.stringify({ type: "prompt", t: 50 })].join("\n") + "\n");
  assert.equal(pruneEvents(f, 10), 3);
  assert.deepEqual((await loadEvents(f)).map((e) => e.t), [50]);
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

import { appendEvent, pruneDays } from "./store.ts";
import { readdirSync, readFileSync, unlinkSync } from "node:fs";
test("day files: structure and text stored apart, rejoined on read, timeline survives without text", async () => {
  const home = tmp(), t0 = Date.UTC(2026, 9, 10, 23, 59, 59);
  const evs: OfficeEvent[] = [
    { type: "session_start", session: "s", project: "p", cwd: "/w/SECRET-CWD", t: t0 },
    { type: "prompt", session: "s", text: "SECRET-PROMPT", t: t0 + 500 },
    { type: "tool", session: "s", tool: "Bash", detail: "SECRET-CMD", t: t0 + 1500 }, // next UTC day
  ];
  for (const e of evs) appendEvent(home, e, false);
  const dir = join(home, "events");
  assert.deepEqual(readdirSync(dir).sort(), ["2026-10-10.idx", "2026-10-10.jsonl", "2026-10-10.text.jsonl", "2026-10-11.idx", "2026-10-11.jsonl", "2026-10-11.text.jsonl"]);
  if (process.platform !== "win32") { // no POSIX modes on Windows
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    for (const f of readdirSync(dir)) assert.equal(statSync(join(dir, f)).mode & 0o777, 0o600, f);
  }
  assert.ok(!readFileSync(join(dir, "2026-10-10.jsonl"), "utf8").includes("SECRET"), "structure lines carry no text");
  const r = await readEvents(home, { text: true });
  assert.deepEqual(r.events.map((e: any) => e.cwd ?? e.text ?? e.detail), ["/w/SECRET-CWD", "SECRET-PROMPT", "SECRET-CMD"]);
  assert.equal(r.more, false);
  for (const f of readdirSync(dir)) if (f.endsWith(".text.jsonl")) unlinkSync(join(dir, f));
  const bare = await readEvents(home, { text: true });
  assert.deepEqual(bare.events.map((e) => e.type), ["session_start", "prompt", "tool"]);
  assert.equal((bare.events[1] as { text: string }).text, "");
  assert.equal(replay(cfg, bare.events, t0 + 2000, 60_000).sessions.s.doing, "Bash");
  appendEvent(home, { type: "prompt", session: "s", text: "PRIVATE", t: t0 + 3000 }, true);
  assert.ok(!readdirSync(dir).some((f) => f.endsWith(".text.jsonl")), "privacy mode writes no text file");
});

test("readEvents pages newest-first with `more`, seeks by the idx and includes the legacy log", async () => {
  const home = tmp(), t0 = Date.UTC(2026, 9, 1);
  writeFileSync(join(home, "events.jsonl"), JSON.stringify({ type: "prompt", session: "s", text: "LEGACY", t: t0 - 10 }) + "\n");
  for (let i = 0; i < 3000; i++) appendEvent(home, { type: "tool", session: "s", tool: "Read", detail: `f${i}`.padEnd(40, "x"), t: t0 + i * 60_000 }, false);
  const idx = readFileSync(join(home, "events", "2026-10-01.idx"), "utf8").trim().split("\n");
  assert.ok(idx.length > 1, "an idx line per 64 KB");
  const all = await readEvents(home, { limit: 10_000, text: true });
  assert.equal(all.events.length, 3001);
  assert.equal((all.events[0] as { text: string }).text, "LEGACY");
  assert.ok(all.events.every((e, i) => i === 0 || e.t >= all.events[i - 1].t), "oldest first");
  const page = await readEvents(home, { limit: 100, text: true });
  assert.deepEqual([page.events.length, page.more, page.events.at(-1)!.t], [100, true, t0 + 2999 * 60_000]);
  const older = await readEvents(home, { limit: 100, until: page.events[0].t - 1 });
  assert.equal(older.events.at(-1)!.t, page.events[0].t - 60_000);
  const mid = await readEvents(home, { since: t0 + 1000 * 60_000, until: t0 + 1004 * 60_000, text: true });
  assert.deepEqual(mid.events.map((e) => (e as { detail: string }).detail.slice(0, 5)), ["f1000", "f1001", "f1002", "f1003", "f1004"]);
  assert.equal((await readEvents(join(home, "nope"))).events.length, 0);
  assert.equal((await readEvents(home, { since: 1e17 })).events.length, 0, "out-of-range dates read nothing, never throw");
});

test("pruneDays deletes whole old days, and text files earlier", () => {
  const home = tmp(), dir = join(home, "events");
  for (const d of ["2026-10-01", "2026-10-05", "2026-10-09"]) appendEvent(home, { type: "prompt", session: "s", text: "x", t: Date.parse(`${d}T12:00:00Z`) }, false);
  const now = Date.parse("2026-10-10T12:00:00Z");
  assert.equal(pruneDays(home, now - 7 * 86_400_000, now - 2 * 86_400_000), 4);
  assert.deepEqual(readdirSync(dir).sort(), ["2026-10-05.idx", "2026-10-05.jsonl", "2026-10-09.idx", "2026-10-09.jsonl", "2026-10-09.text.jsonl"]);
  assert.equal(pruneDays(tmp(), now), 0);
});

import { diffEnvelope, lodState } from "./snapshot.ts";
/** The client's patch rule (packages/web/src/net.ts applyPatch), for checking the server's diff. */
const apply = (env: any, p: any) => {
  const st = { ...env.state, ...p.keys };
  for (const [k, m] of Object.entries(p.maps ?? {})) { st[k] = { ...st[k] }; for (const [id, v] of Object.entries(m as object)) if (v === null) delete st[k][id]; else st[k][id] = v; }
  if (p.log) st.log = [...env.state.log.slice(p.log.drop), ...p.log.add];
  return { ...env, ...p.head, rev: p.rev, state: st };
};
test("diffEnvelope: patches rebuild the next envelope, by identity, also when private", () => {
  for (const priv of [false, true]) {
    let s = emptyState();
    const head = (rev: number, extra = {}) => ({ epoch: "e", rev, ...extra });
    const evs: OfficeEvent[] = [
      { type: "session_start", session: "s", project: "p", t: 1 }, { type: "prompt", session: "s", text: "hi", t: 2 },
      { type: "agent_start", session: "s", agentId: "a", agentType: "qa-engineer", t: 3 },
      { type: "session_start", session: "s2", project: "q", t: 4 },
      { type: "tool", session: "s2", tool: "Read", t: 5 },
      { type: "agent_stop", session: "s", agentId: "a", message: "DONE: ok", t: 6 },
      { type: "session_end", session: "s", t: 7 },
    ];
    let prev = { head: head(0), st: publicState(s, priv) }, env: any = JSON.parse(JSON.stringify({ ...prev.head, state: prev.st }));
    for (const [i, e] of evs.entries()) {
      s = reduce(cfg, s, e);
      const cur = { head: head(i + 1, i === 3 ? { configError: { message: "x" } } : {}), st: publicState(s, priv) };
      const p = diffEnvelope(prev, cur);
      if (e.type === "tool") assert.deepEqual(Object.keys(p.maps!), ["sessions"], "one session changed");
      if (e.type === "tool") assert.deepEqual(Object.keys(p.maps!.sessions), ["s2"]);
      env = JSON.parse(JSON.stringify(apply(env, JSON.parse(JSON.stringify(p)))));
      const want = JSON.parse(JSON.stringify({ ...cur.head, state: cur.st }));
      if (i > 3) want.configError = null; // removed head fields arrive as null
      assert.deepEqual(env, want, `${priv} ${e.type}`);
      prev = cur;
    }
    assert.equal(env.state.summaries.length, 1);
  }
});

test("lodState: summary counts per session, one session in full", () => {
  let s = emptyState();
  for (const e of [{ type: "session_start", session: "s", project: "p", t: 1 }, { type: "session_start", session: "t", project: "q", t: 1 },
    { type: "agent_start", session: "s", agentId: "a", agentType: "qa-engineer", t: 2 }, { type: "agent_start", session: "s", agentId: "b", agentType: "qa-engineer", t: 2 },
    { type: "tool", session: "s", agentId: "a", tool: "Bash", t: 3 }, { type: "agent_start", session: "t", agentId: "c", agentType: "qa-engineer", t: 3 },
    { type: "agent_stop", session: "t", agentId: "c", message: "BLOCKED: no", t: 4 }] as OfficeEvent[]) s = reduce(cfg, s, e);
  const sum = lodState(publicState(s, false));
  assert.deepEqual([Object.keys(sum.agents), sum.log, sum.tasks, sum.pending, sum.outcomes!.length], [[], [], [], {}, 1]);
  assert.deepEqual(sum.crew, { s: { agents: 2, working: 1, waiting: 1, blocked: 0, queued: 0 }, t: { agents: 0, working: 0, waiting: 0, blocked: 1, queued: 0 } });
  const one = lodState(publicState(s, false), "s");
  assert.deepEqual([Object.keys(one.agents).sort(), one.log.every((i) => i.session === "s"), one.log.length > 0], [["a", "b"], true, true]);
});
