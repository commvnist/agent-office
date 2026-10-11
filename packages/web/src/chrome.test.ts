import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, type OfficeState } from "@agent-office/core";
import { Playback, demoScript, virtualTimes, FALLBACK_CFG } from "./sim.ts";
import { BURN_HOT, bySession, coverFit, sustained, burnHot, burnRate, cdCommand, filterFeed, fmtAge, fmtDur, fmtTokens, posterModel, projectHue, quietBefore, radar, rosterGroups, sanitizeFilters, summary, sumUsage, tierOf, titleFor, urgency } from "./logic.ts";
import type { ActorInfo, FeedItem, SessionInfo } from "./api.ts";

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
  const r = radar(ac, { ...st, outcomes: undefined }, 200_000, (_k, f) => f); // an older daemon: blocked actors
  assert.deepEqual(r.map((i) => i.kind), ["blocked", "waiting", "stuck"]);
  assert.equal(r[1].since, 500);
  assert.equal(titleFor([r[1]]), "(1) waiting: pa - Agent Office");
  assert.equal(titleFor(r), "(3) needs you: pa - Agent Office");
  assert.equal(titleFor([]), "Agent Office");
});

test("C6/C7/X3: gave-up rows come from outcomes until the next prompt or Seen; silent helpers; the turn reason is the lead's result", () => {
  const st: OfficeState = emptyState();
  st.sessions.a = { id: "a", project: "pa", waiting: true, waitKind: "turn", waitingText: "Claude is waiting for your input", result: "Rebuilt; want me to fix links?", startedAt: 0, lastAt: 500, promptAt: 100 };
  st.outcomes = [
    { session: "a", agentId: "h1", name: "Dev", outcome: "blocked", text: "BLOCKED: no key", t: 200 },
    { session: "a", agentId: "h0", name: "Old", outcome: "blocked", text: "earlier turn", t: 50 }, // before the latest prompt
    { session: "a", agentId: "lead:a", lead: true, outcome: "blocked", text: "x", t: 300 }, // a lead's turn is the your-turn row
    { session: "gone", agentId: "h2", outcome: "blocked", text: "ended session", t: 300 },
    { session: "a", agentId: "h3", outcome: "done", text: "ok", t: 300 },
  ];
  st.agents.h4 = { id: "h4", session: "a", agentType: "qa", role: "qa", seat: { id: "d0", role: "qa", kind: "permanent", index: 0, name: "Ann" }, parent: "lead:a", lastAt: 1000 };
  const r = radar([], st, 1000 + 3 * 60_000 + 1, (_k, f) => f, 60_000);
  assert.deepEqual(r.map((i) => [i.kind, i.label]), [["blocked", "Dev"], ["waiting", "pa"], ["stuck", "Ann"]]);
  assert.equal(r[0].key, "blocked:h1:200");
  assert.equal(r[1].reason, "Rebuilt; want me to fix links?");
  assert.equal(radar([], st, 2000, (_k, f) => f, 60_000, (k) => k === "blocked:h1:200").filter((i) => i.kind === "blocked").length, 0, "seen");
  st.sessions.a.promptAt = 250;
  assert.equal(radar([], st, 2000, (_k, f) => f, 60_000).filter((i) => i.kind === "blocked").length, 0, "the next prompt clears it");
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
  assert.match(fmtTokens({ input: 1200, output: 40, cacheRead: 300, cacheCreate: 0 }), /^new in 1\.2\D* · cached 300 · out 40$/);
  assert.equal(fmtDur(42_000), "42s");
  assert.equal(sumUsage([{ input: 1, output: 2, cacheRead: 3, cacheCreate: 4 }, undefined]).cacheRead, 3);
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

test("radar tiers, in-flight tools soften stuck, burn rate", () => {
  assert.deepEqual([0, 299_999, 300_000, 900_000].map(tierOf), [0, 0, 1, 2]);
  const st: OfficeState = emptyState();
  st.sessions.a = { id: "a", project: "pa", waiting: false, startedAt: 0, prompt: "x", lastAt: 1, doing: "Bash" };
  assert.equal(radar([], st, 200_000, (_k, f) => f).length, 0); // silent 200s but a tool is running: under 3x120s
  assert.equal(radar([], st, 400_000, (_k, f) => f)[0].kind, "stuck");
  assert.equal(radar([], st, 400_000, (_k, f) => f, 600_000).length, 0); // configurable threshold
  assert.equal(burnRate([{ t: 0, total: 0 }, { t: 60_000, total: 5000 }]), 5000);
  assert.equal(burnRate([{ t: 0, total: 0 }, { t: 1000, total: 5000 }]), 0); // too close to trust
  assert.equal(projectHue("api"), projectHue("api"));
});

test("burn hot is strictly above BURN_HOT", () => {
  assert.equal(burnHot(BURN_HOT), false);
  assert.equal(burnHot(BURN_HOT + 1), true);
});

test("poster tokens count cache writes like usageTotal, not cache reads", () => {
  const st: OfficeState = emptyState();
  st.sessions.a = { id: "a", project: "pa", waiting: false, startedAt: 0, lastAt: 1, usage: { input: 1, output: 2, cacheRead: 100, cacheCreate: 4 } } as OfficeState["sessions"][string];
  assert.equal(posterModel(st, 60_000).tokens, 7);
});

test("session urgency, roster order and feed gaps", () => {
  const ses = (o: Partial<SessionInfo>) => ({ id: "s", lead: "L", project: "p", waiting: false, ...o }) as SessionInfo;
  const act = (o: Partial<ActorInfo>) => ({ id: "x", label: "X", role: "dev", session: "s", project: "p", status: "working", lead: false, children: [], chain: [], ...o }) as ActorInfo;
  assert.equal(urgency(ses({}), [act({ status: "blocked" })]), 0);
  assert.equal(urgency(ses({ waiting: true }), []), 1);
  assert.equal(urgency(ses({}), [act({ id: "L", status: "working", lead: true })]), 2);
  assert.equal(urgency(ses({}), [act({ id: "L", status: "idle", lead: true })]), 3);

  const rows = [
    { a: act({ id: "b", label: "B", session: "s2" }), s: "working" },
    { a: act({ id: "c", label: "C", session: "s3" }), s: "working" },
    { a: act({ id: "c2", label: "C2", session: "s1" }), s: "working" },
    { a: act({ id: "l1", label: "Lead", session: "s1", lead: true }), s: "idle" },
    { a: act({ id: "a", label: "A", session: "s1" }), s: "blocked" },
  ];
  const names: Record<string, string> = { s1: "Zed", s2: "Amy", s3: "Bo" };
  const order = rosterGroups(rows, (s) => names[s]).map((g) => `${g.s}:${g.g.map((r) => r.a.id).join(",")}`);
  assert.deepEqual(order, ["s1:l1,a,c2", "s2:b", "s3:c"]); // blocked group first, then equal rank by project name

  const f = (t: number, session = "s1") => ({ kind: "delegate", from: "A", to: "B", text: "", t, session }) as FeedItem;
  assert.deepEqual(quietBefore([f(10 * 60_000), f(9 * 60_000), f(0)]), [0, 0, 9 * 60_000]); // newest first; only gaps over 5 min
  assert.deepEqual([...bySession([f(3, "s1"), f(2, "s2"), f(1, "s1")])].map(([s, l]) => `${s}:${l.length}`), ["s1:2", "s2:1"]);
});

test("corrupt stored filters fall back to defaults", () => {
  const none = { session: "", kind: "", agent: "", muted: [], grouped: false };
  assert.deepEqual(sanitizeFilters({ session: "s1", muted: ["A", 5, null], grouped: true }), { ...none, session: "s1", muted: ["A"], grouped: true });
  assert.deepEqual(sanitizeFilters({ muted: 5, session: 3, kind: {}, grouped: "yes" }), none);
  assert.deepEqual(sanitizeFilters(null), none);
  assert.deepEqual(sanitizeFilters(5), none);
});

test("sustained fires once after the hold time and resets when the condition ends", () => {
  const m = new Map<string, { since: number; fired: boolean }>();
  assert.equal(sustained(m, "s", true, 0, 120_000), false);
  assert.equal(sustained(m, "s", true, 119_000, 120_000), false);
  assert.equal(sustained(m, "s", true, 120_000, 120_000), true);
  assert.equal(sustained(m, "s", true, 200_000, 120_000), false); // once per episode
  assert.equal(sustained(m, "s", false, 210_000, 120_000), false);
  assert.equal(sustained(m, "s", true, 220_000, 120_000), false); // new episode starts its own clock
  assert.equal(sustained(m, "s", true, 340_000, 120_000), true);
});

test("coverFit fills the box and centres the overflow", () => {
  assert.deepEqual(coverFit(1000, 500, 720, 630), { s: 1.26, x: (720 - 1260) / 2, y: 0 });
  assert.deepEqual(coverFit(400, 800, 720, 630), { s: 1.8, x: 0, y: (630 - 1440) / 2 });
});

test("L2: the header wordmark is the wall sign's 3x5 pixel font, integer-scaled, no accent line", async () => {
  const { readFileSync } = await import("node:fs");
  const { drawPx, pxTextW } = await import("./sprites.ts");
  const cells: string[] = [];
  drawPx({ fillRect: (x: number, y: number) => cells.push(`M${x} ${y}h1v1h-1z`) } as unknown as CanvasRenderingContext2D, "AGENT OFFICE", 0, 0, "");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const svg = /<svg class="wm"[^>]*>[\s\S]*?<\/svg>/.exec(html)?.[0] ?? "";
  assert.ok(svg.includes(`d="${cells.join("")}"`), `wordmark path drifted from the sign font:\n${cells.join("")}`);
  const w = pxTextW("AGENT OFFICE"), [, vw, vh] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? [];
  assert.equal(Number(vw), w); assert.equal(Number(vh), 5);
  const [, pw, ph] = /width="(\d+)" height="(\d+)"/.exec(svg) ?? [];
  assert.equal(Number(pw) / w, Number(ph) / 5); assert.ok(Number.isInteger(Number(pw) / w), "integer scale");
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.doesNotMatch(html, /\.wm[^{]*\{[^}]*border-bottom/, "no accent line under the wordmark");
});
