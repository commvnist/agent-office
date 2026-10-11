import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { deskPos, PODS_PER_ROW, type Layout, type Task } from "@agent-office/core";
import { T, tagHits } from "./actor.ts";
import { bake, Grid, hash, hsl, mix } from "./pixel.ts";
import { shadeTo } from "./color.ts";
import { roleColor, theme } from "./theme.ts";
import { office } from "./api.ts";
import { boardModel, COLS, SUMMARY_MS, type Board, type Col, type Memo } from "./board.ts";
import { podOwners, projectHue } from "./logic.ts";
import { ambientOn, burstAllowed, settings } from "./settings.ts";
import type { Weather } from "./flair.ts";
import { cleanText, couchSeats, skyAt, toolKind } from "./choreo.ts";
import { promptCaption } from "./pod.ts";
import { carpetTex, catTex, chairTex, coffeeTex, coolerTex, couchTex, deskTex, laptopTex, plantTex, rackTex, shadowTex, shelfTex, wallTex, whiteTex, woodTex } from "./sprites.ts";

const MAX_LIGHTS = 30;
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
export type SeatState = { used: boolean; working: boolean; tool?: string; count?: number; stale?: boolean; project?: string; role?: string; flash?: number; waiting?: boolean; prompt?: string };

type Desk = { s: Sprite; accent: string; chair: Sprite | null; overflowTier: number | null; deco: Graphics | null; decoKey: string; shown: number; pod: number; by: number; v: 0 | 1; idx: number; sh: Sprite[] };
const POD_W = 3, POD_H = 4, BUILD_MS = 400, RISE = 6; // pod footprint in tiles; build-in fade/rise
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
  x: number; y: number; g: Graphics; owner: string; plaque: Text | null; key: string;
  cap: Text | null; prompt: string; capPrompt: string; capPriv: boolean; capChars: number; // last-prompt caption, redrawn when any of these change
};

/** Static office furniture + the small amount of ambient animation (windows, clock, whiteboard). */
export class Scene {
  floor = new Container();
  walls = new Container();
  sky = new Graphics();
  clock = new Graphics();
  night = new Graphics();
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
  private shaftDay = 0;
  private dust: Sprite[] = [];
  private coffeeS: Sprite | null = null;
  private coffeeOn = false;
  private rack: Sprite | null = null;
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
    world.addChild(this.floor, this.walls, this.sky, this.wx, this.clock, ysort, this.night, this.glow, vig);
    this.glow.eventMode = "none";
    this.floor.eventMode = this.walls.eventMode = "none";
    this.buildFloor();
    this.buildWalls();
    this.buildWeather();
    this.buildFurniture(ysort);
    const c = l.decor.find((d) => d.kind === "coffee")!;
    this.coffee = { x: c.x * T + 8, y: c.y * T + 2 };
    const label = () => new Text({ text: "", style: { fontFamily: MONO, fontSize: 10, fill: 0x1d2a44 } });
    this.boardText = label(); // summary / empty message; the four column headers are colText
    this.colText = COLS.map(label);
    ui.addChild(this.boardText, ...this.colText, this.boardMask);
    for (const t of [this.boardText, ...this.colText]) { t.mask = this.boardMask; t.eventMode = "none"; } // keep the text inside the board frame when zoomed (#120)
    this.night.rect(0, 0, l.cols * T, l.rows * T).fill(0x0b1030);
    this.night.eventMode = "none";
  }

  private buildFloor() {
    const l = this.l;
    const carpet = new Map<string, number>();
    const zoneOf = new Map<string, string>();
    for (const z of l.zones) {
      const tint = hexNum(mix(theme().carpet.lobby, "#ffffff", theme().carpet.zoneMix)); // wings are neutral; project pods carry the colour
      for (let y = z.y - 1; y <= z.y + 7; y++) for (let x = z.x - 1; x <= z.x + z.w - 1; x++) { carpet.set(`${x},${y}`, tint); zoneOf.set(`${x},${y}`, z.role); }
    }
    const lobbyTint = hexNum(theme().carpet.lobby);
    for (let y = l.lobby[0].y - 1; y <= l.lobby[0].y + 2; y++) for (let x = 1; x < l.cols - 1; x++) { carpet.set(`${x},${y}`, lobbyTint); zoneOf.delete(`${x},${y}`); }
    // one texture for the whole floor (tinted carpet baked in), not a sprite per tile
    // shortcut: a single canvas, so cols*T or rows*T over the GPU max texture size (4096+) needs chunking
    const tile = (t: Sprite["texture"]) => t.source.resource as CanvasImageSource;
    const floor = bake(l.cols * T, (l.rows - l.wallRows) * T, (c) => {
      for (let y = l.wallRows; y < l.rows; y++)
        for (let x = 0; x < l.cols; x++) {
          const tint = carpet.get(`${x},${y}`);
          c.globalCompositeOperation = "source-over";
          c.drawImage(tile(tint ? carpetTex(x + y) : woodTex(x + y)), x * T, (y - l.wallRows) * T);
          if (tint) { // sprite tint is a multiply
            c.globalCompositeOperation = "multiply";
            c.fillStyle = "#" + tint.toString(16).padStart(6, "0");
            c.fillRect(x * T, (y - l.wallRows) * T, T, T);
          }
          const role = zoneOf.get(`${x},${y}`);
          if (tint && role) {
            const g = this.zoneDim.get(role) ?? this.zoneDim.set(role, new Graphics()).get(role)!;
            g.rect(x * T, y * T, T, T);
          }
        }
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
    for (const g of this.zoneDim.values()) { g.fill({ color: DIM, alpha: 0.35 }); g.visible = false; g.eventMode = "none"; this.floor.addChild(g); }
    for (let p = 0; p * 4 < l.props.length; p++) {
      const t = deskPos(p * 4), g = new Graphics();
      g.eventMode = "none";
      this.pods.push({ x: t.x * T - 4, y: t.y * T - 2, g, owner: "\0", plaque: null, key: "", cap: null, prompt: "", capPrompt: "\0", capPriv: false, capChars: 0 });
      this.floor.addChild(g);
    }
    this.floor.addChild(this.doorG);
    this.drawDoor();
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
  private setOwner(i: number, owner: string) {
    const pod = this.pods[i];
    pod.owner = owner;
    pod.g.clear().roundRect(pod.x, pod.y, POD_W * T + 8, POD_H * T + 4, 3);
    if (owner) pod.g.fill({ color: hexNum(hsl(projectHue(owner), 0.45, 0.55)), alpha: 0.36 });
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
    const d = this.l.door, x = d.x * T - 4, y = d.y * T + 6, w = T + 8;
    this.doorG.clear();
    if (this.doorOpen) this.doorG.rect(x, y, w, 10).fill(0x120d08).rect(x, y, 5, 10).fill(0x3b2b1a);
    else this.doorG.rect(x, y, w, 10).fill(0x3b2b1a);
    this.doorG.rect(x, y, w, 2).fill(0xc9a46a);
  }

  private buildWalls() {
    const wt = wallTex();
    const s = new Sprite(bake(this.l.cols * T, 32, (c) => { for (let x = 0; x < this.l.cols; x++) c.drawImage(wt.source.resource as CanvasImageSource, x * T, 0); }));
    s.eventMode = "none";
    this.walls.addChild(s);
    // whiteboard frame (text is drawn in the screen-space overlay)
    const b = this.l.board;
    const g = new Graphics();
    g.roundRect(b.x * T, 3, b.w * T, 24, 2).fill(0xe9edf5).stroke({ width: 2, color: 0x8b93ad });
    g.rect(b.x * T + 4, 27, b.w * T - 8, 2).fill(0x8b93ad);
    this.walls.addChild(g, this.notes);
    for (let i = 0; i < CARDS_PER_COL * 4; i++) { // pooled paper cards, laid out when the task list changes
      const c = new Sprite(whiteTex());
      c.visible = false; c.eventMode = "none";
      this.cards.push(c); this.walls.addChild(c);
    }
  }

  private buildFurniture(ysort: Container) {
    const l = this.l;
    const add = (tex: Sprite["texture"], x: number, y: number, z: number) => {
      const s = new Sprite(tex);
      s.position.set(x, y);
      s.zIndex = z;
      s.eventMode = "none";
      ysort.addChild(s);
      return s;
    };
    // contact shadows are baked sprites under the furniture (zero per-frame cost); hidden with their piece
    const shadow = (x: number, y: number) => {
      const s = new Sprite(shadowTex());
      s.position.set(x, y);
      s.visible = false;
      s.eventMode = "none";
      this.floor.addChild(s);
      return s;
    };
    for (const p of l.props) {
      const accent = "#9aa7d9"; // one desk pool: desks carry no role colour
      const seat = p.seat ?? `${p.role}+${p.tier}`;
      const chair = add(chairTex(), p.x * T, (p.y - 1) * T, p.y * T - 0.5);
      const v = (hash(seat) & 1) as 0 | 1;
      const s = p.kind === "permanent" ? add(deskTex(accent, 0, v), p.x * T, p.y * T, p.y * T + T) : add(laptopTex(p.tier), p.x * T, p.y * T, p.y * T + T);
      s.visible = p.kind === "permanent";
      chair.visible = false; // empty chairs read as top hats: shown only while the seat is used
      const deco = p.kind === "permanent" ? this.addDeco(ysort, p.x * T, p.y * T, p.y * T + T + 0.5) : null;
      const sh = [shadow(p.x * T + 1, p.y * T + T - 3), shadow(p.x * T + 1, (p.y - 1) * T + 12)];
      this.desks.set(seat, { s, accent, chair, overflowTier: p.kind === "overflow" ? p.tier : null, deco, decoKey: "", shown: 0, pod: Math.floor(Number(seat.slice(1)) / 4), by: p.y * T, v, idx: Number(seat.slice(1)) || 0, sh });
    }
    l.lobby.forEach((t, i) => {
      const chair = add(chairTex(), t.x * T, t.y * T, (t.y + 1) * T - 0.5);
      chair.visible = false;
      const s = add(deskTex("#f4f1ff", 0), t.x * T, (t.y + 1) * T, (t.y + 2) * T);
      const sh = [shadow(t.x * T + 1, (t.y + 2) * T - 3), shadow(t.x * T + 1, t.y * T + 12)];
      sh[0].visible = true;
      this.desks.set(`lobby#${i}`, { s, accent: "#f4f1ff", chair, overflowTier: null, deco: this.addDeco(ysort, t.x * T, (t.y + 1) * T, (t.y + 2) * T + 0.5), decoKey: "", shown: 0, pod: -1, by: 0, v: 0, idx: i, sh });
    });
    for (const d of l.decor) {
      const z = d.y * T + T;
      if (d.kind === "plant") add(plantTex(), d.x * T, d.y * T, z);
      else if (d.kind === "coffee") this.coffeeS = add(coffeeTex(), d.x * T, d.y * T, z);
      else if (d.kind === "cooler") add(coolerTex(), d.x * T, d.y * T, z);
      else if (d.kind === "bookshelf") add(shelfTex(), d.x * T, d.y * T, z);
      else if (d.kind === "couch") add(couchTex(), d.x * T, d.y * T, z);
      else if (d.kind === "rack") this.rack = add(rackTex(0), d.x * T, d.y * T, z);
    }
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
  private drawDeco(g: Graphics, o: { working: boolean; tool?: string; count: number; role?: string; v: number; waiting: boolean; flash: boolean }) {
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
      if (p.owner && p.owner !== "\0" && wx >= p.x && wx <= p.x + POD_W * T + 8 && wy >= p.y - 12 && wy <= p.y + POD_H * T + 4) return i;
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
      if (d.chair) d.chair.visible = !!st?.used; // permanent desks too: an empty chair reads as a top hat
      d.sh[0].visible = d.s.visible;
      d.sh[1].visible = !!d.chair?.visible;
    }
    const anyUsed = [...m.values()].some((st) => st.used);
    if (this.coffeeS && anyUsed !== this.coffeeOn) { this.coffeeOn = anyUsed; this.coffeeS.texture = coffeeTex(anyUsed); }
    // empty zones sit darker than occupied ones (#113)
    const used = new Set<string>();
    for (const [k, st] of m) if (st.used) used.add(wingOf(k));
    for (const [role, g] of this.zoneDim) g.visible = !used.has(role);
    const owners = podOwners(new Map([...m].filter(([, st]) => st.used && st.project).map(([k, st]) => [k, st.project!])), this.pods.length);
    owners.forEach((o, i) => { if (o !== this.pods[i].owner) this.setOwner(i, o); });
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
      d.s.texture = deskTex(d.accent, st?.used ? (st.working ? ((1 + flick) as 1 | 2) : 3) : 0, d.v);
      d.s.tint = st?.stale ? 0xa0a0b0 : 0xffffff; // dim monitor when long quiet (#101)
      if (d.deco) {
        const used = !!st?.used, working = used && !!st?.working;
        const el = st?.flash ? now - st.flash - d.idx * 60 : -1; // ship-it wave: 120ms green blink per desk, staggered
        const flash = !settings.reducedMotion && el >= 0 && el < 120 && now - st!.flash! < 1200;
        const o = { working, tool: working ? st?.tool : undefined, count: used ? st?.count ?? 0 : 0, role: used ? st?.role : undefined, v: d.v, waiting: used && !working && !!st?.waiting, flash };
        const key = `${o.tool ?? ""}|${o.count}|${o.role ?? ""}|${+working}${+o.waiting}${+flash}`;
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
    for (const [p, t] of this.born) { // new pods fade and rise in; existing desks never move
      const a = Math.min(1, (now - t) / BUILD_MS), dy = (1 - a) * RISE;
      if (a >= 1) this.born.delete(p);
      for (const d of this.desks.values()) {
        if (d.pod !== p) continue;
        d.s.alpha = d.chair!.alpha = a;
        d.sh.forEach((x) => (x.alpha = a));
        d.s.y = d.by + dy;
        d.chair!.y = d.by - T + dy;
        if (d.deco) { d.deco.alpha = a; d.deco.y = d.by + dy; }
      }
      this.pods[p].g.alpha = a;
    }
    // plaques ride the pod's back edge, clipped to the pod width; text only re-set when the size class changes
    const pfs = Math.round(Math.max(9, Math.min(12, sc * 5)));
    const chars = Math.max(3, Math.floor(((POD_W * T) * sc) / (pfs * 0.62)));
    const cchars = Math.max(8, Math.min(28, Math.floor((4 * T * sc) / (9 * 0.6)))); // caption may spill into the aisle, up to one pod pitch
    this.pods.forEach((p, i) => {
      const q = p.plaque;
      if (!q) return;
      q.visible = !!p.owner && sc >= 1.2 && !this.born.has(i) && i === this.hoverPod; // hover-only: no permanent labels over every pod
      if (!q.visible) { if (p.cap) p.cap.visible = false; return; }
      const key = `${p.owner}|${pfs}|${chars}`;
      if (key !== p.key) {
        p.key = key;
        q.style.fontSize = pfs;
        const t = cleanText(p.owner, 40);
        q.text = t.length > chars ? t.slice(0, chars - 1) + "…" : t;
      }
      const priv = office.privacy || office.source.private, capOn = sc >= 2 && !!p.prompt && !priv && !this.born.has(i);
      const cx = ox + (p.x + (POD_W * T + 8) / 2) * sc;
      q.position.set(cx, oy + (p.y - 7) * sc - (capOn ? 5 : 0));
      if (tagHits(q.x, q.y, q.width, q.height)) q.visible = false; // a name tag or selection ring wins over the plaque
      // last-prompt caption under the plaque: small, muted, only when zoomed in; text re-set only when its inputs change
      if (!capOn) { if (p.cap) p.cap.visible = false; return; }
      const cap = (p.cap ??= this.ui.addChild(new Text({ text: "", style: { fontFamily: MONO, fontSize: 9, fill: 0xdfe4ff, stroke: { color: 0x0e0d16, width: 2 } } })));
      if (p.prompt !== p.capPrompt || p.capChars !== cchars || p.capPriv !== priv) {
        p.capPrompt = p.prompt; p.capChars = cchars; p.capPriv = priv;
        cap.text = promptCaption(p.prompt, priv, cchars);
        cap.anchor.set(0.5);
        cap.alpha = 0.75;
        cap.eventMode = "none";
      }
      cap.position.set(cx, oy + (p.y - 7) * sc + 6);
      cap.visible = !tagHits(cap.x, cap.y, cap.width, cap.height);
    });
    const dt = new Date(clockT); // replay passes the recorded time (#105)
    const hour = dt.getHours() + dt.getMinutes() / 60;
    const hk = Math.floor(hour * 4);
    if (hk !== this.skyHour) { this.skyHour = hk; this.drawSky(hour); this.drawShafts(hour); this.layoutWeather(now); }
    const sec = Math.floor(clockT / 1000);
    if (sec !== this.clockSec) { this.clockSec = sec; this.drawClock(dt); }
    this.night.alpha = this.nightAlpha(hour);
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
    this.tickBoard(now, ox, oy, sc);
    this.tickFx(now);
    if (this.rack && ambientOn()) this.rack.texture = rackTex((Math.floor(now / 500) % 2) as 0 | 1);
  }

  private buildWeather() {
    const t = wxTextures();
    const mk = (tex: Texture) => { const s = new Sprite(tex); s.visible = false; s.eventMode = "none"; this.wx.addChild(s); return s; };
    for (const x of this.windows()) {
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
    this.catS.position.set(pos.x, pos.y - 2);
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
        g.position.set(d.s.x - 4.5, d.s.y - 6.5);
        g.alpha = 0.75 + night;
      } else {
        g.texture = this.lightTexs.get("lamp") ?? this.lightTexs.set("lamp", lampTex()).get("lamp")!;
        g.position.set(d.s.x - 2.5, d.s.y - 6.5);
        g.alpha = still ? 0.6 : 0.35 + 0.35 * Math.sin(now / 320); // waiting: lamp pulses gold
      }
    }
    // dust drifts only inside the shafts; off at night and under reduced motion
    const wins = this.windows(), on = ambientOn() && this.shaftDay > 0.1 && wins.length > 0;
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
        s.position.set(x0 + i * colW + 1, 11 + r * 4);
        s.width = colW - 3; s.height = 3;
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
    const fs = Math.max(8, Math.min(11, Math.floor(sc * 5)));
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
        tx.style.fill = c === "blocked" && n ? 0xb3261e : 0x1d2a44;
      });
      this.boardText.style.fontSize = fs;
      this.boardText.text = bd.summary || "No tasks yet";
    }
    this.boardText.visible = !any;
    this.colText.forEach((t, i) => { t.visible = any; t.position.set(ox + (b.x * T + 3 + i * colW + 1) * sc, oy + 4 * sc); });
    this.boardText.position.set(ox + (b.x * T + 5) * sc, oy + 8 * sc);
    this.boardMask.clear().rect(ox + (b.x * T + 2) * sc, oy + 3 * sc, (b.w * T - 4) * sc, 24 * sc).fill(0xffffff);
  }

  private nightAlpha(h: number) {
    const max = theme().nightMax; // capped by theme so alert cues in the world layer stay readable; UI layer is above this overlay
    if (h >= 8 && h < 18) return 0;
    if (h >= 18 && h < 21) return ((h - 18) / 3) * max;
    if (h >= 21 || h < 5) return max;
    return (1 - (h - 5) / 3) * max;
  }

  /** Tile x of every window (the board's neighbourhood is skipped). */
  private windows() {
    const l = this.l, out: number[] = [];
    for (let x = 3; x < l.cols - 4; x += 4) if (!(x + 2 > l.board.x - 1 && x < l.board.x + l.board.w + 1)) out.push(x);
    return out;
  }

  private shaftShift = 0;
  /** One static parallelogram of daylight per window; x leans with the sun, alpha follows daylight, amber at dawn/dusk. Redrawn on the 15-minute key. */
  private drawShafts(hour: number) {
    const nm = theme().nightMax;
    const day = nm > 0 ? 1 - this.nightAlpha(hour) / nm : hour >= 6 && hour < 19 ? 1 : 0;
    this.shaftDay = Math.max(0, Math.min(1, day));
    this.shafts.clear();
    this.shafts.visible = this.shaftDay > 0.02;
    if (!this.shafts.visible) return;
    const shift = this.shaftShift = (Math.max(0, Math.min(1, (hour - 7) / 11)) - 0.5) * 44;
    const color = hour < 8.5 || hour >= 16.5 ? 0xffb86a : 0xfff1c8;
    for (const x of this.windows()) {
      const wx = x * T, w = 2 * T;
      this.shafts.poly([wx, 26, wx + w, 26, wx + w + shift + 8, 76, wx + shift + 8, 76]).fill({ color, alpha: 0.07 * this.shaftDay });
    }
  }

  private drawSky(hour: number) {
    const { top, bottom, night } = skyAt(hour), day = hour >= 8 && hour < 17;
    this.dark = night;
    this.sky.clear();
    const l = this.l;
    for (const x of this.windows()) {
      const wx = x * T, w = 2 * T;
      this.sky.rect(wx - 2, 2, w + 4, 26).fill(0x2a263e);
      this.sky.rect(wx, 4, w, 11).fill(top).rect(wx, 15, w, 11).fill(bottom);
      if (night) for (let i = 0; i < 4; i++) this.sky.rect(wx + 4 + ((i * 9 + x * 3) % 24), 6 + ((i * 5) % 12), 1, 1).fill(0xffffff);
      if (day) this.sky.roundRect(wx + 6, 7, 10, 3, 1).fill(0xffffff);
      this.sky.rect(wx + T - 1, 4, 2, 22).fill(0x2a263e).rect(wx, 14, w, 2).fill(0x2a263e);
    }
  }

  private drawClock(d: Date) {
    const b = this.l.board, cx = (b.x + b.w + 1) * T + 4, cy = 14;
    const g = this.clock;
    g.clear().circle(cx, cy, 9).fill(0xf4f1ff).stroke({ width: 2, color: 0x2a263e });
    const m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60;
    const hand = (a: number, len: number, w: number) =>
      g.moveTo(cx, cy).lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len).stroke({ width: w, color: 0x2a263e });
    hand((h / 12) * Math.PI * 2, 4, 2);
    hand((m / 60) * Math.PI * 2, 6.5, 1);
  }
}
