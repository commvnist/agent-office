import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interaction } from "@agent-office/core";
import { planInteraction, alertsFor, statusOf, isWorking, boardLines, pickStroller, feedItem, cleanText, uniqueNames, stackLabels, longToolMs, toolKind, skyAt, clampBox, hopPose, stepDrop, popScale, quirkAt, toolIcon, HOP_MS, idleTier, microPose, yieldsTo, stepHold, holds, doorHold, tetherAlpha, loadLevel, sessionHue, shrinkFloor, YIELD_MAX_MS, SLIP_MS, type PlanCtx, type Shrink } from "./choreo.ts";

const it = (o: Partial<Interaction>): Interaction => ({ id: 1, t: 1000, kind: "delegate", session: "s", from: "lead:s", to: "a1", text: "do it", ...o });
const ctx = (log: Interaction[] = [], ids = ["lead:s", "a1", "a2"]): PlanCtx => ({ has: (i) => ids.includes(i), resolve: (h) => ids.find((i) => i === h), log });

test("delegate visits with a guess badge when attribution is ambiguous", () => {
  const a = planInteraction(it({ confidence: "guess" }), ctx());
  assert.deepEqual(a[1], { k: "visit", from: "lead:s", to: "a1", text: "do it", badge: "guess" });
});

test("two delegations within 4s become a huddle, spaced ones do not", () => {
  const log = [it({ id: 1, t: 1000, to: "a1" }), it({ id: 2, t: 3000, to: "a2" })];
  assert.equal(planInteraction(log[1], ctx(log))[1].k, "huddle");
  assert.equal(planInteraction(log[0], ctx(log))[1].k, "visit");
  const slow = [it({ id: 1, t: 1000 }), it({ id: 2, t: 9000, to: "a2" })];
  assert.equal(planInteraction(slow[1], ctx(slow))[1].k, "visit");
});

test("report: blocked stays, done leaves; prefixes stripped; no actor, no action", () => {
  const rep = (o: Partial<Interaction>) => it({ kind: "report", from: "a1", to: "lead:s", ...o });
  assert.deepEqual(planInteraction(rep({ outcome: "blocked", text: "BLOCKED: no creds" }), ctx()), [{ k: "block", id: "a1", text: "no creds", by: "lead:s" }]);
  assert.deepEqual(planInteraction(rep({ outcome: "done", text: "DONE: shipped" }), ctx()), [{ k: "report", from: "a1", to: "lead:s", text: "shipped", done: true }]);
  assert.deepEqual(planInteraction(rep({ outcome: "empty", text: "" }), ctx()), [{ k: "report", from: "a1", to: "lead:s", text: "(no report)", done: false }], "no report is never 'Done.' (S3)");
  assert.deepEqual(planInteraction(rep({ text: "could not find the config" }), ctx()), [{ k: "report", from: "a1", to: "lead:s", text: "could not find the config", done: false }], "an unprefixed report is not a success");
  assert.deepEqual(planInteraction(rep({}), ctx([], ["lead:s"])), []);
});

test("message resolves hints and ignores self-talk", () => {
  const m = it({ kind: "message", from: "a1", to: "a2" });
  assert.equal(planInteraction(m, ctx())[0].k, "visit");
  assert.deepEqual(planInteraction(it({ kind: "message", from: "a1", to: "a1" }), ctx()), []);
});

test("alerts, status, working", () => {
  const s: any = { sessions: { s: { id: "s", waiting: true }, t: { id: "t", waiting: false } } };
  const m = alertsFor(s, ["a1"], (x) => `lead:${x}`);
  assert.equal(m.get("lead:s"), "waiting");
  assert.equal(m.get("a1"), "blocked");
  assert.equal(m.has("lead:t"), false);
  assert.equal(statusOf({ working: true, active: true, waiting: true }), "waiting");
  assert.equal(statusOf({ working: false, active: true }), "thinking");
  assert.equal(statusOf({ working: false, active: false }), "idle");
  assert.equal(isWorking(true, 0, 1_000_000), false);
  assert.equal(isWorking(true, 999_000, 1_000_000), true);
  assert.equal(isWorking(false, 996_000, 1_000_000), true);
  assert.equal(isWorking(false, 990_000, 1_000_000), false);
});

test("boardLines: newest first with status marks and owner", () => {
  const t: any[] = [{ id: "t1", role: "qa", text: "old", status: "done" }, { id: "t2", role: "qa", owner: "Quinn", text: "new", status: "blocked" }, { id: "t3", role: "be", text: "x", status: "pending" }];
  assert.deepEqual(boardLines(t, 2), ["o be: x", "! Quinn: new"]);
  assert.deepEqual(boardLines(undefined), []);
});

test("pickStroller respects idle time and cooldown", () => {
  assert.equal(pickStroller([{ id: "a", lastActive: 90_000, strolledAt: 0 }], 100_000), null);
  assert.equal(pickStroller([{ id: "a", lastActive: 0, strolledAt: 90_000 }], 100_000), null);
  assert.equal(pickStroller([{ id: "b", lastActive: 90_000, strolledAt: 0 }, { id: "a", lastActive: 0, strolledAt: 0 }], 100_000)?.id, "a");
});

test("feedItem names the actors and carries confidence/outcome", () => {
  const f = feedItem(it({ kind: "report", outcome: "blocked", confidence: "guess" }), (i) => i.toUpperCase());
  assert.equal(f.from, "LEAD:S");
  assert.equal(f.outcome, "blocked");
  assert.equal(f.confidence, "guess");
});

test("partial reports are not blocks and strip the PARTIAL prefix", () => {
  const a = planInteraction(it({ kind: "report", from: "a1", to: "lead:s", text: "PARTIAL: half done", outcome: "partial" as never }), ctx());
  assert.deepEqual(a[0], { k: "report", from: "a1", to: "lead:s", text: "half done", partial: true });
});

test("cleanText strips envelope tags and clips", () => {
  assert.equal(cleanText('<agent-message from="x">hi  there</agent-message>'), "hi there");
  assert.equal(cleanText("ok <agent-message from='x"), "ok");
  assert.equal(cleanText("a".repeat(300), 10).length, 10);
  assert.equal(cleanText("1 < 2 and 3 > 2"), "1 < 2 and 3 > 2");
});

test("uniqueNames numbers duplicates by start time", () => {
  const m = uniqueNames([{ id: "b", name: "gp", t: 2 }, { id: "a", name: "gp", t: 1 }, { id: "c", name: "qa", t: 0 }]);
  assert.deepEqual([m.get("a"), m.get("b"), m.get("c")], ["gp 1", "gp 2", "qa"]);
});

test("stackLabels separates overlapping labels and leaves clear ones", () => {
  const dy = stackLabels([{ x: 50, y: 10, w: 40, h: 12 }, { x: 55, y: 12, w: 40, h: 12 }, { x: 300, y: 10, w: 40, h: 12 }]);
  assert.equal(dy[0], 0);
  assert.ok(dy[1] >= 10);
  assert.equal(dy[2], 0);
});

test("stackLabels leaves no overlap however crowded, and alerts keep their place", () => {
  const many = Array.from({ length: 12 }, () => ({ x: 50, y: 10, w: 40, h: 12 }));
  const dy = stackLabels(many);
  const tops = many.map((b, i) => b.y + dy[i]).sort((a, b) => a - b);
  for (let i = 1; i < tops.length; i++) assert.ok(tops[i] >= tops[i - 1] + 12);
  assert.deepEqual(stackLabels([{ x: 50, y: 10, w: 40, h: 12 }, { x: 50, y: 12, w: 40, h: 12, pri: 1 }]), [15, 0]);
});

test("toolKind and skyAt", () => {
  assert.equal(toolKind("Bash"), "term");
  assert.equal(toolKind("Edit"), "edit");
  assert.equal(toolKind("WebFetch"), "web");
  assert.equal(toolKind(undefined), "other");
  assert.equal(skyAt(12).top, 0x7ec8f5);
  assert.equal(skyAt(2).night, true);
  assert.notEqual(skyAt(7).top, skyAt(6.5).top);
});

test("clampBox keeps label boxes inside the floor and centres oversized ones", () => {
  const r = { x: 100, y: 50, w: 200, h: 100 };
  assert.deepEqual(clampBox({ x: 90, y: 40, w: 40, h: 10 }, r), { x: 120, y: 50 });
  assert.deepEqual(clampBox({ x: 295, y: 148, w: 40, h: 10 }, r), { x: 280, y: 140 });
  assert.deepEqual(clampBox({ x: 200, y: 100, w: 40, h: 10 }, r), { x: 200, y: 100 });
  assert.deepEqual(clampBox({ x: 0, y: 0, w: 300, h: 10 }, r), { x: 200, y: 50 });
});

test("hop, drop, pop and quirk curves", () => {
  assert.equal(hopPose(0).y, 0);
  assert.ok(Math.abs(hopPose(180).y + 4) < 1e-9); // apex at the middle of the arc
  assert.equal(hopPose(30).sy, 0.95);
  assert.equal(hopPose(80).sy, 1.08); // take-off smear
  assert.deepEqual(hopPose(HOP_MS), { y: 0, sy: 1 });
  assert.deepEqual([0, 2, 5, 7].map((c) => stepDrop(c, 7)), [2, 5, 7, 7]);
  assert.deepEqual([7, 5, 2, 0].map((c) => stepDrop(c, 0)), [5, 2, 0, 0]);
  assert.ok(Math.abs(popScale(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(popScale(140) - 1) < 1e-9);
  assert.ok(popScale(70) > 1); // easeOutBack overshoots
  assert.equal(quirkAt(0, 0), "stretch");
  assert.equal(quirkAt(2000, 0), null);
  assert.ok(["stretch", "phone", "yawn"].includes(quirkAt(12000 - ((1 << 14) % 12000), 1 << 14)!));
});

test("toolIcon maps tool families, unknown tools get none", () => {
  assert.deepEqual(["Read", "Bash", "Edit", "WebFetch", "Agent", "Grep", "Glob", "Zork"].map(toolIcon), ["book", "term", "pencil", "globe", "arrow", "lens", "lens", null]);
});

test("stackLabels with a floor keeps six door-crowd boxes inside it, apart, or hidden", () => {
  const r = { x: 0, y: 0, w: 300, h: 100 };
  const boxes = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 150 + i * 6, y: 95, w: 60, h: 14, pri: i === 3 ? 1 : 0 }));
  const hide: boolean[] = boxes.map(() => false);
  const dy = stackLabels(boxes, r, hide);
  const out = boxes.map((b, i) => ({ ...clampBox(b, r), w: b.w, h: b.h, i })).map((p, i) => ({ l: p.x - 30, r: p.x + 30, t: p.y + dy[i], b: p.y + dy[i] + 14, i }));
  for (const a of out) {
    if (hide[a.i]) continue;
    assert.ok(a.t >= 0 && a.b <= 100, "inside floor");
    for (const b of out) if (b.i > a.i && !hide[b.i]) assert.ok(a.r <= b.l || a.l >= b.r || a.b <= b.t || a.t >= b.b, `${a.i} overlaps ${b.i}`);
  }
  assert.equal(hide.some(Boolean), false);
  const tiny = boxes.map(() => false);
  stackLabels(boxes, { x: 0, y: 0, w: 300, h: 30 }, tiny);
  assert.ok(tiny.filter(Boolean).length >= 4, "what cannot fit is demoted");
});

test("newAlerts reports only transitions, not every snapshot", async () => {
  const { newAlerts } = await import("./choreo.ts");
  const seen = new Map<string, "waiting" | "blocked">();
  assert.deepEqual(newAlerts(seen, new Map([["a", "waiting"]])), ["a"]);
  assert.deepEqual(newAlerts(seen, new Map([["a", "waiting"]])), []);
  assert.deepEqual(newAlerts(seen, new Map([["a", "blocked"], ["b", "waiting"]])), ["a", "b"]);
  assert.deepEqual(newAlerts(seen, new Map()), []);
  assert.deepEqual(newAlerts(seen, new Map([["a", "blocked"]])), ["a"]); // cleared then raised again
});

test("idle ladder: tiers by silence, coffee then couch", () => {
  assert.deepEqual([0, 5999, 6000, 19_999, 20_000, 59_999, 60_000].map(idleTier), [0, 0, 1, 1, 2, 2, 3]);
  assert.equal(pickStroller([{ id: "a", lastActive: 70_000, strolledAt: 0 }], 100_000)?.where, "coffee"); // 30s silent
  assert.equal(pickStroller([{ id: "a", lastActive: 0, strolledAt: 0 }], 100_000)?.where, "couch"); // 100s silent
});

test("micro-posture is seeded: same inputs, same pose; only in the first 1.5s of a slot", () => {
  const seen = new Set<string | null>();
  for (let t = 0; t < 200_000; t += 250) { assert.equal(microPose(t, 777), microPose(t, 777)); seen.add(microPose(t, 777)); }
  assert.ok(seen.has("look-l") || seen.has("look-r")); assert.ok(seen.has("lean"));
  assert.equal(microPose(1500 - (777 % 5000), 777), null);
});

test("two agents swapping places both get through, even when each wants to yield to the other", () => {
  for (const mutual of [false, true]) {
    const a = { id: "a", pos: { x: 0, y: 0 }, to: 100, held: 0 }, b = { id: "b", pos: { x: 100, y: 0 }, to: 0, held: 0 };
    let t = 0;
    for (; t < 20_000 && (Math.abs(a.pos.x - a.to) > 0.5 || Math.abs(b.pos.x - b.to) > 0.5); t += 16) {
      for (const w of [a, b]) {
        const o = w === a ? b : a, n = { x: w.to, y: 0 };
        const want = mutual || yieldsTo(w, n, o);
        w.held = stepHold(w.held, want, 16);
        if (!holds(w.held, want)) w.pos.x += Math.sign(w.to - w.pos.x) * Math.min(0.64, Math.abs(w.to - w.pos.x)); // 40 px/s
      }
    }
    assert.ok(t < 20_000, `deadlock (mutual=${mutual})`);
  }
  // a hold is capped, then slips for SLIP_MS, then rearms
  let h = 0, held = 0;
  for (let ms = 0; ms < YIELD_MAX_MS + SLIP_MS; ms += 10) { h = stepHold(h, true, 10); if (holds(h, true)) held++; }
  assert.ok(held * 10 <= YIELD_MAX_MS + 20 && stepHold(YIELD_MAX_MS + SLIP_MS, true, 10) === 0);
});

test("door token: leavers first, then lowest id, others unaffected", () => {
  const door = { x: 0, y: 0 }, p = (id: string, x: number, leaving = false) => ({ id, pos: { x, y: 0 }, leaving });
  assert.equal(doorHold(p("b", 2), p("z", 10, true), door, 24), true); // a leaver near the door goes first
  assert.equal(doorHold(p("b", 2), p("a", 5), door, 24), true); // lower id arriver still in the doorway
  assert.equal(doorHold(p("a", 2), p("b", 5), door, 24), false);
  assert.equal(doorHold(p("b", 60), p("z", 10, true), door, 24), false); // far from the door: not held
  assert.equal(doorHold(p("b", 2), p("z", 50, true), door, 24), false);
});

test("tether fades 600ms after the ticket lands; load and hue helpers", () => {
  assert.deepEqual([0, 499, 500, 800, 1100, 5000].map(tetherAlpha), [1, 1, 1, 0.5, 0, 0]);
  assert.deepEqual([0, 1, 2, 3, 5, 6, 40].map(loadLevel), [0, 1, 1, 2, 2, 3, 3]);
  for (let i = 0; i < 400; i++) {
    const h = sessionHue(`s${i}`);
    for (const st of [39, 154, 193, 354]) assert.ok(Math.abs(((h - st + 540) % 360) - 180) >= 25, `hue ${h} too close to status ${st}`);
    assert.ok(!(h > 315 && h < 345), `hue ${h} is the magenta neon`);
    assert.equal(h, sessionHue(`s${i}`));
  }
});

test("shrink ratchet: grow is instant, a row decays after 90s empty, never while a desk in it is used", () => {
  const s: Shrink = { floor: 0, since: 0 };
  const S = 1000;
  assert.equal(shrinkFloor(s, 24, 0, 0), 24); // grow at once
  assert.equal(shrinkFloor(s, 8, 0, 80 * S), 24); // demand fell, not yet 90s
  assert.equal(shrinkFloor(s, 8, 0, 90 * S), 12); // one row (12..23) goes
  assert.equal(shrinkFloor(s, 8, 0, 120 * S), 12); // one step per 90s
  assert.equal(shrinkFloor(s, 8, 0, 180 * S), 8);
  // a desk in the trailing row blocks the step and restarts the clock
  const u: Shrink = { floor: 24, since: 0 };
  assert.equal(shrinkFloor(u, 8, 17, 100 * S), 24); // desk 16 is used
  assert.equal(shrinkFloor(u, 8, 17, 150 * S), 24);
  assert.equal(shrinkFloor(u, 8, 0, 200 * S), 24); // vacated at 150s: only 50s empty
  assert.equal(shrinkFloor(u, 8, 0, 241 * S), 12);
  // floor never drops below the highest desk in use
  const v: Shrink = { floor: 24, since: 0 };
  for (let t = 0; t <= 600; t += 10) assert.ok(shrinkFloor(v, 8, 14, t * S) >= 14);
});

test("stackLabels: a downward-preferring box (lead plaque) never goes up over its own desk when a lower spot is free", () => {
  const boxes = [{ x: 100, y: 50, w: 80, h: 24, pri: 0, dir: 1 as const }, { x: 130, y: 50, w: 80, h: 24, pri: 0, dir: 1 as const }];
  const dy = stackLabels(boxes);
  assert.ok(dy.every((d) => d >= 0), JSON.stringify(dy));
});

import { pushCapped, sipState, MAX_QUEUED } from "./choreo.ts";
test("pushCapped is FIFO and drops the oldest past the cap", () => {
  const q: number[] = [];
  for (let i = 0; i < MAX_QUEUED + 3; i++) pushCapped(q, i);
  assert.equal(q.length, MAX_QUEUED);
  assert.equal(q[0], 3);
});
test("sipState: only in tier 1 and only when calm; still never sips", () => {
  for (const s of [0, 3000, 25_000, 90_000]) assert.equal(sipState(s, true, false, 1000, 7), "none");
  assert.equal(sipState(10_000, false, false, 1000, 7), "none");
  let sips = 0;
  for (let t = 0; t < 200_000; t += 250) { assert.notEqual(sipState(10_000, true, true, t, 7), "sip"); if (sipState(10_000, true, false, t, 7) === "sip") sips++; }
  assert.ok(sips > 0);
});
test("stackLabels: an alert flag pushes other tags away but not its owner's (A8)", () => {
  const me = {}, other = {};
  const flag = { x: 50, y: 0, w: 10, h: 10, pri: 2, own: me };
  assert.deepEqual(stackLabels([flag, { x: 50, y: 2, w: 40, h: 8, own: me }]), [0, 0], "own tag stays put");
  assert.ok(stackLabels([flag, { x: 50, y: 2, w: 40, h: 8, own: other }])[1] >= 9, "a neighbour's tag yields");
});

test("longToolMs: 3x the tool's own p95 once known, floored at 10 s; 30 s before that", () => {
  assert.equal(longToolMs(undefined), 30_000);
  assert.equal(longToolMs({ n: 4, p95: 1000 }), 30_000);
  assert.equal(longToolMs({ n: 5, p95: 1000 }), 10_000);
  assert.equal(longToolMs({ n: 20, p95: 60_000 }), 180_000);
});

import { collapseLatch, worstState } from "./choreo.ts";
test("session collapse: folds when a figure is under 20 screen px, unfolds from 24; worst state follows STATUS order", () => {
  assert.equal(collapseLatch(false, 20), false); // legible: helpers stay on the floor, however many there are
  assert.equal(collapseLatch(false, 19), true);
  assert.equal(collapseLatch(true, 23), true); // hysteresis: a small zoom back does not unfold
  assert.equal(collapseLatch(true, 24), false);
  const w = (...s: ("working" | "idle" | "blocked" | "waiting" | "queued")[]) => worstState(s.map((x) => ({ s: x, wait: "turn" as const })));
  assert.equal(w(), "idle");
  assert.equal(w("idle", "working"), "working");
  assert.equal(w("working", "blocked"), "blocked");
  assert.equal(w("blocked", "waiting"), "turn");
  assert.equal(worstState([{ s: "waiting", wait: "turn" }, { s: "waiting", wait: "permission" }]), "permission");
  assert.equal(w("queued"), "idle");
});

test("alertsFor: a helper's permission prompt rings on that helper, not the lead (C1)", () => {
  const st = { sessions: { s: { id: "s", waiting: true, waitBy: "h1" } }, agents: { h1: { id: "h1" } } } as unknown as Parameters<typeof alertsFor>[0];
  assert.deepEqual([...alertsFor(st, [], (x) => `lead:${x}`)], [["h1", "waiting"]]);
  const gone = { ...st, agents: {} } as unknown as Parameters<typeof alertsFor>[0];
  assert.deepEqual([...alertsFor(gone, [], (x) => `lead:${x}`)], [["lead:s", "waiting"]], "unknown agent: falls back to the lead");
});

test("waitsFor: per-agent waits when the daemon sends them, else the derived one; soft turns stay soft (S3/R2)", async () => {
  const { waitsFor } = await import("./choreo.ts");
  type S = Parameters<typeof waitsFor>[0];
  const L = (x: string) => `lead:${x}`;
  const both = { sessions: { s: { id: "s", waiting: true, waitKind: "permission", waitBy: "h1", waits: [{ agent: "h1", kind: "permission", since: 1 }, { agent: "h2", kind: "permission", since: 2 }, { agent: "lead:s", kind: "turn", since: 3, soft: true }] } }, agents: { h1: {}, h2: {} } } as unknown as S;
  assert.deepEqual([...waitsFor(both, L)], [["h1", { kind: "permission", soft: false }], ["h2", { kind: "permission", soft: false }], ["lead:s", { kind: "turn", soft: true }]]);
  const old = { sessions: { s: { id: "s", waiting: true, waitKind: "turn", waitSoft: true } }, agents: {} } as unknown as S;
  assert.deepEqual([...waitsFor(old, L)], [["lead:s", { kind: "turn", soft: true }]], "no waits list: the derived wait, on the lead");
  const two = { sessions: { s: { id: "s", waiting: true, waits: [{ kind: "turn", soft: true }, { kind: "permission" }] } }, agents: {} } as unknown as S;
  assert.deepEqual(waitsFor(two, L).get("lead:s"), { kind: "permission", soft: false }, "the louder wait wins");
  const ask = { sessions: { s: { id: "s", waiting: true, waits: [{ agent: "lead:s", kind: "question", since: 1 }] } }, agents: {} } as unknown as S;
  assert.deepEqual(waitsFor(ask, L).get("lead:s"), { kind: "turn", soft: false }, "a question is your turn, never the permission sign");
});

test("tether dots: whole art pixels on an across-then-down route, evenly spaced, sliding with the phase (R6)", async () => {
  const { tetherDots } = await import("./choreo.ts");
  const pts: [number, number][] = [];
  tetherDots(10.4, 50, 19, 40, 0, (x, y) => pts.push([x, y]));
  assert.deepEqual(pts, [[10, 50], [13, 50], [16, 50], [19, 50], [19, 47], [19, 44], [19, 41]]);
  const moved: number[] = [];
  tetherDots(0, 0, 9, 0, 4, (x) => moved.push(x));
  assert.deepEqual(moved, [1, 4, 7]);
});
