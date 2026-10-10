import type { OfficeConfig } from "./types.ts";

export type Tile = { x: number; y: number };
export type Prop = Tile & { role: string; kind: "permanent" | "overflow"; tier: number };
export type Decor = Tile & { kind: "plant" | "coffee" | "cooler" | "couch" | "bookshelf"; w?: number };
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

const GUEST_SLOTS = 4;
const key = (t: Tile) => `${t.x},${t.y}`;

export type LayoutOpts = {
  /** Wrap role zones into this many horizontal bands (more bands = narrower, taller office). */
  bands?: number;
  /** Lead desks along the top; sized to the number of live sessions. */
  lobbySlots?: number;
};

const BAND_H = 9;

/**
 * Deterministic floor plan from the office config.
 * Agents sit facing the camera: seat tile on top, desk tile directly below it.
 */
export function buildLayout(cfg: OfficeConfig, opts: LayoutOpts = {}): Layout {
  const bands = Math.max(1, opts.bands ?? 1);
  const roles = Object.entries(cfg.roles).map(([role, r]) => ({
    role, label: r.agent, count: r.count, over: r.overflow?.max ?? 0,
  }));
  roles.push({ role: "guest", label: "guests", count: 0, over: GUEST_SLOTS });

  const WALL = 2, LOBBY_Y = 3, ZONE_Y = 7, X0 = 2;
  const widthOf = (r: (typeof roles)[number]) => Math.max(r.count, r.over, 1) * 2;
  const total = roles.reduce((n, r) => n + widthOf(r) + 1, 0);
  const limit = Math.max(Math.ceil(total / bands), Math.max(...roles.map(widthOf)) + 1);

  const seats: Layout["seats"] = {};
  const props: Prop[] = [];
  const zones: Zone[] = [];
  let x = X0, band = 0, maxX = X0;
  for (const r of roles) {
    const w = widthOf(r);
    if (x - X0 + w > limit && x > X0 && band < bands - 1) { band++; x = X0; }
    const zy = ZONE_Y + band * BAND_H;
    for (let i = 0; i < r.count; i++) {
      seats[`${r.role}#${i}`] = { x: x + i * 2, y: zy };
      props.push({ x: x + i * 2, y: zy + 1, role: r.role, kind: "permanent", tier: 0 });
    }
    for (let i = 0; i < r.over; i++) {
      seats[`${r.role}+${i}`] = { x: x + i * 2, y: zy + 3 };
      props.push({ x: x + i * 2, y: zy + 4, role: r.role, kind: "overflow", tier: i });
    }
    const queue = Array.from({ length: Math.max(r.count, r.over, 1) }, (_, i) => ({ x: x + i * 2, y: zy + 6 }));
    zones.push({ role: r.role, label: r.label, x, w, y: zy, queue });
    x += w + 1;
    maxX = Math.max(maxX, x);
  }
  const lobbyN = Math.max(1, opts.lobbySlots ?? 4);
  const cols = Math.max(maxX + 1, lobbyN * 2 + 5, 16);
  const rows = ZONE_Y + bands * BAND_H;
  const lobbyX0 = Math.floor((cols - lobbyN * 2) / 2) + 0;
  const lobby = Array.from({ length: lobbyN }, (_, i) => ({ x: lobbyX0 + i * 2, y: LOBBY_Y }));
  const door = { x: Math.floor(cols / 2), y: rows - 1 };

  // Floor decor lives on the margins and against the wall so it never cuts off a walkway.
  const decor: Decor[] = [
    { kind: "coffee", x: cols - 3, y: WALL },
    { kind: "cooler", x: cols - 2, y: WALL },
    { kind: "bookshelf", x: 0, y: WALL },
    { kind: "plant", x: 1, y: WALL },
    { kind: "plant", x: 0, y: ZONE_Y },
    { kind: "plant", x: cols - 1, y: ZONE_Y },
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

/** Seat tile, falling back to the zone's last slot when an unlimited role outgrows the plan. */
export function seatTile(l: Layout, seatId: string): Tile {
  if (l.seats[seatId]) return l.seats[seatId];
  const role = seatId.split(/[#+]/)[0];
  const z = l.zones.find((z) => z.role === role) ?? l.zones[l.zones.length - 1];
  return z.queue[z.queue.length - 1];
}

/** A free tile next to `t` to stand on when talking to whoever sits there; `k` rotates the choice so visitors spread out. */
export function standNear(l: Layout, t: Tile, k = 0): Tile {
  const offs = [[1, 0], [-1, 0], [0, 2], [1, 2], [-1, 2], [0, -1], [0, 1], [2, 0], [-2, 0]];
  const free = offs
    .map(([dx, dy]) => ({ x: t.x + dx, y: t.y + dy }))
    .filter((n) => n.x >= 0 && n.y >= l.wallRows && n.x < l.cols && n.y < l.rows && !l.blocked.has(key(n)));
  return free.length ? free[((k % free.length) + free.length) % free.length] : t;
}

/** 4-neighbour BFS around blocked tiles. Returns tiles after `from`, ending at `to`; [] if unreachable. */
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
