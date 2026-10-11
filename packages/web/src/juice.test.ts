import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interaction } from "@agent-office/core";
import { crowdLod, easeOutBack, jitterX, planInteraction, squashY, ticketFor, ticketT, TICKET_MS, ticketEnd, couchSeats, type PlanCtx } from "./choreo.ts";

const it = (o: Partial<Interaction>): Interaction => ({ id: 1, t: 1000, kind: "delegate", session: "s", from: "lead:s", to: "a1", text: "do it", ...o });
const ctx = (log: Interaction[] = [], ids = ["lead:s", "a1", "a2"]): PlanCtx => ({ has: (i) => ids.includes(i), resolve: (h) => ids.find((i) => i === h), log });

test("tickets: delegation goes out, reports come back, blocked/partial are marked", () => {
  assert.deepEqual(ticketFor(it({}), ctx()), { from: "lead:s", to: "a1", kind: "send" });
  const rep = (o: Partial<Interaction>) => it({ kind: "report", from: "a1", to: "lead:s", ...o });
  assert.equal(ticketFor(rep({ outcome: "done" }), ctx())?.kind, "done");
  assert.equal(ticketFor(rep({ outcome: "blocked" }), ctx())?.kind, "blocked");
  assert.equal(ticketFor(rep({ outcome: "partial" as never }), ctx())?.kind, "partial");
  assert.equal(ticketFor(it({ kind: "prompt" }), ctx()), null);
  assert.equal(ticketFor(it({}), ctx([], ["a1"])), null);
});

test("ticket flight: eases to the end, a stalled one stops midway", () => {
  assert.equal(ticketT(0), 0);
  assert.ok(Math.abs(ticketT(TICKET_MS) - 1) < 1e-9);
  assert.ok(Math.abs(ticketT(TICKET_MS * 3) - 1) < 1e-9); // no stall: every ticket reaches its end
});

test("squash and jitter curves", () => {
  assert.ok(Math.abs(squashY(0) - 0.7) < 1e-9);
  assert.equal(squashY(180), 1);
  assert.ok(easeOutBack(0.7) > 1); // overshoots before settling
  assert.deepEqual([0, 100, 200, 300, 400].map(jitterX), [1, -1, 1, -1, 0]);
});

test("crowd LOD latches: on above 24, off below 18, heavy stacking only counts from 18 up", () => {
  assert.equal(crowdLod(false, 24, 0), false);
  assert.equal(crowdLod(false, 25, 0), true);
  assert.equal(crowdLod(true, 20, 0), true);
  assert.equal(crowdLod(true, 17, 0), false);
  assert.equal(crowdLod(false, 20, 9), true);
  assert.equal(crowdLod(false, 10, 30), false);
});

test("huddle lists the burst's distinct receivers", () => {
  const log = [it({ id: 1, t: 1000, to: "a1" }), it({ id: 2, t: 3000, to: "a2" })];
  const a = planInteraction(log[1], ctx(log))[1];
  assert.deepEqual(a.k === "huddle" && a.members, ["a1", "a2"]);
});

test("a send ticket ends on a desk tile or on the recipient, never on bare floor", () => {
  const T = 16, feetOf = (t: { x: number; y: number }) => ({ x: t.x * T + 8, y: t.y * T + T });
  const desks = new Set(["3,8"]), deskAt = (t: { x: number; y: number }) => desks.has(`${t.x},${t.y}`);
  const pos = { x: 50, y: 200 };
  const atDesk = { x: 56, y: 144 }; // the recipient's feet are on the desk tile
  assert.deepEqual(ticketEnd("send", { home: { x: 3, y: 8 }, seated: true, pos: atDesk }, deskAt, feetOf), { x: 56, y: 140 }); // desk
  assert.deepEqual(ticketEnd("send", { home: { x: 3, y: 8 }, seated: true, pos }, deskAt, feetOf), { x: 50, y: 192 }); // assigned but still walking in: follows them
  assert.deepEqual(ticketEnd("send", { home: { x: 5, y: 20 }, seated: false, pos }, deskAt, feetOf), { x: 50, y: 192 }); // queued: waiting-row tile
  assert.deepEqual(ticketEnd("send", { home: null, seated: true, pos }, deskAt, feetOf), { x: 50, y: 192 }); // no desk yet
  assert.deepEqual(ticketEnd("send", { home: { x: 9, y: 9 }, seated: true, pos }, deskAt, feetOf), { x: 50, y: 192 }); // seat beyond the built desks
  assert.deepEqual(ticketEnd("done", { home: { x: 3, y: 8 }, seated: true, pos }, deskAt, feetOf), { x: 50, y: 192 });
});

test("couchSeats: one centred seat per tile", () => {
  assert.deepEqual(couchSeats({ x: 4, y: 10, w: 2 }, 16), [{ x: 72, y: 175 }, { x: 88, y: 175 }]);
  assert.equal(couchSeats({ x: 4, y: 10 }, 16).length, 1);
});

test("the lead's own words (a message to the user) become a bubble at its desk, not a visit", () => {
  const a = planInteraction(it({ kind: "message", from: "lead:s", to: "user", text: "Fixing the header now." }), ctx([], ["lead:s"]));
  assert.deepEqual(a, [{ k: "say", id: "lead:s", text: "Fixing the header now." }]);
  assert.deepEqual(planInteraction(it({ kind: "message", from: "lead:s", to: "user", text: "" }), ctx([], ["lead:s"])), []);
});
