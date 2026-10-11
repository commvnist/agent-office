import { deskPos, findPath, podRow, podStyle, type Layout } from "./layout.ts";

/** Art pixels per tile: the unit of Line coordinates (world pixels, y includes the wall rows). */
export const TILE_PX = 16;
const T = TILE_PX, POD_W = 3, POD_H = 4; // pod footprint in tiles, as scene.ts draws it

/** One thing that occupies space, in tile units. `solid` footprints are exactly the tiles in layout.blocked. */
export type Foot = { id: string; kind: string; x: number; y: number; w: number; h: number; solid: boolean; layer: "wall" | "floor" | "furniture" };
/** A drawn run, integer art pixels (world; y includes the wall rows). conduit: server bank -> trunk -> per-row run (ends on bank, junction or conduit); spine: door -> lobby; apron: pod plate rect / plate anchor point. */
export type Line = { id: string; kind: "conduit" | "spine" | "apron"; pts: { x: number; y: number }[]; from?: string; to?: string };

/** Every object that occupies space. Wall objects are derived exactly as scene.ts places them (windows, board, clock/gauge mirror pair). */
export function placements(l: Layout): Foot[] {
  const out: Foot[] = [];
  const add = (id: string, kind: string, x: number, y: number, w: number, h: number, solid: boolean, layer: Foot["layer"]) => out.push({ id, kind, x, y, w, h, solid, layer });
  for (const p of l.props) add(`desk:${p.seat ?? `${p.x},${p.y}`}`, "desk", p.x, p.y, 1, 1, true, "furniture");
  for (const [id, t] of Object.entries(l.seats)) add(`chair:${id}`, "chair", t.x, t.y, 1, 1, false, "floor");
  for (let p = 0; p * 4 < l.props.length; p++) {
    const s = podStyle(p);
    if (s !== "bench" && s !== "huddle") continue;
    const t = deskPos(p * 4);
    for (const r of [1, 3]) add(`link:${p}:${r}`, s, t.x + 1, t.y + r, 1, 1, true, "furniture");
  }
  l.lobby.forEach((t, i) => {
    add(`lobby-chair:${i}`, "chair", t.x, t.y, 1, 1, false, "floor");
    add(`lobby-desk:${i}`, "desk", t.x, t.y + 1, 1, 1, true, "furniture");
  });
  const seen = new Set<string>();
  for (const z of l.zones) z.queue.forEach((t, i) => { if (!seen.has(`${t.x},${t.y}`)) { seen.add(`${t.x},${t.y}`); add(`queue:${i}`, "queue", t.x, t.y, 1, 1, false, "floor"); } });
  l.decor.forEach((d, i) => add(`decor:${d.kind}:${i}`, d.kind, d.x, d.y, d.w ?? 1, d.h ?? 1, true, "furniture"));
  add("door", "door", l.door.x, l.door.y, 1, 1, false, "wall");
  add("board", "board", l.board.x, 0, l.board.w, l.wallRows, false, "wall");
  // Wall slots, from the board outwards on a fixed pitch and mirrored (critique E8): dial (2 tiles), window (2), sign plate (3), window (2).
  // Every item draws inside its slot, so gaps are fixed (7-10 px) and nothing is wedged; tiles left over toward the corner get a sconce.
  const pair = (x: number, w: number, kind: string, left: string, right: string) => {
    if (x < 0) return false;
    add(left, kind, x, 0, w, l.wallRows, false, "wall");
    add(right, kind === "gauge" ? "clock" : kind, l.cols - x - w, 0, w, l.wallRows, false, "wall");
    return true;
  };
  const b0 = l.board.x, w1 = b0 - 4, w2 = b0 - 9;
  if (pair(b0 - 2, 2, "gauge", "gauge", "clock") && pair(w1, 2, "window", `window:${w1}`, `window:${l.cols - w1 - 2}`) && pair(b0 - 7, 3, "sign", "plate:ops", "plate:agent"))
    pair(w2, 2, "window", `window:${w2}`, `window:${l.cols - w2 - 2}`);
  // wall sconces: one in the last free wall tile of every free run left of the centre, mirrored (the wall light that exists in frame)
  const wallUsed = new Set(out.filter((f) => f.layer === "wall" && f.kind !== "door").flatMap((f) => Array.from({ length: f.w }, (_, i) => f.x + i)));
  for (let x = 0; x < (l.cols - 1) / 2; x++) if (!wallUsed.has(x) && (x + 1 >= (l.cols - 1) / 2 || wallUsed.has(x + 1))) {
    add(`sconce:${x}`, "sconce", x, 0, 1, l.wallRows, false, "wall");
    add(`sconce:${l.cols - 1 - x}`, "sconce", l.cols - 1 - x, 0, 1, l.wallRows, false, "wall");
  }
  // one junction box centred under each built pod, on its row's aisle centre line (the conduit passes through its centre)
  for (let p = 0; p * 4 < l.props.length; p++) { const t = deskPos(p * 4); add(`junction:${p}`, "junction", t.x + 1, t.y + 4, 1, 1, false, "floor"); }
  // lobby band and lounge rugs (drawn under furniture, over the floor)
  const qy = l.zones[0].queue[0].y;
  add("rug:lobby", "rug", 1, l.lobby[0].y - 1, l.cols - 2, 4, false, "floor");
  add("rug:lounge", "rug", l.door.x - 7, qy + 1, 15, l.rows - qy - 1, false, "floor"); // down to the trim row, so the rug can frame the couches with a margin (E3)
  return out;
}

/** What the floor print draws: the spine, pod aprons/plates and the conduit network. Nothing else is a line (no lane seams, no threshold: the rug is the boundary). */
export function lines(l: Layout): Line[] {
  const out: Line[] = [];
  const y0 = deskPos(0).y, ly = l.lobby[0].y, mx = l.door.x;
  const nPods = Math.floor(l.props.length / 4);
  out.push({ id: "spine", kind: "spine", pts: [{ x: mx * T + 8, y: (ly + 3) * T }, { x: mx * T + 8, y: (l.rows - 1) * T }] });
  const xc0 = deskPos(4 * 4).x; // x of pod column 0 (podCol(4) = 0); pod column c sits at xc0 + 4c
  const rowMax = new Map<number, number>(); // pod row -> highest built pod column
  for (let p = 0; p < nPods; p++) {
    const t = deskPos(p * 4), x = t.x * T - 4, y = t.y * T - 2, aw = POD_W * T + 8, ah = POD_H * T + 4;
    out.push({ id: `apron:${p}`, kind: "apron", pts: [{ x, y }, { x: x + aw, y }, { x: x + aw, y: y + ah }, { x, y: y + ah }, { x, y }] });
    out.push({ id: `plate:${p}`, kind: "apron", pts: [{ x: t.x * T - 2, y: (t.y + 4) * T + 10 }] });
    const r = podRow(p);
    rowMax.set(r, Math.max(rowMax.get(r) ?? 0, (t.x - xc0) / 4));
  }
  // Conduits: a trunk from the server bank's bottom edge down walkway column 1 (centre pixel), stepping one pod row at a time; per built row
  // a run along the aisle centre line (tile row y0+5r+4, centre pixel) in per-pod-column cells from the trunk to the last built pod's junction box.
  const trunkX = 1 * T + 8, rowC = (r: number) => (y0 + r * 5 + 4) * T + 8, nodeX = (c: number) => (xc0 + 4 * c) * T + 24; // 24 = centre of a 3-tile pod
  const bank = l.decor.findIndex((d) => d.kind === "rack" && d.x * T <= trunkX && trunkX <= (d.x + (d.w ?? 1)) * T);
  for (const [r, m] of [...rowMax].sort((a, b) => a[0] - b[0])) {
    const from = r === 0 && bank >= 0 ? { x: trunkX, y: (l.decor[bank].y + (l.decor[bank].h ?? 1)) * T } : { x: trunkX, y: rowC(r - 1) };
    out.push({ id: `conduit:trunk:${r}`, kind: "conduit", pts: [from, { x: trunkX, y: rowC(r) }], ...(r === 0 && bank >= 0 ? { from: `decor:rack:${bank}` } : {}) });
    for (let c = 0; c <= m; c++) out.push({ id: `conduit:row:${r}:${c}`, kind: "conduit", pts: [{ x: c === 0 ? trunkX : nodeX(c - 1), y: rowC(r) }, { x: nodeX(c), y: rowC(r) }] });
  }
  return out;
}

/**
 * A light pool anchor (art px, world): it exists only where a source footprint does. Wall sconces and holo tables cast a cool pool that fades
 * within `reach` px; floor lamps a warm one; a window casts `window` light (daylight / moonlight) down from its sill, clipped to its own x-range.
 */
export type Light = { id: string; source: string; x: number; y: number; reach: number; tone: "cool" | "warm" | "window" };
export function lights(l: Layout): Light[] {
  const out: Light[] = [];
  for (const f of placements(l)) {
    if (f.kind === "sconce") out.push({ id: `light:${f.id}`, source: f.id, x: f.x * T + 8, y: (f.y + f.h) * T, reach: 3 * T, tone: "cool" });
    if (f.kind === "lamp") out.push({ id: `light:${f.id}`, source: f.id, x: f.x * T + 8, y: (f.y + 1) * T, reach: 3 * T, tone: "warm" });
    if (f.kind === "window") out.push({ id: `light:${f.id}`, source: f.id, x: f.x * T + T, y: (f.y + f.h) * T, reach: 3 * T, tone: "window" });
    if (f.kind === "holo") out.push({ id: `light:${f.id}`, source: f.id, x: (f.x + f.w / 2) * T, y: f.y * T, reach: 2 * T, tone: "cool" });
  }
  return out;
}
/** Footprint kinds a light pool may hang off. */
const LIGHT_SOURCES = new Set(["sconce", "lamp", "window", "holo", "rack", "desk", "gauge", "clock"]);

const key = (x: number, y: number) => `${x},${y}`;
const px = (f: Foot) => ({ l: f.x * T, t: f.y * T, r: (f.x + f.w) * T, b: (f.y + f.h) * T });
type Seg = { a: { x: number; y: number }; b: { x: number; y: number } };
const segs = (ln: Line): Seg[] => ln.pts.slice(1).map((b, i) => ({ a: ln.pts[i], b }));
/** Segment passes through the open interior of a rect (touching an edge does not count). */
const through = (s: Seg, r: { l: number; t: number; r: number; b: number }) =>
  s.a.x === s.b.x ? s.a.x > r.l && s.a.x < r.r && Math.max(s.a.y, s.b.y) > r.t && Math.min(s.a.y, s.b.y) < r.b
    : s.a.y > r.t && s.a.y < r.b && Math.max(s.a.x, s.b.x) > r.l && Math.min(s.a.x, s.b.x) < r.r;
const onSeg = (p: { x: number; y: number }, s: Seg, pad = 0) => Math.min(s.a.x, s.b.x) - pad <= p.x && p.x <= Math.max(s.a.x, s.b.x) + pad && Math.min(s.a.y, s.b.y) - pad <= p.y && p.y <= Math.max(s.a.y, s.b.y) + pad;

/** Ids that legitimately move or change when the office grows by pod rows (they hang off the row count): queue, door, lounge set (incl. lamps), bottom plants, spine. */
export const NOT_STABLE = [/^queue:/, /^door$/, /^rug:lounge$/, /^decor:(couch|table|armchair|lamp):/, /^decor:plant:[89]$/, /^spine$/, /^light:decor:lamp:/];

/** Human-readable violations of the visual-consistency invariants; [] means consistent. `ls` is injectable so tests can tamper with lines. */
export function checkLayout(l: Layout, ls: Line[] = lines(l), lt: Light[] = lights(l)): string[] {
  const v: string[] = [], feet = placements(l), solid = feet.filter((f) => f.solid);
  const mid = (l.cols - 1) / 2, ly = l.lobby[0]?.y ?? 0;
  const blockedAt = (x: number, y: number) => l.blocked.has(key(x, y));
  const isInt = (n: number) => Number.isInteger(n);

  for (const f of feet) if (![f.x, f.y, f.w, f.h].every(isInt)) v.push(`${f.id}: non-integer footprint ${f.x},${f.y} ${f.w}x${f.h}`);
  for (const f of feet) {
    const wallOnly = f.layer === "wall" && f.kind !== "door";
    const ok = f.x >= 0 && f.x + f.w <= l.cols && f.y + f.h <= l.rows && (wallOnly ? f.y + f.h <= l.wallRows : f.y >= l.wallRows);
    if (!ok) v.push(`${f.id}: outside its region (${f.x},${f.y} ${f.w}x${f.h}; room ${l.cols}x${l.rows}, wall rows ${l.wallRows})`);
  }
  // occupancy: solid footprints never overlap, and their tiles are exactly layout.blocked
  const occ = new Map<string, string>();
  for (const f of solid) for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) {
    const k = key(f.x + dx, f.y + dy), prev = occ.get(k);
    if (prev) v.push(`${f.id} overlaps ${prev} at ${k}`); else occ.set(k, f.id);
  }
  for (const k of l.blocked) if (!occ.has(k)) v.push(`tile ${k} is blocked but no object occupies it`);
  for (const [k, id] of occ) if (!l.blocked.has(k)) v.push(`${id} at ${k} is solid but not blocked`);
  const wall = feet.filter((f) => f.layer === "wall" && f.kind !== "door");
  wall.forEach((a, i) => wall.slice(i + 1).forEach((b) => {
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) v.push(`wall objects ${a.id} and ${b.id} overlap`);
  }));
  // seats: walkable, desk below, reachable
  const seatTiles = [...Object.entries(l.seats).map(([id, t]) => [id, t] as const), ...l.lobby.map((t, i) => [`lobby:${i}`, t] as const), ...l.zones.flatMap((z) => z.queue).map((t, i) => [`queue:${i}`, t] as const)];
  for (const [id, t] of seatTiles) {
    if (blockedAt(t.x, t.y)) v.push(`seat ${id} at ${key(t.x, t.y)} is blocked`);
    else if (!l.door || findPath(l, l.door, t).length === 0) v.push(`seat ${id} at ${key(t.x, t.y)} is unreachable from the door`);
    if (!id.startsWith("queue") && !blockedAt(t.x, t.y + 1)) v.push(`seat ${id} has no desk below it at ${key(t.x, t.y + 1)}`);
  }
  // mirror symmetry about the door aisle for paired kinds, and the couch set
  const pairKinds = new Set(["couch", "table", "armchair", "booth", "lamp", "sconce", "holo", "window", "sign"]);
  for (const d of feet.filter((f) => pairKinds.has(f.kind))) {
    const mx = l.cols - 1 - (d.x + d.w - 1);
    if (!feet.some((e) => e.kind === d.kind && e.x === mx && e.y === d.y && e.w === d.w && e.h === d.h)) v.push(`${d.kind} at ${d.x},${d.y} has no mirror at x=${mx}`);
  }
  for (const a of lt) { // every light pool hangs off a real source footprint
    const src = feet.find((f) => f.id === a.source), r = src && px(src);
    if (!src || !LIGHT_SOURCES.has(src.kind) || !r || a.x < r.l || a.x > r.r || a.y < r.t || a.y > r.b) v.push(`${a.id}: light anchor ${a.x},${a.y} is not on a source footprint (${a.source})`);
  }
  for (const c of l.decor.filter((d) => d.kind === "couch")) {
    const w = c.w ?? 1;
    if (!l.decor.some((d) => d.kind === "table" && d.x === c.x && (d.w ?? 1) === w && d.y === c.y - 1)) v.push(`couch at ${c.x},${c.y} has no table directly in front`);
    for (let dx = 0; dx < w; dx++) if (c.y - 2 < l.wallRows || blockedAt(c.x + dx, c.y - 2)) v.push(`couch at ${c.x},${c.y}: no free clearance tile in front of its table at ${c.x + dx},${c.y - 2}`);
    if (!l.decor.some((d) => d.kind === "armchair" && d.y === c.y && (d.x === c.x - 1 || d.x === c.x + w))) v.push(`couch at ${c.x},${c.y} has no flanking armchair in its row`);
  }
  // door aisle: clear from the door up to the walkway below the lobby desks
  for (let y = ly + 2; y <= l.door.y; y++) if (blockedAt(l.door.x, y)) v.push(`door aisle blocked at ${key(l.door.x, y)}`);
  if (l.door.x !== mid) v.push(`door x=${l.door.x} is not the centre column ${mid}`);
  // lines: conduits start/end on the bank, a junction box or another conduit; never cross a solid; run on tile centre lines
  const rects = solid.map((f) => [f, px(f)] as const);
  const junctions = feet.filter((f) => f.kind === "junction"), racks = feet.filter((f) => f.kind === "rack");
  const inRect = (p: { x: number; y: number }, r: ReturnType<typeof px>) => p.x >= r.l && p.x <= r.r && p.y >= r.t && p.y <= r.b;
  for (const j of junctions) {
    if (j.solid || occ.has(key(j.x, j.y))) v.push(`${j.id} overlaps a solid footprint at ${key(j.x, j.y)}`);
    const c = { x: j.x * T + 8, y: j.y * T + 8 };
    if (!ls.some((o) => o.kind === "conduit" && segs(o).some((s) => onSeg(c, s)))) v.push(`${j.id} has no conduit through its centre`);
  }
  for (const ln of ls) {
    if (!ln.pts.every((p) => isInt(p.x) && isInt(p.y))) v.push(`${ln.id}: non-integer point`);
    if (ln.pts.some((p) => p.x < 0 || p.y < 0 || p.x > l.cols * T || p.y > l.rows * T)) v.push(`${ln.id}: point outside the room`);
    const ss = segs(ln);
    if (ln.kind === "apron") continue;
    ss.forEach((s) => { if (s.a.x !== s.b.x && s.a.y !== s.b.y) v.push(`${ln.id}: diagonal segment ${s.a.x},${s.a.y} -> ${s.b.x},${s.b.y}`); });
    for (const s of ss) for (const [f, r] of rects) if (through(s, r)) v.push(`${ln.id} runs through ${f.id}`);
    for (const s of ss) {
      const horiz = s.a.y === s.b.y, along = horiz ? [s.a.x, s.b.x] : [s.a.y, s.b.y], across = horiz ? s.a.y : s.a.x;
      if (ln.kind === "conduit") {
        if (across % T !== 8) v.push(`${ln.id}: conduit off the tile centre line (${s.a.x},${s.a.y} -> ${s.b.x},${s.b.y})`);
      } else if (along.some((n) => n % T !== 0) || across % (T / 2) !== 0) v.push(`${ln.id}: ${ln.kind} off the tile grid (${s.a.x},${s.a.y} -> ${s.b.x},${s.b.y})`);
    }
    if (ln.kind !== "conduit") continue;
    for (const e of [ln.pts[0], ln.pts[ln.pts.length - 1]]) {
      const onBank = racks.some((f) => { const r = px(f); return inRect(e, r) && (e.x === r.l || e.x === r.r || e.y === r.t || e.y === r.b); });
      const onJunction = junctions.some((f) => inRect(e, px(f)));
      const onOther = ls.some((o) => o.id !== ln.id && o.kind === "conduit" && segs(o).some((s) => onSeg(e, s)));
      if (!onBank && !onJunction && !onOther) v.push(`${ln.id}: dangling end at ${e.x},${e.y}, not on the bank, a junction box or another conduit`);
    }
  }
  return v;
}
