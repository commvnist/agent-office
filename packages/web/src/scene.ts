import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { podRow, podStyle, type Layout, type Task } from "@agent-office/core";
import { T, outline, tagHits } from "./actor.ts";
import { sceneGeometry, selfCheck, type SceneGeometry } from "./geometry.ts";
import { art, dev, place } from "./snap.ts";
import { bake, Grid, hash, hsl, mix } from "./pixel.ts";
import { shade } from "./color.ts";
import { KEY, theme, STATUS } from "./theme.ts";
import { office } from "./api.ts";
import { boardModel, COLS, ledgerLines, SUMMARY_MS, type Board, type Col, type Memo } from "./board.ts";
import { podOwners, projectHue } from "./logic.ts";
import { ambientOn, burstAllowed, fontPx, settings } from "./settings.ts";
import type { Weather } from "./flair.ts";
import { cleanText, couchSeats, skyAt, toolKind } from "./choreo.ts";
import { promptCaption } from "./pod.ts";
import { hideText } from "./stream.ts";
import { activity, armchairTex, stoolTex, benchTex, boothTex, CHAIR_STYLES, catTex, chairTex, vacantChairTex, chipStack, coffeeTex, coolerTex, couchTex, deskTex, drawPx, floorLampTex, fridgeTex, holoTex, huddleTex, junctionTex, laptopTex, ledNoise, plantTex, pxTextW, rackTex, sconceTex, shadowTex, shelfTex, staleK, tableTex, wallTex, whiteTex } from "./sprites.ts";

const MAX_LIGHTS = 30;
const FILED_MS = 30 * 60_000; // how long a finished helper's filed card stays on its empty desk
const FILED: Record<string, string> = { done: "#3ddc97", partial: "#ffb020", blocked: "#ff5c6c", empty: "#8b93ad" };
const DAY_LIFT = 0.1; // peak add-blend alpha of the daylight grade (~10% lift of the deck at noon)
const CHAIR_LINGER_MS = 20_000; // how long a vacated chair stays out
/** Zone (pod row) a seat id `d<N>` belongs to; anything else (lobby) belongs to none. */
const wingOf = (seat: string) => {
  const n = /^d(\d+)$/.exec(seat)?.[1];
  return n === undefined ? "" : `wing${podRow(Math.floor(Number(n) / 4)) + 1}`;
};
const hexNum = (h: string) => parseInt(h.slice(1), 16);
// R2 value key (theme.ts KEY): scene tints use the same env ramp and emitters as the sprites
const E = KEY.env, CY = hexNum(KEY.cyan), CY_OFF = hexNum(KEY.cyanOff), WARM = hexNum(KEY.warm);

/**
 * `tool` = last tool name (monitor glyph), `count` = tool calls so far (desk clutter), `stale` = long quiet (dim monitor),
 * `role` = occupant's role (desk-top item), `flash` = ms stamp of a "ship-it" wave (monitors blink green for 1.2s, staggered),
 * `waiting` = occupant needs the user (a steady lamp in the wait kind's status colour, R2), `prompt` = the session's last user prompt (pod caption),
 */
export type SeatState = { used: boolean; working: boolean; tool?: string; count?: number; stale?: boolean; project?: string; role?: string; flash?: number; waiting?: boolean; prompt?: string;
  /** `load` = tool calls in the last 30 s (0 idle .. 3 busy): lights the desk power rail. `queueDepth` = queued items for the agent (chip stack). `idleMs` = real silence (desaturates the desk). `hue` = session identity hue (floor trim). */
  load?: 0 | 1 | 2 | 3; mug?: boolean; queueDepth?: number; idleMs?: number; hue?: number; /** session lightness offset that goes with `hue` (logic.ts sessionTone) */ tone?: number;
  /** Seated, between tools, mid-turn: three dots on the monitor (the actor shows no thought cloud at the desk). */
  think?: boolean;
  /** The occupant is hidden by session collapse: its chair hides too (an empty chair reads as a top hat), the desk keeps its activity (R1). */
  folded?: boolean;
  /** Why it waits: permission (amber lamp) or your turn (cyan lamp); defaults to permission. */
  waitKind?: "permission" | "turn" };

type Desk = { s: Sprite; accent: string; chair: Sprite | null; ctex?: Texture; hue: number; overflowTier: number | null; deco: Graphics | null; decoKey: string; shown: number; pod: number; by: number; v: 0 | 1; idx: number; sh: Sprite[]; used: boolean; chairAt: number; sty: 0 | 1 | 2 };
const BUILD_MS = 400, RISE = 6; // build-in fade/rise
const MONO = "ui-monospace, Menlo, Consolas, monospace";
const DIM = 0x171421; // cool shadow tint: zones dim toward it instead of plain black
const NAMES = ["Queued", "Working", "Done", "Blocked"];
const CARD: Record<Col, number> = { pending: 0xf6f0d8, running: 0x7fb8ff, done: 0x7fdc8f, blocked: 0xff7a6a };
const CARDS_PER_COL = 4;
// screen spill colour by tool kind (term green, edit amber, read blue, web violet); "other" gets the pool only
const SPILL: Record<string, string> = { term: "91,227,125", edit: "255,179,71", read: "90,169,255", web: "176,123,255", other: "" };
const smooth = (t: Texture) => { t.source.scaleMode = "linear"; return t; };
const radial = (c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rgb: string, a: number) => {
  c.save(); c.translate(x, y); c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, rx, 0, Math.PI * 2); c.fill(); c.restore();
};
/** Desk light for one tool kind: cyan monitor pool, a coloured spill trapezoid under the monitor, a small warm lamp glow. Monitor centre is at (16,10). */
const lightTex = (kind: string) => smooth(bake(32, 26, (c) => {
  radial(c, 16, 10, 14, 8, "127,227,255", 0.1);
  radial(c, 9, 7, 6, 6, "255,210,122", 0.22);
  const rgb = SPILL[kind];
  if (!rgb) return;
  const g = c.createLinearGradient(0, 12, 0, 25);
  g.addColorStop(0, `rgba(${rgb},0.16)`); g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g; c.beginPath(); c.moveTo(13, 12); c.lineTo(19, 12); c.lineTo(27, 25); c.lineTo(5, 25); c.fill();
}));
const lampTex = () => smooth(bake(14, 14, (c) => radial(c, 7, 7, 7, 7, "255,255,255", 0.5))); // white: tinted by wait kind
// weather art (baked once, shared across scenes)
let wxTex: { cloud: Texture; sun: Texture } | null = null;
const wxTextures = () => (wxTex ??= {
  cloud: (() => {
    const g = new Grid(12, 5);
    g.map(0, 0, [".....###....", "..#########.", ".###########", "############", ".##########."], { "#": "#ffffff" });
    return g.texture();
  })(),
  sun: (() => {
    const g = new Grid(7, 7);
    g.map(0, 0, ["..###..", ".#####.", "#######", "#######", "#######", ".#####.", "..###.."], { "#": "#ffffff" });
    return g.texture();
  })(),
});
type WxWin = { x: number; cloud: Sprite; sun: Sprite; drops: Sprite[]; flash: Sprite };
type Pod = {
  x: number; y: number; w: number; h: number; g: Graphics; owner: string; hue: number; plaque: Text | null; key: string;
  cap: Text | null; prompt: string; capPrompt: string; capPriv: boolean; capChars: number; // last-prompt caption, redrawn when any of these change
};

/** Static office furniture + the small amount of ambient animation (windows, clock, whiteboard). */
export class Scene {
  floor = new Container();
  walls = new Container();
  sky = new Graphics();
  clock = new Graphics();
  night = new Graphics();
  private day = new Graphics(); // daylight lift: a faint warm add over the whole room, the inverse of the night overlay
  boardText: Text;
  private boardMask = new Graphics();
  private doorG = new Graphics();
  private doorOpen = false;
  private glow = new Container();
  private glowPool = new Map<string, Sprite>(); // one additive light per occupied desk, reused
  private glowTex = smooth(bake(44, 44, (c) => radial(c, 22, 22, 22, 22, "255,255,255", 1))); // one baked radial gradient
  private lightPool = new Map<string, Sprite>(); // desk light (pool + spill + lamp) per working desk, <= MAX_LIGHTS
  private lightTexs = new Map<string, Texture>();
  private shafts = new Container(); // one soft window-light sprite per window light (lights() tone "window"), clipped to the window's x-range (E1)
  private shaftTex = smooth(bake(1, 56, (c) => { const g = c.createLinearGradient(0, 0, 0, 56); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.12, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 1, 56); }));
  private gauge = new Graphics(); // activity gauge panel (mirror of the clock): bars lit by real office activity
  private gaugeLvl = -1;
  private gaugeSpill: Sprite | null = null;
  private rackSpill: Sprite | null = null;
  private fixtures = new Container(); // ceiling fixtures: bar + soft pool each; day 40%, night 100%
  private fixA = -1;
  private jLeds: Sprite[] = []; // junction status LED per pod
  private filed = new Map<string, { kind: string; t: number }>(); // seat id -> outcome of the helper that just left it
  private geo: SceneGeometry; // every rect and line below comes from here (geometry.ts <- core placements()/lines())
  private bot: Sprite | null = null;
  private botLamp: Sprite | null = null;
  private links = new Map<number, Sprite[]>(); // bench-pod table tiles by pod
  private shaftDay = 0;
  private dust: Sprite[] = [];
  private coffeeS: Sprite | null = null;
  private coffeeOn = false;
  private coffeeWisp = -1;
  private racks: Sprite[] = [];
  private leds: Sprite[] = []; // 4 rows x 3 LEDs per cabinet, drawn over the rack texture
  private ledStep = -1;
  private act = 0; private actTo = 0; private techAt = 0; // smoothed office activity (0..1), its target, last tech tick
  private podWork: number[] = []; // working seats per pod
  private memo: Memo = { counts: null, at: 0 };
  private lastTasks: readonly Task[] | null = null;
  private board: Board | null = null;
  private cards: Sprite[] = [];
  private colText: Text[] = [];
  private colKey = "";
  private clockSec = -1;
  private zoneDim = new Map<string, Graphics>(); // dark overlay per zone, shown while the zone is empty (#113)
  desks = new Map<string, Desk>();
  state = new Map<string, SeatState>();
  coffee: { x: number; y: number };
  private skyHour = -1;
  private pods: Pod[] = [];
  private born = new Map<number, number>(); // pod index -> build-in start; pods added by a growth relayout only
  private hoverPod = -1; // the claimed pod under the pointer (or the hovered/selected agent's): only its plaque and caption show
  // fun layer: weather sits above the sky inside the window panes; every piece is a pooled baked sprite
  private wx = new Container();
  private wxWins: WxWin[] = [];
  private weather: Weather = "cloudy";
  private dark = false;
  private flashUntil = 0;
  private shakeUntil = 0;
  private floorS: Sprite | null = null;
  private catS: Sprite | null = null;
  private catUntil = 0;
  private ys: Container;

  /** `grownFrom`: desk count of the plan this one replaces (0 = first build or unknown); desks beyond it build in. */
  constructor(private l: Layout, world: Container, ysort: Container, private ui: Container, grownFrom = 0) {
    const now = Date.now();
    this.geo = sceneGeometry(l);
    selfCheck(l);
    if (grownFrom > 0 && !settings.reducedMotion) for (let p = Math.floor(grownFrom / 4); p < Math.ceil(l.props.length / 4); p++) this.born.set(p, now);
    const vig = new Sprite(smooth(bake(64, 40, (c) => {
      const g = c.createRadialGradient(32, 20, 10, 32, 20, 42);
      g.addColorStop(0, "rgba(10,8,20,0)"); g.addColorStop(1, "rgba(10,8,20,1)");
      c.fillStyle = g; c.fillRect(0, 0, 64, 40);
    })));
    vig.width = l.cols * T; vig.height = l.rows * T; vig.alpha = 0.34; vig.eventMode = "none"; // the one vignette (E11): the floor print carries no second grade
    const clip = new Graphics().rect(0, 0, l.cols * T, l.rows * T).fill(0xffffff); // additive light stays inside the room (E11)
    this.glow.mask = clip;
    this.shafts.eventMode = "none";
    for (const L of this.geo.lights) if (L.tone === "window") { // the pane's x-range (2 px reveal each side), from the wall foot down onto the floor
      const r = this.geo.rect(L.source), sp = place(new Sprite(this.shaftTex), r.x + 2, L.y);
      sp.width = r.w - 4; sp.height = 56; sp.blendMode = "add"; sp.eventMode = "none";
      this.shafts.addChild(sp);
    }
    this.glow.addChild(this.shafts);
    for (let i = 0; i < 12; i++) { // dust motes: drift only inside the shafts
      const m = new Sprite(whiteTex());
      m.tint = 0xfff1c8; m.visible = false; m.eventMode = "none"; m.blendMode = "add";
      this.dust.push(m); this.glow.addChild(m);
    }
    this.ys = ysort;
    world.addChild(this.floor, this.walls, this.sky, this.wx, this.clock, ysort, this.night, this.day, this.glow, clip, vig);
    this.glow.eventMode = "none";
    this.floor.eventMode = this.walls.eventMode = "none";
    this.buildFloor();
    this.buildWalls();
    this.buildWeather();
    this.buildFurniture(ysort);
    const c = this.geo.rect(`decor:coffee:${l.decor.findIndex((d) => d.kind === "coffee")}`);
    this.coffee = { x: c.x + 8, y: c.y + 2 };
    const label = () => new Text({ text: "", style: { fontFamily: MONO, fontSize: 10, fill: KEY.text.fg } });
    this.boardText = label(); // summary / empty message; the four column headers are colText
    this.colText = COLS.map(label);
    ui.addChild(this.boardText, ...this.colText, this.boardMask);
    for (const t of [this.boardText, ...this.colText]) { t.mask = this.boardMask; t.eventMode = "none"; } // keep the text inside the board frame when zoomed (#120)
    this.night.rect(0, 0, l.cols * T, l.rows * T).fill(0x0b1030);
    this.night.eventMode = "none";
    this.day.rect(0, 0, l.cols * T, l.rows * T).fill(0xfff1d8);
    this.day.blendMode = "add"; this.day.eventMode = "none"; this.day.alpha = 0;
  }

  private buildFloor() {
    const l = this.l, D = theme().deck;
    const zoneOf = new Map<string, string>();
    for (const z of l.zones) for (let y = z.y - 1; y <= z.y + 7; y++) for (let x = z.x - 1; x <= z.x + z.w - 1; x++) zoneOf.set(`${x},${y}`, z.role);
    const ly = l.lobby[0].y, qy = l.zones[0].queue[0].y;
    for (let y = ly - 1; y <= ly + 2; y++) for (let x = 1; x < l.cols - 1; x++) zoneOf.delete(`${x},${y}`);
    for (let y = qy - 1; y < l.rows; y++) for (let x = 0; x < l.cols; x++) zoneOf.delete(`${x},${y}`);
    // One material everywhere: dark composite deck. Work bays are the mid panel, the concourse a step deeper, the perimeter trim deepest;
    // only the lounge and the lobby get a (bordered) rug. Panel seams fall in the pod aisles (see bakeTech).
    const bay = D.mid, concourse = mix(D.mid, D.deep, 0.45);
    const colour = (x: number, y: number) => {
      if (x === 0 || x === l.cols - 1 || y === l.rows - 1) return D.deep;
      const v = mix(zoneOf.has(`${x},${y}`) ? bay : concourse, hash(`f${x},${y}`) & 1 ? D.lit : D.deep, 0.03 * (1 + (hash(`g${x},${y}`) % 3))); // +-3% variance
      return v;
    };
    // one texture for the whole floor, not a sprite per tile
    // shortcut: a single canvas, so cols*T or rows*T over the GPU max texture size (4096+) needs chunking
    const floor = bake(l.cols * T, (l.rows - l.wallRows) * T, (c) => {
      for (let y = l.wallRows; y < l.rows; y++)
        for (let x = 0; x < l.cols; x++) {
          c.fillStyle = colour(x, y);
          c.fillRect(x * T, (y - l.wallRows) * T, T, T);
          const role = zoneOf.get(`${x},${y}`);
          if (role) {
            const g = this.zoneDim.get(role) ?? this.zoneDim.set(role, new Graphics()).get(role)!;
            g.rect(x * T, y * T, T, T);
          }
        }
      this.bakeTech(c);
    });
    const fs = new Sprite(floor);
    fs.position.set(0, l.wallRows * T);
    fs.eventMode = "none";
    this.floorS = fs;
    this.floor.addChild(fs);
    const ao = new Graphics(); // static wall-base ambient occlusion
    [0.12, 0.08, 0.04].forEach((a, i) => ao.rect(0, l.wallRows * T + i * 2, l.cols * T, 2).fill({ color: DIM, alpha: a }));
    ao.eventMode = "none";
    this.floor.addChild(ao);
    this.buildTechGlow();
    for (const g of this.zoneDim.values()) { g.fill({ color: DIM, alpha: 0.35 }); g.visible = false; g.eventMode = "none"; this.floor.addChild(g); }
    for (let p = 0; p * 4 < l.props.length; p++) {
      const a = this.geo.aprons[p], g = new Graphics();
      g.eventMode = "none";
      this.pods.push({ x: a.x, y: a.y, w: a.w, h: a.h, g, owner: "\0", hue: -1, plaque: null, key: "", cap: null, prompt: "", capPrompt: "\0", capPriv: false, capChars: 0 });
      this.floor.addChild(g);
    }
    this.floor.addChild(this.doorG);
    this.drawDoor();
  }

  /**
   * Floor print, baked once with the deck (zero per-frame cost). Every mark has a meaning: panel seams in the aisles, a grid at 6%,
   * rugs for lounge and lobby, the cyan spine door -> lobby with chevrons, standing mats and the conduit network. No text. Nothing here moves.
   */
  private bakeTech(c: CanvasRenderingContext2D) {
    const l = this.l, D = theme().deck, g = this.geo, w = l.cols * T, h = (l.rows - l.wallRows) * T, oy = l.wallRows * T;
    const rgba = (hex: string, a: number) => { const n = hexNum(hex); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
    for (const r of g.rugs) { // bordered rug: fill, 1px lit border; the lounge rug is sized to its couch set (geo.lounge, E3)
      const k = r.id === "rug:lobby" ? { x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4 } : g.lounge;
      c.fillStyle = r.id === "rug:lobby" ? mix(D.mid, D.lit, 0.45) : mix(D.mid, E[3], 0.6); c.fillRect(k.x, k.y - oy, k.w, k.h);
      c.fillStyle = rgba(D.lit, 0.7); c.fillRect(k.x, k.y - oy, k.w, 1); c.fillRect(k.x, k.y - oy + k.h - 1, k.w, 1); c.fillRect(k.x, k.y - oy, 1, k.h); c.fillRect(k.x + k.w - 1, k.y - oy, 1, k.h);
    }
    // contact shadows: the inset server bank (E12) and the lounge pieces sit on the floor, not over it
    const b0 = g.bank[0], b1 = g.bank[g.bank.length - 1];
    if (b0) { c.fillStyle = rgba(E[0], 0.6); c.fillRect(b0.x, b0.y + b0.h - oy, b1.x + b1.w - b0.x, 1); c.fillStyle = rgba(E[0], 0.3); c.fillRect(b0.x + 1, b0.y + b0.h + 1 - oy, b1.x + b1.w - b0.x - 2, 1); }
    for (const f of g.feet) if (f.kind === "couch" || f.kind === "armchair") { const r = g.rect(f.id); c.fillStyle = rgba(E[0], 0.45); c.fillRect(r.x + 2, r.y + r.h - oy, r.w - 4, 2); }
    // deck plates, not an editor grid: a dark seam every 2 tiles with a faint lit lip beside it (critique R4)
    for (let x = 0; x <= l.cols; x += 2) { c.fillStyle = "rgba(8,10,20,0.32)"; c.fillRect(x * T, 0, 1, h); c.fillStyle = "rgba(200,215,255,0.035)"; c.fillRect(x * T + 1, 0, 1, h); }
    for (let y = 0; y <= l.rows - l.wallRows; y += 2) { c.fillStyle = "rgba(8,10,20,0.32)"; c.fillRect(0, y * T, w, 1); c.fillStyle = "rgba(200,215,255,0.035)"; c.fillRect(0, y * T + 1, w, 1); }
    // spine: door -> lobby, a cyan strip with chevrons pointing in
    const [s0, s1] = g.line.get("spine")!.pts, sx = s0.x, sTop = s0.y - oy, sBot = s1.y - oy;
    // sx is a pixel BOUNDARY (the tile centre), so everything is even-width and mirrored about it: 8px strip, 2px apex
    c.fillStyle = rgba(KEY.cyan, 0.1); c.fillRect(sx - 4, sTop, 8, sBot - sTop);
    c.fillStyle = rgba(KEY.cyan, 0.3); c.fillRect(sx - 4, sTop, 1, sBot - sTop); c.fillRect(sx + 3, sTop, 1, sBot - sTop);
    c.fillStyle = rgba(KEY.cyan, 0.55);
    for (let y = sBot - T; y > sTop; y -= 2 * T) for (let k = 0; k < 3; k++) { c.fillRect(sx - 1 - k, y + k, 1, 1); c.fillRect(sx + k, y + k, 1, 1); }
    // mats under standing desks (no floor text anywhere: pod identity lives in the hover plaque)
    for (const m of g.mats) { c.fillStyle = rgba(E[0], 0.85); c.fillRect(m.x, m.y - oy, m.w, m.h); c.fillStyle = rgba(D.lit, 0.5); c.fillRect(m.x, m.y - oy, m.w, 1); }
    // conduits (server bank -> trunk -> pod rows): 2px dark steel with a 1px lit edge on the upper/left side, centred on the line;
    // each segment is inclusive of both end pixels so bends and joints close
    const seg = g.conduits.flatMap((ln) => ln.pts.slice(1).map((b, i) => { const a = ln.pts[i]; return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) - oy, w: Math.abs(b.x - a.x) + 1, h: Math.abs(b.y - a.y) + 1 }; }));
    c.fillStyle = rgba(D.lit, 0.85); for (const k of seg) k.w === 1 ? c.fillRect(k.x - 1, k.y, 1, k.h) : c.fillRect(k.x, k.y - 1, k.w, 1);
    c.fillStyle = rgba(E[0], 0.95); for (const k of seg) k.w === 1 ? c.fillRect(k.x, k.y, 2, k.h) : c.fillRect(k.x, k.y, k.w, 2);
    // charging dock where the cleaning bot parks (start of its first rail)
    const d = g.dock;
    if (d) { c.fillStyle = rgba(E[0], 0.9); c.fillRect(d.x, d.y - oy, d.w, d.h); c.fillStyle = KEY.cyan; c.fillRect(d.x + 1, d.y + 1 - oy, 2, 1); }
  }

  /** A helper reported and left its desk: leave its result there as a filed card (critique R7, world memory). */
  fileOutcome(seat: string, kind: string) {
    if (this.desks.has(seat)) this.filed.set(seat, { kind, t: Date.now() });
  }

  /** The walkable floor in art px (below the back wall): name tags and bubbles belong inside it. */
  floorRect() {
    return { x: 0, y: this.l.wallRows * T, w: this.l.cols * T, h: (this.l.rows - this.l.wallRows) * T };
  }

  /** Owner project per pod ("" while empty), for the minimap. */
  podOwners() {
    return this.pods.map((p) => (p.owner === "\0" ? "" : p.owner));
  }

  /** Redraw a pod's patch: its owner's hue, or a dim neutral square while empty. Runs only when occupancy changes. */
  private setOwner(i: number, owner: string, hue = -1, dl = 0) {
    const pod = this.pods[i];
    pod.owner = owner; pod.hue = hue + dl; // the key: hue and tone together
    pod.g.clear().rect(pod.x, pod.y, pod.w, pod.h); // square: a curve on a 1 art px grid only anti-aliases
    // pad and 1px trim are the session's identity tone (a quiet tint: shirts always beat the pod behind them); a crew without one falls back to its project
    const h = hue >= 0 ? hue : projectHue(owner);
    if (owner) pod.g.fill({ color: hexNum(hsl(h, 0.4, 0.55 + dl)), alpha: 0.09 }).stroke({ width: 1, color: hexNum(hsl(h, 0.65, 0.6 + dl)), alpha: 0.25, alignment: 1 });
    else pod.g.fill({ color: DIM, alpha: 0.14 });
    if (!owner) { if (pod.plaque) pod.plaque.visible = false; return; }
    pod.plaque ??= this.ui.addChild(new Text({ text: "", style: { fontFamily: MONO, fontSize: 10, fill: KEY.text.fg, stroke: outline(3) } }));
    pod.plaque.anchor.set(0.5);
    pod.plaque.eventMode = "none";
    pod.plaque.visible = true;
    pod.key = "";
  }

  /** Door is ajar while someone stands near it (#110). */
  setDoor(open: boolean) {
    if (open !== this.doorOpen) { this.doorOpen = open; this.drawDoor(); }
  }
  private drawDoor() {
    const d = this.geo.rect("door"), x = d.x - 4, y = d.y + 6, w = d.w + 8; // frame overhangs its one-tile footprint by 4px each side
    this.doorG.clear();
    this.doorG.rect(x - 1, y - 4, w + 2, 14).fill(E[3]); // steel frame
    if (this.doorOpen) this.doorG.rect(x, y, w, 10).fill(E[0]).rect(x, y, 5, 10).fill(E[2]);
    else this.doorG.rect(x, y, w, 10).fill(E[1]).rect(x, y, w, 1).fill(E[4]);
    this.doorG.rect(x, y - 3, w, 2).fill(this.doorOpen ? WARM : CY_OFF); // light strip: lamp-warm while ajar
  }

  private buildWalls() {
    const wt = wallTex();
    const sg = this.geo.signs, cw = this.l.cols * T;
    const s = new Sprite(bake(cw, 32, (c) => {
      for (let x = 0; x < this.l.cols; x++) c.drawImage(wt.source.resource as CanvasImageSource, x * T, 0);
      c.fillStyle = theme().wall.trim; c.fillRect(0, 0, cw, 2); // ceiling cove: 2px trim and a cyan wash falling from it
      const g = c.createLinearGradient(0, 2, 0, 8);
      g.addColorStop(0, "rgba(154,246,255,0.08)"); g.addColorStop(1, "rgba(154,246,255,0)"); // KEY.cyan
      c.fillStyle = g; c.fillRect(0, 2, cw, 6);
      // one sign plate style (E8): a dark plate with a lit top edge and a 1px bevel, top on the wall's y=3 baseline, centred on its slot;
      // the letters are decorative neon (magenta, signage only) with a faint halo from the tubes themselves (L5)
      const plate = (cx: number, lines: string[]) => {
        const tw = Math.max(...lines.map(pxTextW)), pw = tw + 5 + ((tw + 5) & 1), ph = lines.length * 6 + 4, px = cx - pw / 2, py = 3;
        c.fillStyle = E[3]; c.fillRect(px - 1, py - 1, pw + 2, ph + 2);
        c.fillStyle = E[0]; c.fillRect(px, py, pw, ph);
        c.fillStyle = theme().wall.trim; c.fillRect(px - 1, py - 1, pw + 2, 1);
        lines.forEach((t, i) => {
          const tx = Math.round(cx - pxTextW(t) / 2), ty = py + 3 + i * 6;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawPx(c, t, tx + dx, ty + dy, "rgba(255,62,165,0.18)"); // KEY.neon halo
          drawPx(c, t, tx, ty, KEY.neon);
        });
      };
      plate(sg.ops.x + sg.ops.w / 2, ["OPS"]); plate(sg.agent.x + sg.agent.w / 2, ["AGENT", "OFFICE"]);
    }));
    s.eventMode = "none";
    this.walls.addChild(s);
    for (const k of this.geo.sconces) { const sp = place(new Sprite(sconceTex()), k.x, 3); sp.eventMode = "none"; this.walls.addChild(sp); } // wall washer: one per sconce footprint
    // whiteboard (E7): a slate frame with a lit top edge, dark glass and one 1px cyan accent along the glass foot; text is the screen-space overlay
    const b = this.geo.rect("board");
    const g = new Graphics();
    g.rect(b.x, 3, b.w, 24).fill(E[3]).rect(b.x, 3, b.w, 1).fill(E[4]).rect(b.x + 2, 5, b.w - 4, 20).fill(E[0]);
    g.rect(b.x + 2, 24, b.w - 4, 1).fill({ color: CY, alpha: 0.55 });
    g.rect(b.x + 4, 27, b.w - 8, 2).fill(E[3]).rect(b.x + 4, 27, b.w - 8, 1).fill(E[4]); // marker tray
    // clock face (E7): an 18 px pixel dial, outline + slate bezel lit top-left + face + 4 ticks; the hands are this.clock
    const { x: cx, y: cy } = this.geo.dials.clock;
    for (let y = -9; y < 9; y++) for (let x = -9; x < 9; x++) {
      const d = Math.hypot(x + 0.5, y + 0.5);
      if (d >= 9) continue;
      g.rect(cx + x, cy + y, 1, 1).fill(d >= 8 ? E[0] : d >= 6.5 ? (x + y < -3 ? E[5] : E[4]) : shade(KEY.paper, -0.12));
    }
    for (const [x, y] of [[-1, -6], [0, -6], [-1, 5], [0, 5], [-6, -1], [-6, 0], [5, -1], [5, 0]]) g.rect(cx + x, cy + y, 1, 1).fill(E[3]);
    this.walls.addChild(g, this.gauge);
    for (let i = 0; i < CARDS_PER_COL * 4; i++) { // pooled paper cards, laid out when the task list changes
      const c = new Sprite(whiteTex());
      c.visible = false; c.eventMode = "none";
      this.cards.push(c); this.walls.addChild(c);
    }
  }

  private buildTechGlow() {
    for (const L of this.geo.lights) { // a soft additive pool under each light source (alpha follows day/night via the container); windows: drawShafts
      if (L.tone === "window") continue;
      const warm = L.tone === "warm", pool = new Sprite(this.glowTex);
      pool.anchor.set(0.5); pool.position.set(L.x, L.y + (warm ? -4 : L.reach * 0.4));
      pool.width = L.reach * (warm ? 1.6 : 1.5); pool.height = L.reach * (warm ? 0.9 : 1);
      pool.tint = warm ? WARM : 0xcfe6ff; pool.alpha = warm ? 0.16 : 0.14; pool.eventMode = "none";
      this.fixtures.addChild(pool);
      if (L.source.startsWith("sconce:")) { // small halo round the lit shade (E9): its source is the sprite right above it
        const halo = new Sprite(this.glowTex);
        halo.anchor.set(0.5); halo.position.set(L.x, 13); halo.width = 18; halo.height = 10; halo.tint = 0xcfe6ff; halo.alpha = 0.28; halo.eventMode = "none";
        this.fixtures.addChild(halo);
      }
    }
    this.fixtures.eventMode = "none";
    this.glow.addChild(this.fixtures);
    for (const j of this.geo.junctions) { // pod junction box (the conduit passes through its centre) + one status LED
      const box = place(new Sprite(junctionTex()), j.cx - 3, j.cy - 2), led = place(new Sprite(whiteTex()), j.cx + 1, j.cy - 1);
      led.width = led.height = 1; led.tint = CY_OFF; box.eventMode = led.eventMode = "none";
      this.floor.addChild(box, led); this.jLeds[j.pod] = led;
    }
    const gcx = this.geo.dials.gauge.x;
    this.gaugeSpill = new Sprite(this.glowTex);
    this.gaugeSpill.anchor.set(0.5); this.gaugeSpill.position.set(gcx, 16); this.gaugeSpill.width = 40; this.gaugeSpill.height = 30; this.gaugeSpill.tint = CY; this.gaugeSpill.alpha = 0; this.gaugeSpill.eventMode = "none";
    this.glow.addChild(this.gaugeSpill);
    if (this.geo.rails.length) { // roaming cleaning bot: under the actors, with a small additive headlamp
      this.bot = new Sprite(bake(10, 6, (c) => {
        c.fillStyle = E[2]; c.fillRect(1, 1, 8, 4); c.fillStyle = E[4]; c.fillRect(1, 1, 8, 1);
        c.fillStyle = E[0]; c.fillRect(0, 5, 10, 1); c.fillStyle = KEY.cyan; c.fillRect(7, 2, 2, 1);
      }));
      this.bot.anchor.set(0.5); this.bot.eventMode = "none"; this.bot.visible = false;
      this.botLamp = new Sprite(this.glowTex);
      this.botLamp.anchor.set(0.5); this.botLamp.tint = CY; this.botLamp.blendMode = "add"; this.botLamp.width = 18; this.botLamp.height = 10; this.botLamp.eventMode = "none"; this.botLamp.visible = false;
      this.floor.addChild(this.bot); this.glow.addChild(this.botLamp);
    }
  }

  /** Position of the cleaning bot at `now`: back and forth along each trace in turn. A pure function of time, so no state to keep or lose. */
  private botAt(now: number) {
    const rs = this.geo.rails, per = rs.map((r) => ((r.x1 - r.x0) * 2 * 1000) / 14); // 14 px/s
    let t = now % per.reduce((a, b) => a + b, 0);
    for (let i = 0; i < rs.length; i++) {
      if (t >= per[i]) { t -= per[i]; continue; }
      const u = t / per[i], tri = u < 0.5 ? u * 2 : 2 - u * 2;
      return { x: art(rs[i].x0 + tri * (rs[i].x1 - rs[i].x0)), y: rs[i].y, dir: u < 0.5 ? 1 : -1 };
    }
    return { x: rs[0].x0, y: rs[0].y, dir: 1 };
  }

  /** Working seats per pod and the activity target. Called every tick, not only per snapshot: `working` on the seat states is set by the per-frame loop (isWorking over time), so a count taken at snapshot time sees everyone idle. Returns seats in use. */
  private countWork(): number {
    this.podWork = [];
    let nUsed = 0, working = 0;
    for (const [id, st] of this.state) {
      if (!st.used) continue;
      nUsed++;
      if (!st.working) continue;
      working++;
      const p = this.desks.get(id)?.pod ?? -1;
      if (p >= 0) this.podWork[p] = (this.podWork[p] ?? 0) + 1;
    }
    this.actTo = activity(working, nUsed);
    return nUsed;
  }

  /** Ambient motion, off when ambient motion is: the cleaning bot, the rack and the pod pads follow real activity. */
  private tickTech(now: number, night: number) {
    const on = ambientOn();
    this.countWork();
    if (this.bot && this.botLamp) {
      this.bot.visible = this.botLamp.visible = on;
      if (on) {
        const b = this.botAt(now);
        this.bot.position.set(b.x, b.y); this.bot.scale.x = b.dir;
        this.botLamp.position.set(b.x + b.dir * 4, b.y); this.botLamp.alpha = 0.35 + night * 0.4;
      }
    }
    const dt = Math.min(100, now - this.techAt); this.techAt = now;
    this.act += (this.actTo - this.act) * Math.min(1, dt / 1500);
    const a = this.act;
    const lvl = a > 0.66 ? 3 : a > 0.33 ? 2 : a > 0.04 ? 1 : 0;
    if (lvl !== this.gaugeLvl) { this.gaugeLvl = lvl; this.drawGauge(lvl); }
    const nm = theme().nightMax, fa = 0.4 + 0.6 * (nm > 0 ? Math.min(1, night / nm) : 0);
    if (fa !== this.fixA) { this.fixA = fa; this.fixtures.alpha = fa; }
    this.tickPads(on, now);
    this.tickRack(on, a, now);
    const wisp = on && this.coffeeOn ? Math.floor(now / 700) % 2 : -1; // two-frame steam wisp off the machine's vent (E9), slow ambient cadence
    if (this.coffeeS && wisp !== this.coffeeWisp) { this.coffeeWisp = wisp; this.coffeeS.texture = coffeeTex(this.coffeeOn, wisp); }
  }

  /** The wall gauge mirrors the clock: 3 bars lit by real office activity (0..3). */
  private drawGauge(lvl: number) {
    const { x: px, y: cy } = this.geo.dials.gauge, g = this.gauge;
    // same bezel language as the clock (E7): outline, slate bezel lit on top, dark face; only the bars are emitters
    g.clear().rect(px - 9, cy - 9, 18, 18).fill(E[0]).rect(px - 8, cy - 8, 16, 16).fill(E[4]).rect(px - 8, cy - 8, 16, 1).fill(E[5]).rect(px - 6, cy - 6, 12, 12).fill(E[0]);
    [[-4, 10], [-1, 6], [2, 8]].forEach(([dy, len], i) => g.rect(px - 5, cy + dy, len, 2).fill(i >= 3 - lvl ? CY : CY_OFF));
    if (this.gaugeSpill) this.gaugeSpill.alpha = 0.04 * lvl;
  }

  /** Junction LEDs: blink while that pod has working agents. Pods carry no corner brackets: brackets mean "selected" (critique R5). */
  private tickPads(on: boolean, now: number) {
    this.jLeds.forEach((led, i) => {
      const blink = on && (this.podWork[i] ?? 0) > 0 && Math.floor(now / 500 + i) % 2 === 0;
      led.tint = blink ? CY : CY_OFF;
    });
  }

  /** Server rack: 16 LEDs; flip rate and lit density follow activity. Steps at <= 8 Hz, deterministic from time. */
  private tickRack(on: boolean, a: number, now: number) {
    if (!this.racks.length) return;
    if (!this.rackSpill) {
      const f = this.racks[0], e = this.racks[this.racks.length - 1], r = (this.rackSpill = new Sprite(this.glowTex));
      r.anchor.set(0.5); r.position.set((f.x + e.x + e.width) / 2, f.y + 8); r.width = e.x + e.width - f.x + 24; r.height = 34; r.tint = CY; r.eventMode = "none";
      this.glow.addChild(r);
    }
    this.rackSpill.alpha = on ? 0.03 + 0.09 * a : 0.03; // the LEDs' small spill follows the same activity
    if (!on) { if (this.leds[0]?.visible) { this.leds.forEach((s) => (s.visible = false)); this.ledStep = -1; } return; }
    if (!this.leds.length) {
      for (const rk of this.racks) for (let i = 0; i < 12; i++) {
        const s = new Sprite(whiteTex()); // a sibling just above the cabinet: Pixi v8 warns on (and will drop) children of a Sprite
        s.position.set(rk.x + 8 + (i % 3), rk.y + 3 + Math.floor(i / 3) * 3); s.zIndex = rk.zIndex + 0.01; s.eventMode = "none";
        rk.parent!.addChild(s); this.leds.push(s);
      }
    }
    const step = Math.floor(now / (125 + 875 * (1 - a))); // 1 s per step idle, 125 ms busy
    if (step === this.ledStep) return;
    this.ledStep = step;
    this.leds.forEach((s, i) => {
      const n = ledNoise(i, step), lit = n < 0.12 + 0.75 * a;
      s.visible = true;
      s.tint = lit ? (ledNoise(i, 7) < 0.2 ? WARM : CY) : CY_OFF; // machine emitters are cyan; amber is reserved for attention
    });
  }

  private buildFurniture(ysort: Container) {
    const l = this.l;
    const add = (tex: Sprite["texture"], x: number, y: number, z: number) => {
      const s = place(new Sprite(tex), x, y); // art px: whole numbers, always
      s.zIndex = z;
      s.eventMode = "none";
      ysort.addChild(s);
      return s;
    };
    // contact shadows are baked sprites under the furniture (zero per-frame cost); hidden with their piece
    const shadow = (x: number, y: number) => {
      const s = place(new Sprite(shadowTex()), x, y);
      s.visible = false;
      s.eventMode = "none";
      this.floor.addChild(s);
      return s;
    };
    for (const p of l.props) {
      const accent = "#9aa7d9"; // one desk pool: desks carry no role colour
      const seat = p.seat ?? `${p.role}+${p.tier}`;
      const dk = this.geo.rect(`desk:${p.seat ?? `${p.x},${p.y}`}`); // desk tile; its chair is the tile above
      const ps = p.kind === "permanent" ? podStyle(Math.floor(Number(seat.slice(1)) / 4)) : "solo";
      const sty = (ps === "standing" ? 1 : ps === "carrel" ? 2 : 0) as 0 | 1 | 2;
      const cv = Math.abs(hash(`c${seat}`)) % CHAIR_STYLES;
      const chair = add(sty === 1 ? stoolTex(cv) : chairTex(cv), dk.x + (Math.abs(hash(`x${seat}`)) % 3) - 1, dk.y - T, dk.y - 0.5); // upholstery and a pixel of drift per seat; standing pods get a drafting stool
      const v = (hash(seat) & 1) as 0 | 1;
      const s = p.kind === "permanent" ? add(deskTex(accent, 0, v, sty), dk.x, dk.y, dk.y + T) : add(laptopTex(p.tier), dk.x, dk.y, dk.y + T);
      s.visible = p.kind === "permanent";
      chair.visible = false; // empty chairs read as top hats: shown only while the seat is used
      const deco = p.kind === "permanent" ? this.addDeco(ysort, dk.x, dk.y, dk.y + T + 0.5) : null;
      const sh = [shadow(dk.x + 1, dk.y + T - 3), shadow(dk.x + 1, dk.y - T + 12)];
      this.desks.set(seat, { s, accent, chair, ctex: chair.texture, hue: -1, overflowTier: p.kind === "overflow" ? p.tier : null, deco, decoKey: "", shown: 0, pod: Math.floor(Number(seat.slice(1)) / 4), by: dk.y, v, idx: Number(seat.slice(1)) || 0, sh, used: false, chairAt: 0, sty });
    }
    for (let p = 0; p * 4 < l.props.length; p++) { // bench and huddle pods: a table tile joins each desk row, so four people share one table
      const st: string = podStyle(p);
      if (st !== "bench" && st !== "huddle") continue;
      this.links.set(p, [1, 3].map((r) => { const k = this.geo.rect(`link:${p}:${r}`); return add(st === "huddle" ? huddleTex(r >> 1) : benchTex(hash(`b${p}${r}`)), k.x, k.y, k.y + T); }));
    }
    l.lobby.forEach((_t, i) => {
      const c = this.geo.rect(`lobby-chair:${i}`), k = this.geo.rect(`lobby-desk:${i}`);
      const chair = add(chairTex(), c.x, c.y, k.y - 0.5);
      chair.visible = false;
      const s = add(deskTex("#f4f1ff", 0), k.x, k.y, k.y + T);
      const sh = [shadow(k.x + 1, k.y + T - 3), shadow(c.x + 1, c.y + 12)];
      sh[0].visible = true;
      this.desks.set(`lobby#${i}`, { s, accent: "#f4f1ff", chair, ctex: chair.texture, hue: -1, overflowTier: null, deco: this.addDeco(ysort, k.x, k.y, k.y + T + 0.5), decoKey: "", shown: 0, pod: -1, by: 0, v: 0, idx: i, sh, used: false, chairAt: 0, sty: 0 });
    });
    l.decor.forEach((d, i) => {
      const r = this.geo.rect(`decor:${d.kind}:${i}`), z = r.y + T;
      if (d.kind === "plant") add(plantTex(), r.x, r.y, z);
      else if (d.kind === "coffee") this.coffeeS = add(coffeeTex(), r.x, r.y, z);
      else if (d.kind === "cooler") add(coolerTex(), r.x, r.y, z);
      else if (d.kind === "bookshelf") add(shelfTex(), r.x, r.y, z);
      else if (d.kind === "couch") { add(couchTex(), r.x, r.y, z); add(couchTex(true), r.x, r.y, r.y + r.h + 3); } // the back rail stacks over a lounger (actor z = seat + 2)
      else if (d.kind === "rack") { const k = this.geo.bank[this.racks.length]; this.racks.push(add(rackTex(0, Math.min(2, this.racks.length) as 0 | 1 | 2), k.x, k.y, z)); }
      else if (d.kind === "holo") add(holoTex(), r.x, r.y, z);
      else if (d.kind === "lamp") add(floorLampTex(), r.x, r.y, z);
      else if (d.kind === "fridge") add(fridgeTex(), r.x, r.y, z);
      else if (d.kind === "table") add(tableTex(), r.x, r.y, z);
      else if (d.kind === "armchair") add(armchairTex(), r.x, r.y, r.y + r.h); // seen from behind, symmetric: never mirrored (the key light stays top-left)
      else if (d.kind === "booth") { // authored facing +x; the right-hand side is the mirror image
        const right = d.x > (l.cols - 1) / 2;
        const s = add(boothTex(), r.x + (right ? T : 0), r.y, r.y + r.h);
        if (right) s.scale.x = -1;
      }
    });
  }

  private addDeco(ysort: Container, x: number, y: number, z: number) {
    const g = new Graphics();
    g.position.set(x, y);
    g.zIndex = z;
    g.eventMode = "none";
    ysort.addChild(g);
    return g;
  }

  /** Monitor glyph by tool kind (#102), lamp shade, role item and drawn over the desk sprite. */
  private drawDeco(g: Graphics, o: { working: boolean; tool?: string; count: number; role?: string; v: number; waiting: boolean; turn: boolean; flash: boolean; used: boolean; load: number; depth: number; mug: boolean; think: boolean; filed?: string }) {
    g.clear();
    const px = (x: number, y: number, col: string) => g.rect(x, y, 1, 1).fill(col);
    if (o.filed) { g.rect(1, 3, 4, 3).fill(KEY.paper).rect(1, 3, 4, 1).fill(FILED[o.filed] ?? "#8b93ad"); return; } // a filed result left on the empty desk
    if (o.v === 0) g.rect(3, 0, 3, 1).fill(o.working ? KEY.warm : o.waiting ? STATUS[o.turn ? "turn" : "permission"].color : E[3]);
    const r = o.role ?? "";
    if (/qa|test/.test(r)) { g.rect(6, 0, 2, 3).fill(E[1]).rect(6, 1, 2, 1).fill(E[3]); px(7, 0, "#5be37d"); }
    else if (/design|front/.test(r)) { g.rect(6, 1, 2, 2).fill(KEY.paper); px(7, 0, "#c9604a"); }
    else if (/secur/.test(r)) { g.rect(6, 0, 2, 1).fill("#c9ccd8").rect(6, 1, 2, 2).fill("#f2c14e"); px(7, 2, "#7a5a10"); }
    if (o.flash) g.rect(9, 1, 5, 4).fill("#5be37d");
    else if (o.working) {
      const k = toolKind(o.tool), c = KEY.cyan;
      if (k !== "other") g.rect(9, 1, 5, 4).fill("#12304a");
      if (k === "term") { px(9, 1, c); px(10, 2, c); px(9, 3, c); px(11, 3, c); px(12, 3, c); }
      else if (k === "edit") g.rect(9, 1, 3, 1).fill("#5be37d").rect(9, 2, 3, 1).fill("#ff6b6b").rect(9, 3, 2, 1).fill("#5be37d");
      else if (k === "read") g.rect(9, 1, 4, 1).fill("#e8ecff").rect(9, 2, 3, 1).fill("#e8ecff").rect(9, 3, 4, 1).fill("#e8ecff");
      else if (k === "web") { for (const [x, y] of [[10, 1], [11, 1], [12, 1], [10, 4], [11, 4], [12, 4], [9, 2], [9, 3], [13, 2], [13, 3], [11, 2], [11, 3]]) px(x, y, c); }
    } else if (o.think) { g.rect(9, 1, 5, 4).fill("#12304a"); px(9, 3, KEY.cyan); px(11, 3, KEY.cyan); px(13, 3, KEY.cyan); } // thinking: "..." on the screen
    if (o.used) { // power rail along the desk front: one step lit per load level (static); queue chips stacked in the front gap
      for (let i = 0; i < 3; i++) g.rect(2 + i * 4, 14, 3, 1).fill(i < o.load ? KEY.cyan : E[1]);
      const q = chipStack(o.depth);
      for (let i = 0; i < q.n; i++) g.rect(7, 13 - i, 2, 1).fill(i % 2 ? "#e0a040" : "#ffc870");
      if (q.more) { px(7, 6, "#ffffff"); px(6, 7, "#ffffff"); px(7, 7, "#ffffff"); px(8, 7, "#ffffff"); px(7, 8, "#ffffff"); }
    }
    if (o.mug) { g.rect(14, 4, 2, 2).fill(KEY.paper); g.rect(14, 4, 2, 1).fill("#6b4a2e"); } // idle sip window: a mug on the desk, gone when the agent works or leaves
    const lvl = o.count >= 40 ? 3 : o.count >= 20 ? 2 : o.count >= 8 ? 1 : 0;
    for (let i = 0; i < lvl; i++) g.rect(8 + (i % 2), 5 - (i > 1 ? 1 : 0), 4, 1).fill(i % 2 ? shade(KEY.paper, -0.06) : KEY.paper);
  }

  destroy() {
    this.boardText.destroy();
    for (const p of this.pods) { p.plaque?.destroy(); p.cap?.destroy(); }
  }

  /** Claimed pod containing the world point (art px), or -1. The rect includes the strip above the pod where its plaque sits. */
  podAt(wx: number, wy: number): number {
    for (let i = 0; i < this.pods.length; i++) {
      const p = this.pods[i];
      if (p.owner && p.owner !== "\0" && wx >= p.x && wx <= p.x + p.w && wy >= p.y - 12 && wy <= p.y + p.h) return i;
    }
    return -1;
  }
  /** Pod index of a seat id (-1 for lobby seats and unknown ids). */
  podOfSeat(seat: string): number { return this.desks.get(seat)?.pod ?? -1; }
  /** Apron rect of pod i in art px (the session badge sits on its top edge). */
  podRect(i: number) { const p = this.pods[i]; return p ? { x: p.x, y: p.y, w: p.w, h: p.h } : null; }
  setHoverPod(i: number) { this.hoverPod = i; }

  setSeats(m: Map<string, SeatState>) {
    this.state = m;
    const now = Date.now();
    for (const [id, d] of this.desks) {
      const st = m.get(id);
      if (d.overflowTier !== null) {
        if (st?.used && !d.s.visible) d.shown = now; // pop-in start (#111)
        d.s.visible = !!st?.used;
      }
      const u = !!st?.used;
      if (u !== d.used) { d.used = u; d.chairAt = now; }
      if (u && st?.hue !== undefined) d.hue = st.hue; // the vacant chair keeps the last occupant's session trim
      if (d.chair && d.ctex) d.chair.texture = u ? d.ctex : vacantChairTex(d.sty === 1, d.hue); // vacant: env ramp + 1 px trim, never a lit block (R8)
      // a chair stays out, pushed back, for a moment after its occupant leaves (tick hides it); never-used chairs stay hidden
      if (d.chair) d.chair.visible = (u || (d.pod >= 0 && !settings.reducedMotion && d.chairAt > 0 && now - d.chairAt < CHAIR_LINGER_MS));
      d.sh[0].visible = d.s.visible;
      d.sh[1].visible = !!d.chair?.visible;
    }
    const nUsed = this.countWork();
    const anyUsed = nUsed > 0;
    if (this.coffeeS && anyUsed !== this.coffeeOn) { this.coffeeOn = anyUsed; this.coffeeWisp = -2; } // tickTech re-picks the texture
    // empty zones sit darker than occupied ones (#113)
    const used = new Set<string>();
    for (const [k, st] of m) if (st.used) used.add(wingOf(k));
    for (const [role, g] of this.zoneDim) g.visible = !used.has(role);
    const owners = podOwners(new Map([...m].filter(([, st]) => st.used && st.project).map(([k, st]) => [k, st.project!])), this.pods.length);
    const hues = new Array<number>(this.pods.length).fill(-1), tones = new Array<number>(this.pods.length).fill(0);
    for (const [id, st] of m) { const pi = this.desks.get(id)?.pod ?? -1; if (pi >= 0 && pi < hues.length && st.used && st.hue !== undefined && hues[pi] < 0) { hues[pi] = st.hue; tones[pi] = st.tone ?? 0; } }
    owners.forEach((o, i) => { if (o !== this.pods[i].owner || hues[i] + tones[i] !== this.pods[i].hue) this.setOwner(i, o, hues[i], tones[i]); });
    // per pod: the caption is the first seat's session prompt
    const prompts = new Array<string>(this.pods.length).fill("");
    for (const [id, st] of m) {
      const pod = this.desks.get(id)?.pod ?? -1;
      if (pod < 0 || pod >= this.pods.length || !st.used) continue;
      if (!prompts[pod] && st.prompt) prompts[pod] = st.prompt;
    }
    this.pods.forEach((p, i) => { p.prompt = p.owner === "\0" || !p.owner ? "" : prompts[i]; });
  }

  /** Per-frame: monitor flicker, sky, clock, night tint, whiteboard position. */
  tick(now: number, ox: number, oy: number, sc: number, _lines: string[], clockT = now) {
    const flick = settings.reducedMotion ? 0 : Math.floor(now / 260) % 2;
    for (const [id, d] of this.desks) {
      if (d.overflowTier !== null) continue;
      const st = this.state.get(id);
      d.s.texture = deskTex(d.accent, st?.used ? (st.working ? ((1 + flick) as 1 | 2) : 3) : 0, d.v, d.sty);
      const k = st?.used ? staleK(st.idleMs, st.stale) : 0; // long real silence drains the desk's colour toward grey (#101)
      d.s.tint = k ? ((255 - Math.round(70 * k)) << 16) | ((255 - Math.round(70 * k)) << 8) | (255 - Math.round(45 * k)) : 0xffffff;
      if (d.chair && d.chair.tint !== d.s.tint) d.chair.tint = d.s.tint;
      if (d.deco) {
        const used = !!st?.used, working = used && !!st?.working;
        const el = st?.flash ? now - st.flash - d.idx * 60 : -1; // ship-it wave: 120ms green blink per desk, staggered
        const flash = !settings.reducedMotion && el >= 0 && el < 120 && now - st!.flash! < 1200;
        const o = { working, tool: working ? st?.tool : undefined, count: used ? st?.count ?? 0 : 0, role: used ? st?.role : undefined, v: d.v, waiting: used && !working && !!st?.waiting, turn: st?.waitKind === "turn", flash, used, load: used ? st?.load ?? 0 : 0, mug: used && !!st?.mug, think: used && !working && !!st?.think, depth: used ? st?.queueDepth ?? 0 : 0 };
        const f = this.filed.get(id);
        if (f && (used || now - f.t > FILED_MS)) this.filed.delete(id); // tidied once someone sits down or after a while
        const filed = !used ? this.filed.get(id)?.kind : undefined;
        const key = `${o.tool ?? ""}|${o.count}|${o.role ?? ""}|${+working}${+o.waiting}${+o.turn}${+flash}|${+used}${o.load}.${o.depth}${+o.mug}${+o.think}|${filed ?? ""}`;
        if (key !== d.decoKey) { d.decoKey = key; this.drawDeco(d.deco, { ...o, filed }); }
      }
    }
    // overflow desks ease in
    if (!settings.reducedMotion) for (const d of this.desks.values()) if (d.overflowTier !== null && d.s.visible) {
      const a = Math.min(1, (now - d.shown) / 250);
      d.s.alpha = a;
      if (d.chair) d.chair.alpha = a;
      d.sh.forEach((x) => (x.alpha = a));
    }
    for (const [id, d] of this.desks) { // chairs scoot in on arrival and push back on departure; a folded occupant's chair hides
      if (!d.chair) continue;
      const lingering = d.pod >= 0 && !settings.reducedMotion && d.chairAt > 0 && now - d.chairAt < CHAIR_LINGER_MS; // a vacated chair stays pushed back, honestly 'recently left', then is tidied
      const vis = (d.used || lingering) && !this.state.get(id)?.folded;
      if (d.chair.visible !== vis) { d.chair.visible = vis; d.sh[1].visible = vis; }
      if (settings.reducedMotion || d.pod < 0 || d.chairAt === 0) continue;
      const k = Math.min(1, (now - d.chairAt) / (d.used ? 260 : 150));
      d.chair.y = art(d.by - T - 4 * (d.used ? 1 - k : k));
    }
    for (const [p, t] of this.born) { // new pods fade and rise in; existing desks never move
      const a = Math.min(1, (now - t) / BUILD_MS), dy = (1 - a) * RISE;
      if (a >= 1) this.born.delete(p);
      for (const d of this.desks.values()) {
        if (d.pod !== p) continue;
        d.s.alpha = d.chair!.alpha = a;
        d.sh.forEach((x) => (x.alpha = a));
        d.s.y = art(d.by + dy);
        d.chair!.y = art(d.by - T + dy);
        if (d.deco) { d.deco.alpha = a; d.deco.y = art(d.by + dy); }
      }
      this.pods[p].g.alpha = a;
      this.links.get(p)?.forEach((s, i) => { s.alpha = a; s.y = art(this.geo.rect(`link:${p}:${i ? 3 : 1}`).y + dy); });
    }
    // plaques ride the pod's back edge, clipped to the pod width; text only re-set when the size class changes
    const pfs = fontPx(10), cfs = fontPx(9); // scene-relative: bigger when zoomed in
    const chars = Math.max(3, Math.floor(((this.pods[0] ? this.pods[0].w - 8 : 3 * T) * sc) / (pfs * 0.62)));
    const cchars = Math.max(8, Math.min(28, Math.floor(((this.pods[0] ? this.pods[0].w + 4 : 4 * T) * sc) / (cfs * 0.6)))); // caption may spill into the aisle, up to one pod pitch
    this.pods.forEach((p, i) => {
      const q = p.plaque;
      if (!q) return;
      q.visible = !!p.owner && sc >= 1.2 && !this.born.has(i) && i === this.hoverPod; // hover-only: no permanent labels over every pod
      if (!q.visible) { if (p.cap) p.cap.visible = false; return; }
      const key = `${i}|${p.owner}|${pfs}|${chars}|${+hideText()}`;
      if (key !== p.key) {
        p.key = key;
        q.style.fontSize = pfs;
        q.style.stroke = outline(3); // strokes scale like the font (R3)
        const t = hideText() ? `P${i + 1}` : `P${i + 1} · ${cleanText(p.owner, 40)}`; // pod identity is attached to the pod; text hidden (stream-safe, private) drops the project name (critique I2)
        q.text = t.length > chars ? t.slice(0, chars - 1) + "…" : t;
      }
      const priv = office.privacy || office.source.private, capOn = sc >= 2 && !!p.prompt && !priv && !this.born.has(i);
      const cx = dev(ox + (p.x + p.w / 2) * sc);
      q.position.set(cx, dev(oy + (p.y - 7) * sc - (capOn ? Math.round(pfs * 0.7) : 0))); // gaps scale with the fonts, so plaque and caption never overprint (R3)
      if (tagHits(q.x, q.y, q.width, q.height)) q.visible = false; // a name tag or selection ring wins over the plaque
      // last-prompt caption under the plaque: small, muted, only when zoomed in; text re-set only when its inputs change
      if (!capOn) { if (p.cap) p.cap.visible = false; return; }
      const cap = (p.cap ??= this.ui.addChild(new Text({ text: "", style: { fontFamily: MONO, fontSize: 9, fill: KEY.text.soft, stroke: outline(2) } })));
      if (p.prompt !== p.capPrompt || p.capChars !== cchars || p.capPriv !== priv || cap.style.fontSize !== cfs) {
        cap.style.fontSize = cfs;
        cap.style.stroke = outline(2);
        p.capPrompt = p.prompt; p.capChars = cchars; p.capPriv = priv;
        cap.text = promptCaption(p.prompt, priv, cchars);
        cap.anchor.set(0.5);
        cap.alpha = 0.75;
        cap.eventMode = "none";
      }
      cap.position.set(cx, dev(oy + (p.y - 7) * sc + Math.round(cfs * 0.7)));
      cap.visible = !tagHits(cap.x, cap.y, cap.width, cap.height);
    });
    const dt = new Date(clockT); // replay passes the recorded time (#105)
    const hour = dt.getHours() + dt.getMinutes() / 60;
    const hk = Math.floor(hour * 4);
    if (hk !== this.skyHour) { this.skyHour = hk; this.drawSky(hour); this.drawShafts(hour); this.layoutWeather(now); }
    const sec = Math.floor(clockT / 1000);
    if (sec !== this.clockSec) { this.clockSec = sec; this.drawClock(dt); }
    this.night.alpha = this.nightAlpha(hour);
    const nm0 = theme().nightMax;
    this.day.alpha = nm0 > 0 ? DAY_LIFT * (1 - Math.min(1, this.night.alpha / nm0)) : 0; // noon reads lighter than midnight; themes without a night get none
    // occupied desks stay warm through the night overlay (#107)
    const glowA = this.night.alpha > 0.03 ? this.night.alpha * 0.55 : 0;
    let lights = 0;
    for (const [id, d] of this.desks) {
      let g = this.glowPool.get(id);
      const on = glowA > 0 && lights < MAX_LIGHTS && !!this.state.get(id)?.used && d.s.visible;
      if (!g) {
        if (!on) continue;
        g = new Sprite(this.glowTex);
        g.anchor.set(0.5);
        g.position.set(d.s.x + 8, d.s.y + 8);
        g.tint = WARM;
        g.blendMode = "add";
        g.eventMode = "none";
        this.glow.addChild(g);
        this.glowPool.set(id, g);
      }
      if (g.visible !== on) g.visible = on;
      if (on) { lights++; if (g.alpha !== glowA) g.alpha = glowA; }
    }
    this.tickLights(now);
    this.tickTech(now, this.night.alpha);
    this.tickBoard(now, ox, oy, sc);
    this.tickFx(now);
  }

  private buildWeather() {
    const t = wxTextures();
    const mk = (tex: Texture) => { const s = new Sprite(tex); s.visible = false; s.eventMode = "none"; this.wx.addChild(s); return s; };
    for (const x of this.geo.windows) {
      const flash = mk(whiteTex());
      flash.position.set(x * T + 2, 5); flash.width = 28; flash.height = 19; flash.alpha = 0.85; // the pane only
      const drops = [0, 1, 2].map(() => { const d = mk(whiteTex()); d.tint = 0x9ad0ff; d.scale.set(1, 3); return d; });
      this.wxWins.push({ x: x * T, cloud: mk(t.cloud), sun: mk(t.sun), drops, flash });
    }
    this.wx.eventMode = "none";
  }

  /** Weather for the window panes (flair.pickWeather); one static icon under reduced motion. */
  setWeather(w: Weather) {
    this.weather = w;
    this.layoutWeather(Date.now());
  }
  private layoutWeather(now: number) {
    const anim = burstAllowed();
    const sunny = this.weather === "sunny", rain = this.weather === "rain";
    this.wxWins.forEach((w, i) => {
      w.sun.visible = sunny && i === 0; // one sun (or moon) in the sky, not one per pane
      w.sun.tint = this.dark ? 0xdfe6ff : 0xffd84a;
      w.sun.position.set(w.x + 21, 7); // inside the pane (x+2..x+29, y 5..23) with >= 2 px clear
      w.cloud.visible = !sunny;
      w.cloud.tint = rain ? 0x7d8398 : 0xe8ecf5;
      w.cloud.position.set(Math.round(w.x + 4 + 12 * (anim ? 0.5 + 0.5 * Math.sin(now / 7000 + i) : 0.5)), 7); // clouds stay 2 px inside the pane (E10)
      w.drops.forEach((d, k) => {
        d.visible = rain;
        d.position.set(w.x + 6 + k * 9 + (i % 2) * 2, Math.floor(anim ? 8 + ((now / 30 + k * 5 + i * 3) % 12) : 9 + k * 4));
      });
    });
  }
  /** One-frame lightning flash and a short shake of the panes (a new block). */
  lightning(now: number) {
    if (!burstAllowed() || this.wxWins.length === 0) return;
    if (now < this.flashUntil + 330) return; // flashes at most ~2.5/s (WCAG 2.3.1)
    this.flashUntil = now + 70;
    this.shakeUntil = now + 160;
  }
  /** Couch seat spots in art px (see choreo.couchSeats), in a stable order: index = delight seat. */
  couchSpots() {
    return this.l.decor.filter((d) => d.kind === "couch").flatMap((d) => couchSeats(d, T));
  }
  /** A cat curled on the couch seat `pos` until `until` (null hides it). */
  setCat(pos: { x: number; y: number } | null, until = 0) {
    if (!pos) { if (this.catS) this.catS.visible = false; this.catUntil = 0; return; }
    if (!this.catS) {
      this.catS = new Sprite(catTex());
      this.catS.anchor.set(0.5, 1);
      this.catS.eventMode = "none";
      this.ys.addChild(this.catS);
    }
    place(this.catS, pos.x, pos.y - 2);
    this.catS.zIndex = pos.y + 1;
    this.catS.visible = true;
    this.catUntil = until;
  }
  private tickFx(now: number) {
    const anim = burstAllowed();
    if (anim && this.wxWins.length && this.weather !== "sunny") this.layoutWeather(now); // clouds drift, rain falls
    const flash = anim && now < this.flashUntil;
    for (const w of this.wxWins) if (w.flash.visible !== flash) w.flash.visible = flash;
    const sh = anim && now < this.shakeUntil ? (Math.floor((this.shakeUntil - now) / 30) % 2 ? 1 : -1) : 0;
    if (this.sky.x !== sh) this.sky.x = this.wx.x = sh;
    if (this.catS?.visible && now >= this.catUntil) this.catS.visible = false;
  }

  /** Desk lights (working: pool + tool-coloured spill + lamp; waiting: a steady lamp in the wait kind's colour, never pulsing), pooled additive sprites, and dust in the shafts. */
  private tickLights(now: number) {
    const night = this.night.alpha, still = settings.reducedMotion;
    let n = 0;
    for (const [id, d] of this.desks) {
      const st = this.state.get(id);
      const working = !!st?.used && st.working && d.s.visible, waiting = !!st?.used && !st.working && !!st.waiting && d.s.visible;
      const on = (working || waiting) && n < MAX_LIGHTS && d.overflowTier === null;
      let g = this.lightPool.get(id);
      if (!g) {
        if (!on) continue;
        g = new Sprite();
        g.blendMode = "add";
        g.eventMode = "none";
        this.glow.addChild(g);
        this.lightPool.set(id, g);
      }
      if (g.visible !== on) g.visible = on;
      if (!on) continue;
      n++;
      if (working) {
        const k = toolKind(st!.tool);
        g.texture = this.lightTexs.get(k) ?? this.lightTexs.set(k, lightTex(k)).get(k)!;
        place(g, d.s.x - 4.5, d.s.y - 6.5);
        g.alpha = 0.75 + night; g.tint = 0xffffff; // pooled: a sprite last used as a waiting lamp keeps its tint otherwise
      } else {
        g.texture = this.lightTexs.get("lamp") ?? this.lightTexs.set("lamp", lampTex()).get("lamp")!;
        place(g, d.s.x - 2.5, d.s.y - 6.5);
        g.tint = Number.parseInt(STATUS[st!.waitKind === "turn" ? "turn" : "permission"].color.slice(1), 16);
        g.alpha = 0.6; // steady: "your turn" never pulses and alerts only move in their first seconds (owner rule, R2)
      }
    }
    // dust drifts only inside the window light; off at night and under reduced motion
    const wins = this.geo.windows, on = ambientOn() && this.shaftDay > 0.1 && wins.length > 0;
    this.dust.forEach((m, i) => {
      if (m.visible !== on) m.visible = on;
      if (!on) return;
      const u = (now / 11000 + i * 0.37) % 1, wx = wins[i % wins.length] * T;
      const y = 34 + u * 44;
      m.position.set(Math.round(wx + 4 + ((i * 0.618) % 1) * 22 + Math.sin(now / 1700 + i)), Math.round(y));
      m.alpha = Math.sin(Math.PI * u) * 0.6 * this.shaftDay;
    });
  }

  /** Whiteboard: four kanban columns (header text + paper cards), or the run summary / empty text. Redraws only when the task list changes. */
  private tickBoard(now: number, ox: number, oy: number, sc: number) {
    const b = this.l.board, tasks = office.tasks();
    if ((tasks !== this.lastTasks && !(tasks.length === 0 && this.lastTasks?.length === 0)) || (this.board?.summary && now - this.memo.at >= SUMMARY_MS)) {
      this.lastTasks = tasks;
      const bd = this.board = boardModel(tasks, this.memo, now);
      const x0 = b.x * T + 3, colW = (b.w * T - 6) / 4;
      let ci = 0;
      COLS.forEach((c, i) => bd.cols[c].slice(0, CARDS_PER_COL).forEach((_t, r) => {
        const s = this.cards[ci++];
        s.visible = true;
        s.tint = CARD[c];
        s.position.set(x0 + Math.floor(i * colW) + 1, 11 + r * 4); // whole art px even when the column width is fractional
        s.width = Math.floor(colW) - 3; s.height = 3;
      }));
      for (; ci < this.cards.length; ci++) this.cards[ci].visible = false;
      this.colKey = "";
    }
    // the board is the outcomes ledger once anything has finished (critique V1); the task columns show only before that
    const outs = office.getEnvelope()?.state.outcomes ?? [], ledger = outs.length > 0;
    const bd = this.board!, any = tasks.length > 0 && !ledger;
    if (ledger) for (const c of this.cards) if (c.visible) c.visible = false;
    const fs = Math.max(1, Math.floor(sc * 5)); // world-relative both ways (O3): the board text keeps its size relative to the board
    const colW = (b.w * T - 6) / 4, chars = Math.floor((colW * sc) / (fs * 0.72)); // 0.72: headroom so a header never runs into the next column's text
    const key = `${fs}|${chars}|${any}|${ledger ? `${outs[0].t}.${outs.length}` : ""}`;
    if (key !== this.colKey) {
      this.colKey = key;
      COLS.forEach((c, i) => {
        const n = bd.counts[c], over = Math.max(0, n - CARDS_PER_COL), more = over ? `+${over}` : "";
        const t = [`${NAMES[i]} ${n}${more && " " + more}`, `${NAMES[i][0]} ${n}${more}`, `${NAMES[i][0]}${n}`].find((x) => x.length <= chars) ?? `${n}`;
        const tx = this.colText[i];
        tx.text = t;
        tx.style.fontSize = fs;
        tx.style.fill = c === "blocked" && n ? STATUS.blocked.color : KEY.text.fg;
      });
      this.boardText.style.fontSize = fs;
      const rows = Math.max(1, Math.min(4, Math.floor((20 * sc) / (fs * 1.25)))), wide = Math.floor(((b.w * T - 8) * sc) / (fs * 0.62));
      this.boardText.text = ledger ? ledgerLines(outs, rows, wide).join("\n") : bd.summary || "Finished work is posted here";
    }
    this.boardText.visible = !any;
    this.colText.forEach((t, i) => { t.visible = any; t.position.set(dev(ox + (b.x * T + 3 + i * colW + 1) * sc), dev(oy + 4 * sc)); });
    this.boardText.position.set(dev(ox + (b.x * T + 5) * sc), dev(oy + (ledger ? 5 : 8) * sc));
    this.boardMask.clear().rect(dev(ox + (b.x * T + 2) * sc), dev(oy + 3 * sc), dev((b.w * T - 4) * sc), dev(24 * sc)).fill(0xffffff);
  }

  private nightAlpha(h: number) {
    const max = theme().nightMax; // capped by theme so alert cues in the world layer stay readable; UI layer is above this overlay
    if (h >= 8 && h < 18) return 0;
    if (h >= 18 && h < 21) return ((h - 18) / 3) * max;
    if (h >= 21 || h < 5) return max;
    return (1 - (h - 5) / 3) * max;
  }

  /** Window light (E1): one soft vertical gradient per window, clipped to its pane's x-range; warm by day (amber at dawn/dusk), faint moonlight at night. Redrawn on the 15-minute key. */
  private drawShafts(hour: number) {
    const nm = theme().nightMax;
    const day = nm > 0 ? 1 - this.nightAlpha(hour) / nm : hour >= 6 && hour < 19 ? 1 : 0;
    this.shaftDay = Math.max(0, Math.min(1, day));
    const moon = (1 - this.shaftDay) * (nm > 0 ? Math.min(1, this.nightAlpha(hour) / nm) : 0);
    const sun = this.shaftDay > 0.02, tint = sun ? (hour < 8.5 || hour >= 16.5 ? 0xffb86a : 0xfff1c8) : 0x9fb8ff, alpha = sun ? 0.12 * this.shaftDay : 0.07 * moon;
    this.shafts.visible = alpha > 0.002;
    for (const sp of this.shafts.children as Sprite[]) { sp.tint = tint; sp.alpha = alpha; }
  }

  /**
   * Window panes, drawn inside their 2-tile footprint (a 2 px reveal each side, tops on the y=3 baseline, sill flush with the slot).
   * Three sky variants (E10: band split, cloud, skyline) and a dim skyline (L4): lit windows at night, one neon district in one window only.
   */
  private drawSky(hour: number) {
    const { top, bottom, night } = skyAt(hour), day = hour >= 8 && hour < 17;
    const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
    const city = night ? E[1] : mix(hex(bottom), E[3], 0.55), lit = night ? "rgba(255,217,140,0.55)" : null;
    this.dark = night;
    this.sky.clear();
    this.geo.windows.forEach((x, i) => {
      const wx = x * T, v = i % 3, g = this.sky;
      g.rect(wx, 3, 2 * T, 22).fill(E[0]).rect(wx + 1, 3, 2 * T - 2, 1).fill(E[3]); // deep reveal, lit top
      const band = [9, 11, 7][v];
      g.rect(wx + 2, 5, 28, band).fill(top).rect(wx + 2, 5 + band, 28, 19 - band).fill(bottom);
      if (night) for (let k = 0; k < 4; k++) g.rect(wx + 4 + ((k * 7 + x * 3) % 22), 7 + ((k * 5 + v) % 7), 1, 1).fill(0xffffff);
      if (day) g.rect(wx + 5 + v * 5, 8 + (v & 1), 9, 2).fill(0xffffff).rect(wx + 7 + v * 5, 7 + (v & 1), 4, 1).fill(0xffffff); // a still cloud, inset >= 2 px
      // skyline: [x, w, h] blocks standing on the pane foot (y 23)
      const blocks = [[[0, 5, 6], [5, 4, 9], [9, 6, 5], [15, 3, 8], [18, 6, 6], [24, 4, 10]], [[0, 4, 8], [4, 7, 5], [11, 3, 11], [14, 5, 7], [19, 5, 4], [24, 4, 7]], [[0, 6, 5], [6, 3, 7], [9, 5, 9], [14, 6, 6], [20, 3, 12], [23, 5, 5]]][v];
      for (const [bx, bw, bh] of blocks) {
        g.rect(wx + 2 + bx, 24 - bh, bw, bh).fill(city);
        if (lit) for (let k = 0; k < bh - 2; k += 3) if ((bx + k + x) % 4 === 0) g.rect(wx + 3 + bx, 25 - bh + k, 1, 1).fill(lit);
      }
      if (i === 1) { // the neon district: decorative magenta (signage/skyline only), dim by day
        const n = night ? KEY.neon : "#5a2a4c";
        g.rect(wx + 13, 15, 3, 1).fill(n).rect(wx + 22, 18, 2, 1).fill(n).rect(wx + 6, 18, 1, 2).fill(n);
      }
      g.rect(wx + 15, 5, 2, 19).fill(E[2]); // mullion, centred on the pane
      g.rect(wx, 24, 2 * T, 3).fill(E[4]).rect(wx, 24, 2 * T, 1).fill(E[5]); // sill, lit edge
      if (i % 2 === 0) g.rect(wx + 24, 19, 4, 3).fill(0x3fa14c).rect(wx + 25, 18, 2, 1).fill(0x7fd18a).rect(wx + 25, 22, 2, 2).fill(0xa8643c); // sill plant
    });
  }

  private drawClock(d: Date) {
    const { x: cx, y: cy } = this.geo.dials.clock;
    const g = this.clock.clear(); // hands only, in whole art pixels (the face is baked in buildWalls)
    const m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60;
    const hand = (a: number, len: number) => { for (let t = 1; t <= len; t += 0.5) g.rect(Math.floor(cx + Math.sin(a) * t), Math.floor(cy - Math.cos(a) * t), 1, 1); };
    g.rect(cx - 1, cy - 1, 2, 2); // hub on the dial's centre boundary
    hand((h / 12) * Math.PI * 2, 3.5);
    hand((m / 60) * Math.PI * 2, 5.5);
    g.fill(E[0]);
  }
}
