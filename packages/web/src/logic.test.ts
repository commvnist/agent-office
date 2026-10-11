import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "@agent-office/core";
import { chimeGate, groupOf, holder, loopOf, podOwners, radar, spendCrossed, statusGroups, viewRect } from "./logic.ts";
import type { ActorInfo } from "./api.ts";

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

test("loop episode: one radar key while the loop lasts, new key after it ends", () => {
  const st = emptyState();
  st.sessions.s = { id: "s", project: "p", waiting: false, startedAt: 0 } as never;
  st.agents.a = { id: "a", session: "s", role: "qa", loop: { tool: "Bash", n: 4 } } as never;
  const ac = [{ id: "a", label: "QA", lead: false, status: "working", project: "p" } as ActorInfo];
  const keys = () => radar(ac, st, 1000, (_k, f) => f).filter((i) => i.kind === "loop");
  assert.deepEqual(keys().map((i) => [i.key, i.reason]), [["loop:a", "loop ×4 · Bash"]]);
  (st.agents.a as { loop?: unknown }).loop = { tool: "Edit", n: 9 };
  assert.equal(keys()[0].key, "loop:a"); // tool and count change, same episode
  delete (st.agents.a as { loop?: unknown }).loop;
  assert.equal(keys().length, 0);
  assert.equal(loopOf(st, "lead:s"), undefined);
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
