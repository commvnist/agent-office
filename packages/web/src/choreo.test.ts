import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interaction } from "@agent-office/core";
import { planInteraction, alertsFor, statusOf, isWorking, boardLines, pickStroller, feedItem, cleanText, uniqueNames, stackLabels, toolKind, skyAt, clampBox, hopPose, stepDrop, popScale, quirkAt, toolIcon, HOP_MS, type PlanCtx } from "./choreo.ts";

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
  assert.deepEqual(planInteraction(rep({ outcome: "done", text: "DONE: shipped" }), ctx()), [{ k: "report", from: "a1", to: "lead:s", text: "shipped" }]);
  assert.deepEqual(planInteraction(rep({ outcome: "empty", text: "" }), ctx()), [{ k: "report", from: "a1", to: "lead:s", text: "Done." }]);
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
