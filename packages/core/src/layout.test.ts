import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, findPath, seatTile, standNear } from "./layout.ts";

const cfg = { roles: { qa: { agent: "qa-engineer", count: 2, overflow: { max: 2 } }, fe: { agent: "frontend-dev", count: 1 } } };

test("every seat is walkable and reachable from the door", () => {
  const l = buildLayout(cfg);
  for (const [id, t] of Object.entries(l.seats)) {
    assert.ok(!l.blocked.has(`${t.x},${t.y}`), `${id} sits on a blocked tile`);
    assert.ok(findPath(l, l.door, t).length > 0, `${id} unreachable`);
  }
});

test("zones do not overlap and lobby/queue tiles are reachable", () => {
  const l = buildLayout(cfg);
  for (let i = 1; i < l.zones.length; i++) assert.ok(l.zones[i].x >= l.zones[i - 1].x + l.zones[i - 1].w);
  for (const t of [...l.lobby, ...l.zones.flatMap((z) => z.queue)]) assert.ok(findPath(l, l.door, t).length > 0);
});

test("unlimited roles fall back to a real tile", () => {
  const l = buildLayout(cfg);
  const t = seatTile(l, "guest+99");
  assert.ok(findPath(l, l.door, t).length > 0);
});

test("desks sit directly below their seat; lead desks below lobby seats", () => {
  const l = buildLayout(cfg);
  for (const p of l.props) {
    const id = p.kind === "permanent" ? `${p.role}#${(p.x - l.zones.find((z) => z.role === p.role)!.x) / 2}` : `${p.role}+${p.tier}`;
    assert.deepEqual(l.seats[id], { x: p.x, y: p.y - 1 });
  }
  for (const t of l.lobby) assert.ok(l.blocked.has(`${t.x},${t.y + 1}`));
});

test("banded layouts keep every seat reachable and zones apart", () => {
  const wide = { roles: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`r${i}`, { agent: `a${i}`, count: 2, overflow: { max: 2 } }])) };
  for (const bands of [1, 2, 3]) {
    const l = buildLayout(wide, { bands, lobbySlots: 5 });
    assert.equal(l.lobby.length, 5);
    for (const [id, t] of Object.entries(l.seats)) assert.ok(findPath(l, l.door, t).length > 0, `${id} (bands=${bands})`);
    for (const z of l.zones) for (const q of z.queue) assert.ok(findPath(l, l.door, q).length > 0);
    const keys = new Set(l.zones.flatMap((z) => Array.from({ length: z.w }, (_, i) => `${z.x + i},${z.y}`)));
    assert.equal(keys.size, l.zones.reduce((n, z) => n + z.w, 0), "zones overlap");
  }
});

test("standNear spreads visitors over distinct free tiles", () => {
  const l = buildLayout(cfg);
  const at = l.seats["qa#0"];
  const spots = new Set([0, 1, 2, 3].map((k) => JSON.stringify(standNear(l, at, k))));
  assert.equal(spots.size, 4);
  for (const s of spots) assert.ok(!l.blocked.has(JSON.parse(s).x + "," + JSON.parse(s).y));
});
