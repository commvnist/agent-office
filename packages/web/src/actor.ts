import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { Tile } from "@agent-office/core";
import { personTex, emoteTex, toolIconTex, type Dir, type Emote, type Expr, type Look } from "./sprites.ts";
import { easeSpeed, fontPx, settings, stackBubbles, type BubbleBox } from "./settings.ts";
import { theme } from "./theme.ts";
import { HOP_MS, JITTER_MS, SQUASH_MS, cleanText, clampBox, hopPose, jitterX, popScale, quirkAt, squashY, stackLabels, statusOf, stepDrop, toolIcon, type Box, type Rect } from "./choreo.ts";
import { hash } from "./color.ts";

export const T = 16; // art pixels per tile
export const feet = (t: Tile) => ({ x: t.x * T + T / 2, y: t.y * T + T });
const SPEED = 3.4 * T; // art px / s

export type Step =
  | { k: "walk"; to: Tile }
  | { k: "say"; text: string; ms?: number; emote?: Emote; kind?: BubbleKind; badge?: Badge }
  | { k: "idle"; on: boolean }
  | { k: "wait"; ms: number }
  | { k: "face"; toward: { x: number; y: number } }
  | { k: "couch"; at: { x: number; y: number }; ms: number } // sit on a couch seat (feet at `at`), then step back
  | { k: "exit" };

export type BubbleKind = "say" | "tool" | "user" | "report" | "blocked";
/** Hook event type a bubble was derived from; only real (hook-derived) bubbles carry one. */
export type Badge = "prompt" | "delegate" | "report" | "tool" | "message" | "guess";
export type Alert = "waiting" | "blocked";
const BUBBLE_STYLE: Record<BubbleKind, { bg: number; fg: number; border: number }> = {
  say: { bg: 0xffffff, fg: 0x1d1b2b, border: 0x1d1b2b },
  report: { bg: 0xe6ffe9, fg: 0x143a1c, border: 0x1f6b33 },
  user: { bg: 0xdbe9ff, fg: 0x13294d, border: 0x2a5cb8 },
  tool: { bg: 0x2a2d3f, fg: 0xcfd6ff, border: 0x555b82 },
  blocked: { bg: 0xffe8e8, fg: 0x4d1010, border: 0xd32f2f },
};
const MONO = "ui-monospace, Menlo, Consolas, monospace";
const PERCH_MS = 240; // couch sit-down / stand-up slide
const GLANCE_MS = 700;
const WALK_STEP = 5; // art px per walk pose (6 poses = 30 px stride, ~93 ms each at walking speed): feet plant instead of sliding

/** Walkable floor in art px (B1 sets it after every relayout): name tags and bubbles are kept inside it. */
const all = new Set<Actor>(); // live actors, for neighbour glances
let floor: Rect | null = null;
export function setFloorBounds(r: Rect) { floor = r; }

/** Small event-type glyph in a chip on the bubble's top-left corner. */
function drawBadge(g: Graphics, b: Badge, fg: number, bg: number) {
  g.roundRect(-5, -6, 14, 14, 3).fill(fg);
  const s = { width: 1.5, color: bg };
  if (b === "prompt") g.moveTo(0, -2).lineTo(4, 1).lineTo(0, 4).stroke(s);
  else if (b === "delegate") g.moveTo(-1, 1).lineTo(6, 1).moveTo(3, -2).lineTo(6, 1).lineTo(3, 4).stroke(s);
  else if (b === "report") g.moveTo(-1, 1).lineTo(1, 4).lineTo(6, -2).stroke(s);
  else if (b === "guess") g.moveTo(0, -2).lineTo(5, -2).lineTo(5, 0).lineTo(2.5, 1.5).lineTo(2.5, 2.5).stroke(s).rect(2, 4, 1, 1).fill(bg); // "?"
  else if (b === "tool") g.rect(0, -2, 5, 5).stroke(s).moveTo(2.5, -3).lineTo(2.5, 5).stroke(s);
  else g.rect(-1, -2, 8, 6).stroke(s).moveTo(-1, -2).lineTo(3, 1).lineTo(7, -2).stroke(s);
}

let blank = false;
/** Stream-safe: new and live bubbles show an ellipsis instead of free text; the caller refreshes actors on change. */
export const setBubbleBlank = (b: boolean) => { const c = blank !== b; blank = b; return c; };
function makeBubble(text: string, kind: BubbleKind, badge?: Badge): Container {
  const st = BUBBLE_STYLE[kind];
  const small = kind === "tool";
  const t = new Text({
    text: blank ? "…" : cleanText(text),
    style: { fontFamily: MONO, fontSize: fontPx(small ? 10 : 12), fill: st.fg, wordWrap: true, wordWrapWidth: small ? 190 : 210, lineHeight: small ? 14 : 16 },
  });
  const pad = 7, w = Math.ceil(t.width) + pad * 2, h = Math.ceil(t.height) + pad * 2;
  const g = new Graphics();
  g.roundRect(0, 0, w, h, 6).fill(st.bg).stroke({ width: 2, color: st.border });
  g.poly([w / 2 - 6, h - 1, w / 2 + 6, h - 1, w / 2, h + 8]).fill(st.bg);
  g.moveTo(w / 2 - 6, h).lineTo(w / 2, h + 8).lineTo(w / 2 + 6, h).stroke({ width: 2, color: st.border });
  t.position.set(pad, pad);
  const c = new Container();
  c.addChild(g, t);
  if (badge) {
    const b = new Graphics(), ic = kind === "tool" ? toolIcon(text) : null;
    if (ic) { // tool family icon in the corner chip; the text stays for what the icon cannot say
      b.roundRect(-5, -6, 14, 14, 3).fill(st.border);
      const s = new Sprite(toolIconTex(ic));
      s.tint = st.bg; s.scale.set(1.5); s.position.set(-3.25, -4.25);
      c.addChild(b, s);
    } else { drawBadge(b, badge, st.border, st.bg); c.addChild(b); }
  }
  c.pivot.set(w / 2, h + 8);
  return c;
}

export class Actor {
  c = new Container(); // art-space: shadow + sprite + emote
  ui = new Container(); // screen-space: name tag + bubble (crisp text)
  sprite = new Sprite();
  emoteSprite = new Sprite();
  tag: Text;
  pos: { x: number; y: number };
  path: Tile[] = [];
  steps: Step[] = [];
  cur: Step | null = null;
  timer = 0;
  home: Tile | null;
  seated = true; // false for queue spots: stand there instead of sitting
  busyAt = 0;
  working = false;
  queued = false;
  gone = false;
  leaving = false;
  dir: Dir = "down";
  flip = false;
  frame = 0;
  frameT = 0;
  emote: { e: Emote; left: number } | null = null;
  speech: { node: Container; left: number; text: string; kind: BubbleKind; badge?: Badge; born: number } | null = null;
  toolBubble: { node: Container; left: number; text: string; born: number } | null = null;
  private hopMs = HOP_MS; // time since hopNow; HOP_MS = at rest
  private squashMs = SQUASH_MS; // time since squash(); SQUASH_MS = at rest
  private jitterMs = JITTER_MS; // time since jitter()
  get hop() { return this.hopMs < HOP_MS ? 1 : 0; }
  alert: Alert | null = null;
  idle = false;
  private t = 0; // last `now` seen in update
  get now() { return this.t; }
  private v = 0; // current walk speed (art px/s)
  private settle = 0; // 1 -> 0 arrival squash
  private perch: { from: { x: number; y: number }; t: number; ms: number; k: number } | null = null; // couch sit in progress; k 0..1 = how far seated
  private glanceMs = 0; // >0: seated head turn toward glanceFlip
  private glanceFlip = false;
  private nudge = 0; // 1 -> 0 chair pull-out slide
  private wasSitting = false;
  private ring = new Graphics(); // alert pulse, screen space (UI layer sits above the night overlay)
  private mark = new Graphics(); // hover / selection outline, screen space
  private glyph = new Sprite(); // enlarged alert emote, screen space
  private hover = false;
  private selected = false;
  private plateW = -1;
  private plateH = -1;
  private progOn = false;
  private edgeOn = false;
  private plate = new Graphics(); // dark backing behind the name tag, screen space
  private edge = new Graphics(); // off-screen alert arrow
  private prog = new Graphics(); // long tool call arc
  private sc = 1;
  private qpos = 0;
  private walked = 0; // art px travelled, drives the walk frame
  private drop = 0; // sit-down / stand-up body offset (0, 2, 5, 7)
  private dropT = 0;
  private h = 0; // id hash: desyncs breathing/quirks between people
  private emoteKey = "";
  private emoteBorn = 0;
  low = false; // LOD: see setLod
  private pip = new Graphics(); // LOD status pip, screen space
  demoted = false; // tag swapped for the pip because the floor was too crowded
  private headPip = { x: 0, y: 0 };
  private pipKey = "";
  private flr: Rect = { x: 0, y: 0, w: 0, h: 0 }; // floor bounds in screen px, valid when `floor` is set
  private hits: number[] = []; // recent tool-event times, drives typing speed
  stale = false; // no activity for a while: desaturate (#101)
  yielding = false; // main.ts: hold still for a walker ahead (#116)
  toolSince = 0; // start of the tool call in flight, 0 = none
  private glitchAt = 0; // wall ms of the last tag glitch (120ms jitter + chromatic tint)

  constructor(
    public id: string,
    public label: string,
    public look: Look,
    public lead: boolean,
    spawn: Tile,
    home: Tile | null,
    private route: (from: Tile, to: Tile) => Tile[],
    public door: Tile,
    world: Container,
    uiLayer: Container,
  ) {
    all.add(this);
    this.home = home;
    this.h = hash(id);
    this.pos = feet(spawn);
    const shadow = new Graphics().ellipse(0, -1, 6, 2.5).fill({ color: 0x000000, alpha: 0.28 });
    this.sprite.anchor.set(0.5, 1);
    this.emoteSprite.anchor.set(0.5, 1);
    this.c.addChild(shadow, this.sprite, this.emoteSprite);
    this.c.eventMode = "static";
    this.c.cursor = "pointer";
    // hit box padded by ~8 screen px so it stays grabbable at fit zoom (#117)
    this.c.hitArea = { contains: (x: number, y: number) => { const p = 8 / this.sc; return x > -12 - p && x < 12 + p && y > -30 - p && y < 4 + p; } };
    world.addChild(this.c);
    this.tag = new Text({ text: label, style: { fontFamily: MONO, fontSize: fontPx(11), fill: 0xffffff, stroke: { color: 0x0e0d16, width: 3 } } });
    this.tag.anchor.set(0.5, 0);
    this.glyph.anchor.set(0.5, 1);
    this.glyph.texture = emoteTex("exclaim");
    this.ring.visible = this.mark.visible = this.glyph.visible = false;
    this.pip.visible = false;
    this.ui.addChild(this.ring, this.mark, this.prog, this.glyph, this.edge, this.plate, this.tag, this.pip);
    uiLayer.addChild(this.ui);
  }

  tile(): Tile {
    return { x: Math.floor(this.pos.x / T), y: Math.floor((this.pos.y - 1) / T) };
  }
  get sitting() {
    return this.seated && !!this.home && !this.cur && !this.path.length && !this.leaving && this.atHome();
  }
  atHome() {
    if (!this.home) return false;
    const t = this.tile();
    return t.x === this.home.x && t.y === this.home.y;
  }

  setLabel(s: string) {
    if (this.label !== s) { this.label = s; this.refreshTag(); }
  }
  /** "! " prefix for blocked and " (idle)" suffix keep state readable without colour. */
  private refreshTag() {
    const lines = this.label.split("\n").map((l) => (l.length > 24 ? l.slice(0, 23) + "…" : l)); // labels are clipped so tags stay short (#F1)
    const q = this.queued && this.qpos ? ` #${this.qpos}` : "";
    this.tag.text = `${this.alert === "blocked" ? "! " : ""}${lines.join("\n")}${q}${this.idle ? " (idle)" : ""}`;
    this.tag.style.fill = this.alert === "blocked" ? 0xff8a80 : 0xffffff;
  }
  /** Queue ordinal chip (#112): 0 clears. */
  setQueuePos(n: number) {
    if (this.qpos !== n) { this.qpos = n; this.refreshTag(); }
  }
  /** Record a tool event; typing speeds up with the recent rate (#103). */
  hit(t: number) {
    this.hits.push(t);
    if (this.hits.length > 12) this.hits.shift();
  }
  /** Recent tool-event times (follow mode ranks agents by them). */
  get recentHits(): readonly number[] { return this.hits; }
  /** Re-apply settings.textScale to the tag and any live bubbles. */
  refreshText() {
    this.tag.style.fontSize = fontPx(11);
    if (this.speech) { const o = this.speech; o.node.destroy({ children: true }); o.node = makeBubble(o.text, o.kind, o.badge); this.ui.addChild(o.node); }
    if (this.toolBubble) { const o = this.toolBubble; o.node.destroy({ children: true }); o.node = makeBubble(o.text, "tool", "tool"); this.ui.addChild(o.node); }
  }
  /** Pulsing ring + large distinct glyph (waiting = "!", blocked = flag + red "! " tag). null clears. Persists while leaving. */
  setAlert(a: Alert | null) {
    if (this.alert === a) return;
    this.alert = a;
    this.ring.clear();
    if (a) {
      const col = Number.parseInt(theme().alert[a].slice(1), 16);
      this.ring.ellipse(0, 0, 13, 17).stroke({ width: 3, color: col });
      this.glyph.texture = emoteTex(a === "blocked" ? "flag" : "exclaim");
    }
    this.ring.visible = this.glyph.visible = !!a;
    this.refreshTag();
  }
  setHover(b: boolean) { this.hover = b; this.drawMark(); }
  setSelected(b: boolean) { this.selected = b; this.drawMark(); }
  private drawMark() {
    this.mark.clear();
    this.mark.visible = this.hover || this.selected;
    if (this.mark.visible) this.mark.ellipse(0, 0, 11, 15).stroke({ width: this.selected ? 3 : 2, color: this.selected ? 0xffffff : 0x9ad7f5 });
  }
  /** Labeled idle ambient visit: walk to `to`, linger, return home. No speech; main.ts decides when. */
  idleStroll(to: Tile, ms: number, toward?: { x: number; y: number }, couch?: { x: number; y: number }) {
    // face the couch/coffee machine on arrival; otherwise the walk direction leaves them staring at a wall
    const stay: Step = couch ? { k: "couch", at: couch, ms } : { k: "wait", ms };
    this.queue({ k: "idle", on: true }, { k: "walk", to }, ...(toward ? [{ k: "face" as const, toward }] : []), stay, { k: "idle", on: false });
  }
  /** True while a couch sit is walking up, in progress, or still queued. */
  get perching() {
    return this.cur?.k === "couch" || this.steps.some((s) => s.k === "couch");
  }
  /** A seated neighbour within 2 tiles spoke or hopped: glance at it, at most once per 4s. */
  private noise() {
    if (!this.sitting) return;
    for (const o of all) {
      if (o === this || !o.sitting || this.t - o.nbrAt < 4000 || Math.hypot(o.pos.x - this.pos.x, o.pos.y - this.pos.y) > 2 * T) continue;
      if (o.glance(this.pos.x)) o.nbrAt = this.t;
    }
  }
  private nbrAt = -1e9;
  /** Brief seated head turn toward world x; ignored when standing, mid-transition or under reduced motion. Returns whether it started. */
  glance(x: number) {
    if (settings.reducedMotion || !this.sitting || this.drop !== 7) return false;
    this.glanceMs = GLANCE_MS;
    this.glanceFlip = x < this.pos.x;
    return true;
  }
  setHome(t: Tile | null, seated = true) {
    this.home = t;
    this.seated = seated;
  }
  queue(...s: Step[]) {
    this.steps.push(...s);
  }
  /** Drop pending visits (not the one in progress) so a burst of events cannot build a long walk backlog. */
  trim(max: number) {
    if (this.steps.length > max) this.steps.length = max;
  }
  lookToward(p: { x: number; y: number }) {
    const dx = p.x - this.pos.x, dy = p.y - this.pos.y;
    if (Math.abs(dx) > Math.abs(dy) + 2) { this.dir = "side"; this.flip = dx < 0; }
    else this.dir = dy < -4 ? "up" : "down";
  }
  showEmote(e: Emote, ms = 1600) {
    this.emote = { e, left: ms };
  }
  speak(text: string, kind: BubbleKind, ms: number, badge?: Badge) {
    this.speech?.node.destroy({ children: true });
    const node = makeBubble(text, kind, badge);
    this.ui.addChild(node);
    this.speech = { node, left: ms, text, kind, badge, born: this.t };
    this.noise();
  }
  tool(text: string) {
    if (this.toolBubble?.text === text) { this.toolBubble.left = 2600; return; }
    this.toolBubble?.node.destroy({ children: true });
    const node = makeBubble(text, "tool", "tool");
    this.ui.addChild(node);
    this.toolBubble = { node, left: 2600, text, born: this.t };
  }
  hopNow() {
    if (settings.reducedMotion) return;
    this.hopMs = 0;
    this.noise();
  }
  /** Short landing squash (arrival, task done). */
  squash() {
    if (!settings.reducedMotion) this.squashMs = 0;
  }
  /** 120ms tag glitch (2px jitter + cyan/magenta tint); the caller skips it under reduced motion. */
  glitch() { if (!settings.reducedMotion) this.glitchAt = Date.now(); }
  /** 400ms red-alert shake of the sprite (error). */
  jitter() {
    if (!settings.reducedMotion) this.jitterMs = 0;
  }
  /** Zoomed out: hide the name tag and tool bubbles, show a status pip (shape differs per state, not just colour). */
  setLod(low: boolean) {
    if (this.low === low) return;
    this.low = low;
    this.tag.visible = this.plate.visible = !low;
    this.pip.visible = low;
    this.demoted = false;
  }
  private drawPip(r: number) {
    const s = statusOf({ blocked: this.alert === "blocked", waiting: this.alert === "waiting", queued: this.queued, working: this.working, active: false });
    const key = `${s}${r}`;
    if (key === this.pipKey) return;
    this.pipKey = key;
    const g = this.pip.clear(), rim = { width: 1.5, color: 0x0e0d16 };
    if (s === "working") g.circle(0, 0, r).fill(0x4ade80).stroke(rim); // dot
    else if (s === "waiting") g.circle(0, 0, r + 1).fill(0xffd84a).stroke(rim).rect(-0.8, -r * 0.7, 1.6, r * 0.8).fill(0x1d1b2b).rect(-0.8, r * 0.3, 1.6, 1.6).fill(0x1d1b2b); // "!"
    else if (s === "blocked") g.circle(0, 0, r + 1).fill(0xff4a4a).stroke(rim).moveTo(-r * 0.5, -r * 0.5).lineTo(r * 0.5, r * 0.5).moveTo(r * 0.5, -r * 0.5).lineTo(-r * 0.5, r * 0.5).stroke({ width: 1.5, color: 0xffffff }); // x
    else if (s === "queued") g.rect(-r, -r, r * 2, r * 2).fill(0xffffff).stroke(rim); // square
    else g.circle(0, 0, r).stroke({ width: 2, color: 0xaab0c8 }); // ring
  }

  update(dt: number, now: number) {
    const ms = dt * 1000;
    this.t = now;
    // --- script
    if (!this.cur && !this.path.length) {
      this.cur = this.steps.shift() ?? null;
      const s = this.cur;
      if (s?.k === "walk") { this.path = this.route(this.tile(), s.to); this.cur = this.path.length ? s : null; }
      else if (s?.k === "exit") { this.path = this.route(this.tile(), this.door); this.cur = { k: "exit" }; }
      else if (s?.k === "say") {
        const len = s.text.length;
        this.timer = s.ms ?? Math.min(7500, Math.max(2200, 1500 + len * 55));
        this.speak(s.text, s.kind ?? "say", this.timer, s.badge);
        if (s.emote) this.showEmote(s.emote, 1200);
      } else if (s?.k === "idle") { this.idle = s.on; this.refreshTag(); this.cur = null; }
      else if (s?.k === "wait") this.timer = s.ms;
      else if (s?.k === "couch") {
        const near = Math.hypot(s.at.x - this.pos.x, s.at.y - this.pos.y) <= T * 1.6; // walk was unreachable: do not teleport onto the couch
        this.perch = near ? { from: { ...this.pos }, t: 0, ms: s.ms, k: 0 } : null;
        if (!near) this.cur = null;
      }
      else if (s?.k === "face") { this.lookToward(s.toward); this.timer = 250; this.cur = { k: "wait", ms: 250 }; }
      else if (!s && this.home && !this.atHome()) {
        const p = this.route(this.tile(), this.home);
        if (p.length) this.path = p;
        else this.pos = feet(this.home); // unreachable: snap rather than re-run BFS every frame
      }
    }
    // --- move
    let moving = false;
    const next = this.path[0];
    if (next && this.yielding) { /* hold for the walker ahead */ }
    else if (next) {
      const to = feet(next), dx = to.x - this.pos.x, dy = to.y - this.pos.y, d = Math.hypot(dx, dy);
      // ease in/out over the path (constant speed under reduced motion)
      this.v = settings.reducedMotion ? SPEED : easeSpeed(this.v || SPEED * 0.25, d + (this.path.length - 1) * T, dt, SPEED);
      const m = this.v * dt;
      moving = true;
      if (Math.abs(dx) > Math.abs(dy)) { this.dir = "side"; this.flip = dx < 0; } else this.dir = dy < 0 ? "up" : "down";
      this.walked += Math.min(m, d);
      if (d <= m) { this.pos = to; this.path.shift(); } else { this.pos.x += (dx / d) * m; this.pos.y += (dy / d) * m; }
      if (!this.path.length && this.cur?.k === "walk") this.cur = null;
    } else if (this.cur?.k === "exit") {
      this.gone = true;
    } else if (this.cur?.k === "couch" && this.perch) {
      const p = this.perch, at = this.cur.at;
      p.t += ms;
      if (this.working && p.t >= PERCH_MS && p.t < PERCH_MS + p.ms) p.ms = p.t - PERCH_MS; // real work arrived: get up now
      p.k = settings.reducedMotion ? 1 : Math.max(0, Math.min(1, p.t < PERCH_MS + p.ms ? p.t / PERCH_MS : 1 - (p.t - PERCH_MS - p.ms) / PERCH_MS));
      this.pos = { x: p.from.x + (at.x - p.from.x) * p.k, y: p.from.y + (at.y - p.from.y) * p.k };
      if (p.t >= PERCH_MS * 2 + p.ms) { this.pos = p.from; this.perch = null; this.cur = null; }
    } else if (this.cur && (this.cur.k === "say" || this.cur.k === "wait")) {
      this.timer -= ms;
      if (this.timer <= 0) this.cur = null;
    }
    if (!moving && this.v && !this.yielding) { this.v = 0; if (!settings.reducedMotion) this.settle = 1; } // arrival squash
    // --- pose
    const sit = !moving && this.sitting;
    const pc = this.perch;
    if (sit || pc) this.dir = "down", this.flip = false;
    if (sit && !this.wasSitting && !settings.reducedMotion) { this.nudge = 1; this.settle = 0.8; } // chair pull-out, then a small settle into the seat
    this.wasSitting = sit;
    const still = settings.reducedMotion;
    // sit-down / stand-up: body steps 2, 5, 7px over ~150ms instead of one snap
    const target = sit ? 7 : 0;
    if (still) this.drop = target;
    else if (this.drop !== target) { if ((this.dropT += ms) >= 50) { this.dropT = 0; this.drop = stepDrop(this.drop, target); } }
    else this.dropT = 0;
    const seated = sit && this.drop === 7;
    this.frameT += ms;
    let recent = 0;
    for (const h of this.hits) if (now - h < 30_000) recent++;
    const period = seated && this.working && !still ? Math.max(80, 170 - recent * 12) : 600;
    if (moving) this.frame = Math.floor(this.walked / WALK_STEP); // distance-locked: feet plant
    else if (this.frameT > period) { this.frameT = 0; this.frame++; }
    const standing = !moving && !sit && !pc && this.drop === 0;
    const glancing = seated && this.glanceMs > 0;
    if (this.glanceMs > 0) this.glanceMs -= ms;
    // idle fidget only after a quiet spell, never during alerts, emotes or speech
    const calm = !moving && !still && !settings.ambientPaused && !this.alert && !this.working && !this.emote && !this.speech && now - this.busyAt > 6000;
    const quirk = calm ? quirkAt(now, this.h) : null;
    const expr: Expr = this.alert === "blocked" ? "stuck" : this.alert === "waiting" ? "worry"
      : this.emote?.e === "check" || this.emote?.e === "heart" ? "happy" : quirk ?? (seated && this.working ? "focus" : "neutral");
    const last = this.hits[this.hits.length - 1] ?? -1e9;
    const pose = pc ? (pc.k >= 1 ? "couch" : "walk") : glancing ? "sit-glance" : seated ? (this.working ? "sit" : "sit-think") : "walk";
    this.sprite.texture = personTex(this.look, glancing ? "side" : this.dir, pose, moving || (seated && this.working && !still) ? this.frame : 0, {
      expr,
      drop: pc ? (pc.k < 0.5 ? 2 : 5) : seated ? 0 : this.drop,
      lift: standing && !still && !settings.ambientPaused && !quirk && Math.floor((now + this.h) / 500) % 2 === 1, // breathing beat, phase by id
      dip: seated && this.working && !still && now - last < 90, // head dips on each tool hit
      think: glancing && !this.working, // the glance turns the head only; arms keep the think pose
    });
    const ls = this.lead ? 1.08 : 1;
    this.sprite.scale.x = (glancing ? this.glanceFlip : this.flip) ? -ls : ls;
    this.sprite.tint = this.stale ? 0x8a8a9c : 0xffffff;
    // fade in/out near the door (#110); sitting agents are never dimmed
    const dd = Math.hypot(this.pos.x - feet(this.door).x, this.pos.y - feet(this.door).y);
    this.c.alpha = settings.reducedMotion || this.sitting ? 1 : Math.min(1, 0.2 + dd / (2 * T));
    if (this.hopMs < HOP_MS) this.hopMs += ms;
    if (this.squashMs < SQUASH_MS) this.squashMs += ms;
    if (this.jitterMs < JITTER_MS) this.jitterMs += ms;
    this.settle = Math.max(0, this.settle - dt * 6);
    this.nudge = Math.max(0, this.nudge - dt * 4);
    const hp = hopPose(this.hopMs);
    this.sprite.x = (standing && !still && !settings.ambientPaused && (now + this.h * 7) % 5000 < 240 ? 1 : 0) + jitterX(this.jitterMs); // occasional weight shift + error jitter
    this.sprite.y = hp.y - this.nudge * 3; // up = away from the desk below
    this.sprite.scale.y = ls * hp.sy * squashY(this.squashMs) * (1 - 0.1 * Math.sin(this.settle * Math.PI));
    this.c.position.set(Math.round(this.pos.x), Math.round(this.pos.y));
    this.c.zIndex = this.pos.y + (pc ? 2 : 0); // on the couch: above its back and cushions (sorted at its bottom edge)
    // --- emote: explicit one wins, else thinking dots while seated and idle, else waiting-in-line
    if (this.emote && (this.emote.left -= ms) <= 0) this.emote = null;
    let e: Emote | null = this.emote?.e ?? null;
    if (!e && sit && !this.working) e = (still || settings.ambientPaused ? "dots1" : `dots${Math.floor(now / 350) % 3}`) as Emote;
    if (!e && this.queued && !moving) e = "question";
    const ek = e ? (e.startsWith("dots") ? "dots" : e) : "";
    if (ek !== this.emoteKey) { this.emoteKey = ek; this.emoteBorn = now; }
    if (e) {
      this.emoteSprite.texture = emoteTex(e);
      this.emoteSprite.visible = true;
      this.emoteSprite.y = sit ? -17 : pc && pc.k >= 1 ? -21 : -25;
      this.emoteSprite.scale.set(still ? 1 : popScale(now - this.emoteBorn));
    } else this.emoteSprite.visible = false;
    // --- bubbles
    if (this.speech && (this.speech.left -= ms) <= 0) { this.speech.node.destroy({ children: true }); this.speech = null; }
    if (this.toolBubble && (this.toolBubble.left -= ms) <= 0) { this.toolBubble.node.destroy({ children: true }); this.toolBubble = null; }
  }

  /** Position the crisp text overlay using the world's current transform. */
  syncUi(ox: number, oy: number, sc: number, view?: { w: number; h: number; top: number }) {
    this.sc = sc;
    // neighbouring desks stagger their tool bubbles so they do not sit on top of each other
    const stagger = this.sitting ? (Math.round(this.pos.x / (T * 2)) % 2) * 26 : 0;
    const sx = ox + this.pos.x * sc, sy = oy + this.pos.y * sc;
    // seated: tag goes under the desk tile so it never covers the desk or the person
    this.tag.position.set(sx, sy + 3 + (this.sitting ? T * sc : 0));
    const gl = this.glitchAt ? Date.now() - this.glitchAt : 1e9;
    if (gl < 120) { this.tag.x += Math.floor(gl / 30) % 2 ? 2 : -2; this.tag.tint = Math.floor(gl / 40) % 2 ? 0x00f0ff : 0xff2bd6; }
    else if (this.tag.tint !== 0xffffff) this.tag.tint = 0xffffff;
    if (floor) { this.flr.x = ox + floor.x * sc; this.flr.y = oy + floor.y * sc; this.flr.w = floor.w * sc; this.flr.h = floor.h * sc; this.clampTag(); }
    const couched = !!this.perch && this.perch.k >= 1; // lounging: head sits ~4px lower than standing
    const headY = sy - (this.sitting ? 20 : couched ? 24 : 28) * sc - 6;
    const toolY = headY - stagger;
    // 120ms pop-in, 150ms fade-out (#109)
    const fade = (b: { left: number; born: number }) => (settings.reducedMotion ? 1 : Math.max(0, Math.min(1, (this.t - b.born) / 120, b.left / 150)));
    if (this.speech) {
      this.speech.node.position.set(sx, headY);
      this.speech.node.alpha = fade(this.speech);
      this.speech.node.scale.set(settings.reducedMotion ? 1 : popScale(this.t - this.speech.born));
    }
    this.headPip.x = sx; this.headPip.y = headY + 4;
    if (this.low) { this.drawPip(Math.max(3, sc * 2)); this.pip.position.set(sx, headY + 4); }
    if (this.toolBubble) {
      this.toolBubble.node.visible = !this.speech && !this.low;
      this.toolBubble.node.alpha = fade(this.toolBubble);
      this.toolBubble.node.position.set(sx, toolY);
    }
    // rings + alert glyph live in screen space so the night overlay never dims them
    const pulse = this.alert && !settings.reducedMotion ? 1 + 0.1 * Math.sin(this.t / 160) : 1;
    this.ring.position.set(sx, sy - 12 * sc);
    this.ring.scale.set(sc * pulse);
    this.mark.position.set(sx, sy - 12 * sc);
    this.mark.scale.set(sc);
    const gs = Math.max(2, sc * 1.6);
    this.glyph.scale.set(gs);
    this.glyph.position.set(sx + 14 * sc, sy - (this.sitting ? 18 : couched ? 22 : 26) * sc);
    // arc for a tool call that has been running a while: busy, not hung (#114)
    const el = this.toolSince ? this.t - this.toolSince : 0;
    if (this.progOn) { this.prog.clear(); this.progOn = false; }
    if (el > 8000) {
      this.progOn = true;
      this.prog.position.set(sx, sy - 12 * sc);
      this.prog.arc(0, 0, 17 * sc, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, el / 300_000)).stroke({ width: 2, color: 0x7fe3ff });
    }
    // off-screen alert: arrow on the nearest viewport edge in the alert colour (#104)
    if (this.edgeOn) { this.edge.clear(); this.edgeOn = false; }
    if (view && this.alert && (sx < 0 || sx > view.w || sy < view.top || sy > view.h)) {
      this.edgeOn = true;
      const ex = Math.max(14, Math.min(view.w - 14, sx)), ey = Math.max(view.top + 14, Math.min(view.h - 14, sy));
      this.edge.position.set(ex, ey);
      this.edge.rotation = Math.atan2(sy - ey, sx - ex);
      this.edge.poly([10, 0, -6, -8, -6, 8]).fill(Number.parseInt(theme().alert[this.alert].slice(1), 16)).stroke({ width: 1.5, color: 0x0e0d16 });
    }
  }

  private clampTag() {
    const p = clampBox({ x: this.tag.x, y: this.tag.y, w: this.tag.width, h: this.tag.height }, this.flr);
    this.tag.position.set(p.x, p.y);
  }
  /** True when the centred box overlaps this actor's visible selection/hover/alert ring (ellipse bbox, 13x17 world px). */
  ringHits(cx: number, cy: number, w: number, h: number) {
    if (!this.mark.visible && !this.ring.visible) return false;
    return Math.abs(this.mark.x - cx) * 2 < w + 26 * this.sc && Math.abs(this.mark.y - cy) * 2 < h + 34 * this.sc;
  }
  /** Screen-space floor rect after syncUi, or null when no floor bounds are set. */
  floorPx(): Rect | null { return floor ? this.flr : null; }

  /** Screen-space box of the name tag after syncUi (for label stacking); alerts keep their place. */
  tagBox(): Box {
    return { x: this.tag.x, y: this.tag.y, w: this.tag.width, h: this.tag.height, pri: this.alert ? 1 : 0 };
  }
  /** Apply a stacking offset and redraw the dark backing plate (#F3). */
  placeTag(dy: number, hide = false) {
    if (hide !== this.demoted) { // no room in the floor: status pip instead of an overlapping tag
      this.demoted = hide;
      this.tag.visible = this.plate.visible = !hide;
      this.pip.visible = hide;
    }
    if (hide) { this.drawPip(Math.max(3, this.sc * 2)); this.pip.position.set(this.headPip.x, this.headPip.y); return; }
    this.tag.y += dy;
    if (floor) this.clampTag();
    const w = this.tag.width, h = this.tag.height;
    if (w !== this.plateW || h !== this.plateH) { // re-tessellate only when the text box changes size
      this.plateW = w; this.plateH = h;
      this.plate.clear().roundRect(0, 0, w + 6, h + 2, 3).fill({ color: 0x0e0d16, alpha: 0.66 });
    }
    this.plate.position.set(this.tag.x - w / 2 - 3, this.tag.y - 1);
  }

  destroy() {
    all.delete(this);
    this.c.destroy({ children: true });
    this.ui.destroy({ children: true });
  }
}

// per-frame scratch, reused so the ticker does not allocate arrays for the layout
const bubbleBoxes: BubbleBox[] = [];
const bubbleNodes: { node: Container | null; fade: number; fl: Rect | null }[] = []; // node null = a name tag, an obstacle only
const tagList: Actor[] = [];
const tagBoxes: Box[] = [];
const hidden: boolean[] = [];

function addBubble(a: Actor, b: { node: Container; born: number } | null, tool: boolean, zone: string) {
  if (!b || !b.node.visible || b.node.destroyed) return;
  bubbleNodes.push({ node: b.node, fade: b.node.alpha, fl: a.floorPx() });
  bubbleBoxes.push({ x: b.node.x, y: b.node.y, w: b.node.width, h: b.node.height, prio: tool ? 1 : 2, age: a.now - b.born, zone, tool });
}

/**
 * Stack overlapping speech/tool bubbles (speech > tool), fade displaced ones and cap tool bubbles per ~6-tile zone.
 * Name tags are fixed obstacles: bubbles shift up clear of them. Call after layoutTags and every actor.syncUi in a frame;
 * syncUi resets positions/alpha, so skipping this keeps the old behaviour.
 */
export function layoutBubbles(actors: Iterable<Actor>, view?: { w: number; h: number; top: number }) {
  bubbleBoxes.length = 0;
  bubbleNodes.length = 0;
  for (const a of actors) {
    const zone = String(Math.floor(a.pos.x / (6 * T)));
    addBubble(a, a.speech, false, zone);
    addBubble(a, a.toolBubble, true, zone);
    if (a.low || a.demoted) continue; // no tag on screen, nothing to avoid
    const tb = a.tagBox(); // prio 3: tags place first and never move; box y is the bottom edge here
    bubbleBoxes.push({ x: tb.x, y: tb.y + tb.h, w: tb.w, h: tb.h, prio: 3, age: 0, zone, tool: false });
    bubbleNodes.push({ node: null, fade: 1, fl: null });
  }
  // shortcut: O(n^2) overlap scan per frame, fine for dozens of bubbles; use a grid if actors reach hundreds
  const res = stackBubbles(bubbleBoxes);
  res.forEach((r, i) => {
    const n = bubbleNodes[i].node;
    if (!n) return;
    const bx = bubbleBoxes[i];
    n.y = r.y;
    n.alpha = r.alpha * bubbleNodes[i].fade;
    n.visible = r.visible;
    const fl = bubbleNodes[i].fl;
    if (fl) { const p = clampBox({ x: n.x, y: n.y - bx.h, w: bx.w, h: bx.h }, fl); n.x = p.x; n.y = p.y + bx.h; } // kept inside the floor after stacking
    if (view) { // keep inside the canvas and below the top HUD (#108/#F3)
      n.y = Math.max(n.y, view.top + 4 + bx.h);
      n.x = Math.max(bx.w / 2 + 2, Math.min(view.w - bx.w / 2 - 2, n.x));
    }
  });
}

/** True when the centred box (cx, cy, w, h) overlaps a placed name tag or an actor's ring; valid after layoutTags. No allocation. */
export function tagHits(cx: number, cy: number, w: number, h: number): boolean {
  for (const a of all) if (a.ringHits(cx, cy, w, h)) return true;
  for (const a of tagList) {
    const t = a.tag;
    if (t.visible && Math.abs(t.x - cx) * 2 < t.width + w && t.y < cy + h / 2 && t.y + t.height > cy - h / 2) return true;
  }
  return false;
}

/** Push overlapping name tags apart and draw their backing plates (#F1); returns how many were displaced. Call after every syncUi in a frame, before layoutBubbles. */
export function layoutTags(actors: Iterable<Actor>): number {
  tagList.length = 0;
  tagBoxes.length = 0;
  for (const a of actors) if (!a.low) { tagList.push(a); tagBoxes.push(a.tagBox()); }
  hidden.length = 0;
  hidden.length = tagList.length; hidden.fill(false);
  const dy = stackLabels(tagBoxes, tagList[0]?.floorPx() ?? undefined, hidden);
  let displaced = 0;
  for (let i = 0; i < tagList.length; i++) { tagList[i].placeTag(dy[i], hidden[i]); if (dy[i]) displaced++; }
  return displaced; // main.ts: heavy stacking switches the crowd to pips
}
