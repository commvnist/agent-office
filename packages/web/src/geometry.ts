// Scene-independent geometry: every rect and line scene.ts draws, derived from the core registry (placements/lines) and nothing else.
// Pure (no pixi, no DOM) so it can be asserted in node tests: see geometry.test.ts and docs/visual-consistency.md.
import { checkLayout, lights, lines, placements, podStyle, TILE_PX, type Foot, type Layout, type Line } from "@agent-office/core";

const T = TILE_PX;
export type Rect = { x: number; y: number; w: number; h: number };

/** Art-pixel rect of a footprint. */
export const rectOf = (f: Foot): Rect => ({ x: f.x * T, y: f.y * T, w: f.w * T, h: f.h * T });

/** Wall gauge and its mirror clock: 18 px dials centred on their 2-tile slot (a pixel boundary), tops on the wall's y=3 baseline. */
export const wallDials = (l: Layout) => { const c = (l.board.x - 1) * T; return { gauge: { x: c, y: 12 }, clock: { x: l.cols * T - c, y: 12 } }; };
/** Server bank cabinets: 13 px wide, inset 8 px from the room edge inside the 3 rack footprints (critique E12). */
export const BANK_INSET = 8, CAB_W = 13;

export function sceneGeometry(l: Layout) {
  const feet = placements(l), ls = lines(l);
  const foot = new Map(feet.map((f) => [f.id, f])), line = new Map(ls.map((x) => [x.id, x]));
  const rect = (id: string): Rect => rectOf(foot.get(id)!);
  const nPods = Math.floor(l.props.length / 4);
  const windows = feet.filter((f) => f.kind === "window").map((f) => f.x).sort((a, b) => a - b);
  const aprons: Rect[] = [], mats: Rect[] = [];
  for (let p = 0; p < nPods; p++) {
    const a = line.get(`apron:${p}`)!.pts; // core also emits plate:p anchors; unused (no floor text)
    aprons.push({ x: a[0].x, y: a[0].y, w: a[2].x - a[0].x, h: a[2].y - a[0].y });
  }
  // standing desks get a floor mat under them (desk tile + fixed inset)
  for (const f of feet) if (f.id.startsWith("desk:d") && podStyle(Math.floor(Number(f.id.slice(6)) / 4)) === "standing") mats.push({ x: f.x * T + 1, y: f.y * T + 5, w: 14, h: 11 });
  // cleaning-bot rails: one per pod row, on the aisle's upper edge between the aprons and the conduit (never on it); the dock is the first rail's park pose
  const byRow = new Map<number, { x0: number; x1: number; y: number }>();
  for (const a of aprons) {
    const y = a.y + a.h + 1, r = byRow.get(y) ?? { x0: Infinity, x1: -Infinity, y };
    r.x0 = Math.min(r.x0, a.x); r.x1 = Math.max(r.x1, a.x + a.w);
    byRow.set(y, r);
  }
  const rails = [...byRow.values()].sort((a, b) => a.y - b.y).map((r) => ({ x0: r.x0 + 5, x1: r.x1 - 5, y: r.y })); // bot is 10 wide, centred on x
  const dock: Rect | null = rails[0] ? { x: rails[0].x0 - 5, y: rails[0].y - 2, w: 10, h: 5 } : null; // the bot's 5 body rows
  const racks = feet.filter((f) => f.kind === "rack").sort((a, b) => a.x - b.x).map((f) => ({ id: f.id, ...rectOf(f) }));
  const bank = racks.map((r, i) => ({ x: racks[0].x + BANK_INSET + CAB_W * i, y: r.y, w: CAB_W, h: r.h }));
  // lounge rug: the couch set's bounding box plus a 4 px margin either side, framed top/bottom around the table and couch art, inside rug:lounge
  const set = feet.filter((f) => f.kind === "couch" || f.kind === "armchair" || f.kind === "table").map(rectOf);
  const sx = Math.min(...set.map((r) => r.x)), sy = Math.min(...set.map((r) => r.y)), ex = Math.max(...set.map((r) => r.x + r.w)), ey = Math.max(...set.map((r) => r.y + r.h));
  const lounge: Rect = { x: sx - 4, y: sy + 1, w: ex - sx + 8, h: ey - sy + 3 };
  const junctions = feet.filter((f) => f.kind === "junction").map((f) => ({ id: f.id, pod: Number(f.id.split(":")[1]), cx: f.x * T + 8, cy: f.y * T + 8 }));
  return {
    feet, lines: ls, foot, line, rect, windows, aprons, mats, rails, dock, racks, bank, lounge, junctions,
    conduits: ls.filter((x) => x.kind === "conduit"), lights: lights(l),
    sconces: feet.filter((f) => f.kind === "sconce").map((f) => ({ id: f.id, ...rectOf(f) })),
    signs: { ops: rectOf(foot.get("plate:ops")!), agent: rectOf(foot.get("plate:agent")!) },
    rugs: feet.filter((f) => f.kind === "rug").map((f) => ({ id: f.id, ...rectOf(f) })),
    dials: wallDials(l),
  };
}
export type SceneGeometry = ReturnType<typeof sceneGeometry>;
export type { Line };

let warned = "";
/** Layout-build self-check: one console.warn per distinct violation set; returns the violations, never throws. */
export function selfCheck(l: Layout, warn: (m: string) => void = (m) => console.warn(m)): string[] {
  let v: string[] = [];
  try { v = checkLayout(l); } catch (e) { v = [`checkLayout threw: ${String(e)}`]; }
  const key = v.join("\n");
  if (v.length && key !== warned) { warned = key; warn(`[agent-office] visual-consistency violations (${v.length}):\n${v.slice(0, 8).join("\n")}`); }
  return v;
}
