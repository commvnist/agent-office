import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, deskPos, findPath, FLOOR_DESKS, floorsOf, floorTop, MAX_DESKS, podRow, podStyle, seatTile, standNear } from "./layout.ts";

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

test("desk count follows demand, whole mirror pairs of pods (8 desks), capped; deskPos is append-only", () => {
  const n = (agents?: number) => Object.keys(buildLayout(cfg, { demand: agents === undefined ? undefined : { agents } }).seats).length;
  assert.equal(n(), 8);
  assert.equal(n(10), 16);
  assert.equal(n(30), 40);
  for (const a of [0, 1, 4, 5, 12, 13, 20, 29, 44, 61]) assert.equal(n(a) % 8, 0);
  assert.equal(n(500), MAX_DESKS);
  const small = buildLayout(cfg, { demand: { agents: 4 } }), big = buildLayout(cfg, { demand: { agents: 60 } });
  assert.deepEqual(Object.keys(big.seats).length, 64);
  for (const [id, t] of Object.entries(small.seats)) assert.deepEqual(big.seats[id], t);
  assert.equal(new Set(Object.values(big.seats).map((t) => `${t.x},${t.y}`)).size, 64);
  assert.deepEqual(seatTile(small, "d63"), deskPos(63));
});

test("pod field is landscape: 6 pods per row, positions pinned", () => {
  assert.deepEqual(deskPos(0), { x: 10, y: 7 }); // first pod sits beside the door aisle
  assert.deepEqual(deskPos(23), { x: 24, y: 9 }); // last desk of pod row 1
  assert.deepEqual(deskPos(24), { x: 10, y: 12 }); // pod 6 starts row 2, again beside the aisle
  assert.equal(buildLayout(cfg, { demand: { agents: 60 } }).zones.length, 3); // 64 desks, 16 pods
  assert.equal(buildLayout(cfg, { demand: { agents: 500 } }).zones.length, 9); // 3 floors x 3 pod rows
  assert.equal(buildLayout(cfg, { demand: { agents: 20 } }).zones.length, 1); // ~20 desks: one row
});

test("floors: desk 64+i sits where desk i does, one floor (3 pod rows) lower; growing across floors only adds", () => {
  for (let i = 0; i < FLOOR_DESKS; i++) for (const f of [1, 2]) {
    const a = deskPos(i), b = deskPos(f * FLOOR_DESKS + i);
    assert.deepEqual(b, { x: a.x, y: a.y + floorTop(f) - floorTop(0) });
    assert.equal(podStyle(f * 16 + Math.floor(i / 4)), podStyle(Math.floor(i / 4)));
  }
  assert.equal(podRow(16), 3); // floor 2 starts a new pod row below floor 1's short third row
  const one = buildLayout(cfg, { demand: { agents: 60 } }), two = buildLayout(cfg, { demand: { agents: 100 } }), all = buildLayout(cfg, { demand: { agents: 500 } });
  assert.deepEqual([floorsOf(one), floorsOf(two), floorsOf(all)], [1, 2, 3]);
  for (const [id, t] of Object.entries(one.seats)) { assert.deepEqual(two.seats[id], t); assert.deepEqual(all.seats[id], t); }
  for (const [id, t] of Object.entries(two.seats)) assert.deepEqual(all.seats[id], t);
  assert.equal(new Set(Object.values(all.seats).map((t) => `${t.x},${t.y}`)).size, MAX_DESKS);
  for (const id of ["d64", "d191"]) assert.ok(findPath(all, all.door, all.seats[id]).length > 0, `${id} unreachable`);
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

test("pod styles: designed table, mirror pods share a style, only bench+huddle block the middle tiles", () => {
  const styles = Array.from({ length: 16 }, (_, p) => podStyle(p));
  assert.deepEqual(styles.slice(0, 12), ["huddle", "huddle", "solo", "solo", "standing", "standing", "bench", "bench", "solo", "solo", "carrel", "carrel"]);
  for (let p = 0; p < 16; p++) assert.equal(podStyle(p), podStyle(p ^ 1));
  const l = buildLayout(cfg, { demand: { agents: 60 } });
  styles.forEach((st, p) => {
    const t = deskPos(p * 4);
    for (const r of [1, 3]) assert.equal(l.blocked.has(`${t.x + 1},${t.y + r}`), st === "bench" || st === "huddle", `pod ${p} row ${r}`);
    assert.ok(!l.blocked.has(`${t.x + 1},${t.y}`) && !l.blocked.has(`${t.x + 1},${t.y + 2}`)); // seat rows stay open
  });
});

test("every non-blocked tile is reachable from the door, every seat has a free reachable neighbour, blocked set mirrors", () => {
  for (let agents = 0; agents <= 64; agents += 4) for (const lobbySlots of [1, 4, 6]) {
    const l = buildLayout(cfg, { demand: { agents }, lobbySlots });
    for (let y = l.wallRows; y < l.rows; y++) for (let x = 0; x < l.cols; x++) {
      const k = `${x},${y}`;
      assert.equal(l.blocked.has(k), l.blocked.has(`${l.cols - 1 - x},${y}`), `asymmetric ${k}`);
      if (!l.blocked.has(k)) assert.ok(x === l.door.x && y === l.door.y || findPath(l, l.door, { x, y }).length > 0, `${k} unreachable (agents ${agents})`);
    }
    for (const t of Object.values(l.seats)) {
      const free = [[1, 0], [-1, 0], [0, -1], [0, 1]].filter(([dx, dy]) => !l.blocked.has(`${t.x + dx},${t.y + dy}`));
      assert.ok(free.length > 0, `seat ${t.x},${t.y} boxed in`);
    }
  }
});

test("decor: Ops/Pantry corners mirror, booths sit on the margins at the seat rows, walkways and door aisle stay clear", () => {
  const l = buildLayout(cfg, { demand: { agents: 60 } });
  const at = (k: string, x: number, y: number) => l.decor.some((d) => d.kind === k && d.x === x && d.y === y);
  assert.ok([0, 1, 2].every((x) => at("rack", x, 2)) && at("plant", 3, 2)); // contiguous server bank
  assert.ok(at("plant", l.cols - 4, 2) && at("coffee", l.cols - 3, 2) && at("fridge", l.cols - 2, 2) && at("cooler", l.cols - 1, 2));
  const booths = l.decor.filter((d) => d.kind === "booth");
  assert.equal(booths.length, 2 * l.zones.length);
  for (const b of booths) {
    assert.ok(b.x === 0 || b.x === l.cols - 1);
    assert.ok(l.zones.some((z) => z.y === b.y));
    assert.ok(l.blocked.has(`${b.x},${b.y}`) && l.blocked.has(`${b.x},${b.y + 1}`));
  }
  for (const d of l.decor) {
    const xs = Array.from({ length: d.w ?? 1 }, (_, i) => d.x + i);
    assert.ok(d.y === l.wallRows || xs.every((x) => x !== 1 && x !== l.cols - 2), `${d.kind} on a walkway column`); // the wall-row bank/pantry may use them
    assert.ok(xs.every((x) => d.y < l.rows - 3 || Math.abs(x - l.door.x) > 1), `${d.kind} near the door aisle`);
  }
  const lobbyY = l.lobby[0].y;
  assert.ok(l.decor.every((d) => d.kind === "holo" || (d.y !== lobbyY && d.y !== lobbyY + 1)));
  // the holo-map pair sits a clear tile away from every lead desk, and only while that fits
  const holo = l.decor.filter((d) => d.kind === "holo");
  assert.equal(holo.length, 2);
  for (const h of holo) assert.ok(l.lobby.every((t) => t.x > h.x + 2 || t.x < h.x - 1), "holo clear of the lead desks");
  for (const n of [10, 11, 12, 16]) assert.equal(buildLayout(cfg, { lobbySlots: n }).decor.filter((d) => d.kind === "holo").length, 0, `no holo with ${n} leads`);
  assert.equal(l.decor.filter((d) => d.kind === "table").length, 2);
  assert.equal(l.decor.filter((d) => d.kind === "armchair").length, 2);
});

test("the room mirrors about the door aisle: odd width, centred door, board, queue, lobby desks and couches", () => {
  for (const lobbySlots of [1, 2, 3, 4, 5, 6]) for (const agents of [0, 30, 60]) {
    const l = buildLayout(cfg, { demand: { agents }, lobbySlots });
    assert.equal(l.cols % 2, 1);
    const m = (l.cols - 1) / 2, mirror = (x: number) => l.cols - 1 - x;
    assert.equal(l.door.x, m);
    assert.equal(l.board.x * 2 + l.board.w - 1, l.cols - 1); // spans a symmetric run of tiles
    const sym = (xs: number[]) => assert.deepEqual([...xs].sort((a, b) => a - b), xs.map(mirror).sort((a, b) => a - b));
    sym(l.lobby.map((t) => t.x));
    sym(l.zones[0].queue.map((t) => t.x));
    sym(l.decor.filter((d) => d.kind === "couch").flatMap((d) => [d.x, d.x + (d.w ?? 1) - 1]));
    sym(l.decor.filter((d) => d.y === l.wallRows).map((d) => d.x));
    sym(l.decor.filter((d) => d.kind === "booth" || d.kind === "armchair" || d.kind === "table").flatMap((d) => [d.x, d.x + (d.w ?? 1) - 1]));
    assert.ok(l.lobby.every((t) => t.x >= 1 && t.x <= l.cols - 2));
  }
});

test("pods fill each row centre-out, so the first 2, 4 or 6 pods are balanced about the aisle", () => {
  const l = buildLayout(cfg, { demand: { agents: 60 } });
  for (const n of [2, 4, 6]) {
    const xs = Array.from({ length: n }, (_, p) => deskPos(p * 4).x);
    assert.deepEqual([...xs].sort((a, b) => a - b), xs.map((x) => l.cols - 1 - (x + 2)).sort((a, b) => a - b)); // pod is 3 wide: x..x+2
  }
  assert.equal(new Set(Array.from({ length: 6 }, (_, p) => deskPos(p * 4).x)).size, 6); // one pod per column
});
