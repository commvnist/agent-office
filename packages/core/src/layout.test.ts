import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, deskPos, findPath, MAX_DESKS, seatTile, standNear } from "./layout.ts";

const cfg = { roles: { qa: { agent: "qa-engineer", count: 2, overflow: { max: 2 } }, fe: { agent: "frontend-dev", count: 1 } } };

test("every seat is walkable and reachable from the door", () => {
  const l = buildLayout(cfg);
  for (const [id, t] of Object.entries(l.seats)) {
    assert.ok(!l.blocked.has(`${t.x},${t.y}`), `${id} sits on a blocked tile`);
    assert.ok(findPath(l, l.door, t).length > 0, `${id} unreachable`);
  }
});

test("lobby, queue and every desk (any demand) are reachable from the door; seats never fall back", () => {
  for (const demand of [undefined, { agents: 3 }, { agents: 30 }, { agents: 500 }]) {
    const l = buildLayout(cfg, { demand });
    for (const t of [...l.lobby, ...l.zones.flatMap((z) => z.queue)]) {
      assert.ok(!l.blocked.has(`${t.x},${t.y}`));
      assert.ok(findPath(l, l.door, t).length > 0);
    }
    assert.equal(Object.keys(l.seats).length, l.props.length);
    for (const id of Object.keys(l.seats)) assert.deepEqual(seatTile(l, id), l.seats[id]);
    const q = new Set(l.zones.flatMap((z) => z.queue).map((t) => `${t.x},${t.y}`));
    assert.ok(l.props.every((p) => !q.has(`${p.x},${p.y}`)));
  }
});

test("desk count follows demand, whole pods, capped; deskPos is append-only", () => {
  const n = (agents?: number) => Object.keys(buildLayout(cfg, { demand: agents === undefined ? undefined : { agents } }).seats).length;
  assert.equal(n(), 8);
  assert.equal(n(10), 16);
  assert.equal(n(30), 36);
  assert.equal(n(500), MAX_DESKS);
  const small = buildLayout(cfg, { demand: { agents: 4 } }), big = buildLayout(cfg, { demand: { agents: 60 } });
  assert.deepEqual(Object.keys(big.seats).length, 64);
  for (const [id, t] of Object.entries(small.seats)) assert.deepEqual(big.seats[id], t);
  assert.equal(new Set(Object.values(big.seats).map((t) => `${t.x},${t.y}`)).size, 64);
  assert.deepEqual(seatTile(small, "d63"), deskPos(63));
});

test("pod field is landscape: 6 pods per row, positions pinned", () => {
  assert.deepEqual(deskPos(0), { x: 2, y: 7 });
  assert.deepEqual(deskPos(23), { x: 24, y: 9 }); // last desk of pod row 1
  assert.deepEqual(deskPos(24), { x: 2, y: 12 }); // pod 6 starts row 2
  assert.equal(buildLayout(cfg, { demand: { agents: 500 } }).zones.length, 3); // 64 desks, 16 pods
  assert.equal(buildLayout(cfg, { demand: { agents: 20 } }).zones.length, 1); // ~20 desks: one row
});

test("desks sit directly below their seat; lead desks below lobby seats", () => {
  const l = buildLayout(cfg);
  for (const p of l.props) assert.deepEqual(l.seats[p.seat!], { x: p.x, y: p.y - 1 });
  for (const t of l.lobby) assert.ok(l.blocked.has(`${t.x},${t.y + 1}`));
});

test("standNear spreads visitors over distinct free tiles", () => {
  const l = buildLayout(cfg);
  const at = l.seats.d0;
  const spots = new Set([0, 1, 2, 3].map((k) => JSON.stringify(standNear(l, at, k))));
  assert.equal(spots.size, 4);
  for (const s of spots) assert.ok(!l.blocked.has(JSON.parse(s).x + "," + JSON.parse(s).y));
});

test("server rack tile is blocked, decor is never a seat", () => {
  const l = buildLayout(cfg);
  assert.ok(l.decor.some((d) => d.kind === "rack" && d.x === 2 && d.y === l.wallRows));
  assert.ok(l.blocked.has(`2,${l.wallRows}`));
});
