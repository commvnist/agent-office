import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, type Layout } from "./layout.ts";
import { checkLayout, lights, lines, NOT_STABLE, placements, TILE_PX, type Line } from "./footprint.ts";

const cfg = { roles: {} };
const has = (v: string[], re: RegExp) => assert.ok(v.some((m) => re.test(m)), `expected /${re}/ in ${JSON.stringify(v)}`);
const base = () => buildLayout(cfg, { minDesks: 16, lobbySlots: 4 });
const clone = (l: Layout, f: (c: Layout) => void): Layout => { const c = { ...l, decor: [...l.decor], props: [...l.props], seats: { ...l.seats }, blocked: new Set(l.blocked), door: { ...l.door } }; f(c); return c; };

test("current layout is consistent for every desk total, lobby size and demand", () => {
  for (const total of [8, 16, 24, 32, 40, 48, 56, 64]) for (let lobbySlots = 1; lobbySlots <= 8; lobbySlots++) for (const agents of [0, 12, 60]) {
    const l = buildLayout(cfg, { minDesks: total, lobbySlots, demand: { agents } });
    assert.deepEqual(checkLayout(l), [], `total=${total} lobby=${lobbySlots} agents=${agents}`);
  }
  for (const total of [72, 128, 136, 192]) assert.deepEqual(checkLayout(buildLayout(cfg, { minDesks: total, lobbySlots: 4 })), [], `floors: total=${total}`);
});

test("placements: ids are unique and every desk, chair and rack is present", () => {
  const l = base(), f = placements(l), ids = f.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(f.filter((x) => x.kind === "desk").length, l.props.length + l.lobby.length);
  assert.equal(f.filter((x) => x.kind === "rack").length, 3); // contiguous bank
  assert.ok(lines(l).every((ln) => ln.pts.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y))));
});

test("conduits: trunk from the bank edge down column 1, row run on the aisle centre line, junction under each pod; no lanes or threshold", () => {
  const l = base(), ls = lines(l), by = (id: string) => ls.find((x) => x.id === id)!, T = TILE_PX;
  assert.deepEqual(by("conduit:trunk:0").pts, [{ x: 24, y: 3 * T }, { x: 24, y: 11 * T + 8 }]);
  assert.deepEqual(by("conduit:row:0:0").pts, [{ x: 24, y: 11 * T + 8 }, { x: 2 * T + 24, y: 11 * T + 8 }]);
  assert.deepEqual(by("spine").pts, [{ x: l.door.x * T + 8, y: 6 * T }, { x: l.door.x * T + 8, y: (l.rows - 1) * T }]);
  assert.ok(ls.every((x) => !/^(lane|threshold|cable)/.test(x.id)));
  const js = placements(l).filter((f) => f.kind === "junction");
  assert.equal(js.length, l.props.length / 4);
  for (const j of js) assert.ok(!j.solid && !l.blocked.has(`${j.x},${j.y}`));
});

test("lights come only from sconces, lamps, windows and holo tables, on their footprints", () => {
  const l = base(), lt = lights(l), f = new Map(placements(l).map((x) => [x.id, x]));
  assert.ok(lt.length >= 4);
  for (const a of lt) assert.ok(["sconce", "lamp", "window", "holo"].includes(f.get(a.source)!.kind));
  assert.equal(lt.filter((a) => a.tone === "window").length, placements(l).filter((x) => x.kind === "window").length);
  assert.deepEqual(lt.filter((a) => a.source.startsWith("decor:lamp")).map((a) => a.x / TILE_PX - 0.5).sort((a, b) => a - b), [l.door.x - 8, l.door.x + 8]);
  const sc = placements(l).filter((x) => x.kind === "sconce").map((x) => x.x).sort((a, b) => a - b);
  assert.deepEqual(sc, sc.map((x) => l.cols - 1 - x).sort((a, b) => a - b));
  assert.ok(sc.every((x) => placements(l).filter((o) => o.layer === "wall" && o.id !== `sconce:${x}` && o.x <= x && x < o.x + o.w && o.kind !== "door").length === 0));
});

const grow = [8, 16, 24, 32, 40, 48, 56, 64, 72, 128, 136, 192].map((n) => buildLayout(cfg, { minDesks: n, lobbySlots: 4 }));
const stable = (id: string) => !NOT_STABLE.some((re) => re.test(id));

test("placements and lines are pure", () => {
  for (const l of grow) {
    assert.deepEqual(placements(l), placements(l));
    assert.deepEqual(lines(l), lines(l));
  }
});

test("growing the office only adds: footprints and conduits never move (NOT_STABLE ids excepted)", () => {
  for (let i = 0; i + 1 < grow.length; i++) {
    const big = new Map(placements(grow[i + 1]).map((f) => [f.id, f])), bigL = new Map(lines(grow[i + 1]).map((x) => [x.id, x]));
    for (const f of placements(grow[i]).filter((x) => stable(x.id))) assert.deepEqual(big.get(f.id), f, `${f.id} moved at ${i}`);
    for (const x of lines(grow[i]).filter((y) => stable(y.id))) assert.deepEqual(bigL.get(x.id), x, `${x.id} moved at ${i}`);
    assert.ok(lines(grow[i]).some((x) => x.id.startsWith("conduit:row:")));
  }
});

test("checker catches broken layouts", () => {
  const l = base(), mid = l.door.x;
  has(checkLayout(clone(l, (c) => c.blocked.add("5,5"))), /blocked but no object/);
  has(checkLayout(clone(l, (c) => c.blocked.delete(`${l.props[0].x},${l.props[0].y}`))), /solid but not blocked/);
  has(checkLayout(clone(l, (c) => c.props.push({ ...c.props[0] }))), /overlaps/);
  has(checkLayout(clone(l, (c) => { c.door = { x: mid + 0.5, y: c.door.y }; })), /non-integer/);
  has(checkLayout(clone(l, (c) => c.decor.push({ kind: "plant", x: 0, y: 0 }))), /outside its region/);
  has(checkLayout(clone(l, (c) => c.decor.push({ kind: "plant", x: c.cols, y: 10 }))), /outside its region/);
  has(checkLayout(clone(l, (c) => { const t = c.seats.d0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1]]) c.blocked.add(`${t.x + dx},${t.y + dy}`); })), /unreachable/);
  has(checkLayout(clone(l, (c) => { c.decor = c.decor.filter((d) => d.kind !== "table"); c.blocked = new Set(l.blocked); })), /no table directly in front/);
  has(checkLayout(clone(l, (c) => { c.decor = c.decor.filter((d) => d.kind !== "armchair"); })), /flanking armchair/);
  has(checkLayout(clone(l, (c) => { const a = c.decor.findIndex((d) => d.kind === "armchair"); c.decor[a] = { ...c.decor[a], x: c.decor[a].x - 1 }; })), /no mirror/);
  has(checkLayout(clone(l, (c) => { c.decor.push({ kind: "plant", x: mid, y: c.rows - 3 }); c.blocked.add(`${mid},${c.rows - 3}`); })), /door aisle blocked/);
  has(checkLayout(clone(l, (c) => { c.decor.push({ kind: "plant", x: 1, y: 4 }); c.blocked.add("1,4"); })), /conduit:trunk:0 runs through/);
});

test("checker catches tampered lines, conduits and lights", () => {
  const l = base(), ls = lines(l), T = TILE_PX;
  const tweak = (id: string, f: (ln: Line) => void) => ls.map((ln) => { if (ln.id !== id) return ln; const c = { ...ln, pts: ln.pts.map((p) => ({ ...p })) }; f(c); return c; });
  has(checkLayout(l, tweak("conduit:trunk:0", (c) => { c.pts[0].y += 5; })), /dangling end/);
  has(checkLayout(l, tweak("conduit:trunk:0", (c) => { c.pts[1] = { x: c.pts[1].x + 5, y: c.pts[1].y + 5 }; })), /diagonal/);
  has(checkLayout(l, tweak("conduit:trunk:0", (c) => { c.pts[1].x += 0.5; })), /non-integer/);
  has(checkLayout(l, tweak("conduit:row:0:0", (c) => { c.pts[0].y += 3; c.pts[1].y += 3; })), /off the tile centre line/);
  has(checkLayout(l, tweak("conduit:row:0:0", (c) => { c.pts[1].x = 500; })), /outside the room/);
  has(checkLayout(l, [...ls, { id: "stub", kind: "conduit", pts: [{ x: 200, y: 11 * T + 8 }, { x: 200, y: 150 }] }]), /dangling end at 200,150/);
  const d = l.props[0]; // a conduit through a desk
  has(checkLayout(l, [...ls, { id: "thru", kind: "conduit", pts: [{ x: d.x * T + 8, y: d.y * T - 8 }, { x: d.x * T + 8, y: 11 * T + 8 }] }]), /thru runs through desk:d0/);
  has(checkLayout(l, tweak("spine", (c) => { c.pts[0].x += 3; c.pts[1].x += 3; })), /off the tile grid/);
  has(checkLayout(l, ls.filter((x) => !x.id.startsWith("conduit:row:0:"))), /no conduit through its centre|dangling/);
  has(checkLayout(clone(l, (c) => { c.decor.push({ kind: "plant", x: 11, y: 11 }); c.blocked.add("11,11"); })), /junction:0 overlaps/);
  const lt = lights(l);
  has(checkLayout(l, ls, lt.map((a, i) => (i ? a : { ...a, x: a.x + 40 }))), /not on a source footprint/);
  has(checkLayout(l, ls, [...lt, { id: "light:float", source: "nope", x: 100, y: 100, reach: 48, tone: "cool" }]), /not on a source footprint/);
  has(checkLayout(clone(l, (c) => { c.decor = c.decor.filter((d2) => !(d2.kind === "lamp" && d2.x < c.door.x)); c.blocked = new Set(l.blocked); })), /no mirror|blocked/);
});
