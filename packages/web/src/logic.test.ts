import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "@agent-office/core";
import { captionText, chimeGate, groupOf, holder, podOwners, radar, spendCrossed, statusGroups, viewRect, whoLine } from "./logic.ts";
import type { ActorInfo, FeedItem } from "./api.ts";

test("podOwners: majority project per pod, empty pods are blank", () => {
  const m = new Map([["d0", "a"], ["d1", "b"], ["d2", "b"], ["d4", "a"], ["lobby#0", "z"], ["d99", "q"]]);
  assert.deepEqual(podOwners(m, 3), ["b", "a", ""]);
});

test("viewRect maps the viewport into art px", () => {
  assert.deepEqual(viewRect({ sc: 2, ox: -100, oy: 34 }, 800, 34, 600), { x: 50, y: 0, w: 400, h: 300 });
});

test("freeze holder keeps only the newest and counts the rest", () => {
  let on = false;
  const h = holder<number>(() => on);
  assert.equal(h.offer(1), false); // live: pass through
  on = true;
  assert.equal(h.offer(2), true); h.offer(3); h.offer(4);
  assert.equal(h.n, 3);
  assert.equal(h.take(), 4);
  assert.deepEqual([h.n, h.take()], [0, null]);
});

test("status groups: order, bucket, empty groups dropped", () => {
  const row = (s: string, id: string) => ({ a: { id } as ActorInfo, s });
  const g = statusGroups([row("idle", "i"), row("blocked", "b"), row("thinking", "t"), row("waiting", "w")]);
  assert.deepEqual(g.map((x) => [x.id, x.rows.map((r) => r.a.id)]), [["need", ["b", "w"]], ["work", ["t"]], ["idle", ["i"]]]);
  assert.equal(groupOf("queued"), "work");
  assert.deepEqual(statusGroups([row("idle", "i")]).map((x) => x.id), ["idle"]);
});

test("spend alarm fires once on the crossing, never on first sight", () => {
  const was = new Map<string, boolean>();
  assert.equal(spendCrossed(was, "s", 500, 100), false); // already above at load
  assert.equal(spendCrossed(was, "t", 50, 100), false);
  assert.equal(spendCrossed(was, "t", 150, 100), true);
  assert.equal(spendCrossed(was, "t", 900, 100), false);
  assert.equal(spendCrossed(was, "t", 900, 0), false); // alarm off
});

test("chime gate dedupes keys and rate-limits globally and per kind", () => {
  const g = chimeGate(1000, 5000);
  assert.equal(g("blocked", "a", 0), true);
  assert.equal(g("blocked", "a", 9000), false); // same key
  assert.equal(g("waiting", "b", 500), false); // global limit
  assert.equal(g("waiting", "b2", 600), false); // key already seen above
  assert.equal(g("waiting", "c", 1500), true);
  assert.equal(g("blocked", "d", 3000), false); // per-kind limit
  assert.equal(g("blocked", "e", 6000), true);
});

test("caption wording: plain sentences, report prefixes not repeated, lead notes read as the lead speaking", () => {
  const f = (o: Partial<FeedItem>): FeedItem => ({ id: 1, t: 0, kind: "report", session: "s", from: "Dev", to: "shop", text: "DONE: added the model", ...o } as FeedItem);
  assert.equal(whoLine(f({ outcome: "done" })), "Dev finished");
  assert.equal(whoLine(f({ outcome: "blocked" })), "Dev gave up");
  assert.equal(whoLine(f({ outcome: undefined, text: "notes" })), "Dev reported", "C3: an unprefixed report is not 'finished'");
  assert.equal(captionText(f({})), "added the model");
  assert.equal(captionText(f({ kind: "prompt", text: "DONE is a word" })), "DONE is a word");
  assert.equal(whoLine(f({ kind: "message", from: "shop", to: "user", text: "Report: DONE: x" })), "shop says");
});

test("sessionColor uses the scene's session hue, so a session has one identity colour everywhere", async () => {
  const { sessionColor } = await import("./logic.ts");
  const { sessionHue } = await import("./choreo.ts");
  assert.equal(sessionColor("abc"), `hsl(${sessionHue("abc")} 70% 72%)`);
});
