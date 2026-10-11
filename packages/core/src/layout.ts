import type { OfficeConfig } from "./types.ts";

export type Tile = { x: number; y: number };
export type Prop = Tile & { role: string; kind: "permanent" | "overflow"; tier: number; seat?: string };
export type Decor = Tile & { kind: "plant" | "coffee" | "cooler" | "couch" | "bookshelf" | "rack"; w?: number };
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

export const MAX_DESKS = 64;
export const PODS_PER_ROW = 6;
const POD = 4; // desks per pod: a 2x2 cluster of chair+desk pairs
const WALL = 2, LOBBY_Y = 3, Y0 = 7, X0 = 2; // pod grid origin; pod stride is 4 wide (3 + aisle), 5 tall (4 + aisle)

/**
 * Chair tile of desk `i` (its desk is the tile below). Pure and append-only: independent of config, demand and window,
 * so a desk never moves when the office grows. Pod p = i/4 sits at column p%4, row p/4 (row-major); desks go 2x2 inside it.
 */
export function deskPos(i: number): Tile {
  const pod = Math.floor(i / POD), k = i % POD;
  return { x: X0 + (pod % PODS_PER_ROW) * 4 + (k % 2) * 2, y: Y0 + Math.floor(pod / PODS_PER_ROW) * 5 + Math.floor(k / 2) * 2 };
}

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
 * Desks built for `agents` live agents (whole pods, 8..MAX_DESKS): the configured headcount or agents + 4 spare.
 * Shared by buildLayout and allocate(): the allocator must never hand out a desk that is not built.
 */
export function deskCount(cfg: OfficeConfig, agents: number): number {
  const want = Math.max(Object.values(cfg.roles).reduce((n, r) => n + r.count + (r.overflow?.max ?? 0), 0), agents > 0 ? agents + 4 : 0);
  return Math.min(MAX_DESKS, Math.max(2 * POD, Math.ceil(want / POD) * POD));
}

/**
 * Deterministic floor plan: `total` desks (whole pods, 8..MAX_DESKS) at deskPos(0..total-1), seat ids `d<N>`.
 * Agents sit facing the camera: seat tile on top, desk tile directly below it. `zones` are pod rows ("wings") that
 * share one waiting-area queue below the last row; `props[i].seat` is the seat id of that desk.
 */
export function buildLayout(cfg: OfficeConfig, opts: LayoutOpts = {}): Layout {
  // minDesks keeps every desk an agent still sits at (agents may have left, shrinking demand, while a high desk is in use)
  const total = Math.min(MAX_DESKS, Math.max(deskCount(cfg, opts.demand?.agents ?? 0), Math.ceil((opts.minDesks ?? 0) / POD) * POD));
  const podRows = Math.ceil(total / POD / PODS_PER_ROW);

  const seats: Layout["seats"] = {};
  const props: Prop[] = [];
  for (let i = 0; i < total; i++) {
    const t = deskPos(i);
    seats[`d${i}`] = t;
    props.push({ x: t.x, y: t.y + 1, role: "desk", kind: "permanent", tier: 0, seat: `d${i}` });
  }

  const lobbyN = Math.max(1, opts.lobbySlots ?? 4);
  const cols = Math.max(X0 + PODS_PER_ROW * 4 + 2, lobbyN * 2 + 5);
  const qy = Y0 + podRows * 5; // waiting row, one aisle below the last pod row
  const rows = qy + 4;
  const queue = Array.from({ length: 8 }, (_, i) => ({ x: X0 + i * 2, y: qy }));
  const zones: Zone[] = Array.from({ length: podRows }, (_, r) => ({
    role: `wing${r + 1}`, label: `Wing ${r + 1}`, x: X0, w: PODS_PER_ROW * 4 - 1, y: Y0 + r * 5, queue,
  }));
  const lobbyX0 = Math.floor((cols - lobbyN * 2) / 2);
  const lobby = Array.from({ length: lobbyN }, (_, i) => ({ x: lobbyX0 + i * 2, y: LOBBY_Y }));
  const door = { x: Math.floor(cols / 2), y: rows - 1 };

  // Floor decor lives on the margins and against the wall so it never cuts off a walkway.
  const decor: Decor[] = [
    { kind: "coffee", x: cols - 3, y: WALL },
    { kind: "cooler", x: cols - 2, y: WALL },
    { kind: "bookshelf", x: 0, y: WALL },
    { kind: "plant", x: 1, y: WALL },
    { kind: "rack", x: 2, y: WALL },
    { kind: "plant", x: 0, y: Y0 },
    { kind: "plant", x: cols - 1, y: Y0 },
    { kind: "plant", x: 0, y: rows - 3 },
    { kind: "plant", x: cols - 1, y: rows - 3 },
    { kind: "couch", x: door.x - 5, y: rows - 2, w: 2 },
    { kind: "couch", x: door.x + 4, y: rows - 2, w: 2 },
  ];
  const decorBlocked = decor.flatMap((d) => Array.from({ length: d.w ?? 1 }, (_, i) => ({ x: d.x + i, y: d.y })));
  const blocked = new Set<string>([
    ...props.map(key),
    ...lobby.map((t) => key({ x: t.x, y: t.y + 1 })),
    ...decorBlocked.map(key),
  ]);
  return {
    cols, rows, wallRows: WALL, door, lobby, zones, seats, props, decor,
    board: { x: Math.floor(cols / 2) - 3, w: 6 },
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
 * shortcut: string keys, fine to ~2,000 tiles (a full 64-desk office is ~600); switch to y*cols+x indices above that.
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
