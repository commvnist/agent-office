import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { podStyle, PODS_PER_ROW, type Layout, type Task } from "@agent-office/core";
import { T, tagHits } from "./actor.ts";
import { sceneGeometry, selfCheck, type SceneGeometry } from "./geometry.ts";
import { art, dev, place } from "./snap.ts";
import { bake, Grid, hash, hsl, mix } from "./pixel.ts";
import { shadeTo } from "./color.ts";
import { roleColor, theme } from "./theme.ts";
import { office } from "./api.ts";
import { boardModel, COLS, SUMMARY_MS, type Board, type Col, type Memo } from "./board.ts";
import { podOwners, projectHue } from "./logic.ts";
import { ambientOn, burstAllowed, fontPx, settings } from "./settings.ts";
import type { Weather } from "./flair.ts";
import { cleanText, couchSeats, skyAt, toolKind } from "./choreo.ts";
import { promptCaption } from "./pod.ts";
import { activity, armchairTex, stoolTex, benchTex, boothTex, CHAIR_STYLES, catTex, chairTex, chipStack, coffeeTex, coolerTex, couchTex, deskTex, drawPx, floorLampTex, fridgeTex, huddleTex, junctionTex, laptopTex, ledNoise, plantTex, pxTextW, rackTex, sconceTex, shadowTex, shelfTex, staleK, tableTex, wallTex, whiteTex } from "./sprites.ts";

const MAX_LIGHTS = 30;
const DAY_LIFT = 0.1; // peak add-blend alpha of the daylight grade (~10% lift of the deck at noon)
const CHAIR_LINGER_MS = 20_000; // how long a vacated chair stays out
/** Zone (pod row) a seat id `d<N>` belongs to; anything else (lobby) belongs to none. */
const wingOf = (seat: string) => {
  const n = /^d(\d+)$/.exec(seat)?.[1];
  return n === undefined ? "" : `wing${Math.floor(Number(n) / 4 / PODS_PER_ROW) + 1}`;
};
const hexNum = (h: string) => parseInt(h.slice(1), 16);

/**
 * `tool` = last tool name (monitor glyph), `count` = tool calls so far (desk clutter), `stale` = long quiet (dim monitor),
 * `role` = occupant's role (desk-top item), `flash` = ms stamp of a "ship-it" wave (monitors blink green for 1.2s, staggered),
 * `waiting` = occupant needs the user (lamp pulses gold), `prompt` = the session's last user prompt (pod caption),
 */
export type SeatState = { used: boolean; working: boolean; tool?: string; count?: number; stale?: boolean; project?: string; role?: string; flash?: number; waiting?: boolean; prompt?: string;
  /** `load` = tool calls in the last 30 s (0 idle .. 3 busy): lights the desk power rail. `queueDepth` = queued items for the agent (chip stack). `idleMs` = real silence (desaturates the desk). `hue` = session identity hue (floor trim). */
  load?: 0 | 1 | 2 | 3; mug?: boolean; queueDepth?: number; idleMs?: number; hue?: number };

type Desk = { s: Sprite; accent: string; chair: Sprite | null; overflowTier: number | null; deco: Graphics | null; decoKey: string; shown: number; pod: number; by: number; v: 0 | 1; idx: number; sh: Sprite[]; used: boolean; chairAt: number; sty: 0 | 1 | 2 };
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
const lampTex = () => smooth(bake(14, 14, (c) => radial(c, 7, 7, 7, 7, "255,216,74", 0.5)));
// weather art (baked once, shared across scenes)
let wxTex: { cloud: Texture; sun: Texture; rainbow: Texture } | null = null;
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
  rainbow: smooth(bake(48, 14, (c) => {
    ["#ff5a5a", "#ffa94a", "#ffe14a", "#5be37d", "#4aa3ff", "#a56bff"].forEach((col, i) => {
      c.strokeStyle = col; c.lineWidth = 1.6; c.beginPath(); c.arc(24, 14, 22 - i * 1.6, Math.PI, 0); c.stroke();
    });
  })),
});
const DISCO = [0xffa6ff, 0xa6ffff, 0xffffa6];
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
  private shafts = new Graphics();
  private gauge = new Graphics(); // activity gauge panel (mirror of the clock): bars lit by real office activity
  private gaugeLvl = -1;
  private gaugeSpill: Sprite | null = null;
  private rackSpill: Sprite | null = null;
  private fixtures = new Container(); // ceiling fixtures: bar + soft pool each; day 40%, night 100%
  private fixA = -1;
  private jLeds: Sprite[] = []; // junction status LED per pod
  private geo: SceneGeometry; // every rect and line below comes from here (geometry.ts <- core placements()/lines())
  private bot: Sprite | null = null;
  private botLamp: Sprite | null = null;
  private links = new Map<number, Sprite[]>(); // bench-pod table tiles by pod
  private shaftDay = 0;
  private dust: Sprite[] = [];
  private coffeeS: Sprite | null = null;
  private coffeeOn = false;
  private racks: Sprite[] = [];
  private leds: Sprite[] = []; // 4 rows x 3 LEDs per cabinet, drawn over the rack texture
  private ledStep = -1;
  private act = 0; private actTo = 0; private techAt = 0; // smoothed office activity (0..1), its target, last tech tick
  private podWork: number[] = []; // working seats per pod
  private pads: Graphics[] = []; // pod pad bracket glow, one per pod, drawn once and only re-alpha'd
  private memo: Memo = { counts: null, at: 0 };
  private lastTasks: readonly Task[] | null = null;
  private board: Board | null = null;
  private cards: Sprite[] = [];
  private colText: Text[] = [];
  private colKey = "";
  private notes = new Graphics();
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
  private rainbowS: Sprite | null = null;
  private rainbowAt = 0;
  private rainbowUntil = 0;
  private floorS: Sprite | null = null;
  private discoUntil = 0;
  private discoOn = false;
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
    vig.width = l.cols * T; vig.height = l.rows * T; vig.alpha = 0.3; vig.eventMode = "none";
    this.shafts.blendMode = "add"; this.shafts.eventMode = "none";
    this.glow.addChild(this.shafts);
    for (let i = 0; i < 12; i++) { // dust motes: drift only inside the shafts
      const m = new Sprite(whiteTex());
      m.tint = 0xfff1c8; m.visible = false; m.eventMode = "none"; m.blendMode = "add";
      this.dust.push(m); this.glow.addChild(m);
    }
    this.ys = ysort;
    world.addChild(this.floor, this.walls, this.sky, this.wx, this.clock, ysort, this.night, this.day, this.glow, vig);
    this.glow.eventMode = "none";
    this.floor.eventMode = this.walls.eventMode = "none";
    this.buildFloor();
    this.buildWalls();
    this.buildWeather();
    this.buildFurniture(ysort);
    const c = this.geo.rect(`decor:coffee:${l.decor.findIndex((d) => d.kind === "coffee")}`);
    this.coffee = { x: c.x + 8, y: c.y + 2 };
    const label = () => new Text({ text: "", style: { fontFamily: MONO, fontSize: 10, fill: 0xbfeaff } });
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
    for (const r of g.rugs) { // bordered rug: fill, 1px lit border inset 1px
      c.fillStyle = r.id === "rug:lobby" ? mix(D.mid, D.lit, 0.45) : mix(D.mid, "#3b4a6e", 0.6); c.fillRect(r.x + 2, r.y - oy + 2, r.w - 4, r.h - 4);
      c.strokeStyle = rgba(D.lit, 0.7); c.lineWidth = 1; c.strokeRect(r.x + 2.5, r.y - oy + 2.5, r.w - 5, r.h - 5);
    }
    c.globalCompositeOperation = "multiply"; // grade: a touch darker toward the edges so the lights carry the room
    const gr = c.createRadialGradient(w / 2, h * 0.45, h * 0.2, w / 2, h * 0.45, Math.max(w, h) * 0.7);
    gr.addColorStop(0, "#ffffff"); gr.addColorStop(1, "#8a93b8");
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = "source-over";
    for (let x = 0; x <= l.cols; x++) { c.fillStyle = `rgba(127,227,255,${x % 4 === 0 ? 0.06 : 0.03})`; c.fillRect(x * T, 0, 1, h); }
    for (let y = 0; y <= l.rows - l.wallRows; y++) { c.fillStyle = `rgba(127,227,255,${y % 4 === 0 ? 0.06 : 0.03})`; c.fillRect(0, y * T, w, 1); }
    // spine: door -> lobby, a cyan strip with chevrons pointing in
    const [s0, s1] = g.line.get("spine")!.pts, sx = s0.x, sTop = s0.y - oy, sBot = s1.y - oy;
    // sx is a pixel BOUNDARY (the tile centre), so everything is even-width and mirrored about it: 8px strip, 2px apex
    c.fillStyle = "rgba(127,227,255,0.1)"; c.fillRect(sx - 4, sTop, 8, sBot - sTop);
    c.fillStyle = "rgba(127,227,255,0.3)"; c.fillRect(sx - 4, sTop, 1, sBot - sTop); c.fillRect(sx + 3, sTop, 1, sBot - sTop);
    c.fillStyle = "rgba(127,227,255,0.55)";
    for (let y = sBot - T; y > sTop; y -= 2 * T) for (let k = 0; k < 3; k++) { c.fillRect(sx - 1 - k, y + k, 1, 1); c.fillRect(sx + k, y + k, 1, 1); }
    // mats under standing desks (no floor text anywhere: pod identity lives in the hover plaque)
    for (const m of g.mats) { c.fillStyle = rgba("#10131f", 0.85); c.fillRect(m.x, m.y - oy, m.w, m.h); c.fillStyle = rgba(D.lit, 0.5); c.fillRect(m.x, m.y - oy, m.w, 1); }
    // conduits (server bank -> trunk -> pod rows): 2px dark steel with a 1px lit edge on the upper/left side, centred on the line;
    // each segment is inclusive of both end pixels so bends and joints close
    const seg = g.conduits.flatMap((ln) => ln.pts.slice(1).map((b, i) => { const a = ln.pts[i]; return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) - oy, w: Math.abs(b.x - a.x) + 1, h: Math.abs(b.y - a.y) + 1 }; }));
    c.fillStyle = rgba(D.lit, 0.85); for (const k of seg) k.w === 1 ? c.fillRect(k.x - 1, k.y, 1, k.h) : c.fillRect(k.x, k.y - 1, k.w, 1);
    c.fillStyle = rgba("#0c0f1c", 0.95); for (const k of seg) k.w === 1 ? c.fillRect(k.x, k.y, 2, k.h) : c.fillRect(k.x, k.y, k.w, 2);
    // charging dock where the cleaning bot parks (start of its first rail)
    const d = g.dock;
    if (d) { c.fillStyle = rgba("#10131f", 0.9); c.fillRect(d.x, d.y - oy, d.w, d.h); c.fillStyle = "#7fe3ff"; c.fillRect(d.x + 1, d.y + 1 - oy, 2, 1); }
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
  private setOwner(i: number, owner: string, hue = -1) {
    const pod = this.pods[i];
    pod.owner = owner; pod.hue = hue;
    pod.g.clear().roundRect(pod.x, pod.y, pod.w, pod.h, 3);
    // the pad is the project's colour; the 1px trim at 25% alpha is the session's identity hue
    if (owner) pod.g.fill({ color: hexNum(hsl(projectHue(owner), 0.45, 0.55)), alpha: 0.16 }).stroke({ width: 1, color: hexNum(hsl(hue >= 0 ? hue : projectHue(owner), 0.65, 0.6)), alpha: 0.25, alignment: 1 });
    else pod.g.fill({ color: DIM, alpha: 0.14 });
    if (!owner) { if (pod.plaque) pod.plaque.visible = false; return; }
    pod.plaque ??= this.ui.addChild(new Text({ text: "", style: { fontFamily: MONO, fontSize: 10, fill: 0xffffff, stroke: { color: 0x0e0d16, width: 3 } } }));
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
    this.doorG.rect(x - 1, y - 4, w + 2, 14).fill(0x2d3556); // steel frame
    if (this.doorOpen) this.doorG.rect(x, y, w, 10).fill(0x0c0f1c).rect(x, y, 5, 10).fill(0x2a3050);
    else this.doorG.rect(x, y, w, 10).fill(0x171b30).rect(x, y, w, 1).fill(0x3a4366);
    this.doorG.rect(x, y - 3, w, 2).fill(this.doorOpen ? 0xffc870 : 0x2b5a6a); // light strip: lamp-warm while ajar
  }

  private buildWalls() {
    const wt = wallTex();
    const sg = this.geo.signs, cw = this.l.cols * T;
    const s = new Sprite(bake(cw, 32, (c) => {
      for (let x = 0; x < this.l.cols; x++) c.drawImage(wt.source.resource as CanvasImageSource, x * T, 0);
      c.fillStyle = theme().wall.trim; c.fillRect(0, 0, cw, 2); // ceiling cove: 2px trim and a cyan wash falling from it
      const g = c.createLinearGradient(0, 2, 0, 8);
      g.addColorStop(0, "rgba(127,227,255,0.08)"); g.addColorStop(1, "rgba(127,227,255,0)");
      c.fillStyle = g; c.fillRect(0, 2, cw, 6);
      const plate = (cx: number, lines: string[]) => { // signage plate, backlit ~10%, centred on cx
        const pw = Math.max(...lines.map(pxTextW)) + 4, ph = lines.length * 6 + 3, px = Math.round(cx - pw / 2), py = 17 - Math.round(ph / 2);
        c.fillStyle = "rgba(127,227,255,0.1)"; c.fillRect(px - 2, py - 2, pw + 4, ph + 4);
        c.fillStyle = "#10131f"; c.fillRect(px, py, pw, ph);
        c.fillStyle = theme().wall.trim; c.fillRect(px, py, pw, 1);
        lines.forEach((t, i) => drawPx(c, t, Math.round(cx - pxTextW(t) / 2), py + 2 + i * 6, "#9fd8ee"));
      };
      plate(sg.ops.x + sg.ops.w / 2, ["OPS"]); plate(sg.agent.x + sg.agent.w / 2, ["AGENT", "OFFICE"]);
    }));
    s.eventMode = "none";
    this.walls.addChild(s);
    for (const k of this.geo.sconces) { const sp = place(new Sprite(sconceTex()), k.x, 10); sp.eventMode = "none"; this.walls.addChild(sp); } // wall washer: one per sconce footprint
    // whiteboard frame (text is drawn in the screen-space overlay)
    const b = this.geo.rect("board");
    const g = new Graphics();
    g.roundRect(b.x, 3, b.w, 24, 2).fill(0x0a1124).stroke({ width: 2, color: 0x3fb8d6 }); // dark glass panel, cyan rim
    g.rect(b.x + 4, 27, b.w - 8, 2).fill(0x1d5f73);
    this.walls.addChild(g, this.notes, this.gauge);
    for (let i = 0; i < CARDS_PER_COL * 4; i++) { // pooled paper cards, laid out when the task list changes
      const c = new Sprite(whiteTex());
      c.visible = false; c.eventMode = "none";
      this.cards.push(c); this.walls.addChild(c);
    }
  }

  private buildTechGlow() {
    for (const L of this.geo.lights) { // a soft additive pool under each light source (alpha follows day/night via the container)
      const warm = L.tone === "warm", pool = new Sprite(this.glowTex);
      pool.anchor.set(0.5); pool.position.set(L.x, L.y + (warm ? -4 : L.reach * 0.4));
      pool.width = L.reach * (warm ? 1.6 : 1.5); pool.height = L.reach * (warm ? 0.9 : 1);
      pool.tint = warm ? 0xffc870 : 0xcfe6ff; pool.alpha = warm ? 0.16 : 0.14; pool.eventMode = "none";
      this.fixtures.addChild(pool);
    }
    this.fixtures.eventMode = "none";
    this.glow.addChild(this.fixtures);
    for (const j of this.geo.junctions) { // pod junction box (the conduit passes through its centre) + one status LED
      const box = place(new Sprite(junctionTex()), j.cx - 3, j.cy - 2), led = place(new Sprite(whiteTex()), j.cx + 1, j.cy - 1);
      led.width = led.height = 1; led.tint = 0x2c5a3a; box.eventMode = led.eventMode = "none";
      this.floor.addChild(box, led); this.jLeds[j.pod] = led;
    }
    const gcx = this.geo.dials.gauge.x;
    this.gaugeSpill = new Sprite(this.glowTex);
    this.gaugeSpill.anchor.set(0.5); this.gaugeSpill.position.set(gcx, 16); this.gaugeSpill.width = 40; this.gaugeSpill.height = 30; this.gaugeSpill.tint = 0x7fe3ff; this.gaugeSpill.alpha = 0; this.gaugeSpill.eventMode = "none";
    this.glow.addChild(this.gaugeSpill);
    if (this.geo.rails.length) { // roaming cleaning bot: under the actors, with a small additive headlamp
      this.bot = new Sprite(bake(10, 6, (c) => {
        c.fillStyle = "#2a2f45"; c.fillRect(1, 1, 8, 4); c.fillStyle = "#5a6490"; c.fillRect(1, 1, 8, 1);
        c.fillStyle = "#171a24"; c.fillRect(0, 5, 10, 1); c.fillStyle = "#7fe3ff"; c.fillRect(7, 2, 2, 1);
      }));
      this.bot.anchor.set(0.5); this.bot.eventMode = "none"; this.bot.visible = false;
      this.botLamp = new Sprite(this.glowTex);
      this.botLamp.anchor.set(0.5); this.botLamp.tint = 0x7fe3ff; this.botLamp.blendMode = "add"; this.botLamp.width = 18; this.botLamp.height = 10; this.botLamp.eventMode = "none"; this.botLamp.visible = false;
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
    this.tickPads(on, a, now);
    this.tickRack(on, a, now);
  }

  /** The wall gauge mirrors the clock: 3 bars lit by real office activity (0..3). */
  private drawGauge(lvl: number) {
    const { x: px, y: cy } = this.geo.dials.gauge, g = this.gauge;
    g.clear().roundRect(px - 9, cy - 9, 18, 18, 2).fill(0x0a1124).stroke({ width: 2, color: 0x3fb8d6 });
    [[-5, 11], [-1, 7], [3, 9]].forEach(([dy, len], i) => g.rect(px - 6, cy + dy, len, 2).fill(i >= 3 - lvl ? 0x7fe3ff : 0x1d3f55));
    if (this.gaugeSpill) this.gaugeSpill.alpha = 0.04 * lvl;
  }

  /** Pod pad brackets: dim while a pod is empty (hidden), faint when seated, bright and breathing when its agents work. */
  private tickPads(on: boolean, a: number, now: number) {
    while (this.pads.length < this.pods.length) {
      const p = this.pods[this.pads.length], w = p.w, h = p.h, g = new Graphics();
      for (const [cx, cy, dx, dy] of [[0, 0, 1, 1], [w - 1, 0, -1, 1], [0, h - 1, 1, -1], [w - 1, h - 1, -1, -1]])
        g.rect(dx > 0 ? cx : cx - 4, cy, 5, 1).rect(cx, dy > 0 ? cy : cy - 4, 1, 5).fill(0x7fe3ff);
      g.position.set(p.x, p.y); g.blendMode = "add"; g.eventMode = "none"; g.visible = false;
      this.glow.addChild(g); this.pads.push(g);
    }
    this.jLeds.forEach((led, i) => { // junction LED: blinks only while that pod has working agents; steady dim green otherwise
      const blink = on && (this.podWork[i] ?? 0) > 0 && Math.floor(now / 500 + i) % 2 === 0;
      led.tint = blink ? 0x5be37d : 0x2c5a3a;
    });
    this.pads.forEach((g, i) => {
      const p = this.pods[i], seated = !!p && p.owner !== "\0" && p.owner !== "" && !this.born.has(i), w = this.podWork[i] ?? 0;
      const vis = on && seated;
      if (g.visible !== vis) g.visible = vis;
      if (vis) g.alpha = w > 0 ? 0.55 + 0.25 * a + 0.2 * Math.sin(now / 400 + i) : 0.18;
    });
  }

  /** Server rack: 16 LEDs; flip rate and lit density follow activity. Steps at <= 8 Hz, deterministic from time. */
  private tickRack(on: boolean, a: number, now: number) {
    if (!this.racks.length) return;
    if (!this.rackSpill) {
      const f = this.racks[0], e = this.racks[this.racks.length - 1], r = (this.rackSpill = new Sprite(this.glowTex));
      r.anchor.set(0.5); r.position.set((f.x + e.x + 16) / 2, f.y + 8); r.width = e.x + 16 - f.x + 24; r.height = 34; r.tint = 0x5be37d; r.eventMode = "none";
      this.glow.addChild(r);
    }
    this.rackSpill.alpha = on ? 0.03 + 0.09 * a : 0.03; // the LEDs' small spill follows the same activity
    if (!on) { if (this.leds[0]?.visible) { this.leds.forEach((s) => (s.visible = false)); this.ledStep = -1; } return; }
    if (!this.leds.length) {
      for (const rk of this.racks) for (let i = 0; i < 12; i++) {
        const s = new Sprite(whiteTex());
        s.position.set(9 + (i % 3), 3 + Math.floor(i / 3) * 3); s.eventMode = "none";
        rk.addChild(s); this.leds.push(s);
      }
    }
    const step = Math.floor(now / (125 + 875 * (1 - a))); // 1 s per step idle, 125 ms busy
    if (step === this.ledStep) return;
    this.ledStep = step;
    this.leds.forEach((s, i) => {
      const n = ledNoise(i, step), lit = n < 0.12 + 0.75 * a;
      s.visible = true;
      s.tint = lit ? (ledNoise(i, 7) < 0.2 ? 0xffb347 : 0x5be37d) : 0x2c5a3a;
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
      this.desks.set(seat, { s, accent, chair, overflowTier: p.kind === "overflow" ? p.tier : null, deco, decoKey: "", shown: 0, pod: Math.floor(Number(seat.slice(1)) / 4), by: dk.y, v, idx: Number(seat.slice(1)) || 0, sh, used: false, chairAt: 0, sty });
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
      this.desks.set(`lobby#${i}`, { s, accent: "#f4f1ff", chair, overflowTier: null, deco: this.addDeco(ysort, k.x, k.y, k.y + T + 0.5), decoKey: "", shown: 0, pod: -1, by: 0, v: 0, idx: i, sh, used: false, chairAt: 0, sty: 0 });
    });
    l.decor.forEach((d, i) => {
      const r = this.geo.rect(`decor:${d.kind}:${i}`), z = r.y + T;
      if (d.kind === "plant") add(plantTex(), r.x, r.y, z);
      else if (d.kind === "coffee") this.coffeeS = add(coffeeTex(), r.x, r.y, z);
      else if (d.kind === "cooler") add(coolerTex(), r.x, r.y, z);
      else if (d.kind === "bookshelf") add(shelfTex(), r.x, r.y, z);
      else if (d.kind === "couch") add(couchTex(), r.x, r.y, z);
      else if (d.kind === "rack") this.racks.push(add(rackTex(0, Math.min(2, this.racks.length) as 0 | 1 | 2), r.x, r.y, z));
      else if (d.kind === "lamp") add(floorLampTex(), r.x, r.y, z);
      else if (d.kind === "fridge") add(fridgeTex(), r.x, r.y, z);
      else if (d.kind === "table") add(tableTex(), r.x, r.y, z);
      else if (d.kind === "booth" || d.kind === "armchair") { // authored facing +x; the right-hand side is the mirror image
        const right = d.x > (l.cols - 1) / 2;
        const s = add(d.kind === "booth" ? boothTex() : armchairTex(), r.x + (right ? T : 0), r.y, r.y + r.h);
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
  private drawDeco(g: Graphics, o: { working: boolean; tool?: string; count: number; role?: string; v: number; waiting: boolean; flash: boolean; used: boolean; load: number; depth: number; mug: boolean }) {
    g.clear();
    const px = (x: number, y: number, col: string) => g.rect(x, y, 1, 1).fill(col);
    if (o.v === 0) g.rect(3, 0, 3, 1).fill(o.working ? "#ffd27a" : o.waiting ? "#ffd84a" : "#4a4f69");
    const r = o.role ?? "";
    if (/qa|test/.test(r)) { g.rect(6, 0, 2, 3).fill("#2a2d3b").rect(6, 1, 2, 1).fill("#4a5068"); px(7, 0, "#5be37d"); }
    else if (/design|front/.test(r)) { g.rect(6, 1, 2, 2).fill("#f4ead0"); px(7, 0, "#c9604a"); }
    else if (/secur/.test(r)) { g.rect(6, 0, 2, 1).fill("#c9ccd8").rect(6, 1, 2, 2).fill("#f2c14e"); px(7, 2, "#7a5a10"); }
    if (o.flash) g.rect(9, 1, 5, 4).fill("#5be37d");
    else if (o.working) {
      const k = toolKind(o.tool), c = "#7fe3ff";
      if (k !== "other") g.rect(9, 1, 5, 4).fill("#12304a");
      if (k === "term") { px(9, 1, c); px(10, 2, c); px(9, 3, c); px(11, 3, c); px(12, 3, c); }
      else if (k === "edit") g.rect(9, 1, 3, 1).fill("#5be37d").rect(9, 2, 3, 1).fill("#ff6b6b").rect(9, 3, 2, 1).fill("#5be37d");
      else if (k === "read") g.rect(9, 1, 4, 1).fill("#e8ecff").rect(9, 2, 3, 1).fill("#e8ecff").rect(9, 3, 4, 1).fill("#e8ecff");
      else if (k === "web") { for (const [x, y] of [[10, 1], [11, 1], [12, 1], [10, 4], [11, 4], [12, 4], [9, 2], [9, 3], [13, 2], [13, 3], [11, 2], [11, 3]]) px(x, y, c); }
    }
    if (o.used) { // power rail along the desk front: one step lit per load level (static); queue chips stacked in the front gap
      for (let i = 0; i < 3; i++) g.rect(2 + i * 4, 14, 3, 1).fill(i < o.load ? "#7fe3ff" : "#1c2238");
      const q = chipStack(o.depth);
      for (let i = 0; i < q.n; i++) g.rect(7, 13 - i, 2, 1).fill(i % 2 ? "#e0a040" : "#ffc870");
      if (q.more) { px(7, 6, "#ffffff"); px(6, 7, "#ffffff"); px(7, 7, "#ffffff"); px(8, 7, "#ffffff"); px(7, 8, "#ffffff"); }
    }
    if (o.mug) { g.rect(14, 4, 2, 2).fill("#f4f1e6"); g.rect(14, 4, 2, 1).fill("#6b4a2e"); } // idle sip window: a mug on the desk, gone when the agent works or leaves
    const lvl = o.count >= 40 ? 3 : o.count >= 20 ? 2 : o.count >= 8 ? 1 : 0;
    for (let i = 0; i < lvl; i++) g.rect(8 + (i % 2), 5 - (i > 1 ? 1 : 0), 4, 1).fill(i % 2 ? "#dfe3f0" : "#f6f7fb");
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
      // a chair stays out, pushed back, for a moment after its occupant leaves (tick hides it); never-used chairs stay hidden
      if (d.chair) d.chair.visible = (u || (d.pod >= 0 && !settings.reducedMotion && d.chairAt > 0 && now - d.chairAt < CHAIR_LINGER_MS));
      d.sh[0].visible = d.s.visible;
      d.sh[1].visible = !!d.chair?.visible;
    }
    const nUsed = this.countWork();
    const anyUsed = nUsed > 0;
    if (this.coffeeS && anyUsed !== this.coffeeOn) { this.coffeeOn = anyUsed; this.coffeeS.texture = coffeeTex(anyUsed); }
    // empty zones sit darker than occupied ones (#113)
    const used = new Set<string>();
    for (const [k, st] of m) if (st.used) used.add(wingOf(k));
    for (const [role, g] of this.zoneDim) g.visible = !used.has(role);
    const owners = podOwners(new Map([...m].filter(([, st]) => st.used && st.project).map(([k, st]) => [k, st.project!])), this.pods.length);
    const hues = new Array<number>(this.pods.length).fill(-1);
    for (const [id, st] of m) { const pi = this.desks.get(id)?.pod ?? -1; if (pi >= 0 && pi < hues.length && st.used && st.hue !== undefined && hues[pi] < 0) hues[pi] = st.hue; }
    owners.forEach((o, i) => { if (o !== this.pods[i].owner || hues[i] !== this.pods[i].hue) this.setOwner(i, o, hues[i]); });
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
        const o = { working, tool: working ? st?.tool : undefined, count: used ? st?.count ?? 0 : 0, role: used ? st?.role : undefined, v: d.v, waiting: used && !working && !!st?.waiting, flash, used, load: used ? st?.load ?? 0 : 0, mug: used && !!st?.mug, depth: used ? st?.queueDepth ?? 0 : 0 };
        const key = `${o.tool ?? ""}|${o.count}|${o.role ?? ""}|${+working}${+o.waiting}${+flash}|${+used}${o.load}.${o.depth}${+o.mug}`;
        if (key !== d.decoKey) { d.decoKey = key; this.drawDeco(d.deco, o); }
      }
    }
    // overflow desks ease in
    if (!settings.reducedMotion) for (const d of this.desks.values()) if (d.overflowTier !== null && d.s.visible) {
      const a = Math.min(1, (now - d.shown) / 250);
      d.s.alpha = a;
      if (d.chair) d.chair.alpha = a;
      d.sh.forEach((x) => (x.alpha = a));
    }
    if (!settings.reducedMotion) for (const d of this.desks.values()) { // chairs scoot in on arrival and push back on departure
      if (!d.chair || d.pod < 0 || d.chairAt === 0) continue;
      const k = Math.min(1, (now - d.chairAt) / (d.used ? 260 : 150)), vis = d.used || now - d.chairAt < CHAIR_LINGER_MS; // a vacated chair stays pushed back, honestly 'recently left', then is tidied
      if (d.chair.visible !== vis) { d.chair.visible = vis; d.sh[1].visible = vis; }
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
      const key = `${i}|${p.owner}|${pfs}|${chars}`;
      if (key !== p.key) {
        p.key = key;
        q.style.fontSize = pfs;
        const t = `P${i + 1} · ${cleanText(p.owner, 40)}`; // pod identity is attached to the pod, not painted on the floor
        q.text = t.length > chars ? t.slice(0, chars - 1) + "…" : t;
      }
      const priv = office.privacy || office.source.private, capOn = sc >= 2 && !!p.prompt && !priv && !this.born.has(i);
      const cx = dev(ox + (p.x + p.w / 2) * sc);
      q.position.set(cx, dev(oy + (p.y - 7) * sc - (capOn ? 5 : 0)));
      if (tagHits(q.x, q.y, q.width, q.height)) q.visible = false; // a name tag or selection ring wins over the plaque
      // last-prompt caption under the plaque: small, muted, only when zoomed in; text re-set only when its inputs change
      if (!capOn) { if (p.cap) p.cap.visible = false; return; }
      const cap = (p.cap ??= this.ui.addChild(new Text({ text: "", style: { fontFamily: MONO, fontSize: 9, fill: 0xdfe4ff, stroke: { color: 0x0e0d16, width: 2 } } })));
      if (p.prompt !== p.capPrompt || p.capChars !== cchars || p.capPriv !== priv || cap.style.fontSize !== cfs) {
        cap.style.fontSize = cfs;
        p.capPrompt = p.prompt; p.capChars = cchars; p.capPriv = priv;
        cap.text = promptCaption(p.prompt, priv, cchars);
        cap.anchor.set(0.5);
        cap.alpha = 0.75;
        cap.eventMode = "none";
      }
      cap.position.set(cx, dev(oy + (p.y - 7) * sc + 6));
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
        g.tint = 0xffc870;
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
      flash.position.set(x * T, 4); flash.width = 2 * T; flash.height = 22; flash.alpha = 0.85;
      const drops = [0, 1, 2].map(() => { const d = mk(whiteTex()); d.tint = 0x9ad0ff; d.scale.set(1, 3); return d; });
      this.wxWins.push({ x: x * T, cloud: mk(t.cloud), sun: mk(t.sun), drops, flash });
    }
    const rb = this.rainbowS = mk(t.rainbow);
    rb.position.set(0, 2); rb.width = this.l.cols * T; rb.height = 24;
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
      w.sun.visible = sunny;
      w.sun.tint = this.dark ? 0xdfe6ff : 0xffd84a;
      w.sun.position.set(w.x + 22, 6);
      w.cloud.visible = !sunny;
      w.cloud.tint = rain ? 0x7d8398 : 0xe8ecf5;
      w.cloud.position.set(Math.round(w.x + 2 + 16 * (anim ? 0.5 + 0.5 * Math.sin(now / 7000 + i) : 0.5)), 6);
      w.drops.forEach((d, k) => {
        d.visible = rain;
        d.position.set(w.x + 6 + k * 9 + (i % 2) * 2, Math.floor(anim ? 12 + ((now / 30 + k * 5 + i * 3) % 13) : 13 + k * 4));
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
  /** Rainbow arc over the windows until `until`. */
  rainbow(now: number, until: number) {
    if (!burstAllowed()) return;
    this.rainbowAt = now;
    this.rainbowUntil = until;
  }
  /** Floor tint cycles three colours until `until`. */
  disco(until: number) {
    if (burstAllowed()) this.discoUntil = until;
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
    const rb = this.rainbowS;
    if (rb) {
      const left = this.rainbowUntil - now, show = anim && left > 0;
      if (rb.visible !== show) rb.visible = show;
      if (show) rb.alpha = 0.55 * Math.max(0, Math.min(1, (now - this.rainbowAt) / 1000, left / 1000));
    }
    const disco = anim && now < this.discoUntil;
    if (disco && this.floorS) this.floorS.tint = DISCO[Math.floor(now / 400) % 3];
    else if (this.discoOn && this.floorS) this.floorS.tint = 0xffffff;
    this.discoOn = disco;
    if (this.catS?.visible && now >= this.catUntil) this.catS.visible = false;
  }

  /** Desk lights (working: pool + tool-coloured spill + lamp; waiting: pulsing gold lamp), pooled additive sprites, and dust in the shafts. */
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
        g.alpha = 0.75 + night;
      } else {
        g.texture = this.lightTexs.get("lamp") ?? this.lightTexs.set("lamp", lampTex()).get("lamp")!;
        place(g, d.s.x - 2.5, d.s.y - 6.5);
        g.alpha = still ? 0.6 : 0.35 + 0.35 * Math.sin(now / 320); // waiting: lamp pulses gold
      }
    }
    // dust drifts only inside the shafts; off at night and under reduced motion
    const wins = this.geo.windows, on = ambientOn() && this.shaftDay > 0.1 && wins.length > 0;
    const shift = this.shaftShift;
    this.dust.forEach((m, i) => {
      if (m.visible !== on) m.visible = on;
      if (!on) return;
      const u = (now / 11000 + i * 0.37) % 1, wx = wins[i % wins.length] * T, w = 2 * T;
      const y = 28 + u * 44;
      m.position.set(Math.round(wx + (shift + 8) * ((y - 26) / 50) + 2 + ((i * 0.618) % 1) * (w - 4) + Math.sin(now / 1700 + i) * 2), Math.round(y));
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
      // sticky-note wall beside the board: one note per done report (cap 12), coloured by role
      this.notes.clear();
      bd.cols.done.slice(0, 12).forEach((t, i) => {
        this.notes.rect((b.x - 1) * T + 3 + (i % 3) * 4, 6 + Math.floor(i / 3) * 4, 3, 3).fill(hexNum(shadeTo(roleColor(t.role), "#fff1d6", 0.3)));
      });
      this.colKey = "";
    }
    const bd = this.board!, any = tasks.length > 0;
    const fs = Math.max(8, Math.floor(sc * 5)); // no upper cap: the board text keeps its size relative to the board, so zooming in makes it larger
    const colW = (b.w * T - 6) / 4, chars = Math.floor((colW * sc) / (fs * 0.72)); // 0.72: headroom so a header never runs into the next column's text
    const key = `${fs}|${chars}|${any}`;
    if (key !== this.colKey) {
      this.colKey = key;
      COLS.forEach((c, i) => {
        const n = bd.counts[c], over = Math.max(0, n - CARDS_PER_COL), more = over ? `+${over}` : "";
        const t = [`${NAMES[i]} ${n}${more && " " + more}`, `${NAMES[i][0]} ${n}${more}`, `${NAMES[i][0]}${n}`].find((x) => x.length <= chars) ?? `${n}`;
        const tx = this.colText[i];
        tx.text = t;
        tx.style.fontSize = fs;
        tx.style.fill = c === "blocked" && n ? 0xff7a6a : 0xbfeaff;
      });
      this.boardText.style.fontSize = fs;
      this.boardText.text = bd.summary || "No tasks yet";
    }
    this.boardText.visible = !any;
    this.colText.forEach((t, i) => { t.visible = any; t.position.set(dev(ox + (b.x * T + 3 + i * colW + 1) * sc), dev(oy + 4 * sc)); });
    this.boardText.position.set(dev(ox + (b.x * T + 5) * sc), dev(oy + 8 * sc));
    this.boardMask.clear().rect(dev(ox + (b.x * T + 2) * sc), dev(oy + 3 * sc), dev((b.w * T - 4) * sc), dev(24 * sc)).fill(0xffffff);
  }

  private nightAlpha(h: number) {
    const max = theme().nightMax; // capped by theme so alert cues in the world layer stay readable; UI layer is above this overlay
    if (h >= 8 && h < 18) return 0;
    if (h >= 18 && h < 21) return ((h - 18) / 3) * max;
    if (h >= 21 || h < 5) return max;
    return (1 - (h - 5) / 3) * max;
  }

  private shaftShift = 0;
  /** One static parallelogram of daylight per window; x leans with the sun, alpha follows daylight, amber at dawn/dusk. Redrawn on the 15-minute key. */
  private drawShafts(hour: number) {
    const nm = theme().nightMax;
    const day = nm > 0 ? 1 - this.nightAlpha(hour) / nm : hour >= 6 && hour < 19 ? 1 : 0;
    this.shaftDay = Math.max(0, Math.min(1, day));
    this.shafts.clear();
    const moon = (1 - this.shaftDay) * (nm > 0 ? Math.min(1, this.nightAlpha(hour) / nm) : 0); // night: cool pools where the window light lands
    this.shafts.visible = this.shaftDay > 0.02 || moon > 0.02;
    if (!this.shafts.visible) return;
    if (moon > 0.02) for (const x of this.geo.windows) this.shafts.poly([x * T, 28, x * T + 2 * T, 28, x * T + 2 * T + 6, 70, x * T + 6, 70]).fill({ color: 0x9fb8ff, alpha: 0.07 * moon });
    if (this.shaftDay <= 0.02) return;
    const shift = this.shaftShift = (Math.max(0, Math.min(1, (hour - 7) / 11)) - 0.5) * 44;
    const color = hour < 8.5 || hour >= 16.5 ? 0xffb86a : 0xfff1c8;
    for (const x of this.geo.windows) {
      const wx = x * T, w = 2 * T;
      this.shafts.poly([wx, 26, wx + w, 26, wx + w + shift + 8, 76, wx + shift + 8, 76]).fill({ color, alpha: 0.07 * this.shaftDay });
    }
  }

  private drawSky(hour: number) {
    const { top, bottom, night } = skyAt(hour), day = hour >= 8 && hour < 17;
    this.dark = night;
    this.sky.clear();
    const l = this.l;
    for (const x of this.geo.windows) {
      const wx = x * T, w = 2 * T;
      this.sky.rect(wx - 3, 1, w + 6, 28).fill(0x171b30); // deep reveal
      this.sky.rect(wx - 2, 2, w + 4, 1).fill(0x2d3556);
      this.sky.rect(wx, 4, w, 11).fill(top).rect(wx, 15, w, 11).fill(bottom);
      if (night) for (let i = 0; i < 4; i++) this.sky.rect(wx + 4 + ((i * 9 + x * 3) % 24), 6 + ((i * 5) % 12), 1, 1).fill(0xffffff);
      if (day) this.sky.roundRect(wx + 6, 7, 10, 3, 1).fill(0xffffff);
      this.sky.rect(wx + T - 1, 4, 2, 22).fill(0x232a45).rect(wx, 14, w, 2).fill(0x232a45);
      this.sky.rect(wx - 3, 26, w + 6, 3).fill(0x4a5578).rect(wx - 3, 26, w + 6, 1).fill(0x6b7aa8); // sill, lit edge
      this.sky.rect(wx + w - 6, 22, 4, 4).fill(0x3fa14c).rect(wx + w - 5, 21, 2, 1).fill(0x7fd18a).rect(wx + w - 5, 25, 2, 1).fill(0xa8643c); // sill plant
    }
  }

  private drawClock(d: Date) {
    const { x: cx, y: cy } = this.geo.dials.clock;
    const g = this.clock;
    g.clear().circle(cx, cy, 9).fill(0xe8ecf8).stroke({ width: 2, color: 0x171b30 });
    const m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60;
    const hand = (a: number, len: number, w: number) =>
      g.moveTo(cx, cy).lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len).stroke({ width: w, color: 0x171b30 });
    hand((h / 12) * Math.PI * 2, 4, 2);
    hand((m / 60) * Math.PI * 2, 6.5, 1);
  }
}
