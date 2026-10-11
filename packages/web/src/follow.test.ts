import { test } from "node:test";
import assert from "node:assert/strict";
import { followDue, pickBusiest, FOLLOW_PAUSE_MS } from "./follow.ts";

test("pickBusiest: most recent tool events win, old events and idle agents do not count", () => {
  const now = 100_000;
  assert.equal(pickBusiest([{ id: "a", hits: [now - 1000] }, { id: "b", hits: [now - 2000, now - 3000] }], now), "b");
  assert.equal(pickBusiest([{ id: "a", hits: [now - 40_000] }, { id: "b", hits: [] }], now), null);
  assert.equal(pickBusiest([{ id: "a", hits: [now - 5000] }, { id: "b", hits: [now - 1000] }], now), "b"); // tie: most recent
});

test("followDue: off, frozen, presenter, reduced motion and a recent manual pan all hold the camera still", () => {
  const ok = { mode: "busiest", frozen: false, presenter: false, reduced: false, now: 100_000, touched: 100_000 - FOLLOW_PAUSE_MS };
  assert.equal(followDue(ok), true);
  assert.equal(followDue({ ...ok, mode: "off" }), false);
  assert.equal(followDue({ ...ok, frozen: true }), false);
  assert.equal(followDue({ ...ok, presenter: true }), false);
  assert.equal(followDue({ ...ok, reduced: true }), false);
  assert.equal(followDue({ ...ok, touched: ok.now - FOLLOW_PAUSE_MS + 1 }), false);
});
