import type { OfficeConfig } from "./types.ts";

export type Tile = { x: number; y: number };
export type Prop = Tile & { role: string; kind: "permanent" | "overflow"; tier: number; seat?: string };
export type Decor = Tile & { kind: "plant" | "coffee" | "cooler" | "couch" | "bookshelf" | "rack" | "booth" | "fridge" | "table" | "armchair" | "lamp" | "holo"; w?: number; h?: number };
export type Zone = { role: string; label: string; x: number; w: number; y: number; queue: Tile[] };
export type Layout = {
  cols: number;
  rows: number;
  wallRows: number; // rows 0..wallRows-1 are the back wall (windows, board, clock)
  door: Tile;
  lobby: Tile[]; // where session leads sit (their desk is the tile below)
  zones: Zone[];
  seats: Record<string, Tile>; // seat id -> tile the agent sits on (the desk is the tile below)
  props: Prop[]; // desk / laptop / folding table tiles (blocked)
  decor: Decor[];
  board: { x: number; w: number }; // whiteboard on the wall
  blocked: Set<string>;
};

const key = (t: Tile) => `${t.x},${t.y}`;

/** Desks per floor (16 pods: pod rows of 6, 6 and 4) and floors; demand above one floor opens the next, stacked below it in the one world. */
export const FLOOR_DESKS = 64, MAX_FLOORS = 3;
/** 192 desks: just under the reducer's own cap (LIMITS.agents = 200), so enforceSeats and the visible queue stay reachable; a 4th floor would hold at most 8. */
export const MAX_DESKS = FLOOR_DESKS * MAX_FLOORS;
export const PODS_PER_ROW = 6;
const FLOOR_ROWS = 3; // pod rows per floor
const POD = 4; // desks per pod: a 2x2 cluster of chair+desk pairs
const PAIR = 2 * POD; // desks per mirror pair of pods: the office only ever grows in these
const WALL = 2, LOBBY_Y = 3, Y0 = 7, X0 = 2; // pod grid origin; pod stride is 4 wide (3 + aisle), 5 tall (4 + aisle)

/**
 * Chair tile of desk `i` (its desk is the tile below). Pure and append-only: independent of config, demand and window,
 * so a desk never moves when the office grows. Pod p = i/4 sits in row p/6 at the column podCol(p%6) (centre-out); desks go 2x2 inside it.
 * Floor f = i/64 repeats that plan FLOOR_ROWS pod rows further down (its third row holds 4 pods, so floors read as bands).
 */
export function deskPos(i: number): Tile {
  const pod = Math.floor((i % FLOOR_DESKS) / POD), k = i % POD;
  return { x: X0 + podCol(pod % PODS_PER_ROW) * 4 + (k % 2) * 2, y: floorTop(Math.floor(i / FLOOR_DESKS)) + Math.floor(pod / PODS_PER_ROW) * 5 + Math.floor(k / 2) * 2 };
}
/** Tile y of floor f's first pod row (its chairs). */
export const floorTop = (f: number) => Y0 + f * FLOOR_ROWS * 5;
/** Pod row (0-based, counted over every floor) of pod p: the wing it belongs to. */
export const podRow = (p: number) => Math.floor((deskPos(p * POD).y - Y0) / 5);
/** Floors the layout has built (1 + the floor of its last desk). */
export const floorsOf = (l: Layout) => Math.max(1, Math.ceil(l.props.length / FLOOR_DESKS));
/** Column of the n-th pod in a row, filling outward from the door aisle (2,3,1,4,0,5): a small office stays centred and balanced. */
const podCol = (n: number) => (n % 2 ? PODS_PER_ROW / 2 + (n - 1) / 2 : PODS_PER_ROW / 2 - 1 - n / 2);

export type PodStyle = "solo" | "bench" | "huddle" | "standing" | "carrel";
/** Designed styles by pod row, then mirror pair (pods 2k and 2k+1 share a column pair about the aisle); rows past the table use the last. */
const POD_STYLES: PodStyle[][] = [["huddle", "solo", "standing"], ["bench", "solo", "carrel"], ["bench", "solo", "solo"]];
/** Furniture style of pod `p`. Pure of the index and equal for mirror pods p and p^1, so it never changes as the office grows. */
export const podStyle = (p: number): PodStyle => { const q = p % (FLOOR_DESKS / POD); return POD_STYLES[Math.min(Math.floor(q / PODS_PER_ROW), POD_STYLES.length - 1)][Math.floor((q % PODS_PER_ROW) / 2)]; }; // every floor repeats the first

export type LayoutOpts = {
  /** Ignored: the pod grid has a fixed width (kept so older callers still compile). */
  bands?: number;
  /** Lead desks along the top; sized to the number of live sessions. */
  lobbySlots?: number;
  /** Live load; the office gets agents + 4 spare desks (never fewer than the configured roles ask for). */
  demand?: { agents: number; sessions?: number };
  /** Build at least this many desks (the highest desk index in use + 1). */
  minDesks?: number;
};

/**
 * Desks built for `agents` live agents (whole mirror pairs of pods, 8..MAX_DESKS): the configured headcount or agents + 4 spare.
 * Shared by buildLayout and allocate(): the allocator must never hand out a desk that is not built.
 */
export function deskCount(cfg: OfficeConfig, agents: number): number {
  const want = Math.max(Object.values(cfg.roles).reduce((n, r) => n + r.count + (r.overflow?.max ?? 0), 0), agents > 0 ? agents + 4 : 0);
  return Math.min(MAX_DESKS, Math.max(PAIR, Math.ceil(want / PAIR) * PAIR));
}

/**
 * Deterministic floor plan: `total` desks (whole mirror pairs of pods, 8..MAX_DESKS) at deskPos(0..total-1), seat ids `d<N>`.
 * Agents sit facing the camera: seat tile on top, desk tile directly below it. `zones` are pod rows ("wings") that
 * share one waiting-area queue below the last row; `props[i].seat` is the seat id of that desk.
 */
export function buildLayout(cfg: OfficeConfig, opts: LayoutOpts = {}): Layout {
  // minDesks keeps every desk an agent still sits at (agents may have left, shrinking demand, while a high desk is in use)
  const total = Math.min(MAX_DESKS, Math.max(deskCount(cfg, opts.demand?.agents ?? 0), Math.ceil((opts.minDesks ?? 0) / PAIR) * PAIR));
  const podRows = podRow(Math.floor((total - 1) / POD)) + 1;

  const seats: Layout["seats"] = {};
  const props: Prop[] = [];
  for (let i = 0; i < total; i++) {
    const t = deskPos(i);
    seats[`d${i}`] = t;
    props.push({ x: t.x, y: t.y + 1, role: "desk", kind: "permanent", tier: 0, seat: `d${i}` });
  }

  const lobbyN = Math.max(1, opts.lobbySlots ?? 4);
  // odd width: the centre column is the door aisle, so everything below mirrors about x = cols/2 (a tile x pairs with cols-1-x)
  let cols = Math.max(2 * X0 + PODS_PER_ROW * 4 - 1, lobbyN * 2 + 5);
  if (cols % 2 === 0) cols++;
  const mid = (cols - 1) / 2;
  const qy = Y0 + podRows * 5; // waiting row, one aisle below the last pod row
  const rows = qy + 4;
  const queue = Array.from({ length: 8 }, (_, i) => ({ x: mid - 7 + i * 2, y: qy })); // centred: 8 spots either side of the aisle
  const zones: Zone[] = Array.from({ length: podRows }, (_, r) => ({
    role: `wing${r + 1}`, label: `Wing ${r + 1}`, x: X0, w: PODS_PER_ROW * 4 - 1, y: Y0 + r * 5, queue,
  }));
  // lead desks mirror about the aisle: odd counts put one on it, even counts leave the aisle open
  const lobby = Array.from({ length: lobbyN }, (_, i) => ({ x: mid + (lobbyN % 2 ? 2 * (i - (lobbyN - 1) / 2) : 2 * (i - lobbyN / 2) + (i >= lobbyN / 2 ? 2 : 0)), y: LOBBY_Y }));
  const door = { x: mid, y: rows - 1 };

  // Floor decor lives on the margins and against the wall so it never cuts off a walkway.
  // Corners mirror: Ops (a contiguous 3-rack server bank, plant) left, Pantry (plant, coffee, fridge, cooler) right, flush to the corners.
  // Below the wall row the walkway columns x=1 and x=cols-2 stay clear (the bank's cable trunk runs down x=1).
  const couchL = door.x - 5, couchR = door.x + 4; // mirrored about the door aisle: x and cols - 1 - (x + w - 1)
  const decor: Decor[] = [
    { kind: "rack", x: 0, y: WALL }, { kind: "rack", x: 1, y: WALL }, { kind: "rack", x: 2, y: WALL }, { kind: "plant", x: 3, y: WALL },
    { kind: "plant", x: cols - 4, y: WALL }, { kind: "coffee", x: cols - 3, y: WALL }, { kind: "fridge", x: cols - 2, y: WALL }, { kind: "cooler", x: cols - 1, y: WALL },
    { kind: "plant", x: 0, y: rows - 3 },
    { kind: "plant", x: cols - 1, y: rows - 3 },
    { kind: "couch", x: couchL, y: rows - 2, w: 2 },
    { kind: "couch", x: couchR, y: rows - 2, w: 2 },
    { kind: "table", x: couchL, y: rows - 3, w: 2 }, // low table in front of each couch
    { kind: "table", x: couchR, y: rows - 3, w: 2 },
    { kind: "armchair", x: couchL - 1, y: rows - 2 }, // outer ends
    { kind: "armchair", x: couchR + 2, y: rows - 2 },
    { kind: "lamp", x: mid - 8, y: rows - 2 }, { kind: "lamp", x: mid + 8, y: rows - 2 }, // floor lamps flank the lounge rug, clear of the door aisle and armchairs
  ];
  // signature prop (critique L5): a holo-map table either side of the lead desks, on the lobby rug below the Ops / Pantry corners.
  // shortcut: only while the lead row leaves tiles 2..4 free (up to 9 sessions); a wider lobby drops the pair rather than moving it.
  if (Math.min(...lobby.map((t) => t.x)) >= 5) decor.push({ kind: "holo", x: 2, y: LOBBY_Y, w: 2 }, { kind: "holo", x: cols - 4, y: LOBBY_Y, w: 2 });
  for (let r = 0; r < podRows; r++) // phone booths (1 wide, 2 tall) on both margins at each pod row's seat row + desk row
    for (const x of [0, cols - 1]) decor.push({ kind: "booth", x, y: Y0 + r * 5, h: 2 });
  const decorBlocked = decor.flatMap((d) => Array.from({ length: (d.w ?? 1) * (d.h ?? 1) }, (_, i) => ({ x: d.x + (i % (d.w ?? 1)), y: d.y + Math.floor(i / (d.w ?? 1)) })));
  const blocked = new Set<string>([
    ...props.map(key),
    ...lobby.map((t) => key({ x: t.x, y: t.y + 1 })),
    ...decorBlocked.map(key),
  ]);
  for (let p = 0; p * POD < total; p++) { // a bench/huddle pod's table runs through the middle column on both desk rows; seat rows stay open
    if (podStyle(p) !== "bench" && podStyle(p) !== "huddle") continue;
    const t = deskPos(p * POD);
    blocked.add(key({ x: t.x + 1, y: t.y + 1 })); blocked.add(key({ x: t.x + 1, y: t.y + 3 }));
  }
  return {
    cols, rows, wallRows: WALL, door, lobby, zones, seats, props, decor,
    board: { x: mid - 3, w: 7 }, // 7 wide, centred on the aisle
    blocked,
  };
}

/** Chair tile of a seat id; ids beyond the built desks (office grew since) still resolve through deskPos. */
export function seatTile(l: Layout, seatId: string): Tile {
  const n = /^d(\d+)$/.exec(seatId)?.[1];
  return l.seats[seatId] ?? (n !== undefined ? deskPos(Number(n)) : l.zones[0].queue[0]);
}

/** A free tile next to `t` to stand on when talking to whoever sits there; `k` rotates the choice so visitors spread out. */
export function standNear(l: Layout, t: Tile, k = 0): Tile {
  const offs = [[1, 0], [-1, 0], [0, 2], [1, 2], [-1, 2], [0, -1], [0, 1], [2, 0], [-2, 0]];
  const free = offs
    .map(([dx, dy]) => ({ x: t.x + dx, y: t.y + dy }))
    .filter((n) => n.x >= 0 && n.y >= l.wallRows && n.x < l.cols && n.y < l.rows && !l.blocked.has(key(n)));
  return free.length ? free[((k % free.length) + free.length) % free.length] : t;
}

/**
 * 4-neighbour BFS around blocked tiles. Returns tiles after `from`, ending at `to`; [] if unreachable.
 * shortcut: string keys, fine to ~2,000 tiles (one 64-desk floor is ~700, three floors ~1,600); switch to y*cols+x indices above that.
 */
export function findPath(l: Layout, from: Tile, to: Tile): Tile[] {
  const start = key(from), goal = key(to);
  const prev = new Map<string, string | null>([[start, null]]);
  const q: Tile[] = [from];
  for (let i = 0; i < q.length && !prev.has(goal); i++) {
    const c = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: c.x + dx, y: c.y + dy };
      const k = key(n);
      if (n.x < 0 || n.y < l.wallRows || n.x >= l.cols || n.y >= l.rows || prev.has(k) || l.blocked.has(k)) continue;
      prev.set(k, key(c));
      q.push(n);
    }
  }
  if (!prev.has(goal)) return [];
  const out: Tile[] = [];
  for (let k: string | null = goal; k && k !== start; k = prev.get(k)!) {
    const [x, y] = k.split(",").map(Number);
    out.unshift({ x, y });
  }
  return out;
}
