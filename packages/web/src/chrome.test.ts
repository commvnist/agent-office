import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, type OfficeState } from "@agent-office/core";
import { Playback, demoScript, virtualTimes, FALLBACK_CFG } from "./sim.ts";
import { cdCommand, filterFeed, fmtAge, fmtTokens, posterModel, radar, summary, titleFor } from "./logic.ts";
import type { ActorInfo, FeedItem } from "./api.ts";

test("virtualTimes caps idle gaps", () => {
  assert.deepEqual(virtualTimes([0, 100, 100000], 3000), [0, 100, 3100]);
});

test("demo script plays to an empty office and seek is repeatable", () => {
  const p = new Playback(FALLBACK_CFG, demoScript());
  const mid = Math.floor(p.events.length / 2);
  const a = JSON.stringify(p.seek(mid, 1000).sessions);
  assert.ok(Object.keys(p.state.sessions).length >= 1);
  p.seek(p.events.length, 1000);
  assert.equal(Object.keys(p.state.sessions).length, 0);
  assert.equal(JSON.stringify(p.seek(mid, 1000).sessions), a); // backwards seek rebuilds identically
  assert.equal(p.countAt(p.end), p.events.length);
});

test("radar: blocked, waiting, stuck; first-seen is remembered by the caller", () => {
  const st: OfficeState = emptyState();
  st.sessions.a = { id: "a", project: "pa", waiting: true, startedAt: 0, lastAt: 500 };
  st.sessions.b = { id: "b", project: "pb", waiting: false, startedAt: 0, prompt: "x", lastAt: 1000 };
  st.sessions.c = { id: "c", project: "pc", waiting: false, startedAt: 0, lastAt: 1000 }; // idle, not stuck
  const ac = [{ id: "x1", label: "Dev", lead: false, status: "blocked", project: "pa" } as ActorInfo];
  const r = radar(ac, st, 200_000, (_k, f) => f);
  assert.deepEqual(r.map((i) => i.kind), ["blocked", "waiting", "stuck"]);
  assert.equal(r[1].since, 500);
  assert.equal(titleFor([r[1]]), "(1) waiting - Agent Office");
  assert.equal(titleFor(r), "(3) needs you - Agent Office");
  assert.equal(titleFor([]), "Agent Office");
});

test("filterFeed by session, kind, agent and mute", () => {
  const f = (o: Partial<FeedItem>) => ({ kind: "delegate", from: "A", to: "B", text: "", t: 0, session: "s1", ...o }) as FeedItem;
  const items = [f({}), f({ kind: "report", from: "B", to: "A" }), f({ session: "s2", from: "C" })];
  const none = { session: "", kind: "", agent: "", muted: new Set<string>() };
  assert.equal(filterFeed(items, none).length, 3);
  assert.equal(filterFeed(items, { ...none, session: "s2" }).length, 1);
  assert.equal(filterFeed(items, { ...none, kind: "report" }).length, 1);
  assert.equal(filterFeed(items, { ...none, agent: "B" }).length, 3);
  assert.equal(filterFeed(items, { ...none, muted: new Set(["A"]) }).length, 2);
});

test("formatting", () => {
  assert.equal(fmtAge(5000), "just now");
  assert.equal(fmtAge(180_000), "3m");
  assert.equal(fmtAge(3_900_000), "1h 5m");
  assert.equal(fmtTokens({ input: 1200, output: 40, cacheRead: 300, cacheCreate: 0 }), "in 1.5k · out 40");
  assert.equal(fmtTokens(undefined), "");
  assert.equal(cdCommand("/a/it's"), `cd '/a/it'\\''s'`);
});

test("poster carries counts and names only", () => {
  const p = new Playback(FALLBACK_CFG, demoScript());
  p.seek(p.events.findIndex((e) => e.type === "waiting"), 10 * 60_000);
  const m = posterModel(p.state, 10 * 60_000);
  assert.ok(m.agents.length > 0 && m.minutes >= 0);
  assert.ok(!JSON.stringify(m).includes("discount"));
  assert.match(summary([], []), /no sessions/);
});
