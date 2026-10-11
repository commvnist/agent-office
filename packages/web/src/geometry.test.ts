import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, checkLayout, lines, placements, TILE_PX } from "@agent-office/core";
import { rectOf, sceneGeometry, selfCheck, wallDials } from "./geometry.ts";
import { art, dev, place, setDpr } from "./snap.ts";

const cfg = { roles: {} };
const T = TILE_PX;

test("every desk total x lobby size: consistent, and the scene geometry is exactly the registry", () => {
  for (let total = 8; total <= 64; total += 8) for (let lobbySlots = 1; lobbySlots <= 8; lobbySlots++) {
    const l = buildLayout(cfg, { minDesks: total, lobbySlots }), g = sceneGeometry(l), at = `total=${total} lobby=${lobbySlots}`;
    assert.deepEqual(checkLayout(l), [], at);
    assert.deepEqual(g.feet, placements(l), at);
    assert.deepEqual(g.lines, lines(l), at);
    // furniture: one rect per footprint, tile-aligned integers
    for (const f of g.feet) { const r = g.rect(f.id); assert.deepEqual(r, rectOf(f)); assert.ok(Object.values(r).every((n) => Number.isInteger(n)), f.id); }
    // derived pieces all come from a registry id
    assert.deepEqual(g.windows, g.feet.filter((f) => f.kind === "window").map((f) => f.x).sort((a, b) => a - b));
    assert.equal(g.aprons.length, Math.floor(l.props.length / 4));
    g.aprons.forEach((a, p) => assert.deepEqual([a.x, a.y], [g.line.get(`apron:${p}`)!.pts[0].x, g.line.get(`apron:${p}`)!.pts[0].y]));
    for (const m of g.mats) assert.ok(g.feet.some((f) => f.kind === "desk" && f.x * T + 1 === m.x && f.y * T + 5 === m.y), `mat ${m.x},${m.y} sits on a desk`);
    // bot rails run on the aisle's upper edge under a row's aprons, clear of the conduit centre line
    for (const r of g.rails) {
      const row = g.aprons.filter((a) => a.y + a.h + 1 === r.y);
      assert.ok(row.length > 0 && r.x0 === Math.min(...row.map((a) => a.x)) + 5 && r.x1 === Math.max(...row.map((a) => a.x + a.w)) - 5, "rail under aprons");
      const rowC = row[0].y + row[0].h - 2 + 8; // conduit centre line of this aisle
      assert.ok(r.y + 3 < rowC - 1, `bot sprite (to ${r.y + 3}) stays above the conduit (lit edge at ${rowC - 1})`);
    }
    // conduits: every row run lies on its aisle centre line; each junction sits on the end of a run (centre pixel) and the last pod's junction ends its row
    assert.ok(g.conduits.length > 0 && g.conduits.every((c) => c.kind === "conduit"));
    for (const j of g.junctions) assert.ok(g.conduits.some((c) => c.id.startsWith("conduit:row:") && c.pts[1].x === j.cx && c.pts[1].y === j.cy), `junction ${j.id} on a conduit end`);
    assert.equal(g.junctions.length, g.aprons.length);
    // racks: contiguous, same height, first one over the trunk column
    assert.ok(g.racks.length === 3 && g.racks.every((r, i) => r.h === T && (i === 0 || r.x === g.racks[i - 1].x + T)));
    // lights: one pool per sconce/lamp, anchored on its source footprint
    assert.ok(g.lights.length > 0 && g.lights.every((L) => g.foot.has(L.source)));
    // signs centred on their footprints
    assert.equal(g.signs.ops.x + g.signs.ops.w / 2 + g.signs.agent.x + g.signs.agent.w / 2, l.cols * T);
    // wall dials sit inside the clock/gauge footprints
    const d = wallDials(l);
    for (const [id, c] of [["clock", d.clock], ["gauge", d.gauge]] as const) { const r = g.rect(id); assert.ok(c.x - 9 >= r.x && c.x + 9 <= r.x + r.w && c.y - 9 === 3, id); }
    // E8 wall rhythm: every wall item has a mirror slot
    const wall = g.feet.filter((f) => f.layer === "wall" && f.kind !== "door").sort((a, b) => a.x - b.x);
    for (const f of wall) assert.ok(wall.some((o) => o.x === l.cols - f.x - f.w && o.w === f.w), `${f.id} mirrored`);
    // E12 bank inset inside the rack footprints, trunk leaves its bottom edge; E3 lounge rug inside its footprint, around the couch set
    const rk = g.racks, bk = g.bank;
    assert.ok(bk[0].x === rk[0].x + 8 && bk[2].x + bk[2].w <= rk[2].x + rk[2].w && bk.every((c, i) => !i || c.x === bk[i - 1].x + c.w));
    const trunk = g.line.get("conduit:trunk:0")!.pts[0];
    assert.ok(trunk.x > bk[0].x && trunk.x < bk[2].x + bk[2].w, "trunk under the inset bank");
    const rug = g.rect("rug:lounge"), lr = g.lounge;
    assert.ok(lr.x >= rug.x && lr.y >= rug.y && lr.x + lr.w <= rug.x + rug.w && lr.y + lr.h <= rug.y + rug.h, "lounge rug inside its footprint");
    assert.equal(lr.x + lr.w / 2, l.door.x * T + 8, "lounge rug centred on the door aisle");
    // no floor-painted text: the scene geometry carries no plates or letters
    assert.ok(!("plates" in g) && !("letters" in g));
  }
});

test("selfCheck warns once per violation set and never throws", () => {
  const l = buildLayout(cfg, { minDesks: 16, lobbySlots: 4 }), seen: string[] = [];
  assert.deepEqual(selfCheck(l, (m) => seen.push(m)), []);
  assert.equal(seen.length, 0);
  const bad = { ...l, blocked: new Set([...l.blocked, "5,5"]) };
  assert.ok(selfCheck(bad, (m) => seen.push(m)).length > 0);
  selfCheck(bad, (m) => seen.push(m));
  assert.equal(seen.length, 1);
});

test("snapping: art px are whole, device px follow the ratio", () => {
  assert.equal(art(3.5), 4);
  assert.equal(dev(10.3, 2), 10.5);
  setDpr(1.5);
  assert.equal(dev(10.3), 15 / 1.5); // 10.3 * 1.5 = 15.45 -> 15 device px
  setDpr(1);
  const o = { position: { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; } } };
  place(o, 2.4, 7.6);
  assert.deepEqual([o.position.x, o.position.y], [2, 8]);
});
