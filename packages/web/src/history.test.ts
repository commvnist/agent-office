import { test } from "node:test";
import assert from "node:assert/strict";
import type { OfficeEvent } from "@agent-office/core";
import { awayCounts, fetchHistory, historyRange, gantt, markers, pickRange, rangeStats, toCsv, waterfall, zoomView } from "./history.ts";
import { MSG, t } from "./i18n.ts";

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
test("X2: a stored stop's outcome field wins over the message prefix; away counts use it", () => {
  const stop = (o: object) => ev({ type: "agent_stop", session: "s", agentId: "a", t: 30, ...o });
  const W = [E[0], E[1], stop({ outcome: "done" })];
  assert.equal(waterfall(W).rows[1].outcome, "done");
  assert.equal(waterfall([E[0], E[1], stop({ outcome: "empty" })]).rows[1].outcome, undefined);
  assert.deepEqual(markers([stop({ outcome: "blocked" })]).map((m) => m.kind), ["blocked"]);
  assert.deepEqual(awayCounts([stop({ outcome: "done" }), stop({ message: "BLOCKED: x" }), stop({ outcome: "blocked" }), stop({ outcome: "empty" })]), { done: 1, gaveUp: 2 });
});
test("csv quotes and defuses formulas", () => {
  assert.match(toCsv(E).split("\n")[3], /"'=x,""y"""/);
});
test("plural message", () => {
  assert.equal(t("session", { n: 1 }, "en"), "1 session");
  assert.equal(t("session", { n: 3 }, "en"), "3 sessions");
  MSG.pl = { file: { one: "{n} plik", few: "{n} pliki", many: "{n} plików", other: "{n} pliku" } }; // P4: every CLDR category, not one/other
  assert.deepEqual([1, 3, 5, 1.5].map((n) => t("file", { n }, "pl")), ["1 plik", "3 pliki", "5 plików", "1.5 pliku"]);
  delete MSG.pl;
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
    globalThis.fetch = (async () => new Response(JSON.stringify({ events: [ev(1)], more: true }))) as typeof fetch;
    assert.equal((await fetchHistory(0)).limited, true); // the daemon's `more` decides, not the page size
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

test("historyRange presets: since last visit (at least an hour), first visit 24 h, week, custom", () => {
  const now = 100 * 3600e3;
  assert.deepEqual(historyRange("last", now, now - 5 * 3600e3), { since: now - 5 * 3600e3, until: 0 });
  assert.deepEqual(historyRange("last", now, now - 60e3), { since: now - 3600e3, until: 0 });
  assert.deepEqual(historyRange("last", now, 0), { since: now - 24 * 3600e3, until: 0 });
  assert.deepEqual(historyRange("week", now, 0), { since: now - 7 * 24 * 3600e3, until: 0 });
  assert.deepEqual(historyRange("custom", now, 0, { since: 5, until: 9 }), { since: 5, until: 9 });
  assert.deepEqual(historyRange("custom", now, 0, { since: 5, until: 2 }), { since: 5, until: 0 }); // an end before the start means now
  assert.ok(historyRange("today", now, 0).since <= now);
});
