import { test } from "node:test";
import assert from "node:assert/strict";
import type { OfficeEvent } from "@agent-office/core";
import { fetchHistory, gantt, markers, pickRange, rangeStats, toCsv, waterfall, zoomView } from "./history.ts";
import { posterModel } from "./logic.ts";
import { emptyState } from "@agent-office/core";
import { t } from "./i18n.ts";

const ev = (x: unknown) => x as OfficeEvent;
const E = [
  ev({ type: "session_start", session: "s", project: "p", t: 0 }),
  ev({ type: "agent_start", session: "s", agentId: "a", agentType: "qa", t: 10 }),
  ev({ type: "tool_end", session: "s", tool: "Bash", ok: false, error: "=x,\"y\"", t: 20 }),
  ev({ type: "agent_stop", session: "s", agentId: "a", message: "BLOCKED: no", t: 30 }),
  ev({ type: "waiting", session: "s", t: 40 }),
];
test("markers and gantt", () => {
  assert.deepEqual(markers(E).map((m) => [m.i, m.kind]), [[1, "session_start"], [3, "error"], [4, "blocked"], [5, "waiting"]]);
  const g = gantt(E);
  assert.equal(g.rows.length, 1);
  assert.deepEqual(g.rows[0].bars.map((b) => [b.kind, b.s, b.e]), [["session", 0, 40], ["agent", 10, 30]]);
});
test("csv quotes and defuses formulas", () => {
  assert.match(toCsv(E).split("\n")[3], /"'=x,""y"""/);
});
test("poster adds tokens, longest agent and errors", () => {
  const s = emptyState();
  s.sessions.s = { id: "s", project: "p", waiting: false, startedAt: 0, errors: 2, usage: { input: 5, output: 7, cacheRead: 0, cacheCreate: 0 } } as never;
  s.agents.a = { id: "a", session: "s", role: "qa", agentType: "qa", startedAt: 1000, errors: 1 } as never;
  const m = posterModel(s, 61_000);
  assert.deepEqual([m.tokens, m.errors, m.longest?.minutes], [12, 3, 1]);
});
test("plural message", () => {
  assert.equal(t("session", { n: 1 }, "en"), "1 session");
  assert.equal(t("session", { n: 3 }, "en"), "3 sessions");
});
test("fetchHistory sends until, trims client-side, and reports the limit", async () => {
  const realFetch = globalThis.fetch;
  let url = "";
  const ev = (t: number) => ({ type: "waiting", session: "s", t }) as unknown as OfficeEvent;
  globalThis.fetch = (async (u: string) => { url = String(u); return new Response(JSON.stringify({ events: [ev(1), ev(5), ev(9)] })); }) as typeof fetch;
  try {
    const r = await fetchHistory(0, 6, true);
    assert.match(url, /until=6/);
    assert.match(url, /private=1/);
    assert.deepEqual(r.events.map((e) => e.t), [1, 5]);
    assert.equal(r.limited, false);
    globalThis.fetch = (async () => new Response("", { status: 401 })) as typeof fetch;
    await assert.rejects(fetchHistory(0), /unauthorized/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("waterfall rows carry the outcome; range maths", () => {
  const w = waterfall(E);
  assert.deepEqual(w.rows.map((r) => [r.kind, r.s, r.e, r.outcome ?? ""]), [["session", 0, 40, ""], ["agent", 10, 30, "blocked"]]);
  assert.equal(w.rows[0].open, true);
  assert.deepEqual(rangeStats(w, { t0: 15, t1: 35 }), { ms: 20, events: 2, agents: 1 }); // tool_end@20, agent_stop@30
  assert.deepEqual(rangeStats(w, { t0: 31, t1: 39 }), { ms: 8, events: 0, agents: 0 });
});
test("pickRange sorts and clamps; zoomView keeps the anchor and the bounds", () => {
  const full = { t0: 0, t1: 10_000 };
  assert.deepEqual(pickRange(300, 100, 100, 200, full), full); // drag right-to-left, ends clamped to the plot
  const z = zoomView(full, 2, 5000, full);
  assert.deepEqual(z, { t0: 2500, t1: 7500 });
  assert.deepEqual(zoomView(z, 0.01, 5000, full), full); // zooming far out stops at the data
  assert.equal(zoomView(full, 1e9, 0, full).t1 - zoomView(full, 1e9, 0, full).t0, 1000); // and far in at MIN_SPAN
});
