import { Container, Graphics, Sprite, Text } from "pixi.js";
import { TILE_PX, type Tile } from "@agent-office/core";
import { dev } from "./snap.ts";
import { personTex, emoteTex, ringTex, arcTex, ARC_STEPS, toolIconTex, badgeIconTex, pipTex, PIP, type Dir, type Emote, type Expr, type Look } from "./sprites.ts";
import { easeSpeed, fontPx, REF_SC, settings, stackBubbles, textZoom, type BubbleBox } from "./settings.ts";
import { KEY, STATUS, theme } from "./theme.ts";
import { HOP_MS, JITTER_MS, SQUASH_MS, cleanText, clampBox, hopPose, idleTier, jitterX, microPose, microSlot, sipState, popScale, quirkAt, squashY, stackLabels, statusOf, stepDrop, type Status, toolIcon, type Box, type Rect } from "./choreo.ts";
import { hash } from "./color.ts";

export const T = TILE_PX; // art pixels per tile
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
/** What a waiting lead waits for: a permission prompt (act now) or the end of its turn (your move). */
export type WaitKind = "permission" | "turn";
const BUBBLE_STYLE: Record<BubbleKind, { bg: number; fg: number; border: number }> = {
  say: { bg: 0xe4e0d4, fg: 0x1d1b2b, border: 0x1d1b2b }, // a paper tint, not pure white: white is for lights and text (R6)
  report: { bg: 0xe6ffe9, fg: 0x143a1c, border: 0x1f6b33 },
  user: { bg: 0xdbe9ff, fg: 0x13294d, border: 0x2a5cb8 },
  tool: { bg: 0x2a2d3f, fg: 0xcfd6ff, border: 0x555b82 },
  blocked: { bg: 0xffe8e8, fg: 0x4d1010, border: 0xd32f2f },
};
const MONO = "ui-monospace, Menlo, Consolas, monospace";
/** Dark outline for in-scene text: its width scales like the font (`base` is the width at the reference zoom), round joins (R3). */
export const outline = (base: number) => ({ color: KEY.env[0], width: fontPx(base), join: "round" as const });
const hexN = (h: string) => Number.parseInt(h.slice(1), 16);
const PERCH_MS = 240; // couch sit-down / stand-up slide
const GLANCE_MS = 700;
const WALK_STEP = 5; // art px per walk pose (6 poses = 30 px stride, ~93 ms each at walking speed): feet plant instead of sliding

/** Walkable floor in art px (B1 sets it after every relayout): name tags and bubbles are kept inside it. */
const all = new Set<Actor>(); // live actors, for neighbour glances
let floor: Rect | null = null;
export function setFloorBounds(r: Rect) { floor = r; }

let blank = false;
/** Stream-safe: new and live bubbles show an ellipsis instead of free text; the caller refreshes actors on change. */
export const setBubbleBlank = (b: boolean) => { const c = blank !== b; blank = b; return c; };
function makeBubble(text: string, kind: BubbleKind, badge?: Badge): Container {
  const st = BUBBLE_STYLE[kind];
  const small = kind === "tool";
  // Sized in art px (a tile is 16), converted with the scene zoom like every in-scene text, so a bubble keeps one size
  // relative to the figures: 72 art px wide (4.5 tiles) for speech, 64 for a tool; text ~5 art px. Long narration is clipped
  // here (the feed and the card keep it whole), so a bubble stays a few lines tall.
  const u = textZoom.k, A = REF_SC * u; // screen px per art px at this zoom
  const t = new Text({
    text: blank ? "…" : cleanText(text, small ? 60 : 110),
    style: { fontFamily: MONO, fontSize: fontPx(small ? 10 : 12), fill: st.fg, wordWrap: true, wordWrapWidth: Math.round((small ? 64 : 72) * A), lineHeight: Math.round((small ? 14 : 16) * u) },
  });
  // radius, stroke, tail and chip follow the text zoom in whole pixels (an even stroke stays on the pixel grid when centred)
  const k = Math.max(1, Math.round(1.5 * u)), m = Math.max(1, Math.round(2 * u)), o = Math.round(5 * u), chip = 7 * k + 2 * m;
  const pad = Math.round(7 * u), padL = badge ? Math.max(pad, chip - o + Math.round(3 * u)) : pad; // text starts past the corner chip, never under it (R7)
  const w = Math.ceil(t.width) + padL + pad, h = Math.ceil(t.height) + pad * 2;
  const sw = 2 * Math.max(1, Math.round(u)), tw = Math.max(3, Math.round(6 * u)), th = Math.max(4, Math.round(8 * u)), cx = Math.round(w / 2);
  const g = new Graphics();
  g.roundRect(0, 0, w, h, Math.max(2, Math.round(6 * u))).fill(st.bg).stroke({ width: sw, color: st.border });
  g.poly([cx - tw, h - sw / 2, cx + tw, h - sw / 2, cx, h + th]).fill(st.bg);
  g.moveTo(cx - tw, h).lineTo(cx, h + th).lineTo(cx + tw, h).stroke({ width: sw, color: st.border });
  t.position.set(padL, pad);
  const c = new Container();
  c.addChild(g, t);
  if (badge) { // corner chip: a square plate with a 7x7 pixel glyph at a whole-number scale (tool family icon, else the event type)
    const ic = kind === "tool" ? toolIcon(text) : null;
    const b = new Graphics().rect(-o, -o, chip, chip).fill(st.border);
    const s = new Sprite(ic ? toolIconTex(ic) : badgeIconTex(badge));
    s.tint = st.bg; s.scale.set(k); s.position.set(m - o, m - o);
    c.addChild(b, s);
  }
  c.pivot.set(cx, h + th);
  return c;
}

/** Status pip sprite scale for a pip of radius r screen px: a whole number, so the 9x9 pixel pip never resamples. */
export const pipScale = (r: number) => Math.max(1, Math.round((2 * r) / PIP));
/** Point a pip sprite (anchor centred) at the texture for status `s`, at a whole-number scale for radius r. */
export function setPip(sp: Sprite, s: Status, waitKind: WaitKind, r: number): Sprite {
  sp.texture = pipTex(s, waitKind);
  sp.anchor.set(0.5);
  sp.scale.set(pipScale(r));
  return sp;
}
/** Centre a pip sprite near (x, y) with its top-left corner on a whole pixel (its side is 9 x scale, often odd). */
export function placePip(sp: Sprite, x: number, y: number) {
  const w = sp.width;
  sp.position.set(dev(x - w / 2) + w / 2, dev(y - w / 2) + w / 2);
}

/** Fixed screen boxes (x = centre, y = top) that name tags and bubbles must keep clear of: the session badges (main.ts fills it per frame). */
export const obstacles: Box[] = [];

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
  thinking = true; // mid-turn but between tools; false for an idle lead, so it shows no dots
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
  idle = false; // on an ambient stroll (motion only; the tag does not show it)
  private quiet = false; // really idle: no prompt, no tool, no alert (main.ts setQuiet)
  /** Real idleness for the tag; refreshes it only when it changes. */
  setQuiet(b: boolean) { if (this.quiet !== b) { this.quiet = b; this.refreshTag(); } }
  private t = 0; // last `now` seen in update
  get now() { return this.t; }
  private v = 0; // current walk speed (art px/s)
  private settle = 0; // 1 -> 0 arrival squash
  private perch: { from: { x: number; y: number }; t: number; ms: number; k: number } | null = null; // couch sit in progress; k 0..1 = how far seated
  private glanceMs = 0; // >0: seated head turn toward glanceFlip
  private glanceFlip = false;
  private nudge = 0; // 1 -> 0 chair pull-out slide
  private wasSitting = false;
  private ring = new Sprite(); // alert ring: a pixel sprite at art scale, screen space (UI layer sits above the night overlay)
  waitKind: WaitKind = "permission";
  /** A finished turn (the session's Stop): a calm "your turn", no raised hand or worried face (R2). */
  soft = false;
  private alertAt = 0; // this.t when the alert began: it pulses only for its first seconds
  tagAbove = false; // upper-row seat: the name tag goes above the head, since below the desk is the lower row's head
  private mark = new Graphics(); // hover / selection outline, screen space
  private glyph = new Sprite(); // enlarged alert emote, screen space
  private hover = false;
  private selected = false;
  private plateW = -1;
  private plateH = -1;
  private edgeOn = false;
  private plate = new Graphics(); // dark backing behind the name tag, screen space
  private edge = new Graphics(); // off-screen alert arrow
  private prog = new Sprite(); // long tool call: pixel ring frames behind the figure (R6)
  private progN = -1;
  private sc = 1;
  private qpos = 0;
  private walked = 0; // art px travelled, drives the walk frame
  private drop = 0; // sit-down / stand-up body offset (0, 2, 5, 7)
  private dropT = 0;
  private h = 0; // id hash: desyncs breathing/quirks between people
  private emoteKey = "";
  private emoteBorn = 0;
  low = false; // LOD: see setLod
  readonly pip = new Sprite(); // LOD status pip (a 9x9 pixel texture per state), screen space
  demoted = false; // tag swapped for the pip because the floor was too crowded
  onScreen = true;
  private ringScr = { x: 0, y: 0, w: 0, h: 0 }; // the world ring's screen box after syncUi (label stacking) // after syncUi: off-screen tags are not stacked (their floor rect is not the visible one)
  private headPip = { x: 0, y: 0 };
  private pipKey = "";
  private flr: Rect = { x: 0, y: 0, w: 0, h: 0 }; // floor bounds in screen px, valid when `floor` is set
  private hits: number[] = []; // recent tool-event times, drives typing speed
  stale = false; // no activity for a while: desaturate (#101)
  yielding = false; // main.ts: hold still for a walker ahead (#116)
  held = 0; // main.ts: ms held up so far, capped by choreo.YIELD_MAX_MS (no deadlock)
  sip: "none" | "desk" | "sip" = "none"; // mug state (choreo.sipState), read by main.ts for the desk mug
  lineX = 0; // main.ts: px offset while queued in the door line
  staleMin = 0; // main.ts: whole minutes of silence once stale, 0 = not stale
  private microAt = -1; // last micro-posture slot played
  private lx = 0; // lane offset (art px): walkers keep to their right
  private ly = 0;
  toolSince = 0; // start of the tool call in flight, 0 = none
  longAfter = 30_000; // ms before that call earns the long-call arc (main.ts: longToolMs)
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
    // the alert ring sits behind the figure (R5): its back arc frames the person, the face and a raised hand stay visible
    this.ring.position.set(0, -12);
    this.prog.position.set(0, -12);
    this.prog.anchor.set(0.5);
    this.prog.tint = hexN(KEY.cyan);
    this.prog.visible = false;
    this.c.addChild(shadow, this.ring, this.prog, this.sprite, this.emoteSprite);
    this.c.eventMode = "static";
    this.c.cursor = "pointer";
    // hit box padded by ~8 screen px so it stays grabbable at fit zoom (#117)
    this.c.hitArea = { contains: (x: number, y: number) => { const p = 8 / this.sc; return x > -12 - p && x < 12 + p && y > -30 - p && y < 4 + p; } };
    world.addChild(this.c);
    this.tag = new Text({ text: label, style: { fontFamily: MONO, fontSize: fontPx(11), fill: KEY.text.fg, stroke: outline(3) } });
    this.tag.anchor.set(0.5, 0);
    this.glyph.anchor.set(0.5, 1);
    this.ring.anchor.set(0.5);
    this.glyph.texture = emoteTex("exclaim");
    this.ring.visible = this.mark.visible = this.glyph.visible = false;
    this.pip.visible = false;
    this.ui.addChild(this.mark, this.glyph, this.edge, this.plate, this.tag, this.pip);
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
    const st = this.alert === "blocked" ? STATUS.blocked : this.alert === "waiting" ? STATUS[this.waitKind] : null;
    // "(idle)" follows the session's real state (set each frame by main.ts), never the ambient stroll: a lead that has done
    // nothing must not flip between idle and not idle as it walks to the couch and back
    this.tag.text = `${st ? st.glyph + " " : ""}${lines.join("\n")}${q}${this.quiet ? " (idle)" : this.staleMin ? ` idle ${this.staleMin}m` : ""}`;
    this.tag.style.fill = st ? st.color : KEY.text.fg;
  }
  /** "idle Nm" tag suffix once the agent is stale; 0 clears. */
  setStaleMin(n: number) {
    if (this.staleMin !== n) { this.staleMin = n; this.refreshTag(); }
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
    this.tag.style.stroke = outline(3);
    if (this.speech) { const o = this.speech; o.node.destroy({ children: true }); o.node = makeBubble(o.text, o.kind, o.badge); bubbleHost(this.ui).addChild(o.node); }
    if (this.toolBubble) { const o = this.toolBubble; o.node.destroy({ children: true }); o.node = makeBubble(o.text, "tool", "tool"); bubbleHost(this.ui).addChild(o.node); }
  }
  /** Pulsing ring + large distinct glyph (waiting = "!", blocked = flag + red "! " tag). null clears. Persists while leaving. */
  setAlert(a: Alert | null, kind: WaitKind = "permission", soft = false) {
    const sf = a === "waiting" && kind === "turn" && soft;
    if (this.alert === a && (a !== "waiting" || (this.waitKind === kind && this.soft === sf))) return;
    if (this.alert !== a) this.alertAt = this.t;
    this.alert = a;
    this.waitKind = kind;
    this.soft = sf;
    if (a) {
      // one status map (theme.STATUS), shape + glyph + colour: permission 4 arcs "!", your turn dotted "?", gave up 6 arcs "x"
      const k = a === "blocked" ? "blocked" : kind;
      this.ring.texture = ringTex(k);
      this.glyph.texture = emoteTex(k === "blocked" ? "cross" : k === "turn" ? "question" : "exclaim");
    }
    this.ring.visible = this.glyph.visible = !!a;
    this.refreshTag();
  }
  setHover(b: boolean) { this.hover = b; this.drawMark(); }
  setSelected(b: boolean) { this.selected = b; this.drawMark(); }
  private markKey = "";
  /** HUD reticle: corner brackets around the person, drawn as whole-pixel rects at scale 1 (uniform, never stretched); selected adds mid-edge ticks. */
  private drawMark() {
    const on = this.hover || this.selected, m = this.mark;
    m.visible = on;
    if (!on) { if (this.markKey) { this.markKey = ""; m.clear(); } return; }
    const sel = this.selected, sc = this.sc, sit = this.sitting;
    const key = `${+sel}${sc}${+sit}`;
    if (key === this.markKey) return;
    this.markKey = key;
    const W = Math.round(11 * sc), H = Math.round((sit ? 12 : 15) * sc), L = Math.max(2, Math.round((sel ? 5 : 4) * sc)), t = Math.max(1, Math.round(sc * (sel ? 0.6 : 0.4)));
    m.clear();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const x = sx < 0 ? -W : W - t, y = sy < 0 ? -H : H - t;
      m.rect(x, sy < 0 ? -H : H - L, t, L).rect(sx < 0 ? -W : W - L, y, L, t);
    }
    const Lh = Math.round(L / 2);
    if (sel) for (const sx of [-1, 1]) m.rect(sx < 0 ? -W : W - Lh, -Math.ceil(t / 2), Lh, t);
    m.fill(sel ? hexN(KEY.cyan) : 0x5aa9c9); // a machine mark: never the your-turn cyan
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
    bubbleHost(this.ui).addChild(node);
    this.speech = { node, left: ms, text, kind, badge, born: this.t };
    this.noise();
  }
  tool(text: string) {
    if (this.toolBubble?.text === text) { this.toolBubble.left = 2600; return; }
    this.toolBubble?.node.destroy({ children: true });
    const node = makeBubble(text, "tool", "tool");
    bubbleHost(this.ui).addChild(node);
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
  /** Status for the pip and the session badge: shape and colour per state. */
  get status() { return statusOf({ blocked: this.alert === "blocked", waiting: this.alert === "waiting", queued: this.queued, working: this.working, active: false }); }
  private drawPip(r: number) {
    const s = this.status;
    const key = `${s}${this.waitKind}${r}`;
    if (key === this.pipKey) return;
    this.pipKey = key;
    setPip(this.pip, s, this.waitKind, r);
  }
  /** Collapsed crew (main.ts): the sprite and every overlay hide; the desk keeps showing the work. */
  hidden = false;
  setHidden(b: boolean) {
    if (this.hidden === b) return;
    this.hidden = b;
    this.c.visible = this.ui.visible = !b;
    if (this.speech) this.speech.node.visible = !b;
  }

  update(dt: number, now: number) {
    const ms = dt * 1000;
    this.t = now;
    // a real event ends an idle visit at once: drop the walk and wait, go home (a couch sit already stands up on its own)
    if (this.idle && this.working && !this.perch && !this.leaving) { this.path = []; this.cur = null; this.steps = [{ k: "idle", on: false }]; }
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
    if (sit) this.dir = "down", this.flip = false;
    else if (pc) this.dir = pc.t >= PERCH_MS + pc.ms ? "down" : "up", this.flip = false; // the couch faces its table: the lounger is seen from behind; getting up, it turns to step down off the back, never gliding backwards
    if (sit && !this.wasSitting && !settings.reducedMotion) { this.nudge = 1; this.settle = 0.8; } // chair pull-out, then a small settle into the seat
    this.wasSitting = sit;
    const still = settings.reducedMotion;
    // sit-down / stand-up: body steps 2, 5, 7px over ~150ms instead of one snap
    const target = sit ? 7 : 0;
    if (still) this.drop = target;
    else if (this.drop !== target) { if ((this.dropT += ms) >= 50) { this.dropT = 0; this.drop = stepDrop(this.drop, target); } }
    else this.dropT = 0;
    const seated = sit && this.drop === 7;
    // micro-posture while quiet 6-20s: a look to one side or a lean back, seeded per person and 5s slot (no random)
    let lean = 0;
    if (seated && !this.working && !still && !settings.ambientPaused && !this.alert && !this.emote && !this.speech && this.busyAt > 0 && idleTier(now - this.busyAt) === 1) {
      const m = microPose(now, this.h);
      if (m === "lean") lean = 1;
      else if (m && this.microAt !== microSlot(now, this.h)) { this.microAt = microSlot(now, this.h); this.glance(this.pos.x + (m === "look-l" ? -1 : 1)); }
    }
    this.sip = sipState(now - this.busyAt, seated && !this.working && !this.alert && !this.emote && !this.speech && this.busyAt > 0, still || settings.ambientPaused, now, this.h);
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
    // quirks (yawn, phone, sip) only when truly idle: a helper between tools is still generating, so it never qualifies (S8)
    const calm = !moving && !still && !settings.ambientPaused && !this.alert && !this.working && !this.thinking && !this.emote && !this.speech && now - this.busyAt > 6000;
    const quirk = calm ? quirkAt(now, this.h) : null;
    const expr: Expr = this.alert === "blocked" ? "stuck" : this.alert === "waiting" && !this.soft ? "worry"
      : this.emote?.e === "check" || this.emote?.e === "heart" ? "happy" : quirk ?? (seated && this.working ? "focus" : "neutral");
    const last = this.hits[this.hits.length - 1] ?? -1e9;
    const pose = pc ? (pc.k >= 1 ? "couch" : "walk") : glancing ? "sit-glance" : seated ? (this.working ? "sit" : "sit-think") : "walk";
    this.sprite.texture = personTex(this.look, glancing ? "side" : this.dir, pose, moving || (seated && this.working && !still) ? this.frame : 0, {
      expr,
      drop: pc ? (pc.k < 0.5 ? 2 : 5) : seated ? 0 : this.drop,
      lift: standing && !still && !settings.ambientPaused && !quirk && Math.floor((now + this.h) / 500) % 2 === 1, // breathing beat, phase by id
      dip: seated && this.working && !still && now - last < 90, // head dips on each tool hit
      sip: this.sip === "sip" && !glancing,
      think: (glancing && !this.working) || (this.sip === "sip" && !glancing), // the glance turns the head only; arms keep the think pose
      raise: this.alert === "waiting" && !this.soft && !moving && !pc, // waiting on you: a hand goes up (readable at pod scale without a UI mark); a finished turn sits calm
    });
    this.sprite.scale.x = (glancing ? this.glanceFlip : this.flip) ? -1 : 1; // leads at 1x too: whole art pixels; the padded shoulders are the lead cue
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
    this.sprite.y = Math.round(hp.y - this.nudge * 3) - lean; // up = away from the desk below; whole art px (stepped)
    const th = this.sprite.texture.height; // squash/settle in whole art rows: the figure steps, it never resamples to a fractional height
    this.sprite.scale.y = Math.max(1, Math.round(th * hp.sy * squashY(this.squashMs) * (1 - 0.1 * Math.sin(this.settle * Math.PI)))) / th;
    // lanes: walkers keep 2px to their right so opposite flows pass; standing, seated and couch figures sit on their tile
    const k = moving && !pc ? 2 : 0;
    const tx = this.dir === "down" ? -k : this.dir === "up" ? k : 0, ty = this.dir === "side" ? (this.flip ? -k : k) : 0;
    if (still) { this.lx = tx; this.ly = ty; } else { const f = Math.min(1, dt * 12); this.lx += (tx - this.lx) * f; this.ly += (ty - this.ly) * f; }
    this.c.position.set(Math.round(this.pos.x + this.lx + this.lineX), Math.round(this.pos.y + this.ly));
    this.c.zIndex = this.pos.y + (pc ? 2 : 0); // on the couch: above its cushions, under its back rail (scene.ts stacks the rail at +3)
    // --- emote: explicit one wins, else waiting-in-line. A seated agent that is thinking shows dots on its monitor (scene.ts), not a
    // cloud: the cloud sat on the leaned-back pose and landed on the desk row above
    if (this.emote && (this.emote.left -= ms) <= 0) this.emote = null;
    let e: Emote | null = this.emote?.e ?? null;
    if (!e && this.queued && !moving) e = "wait"; // waiting for a desk is not "needs you" (R1)
    const ek = e ? (e.startsWith("dots") ? "dots" : e) : "";
    if (ek !== this.emoteKey) { this.emoteKey = ek; this.emoteBorn = now; }
    if (e) {
      this.emoteSprite.texture = emoteTex(e);
      this.emoteSprite.visible = true;
      this.emoteSprite.y = sit ? -19 : pc && pc.k >= 1 ? -23 : -27; // 2px clear of the hair so the thought cloud never reads as a hat (critique R6)
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
    const sx = dev(ox + Math.round(this.pos.x) * sc), sy = dev(oy + Math.round(this.pos.y) * sc); // the sprite sits on whole art px; overlays on whole device px
    // seated: tag goes under the desk tile so it never covers the desk or the person
    this.tag.position.set(sx, dev(sy + 3 + (this.sitting ? T * sc : 0)));
    const gl = this.glitchAt ? Date.now() - this.glitchAt : 1e9;
    if (gl < 120) { this.tag.x += Math.floor(gl / 30) % 2 ? 2 : -2; this.tag.tint = Math.floor(gl / 40) % 2 ? 0x00f0ff : 0xff2bd6; }
    else if (this.tag.tint !== 0xffffff) this.tag.tint = 0xffffff;
    if (floor) {
      this.flr.x = ox + floor.x * sc; this.flr.y = oy + floor.y * sc; this.flr.w = floor.w * sc; this.flr.h = floor.h * sc;
      this.onScreen = !view || (sx >= 0 && sx <= view.w && sy >= view.top && sy <= view.h);
      if (view && this.onScreen) { // on screen: the visible floor only, so a followed or zoomed camera never clips a label at the edge (H5)
        const r = Math.min(this.flr.x + this.flr.w, view.w), b = Math.min(this.flr.y + this.flr.h, view.h);
        this.flr.x = Math.max(this.flr.x, 0); this.flr.y = Math.max(this.flr.y, view.top);
        this.flr.w = Math.max(0, r - this.flr.x); this.flr.h = Math.max(0, b - this.flr.y);
      }
      this.clampTag();
    }
    const couched = !!this.perch && this.perch.k >= 1; // lounging: head sits ~4px lower than standing
    const headY = dev(sy - (this.sitting ? 20 : couched ? 24 : 28) * sc - 2 * sc); // the tail tip sits 2 art px above the head, at every zoom
    // upper-row tag sits on the head top (20 art px above the feet); while an emote shows it lifts above the emote's space (emotes are
    // <= 9 art px tall, bottom 19 px above the feet), so it never covers its own emote or thought (O1); bubbles stack above it (R9)
    if (this.tagAbove && this.sitting) { this.tag.y = dev(sy - (this.emoteSprite.visible ? 29 : 20) * sc - this.tag.height - 1); if (floor) this.clampTag(); }
    const toolY = headY - stagger;
    // 120ms pop-in, 150ms fade-out (#109)
    const fade = (b: { left: number; born: number }) => (settings.reducedMotion ? 1 : Math.max(0, Math.min(1, (this.t - b.born) / 120, b.left / 150)));
    if (this.speech) {
      if (this.hidden) this.speech.node.visible = false; // said while collapsed
      this.speech.node.position.set(sx, headY);
      this.speech.node.alpha = fade(this.speech);
      this.speech.node.scale.set(settings.reducedMotion ? 1 : popScale(this.t - this.speech.born));
    }
    this.headPip.x = sx; this.headPip.y = headY + 4;
    if (this.low) { this.drawPip(Math.max(3, sc * 2)); placePip(this.pip, sx, headY + 4); }
    if (this.toolBubble) {
      this.toolBubble.node.visible = !this.speech && !this.low && !this.hidden;
      this.toolBubble.node.alpha = fade(this.toolBubble);
      this.toolBubble.node.position.set(sx, toolY);
    }
    // the alert glyph lives in screen space so the night overlay never dims it; the ring is in the world, behind the figure
    // alerts move only for their first 4 s (then hold still); "your turn" never pulses: it is calm, not urgent. The pulse is two
    // stepped frames (full, dimmed), never a fractional scale that blurs the pixel ring (R5).
    const fresh = this.alert && !settings.reducedMotion && !(this.alert === "waiting" && this.waitKind === "turn") && this.t - this.alertAt < 4000;
    this.ring.alpha = this.soft ? 0.5 : fresh && Math.floor(this.t / (this.alert === "blocked" ? 225 : 350)) % 2 ? 0.55 : 1;
    const rt = this.ring.texture;
    this.ringScr.x = sx; this.ringScr.y = dev(sy - 12 * sc); this.ringScr.w = rt.width * sc; this.ringScr.h = rt.height * sc;
    this.mark.position.set(sx, dev(sy - (this.sitting ? 9 : 12) * sc));
    this.drawMark(); // redrawn only when the scale, the seat or the state changes
    const gs = dev(Math.max(2, sc * 1.6)); // whole device px per glyph texel
    this.glyph.scale.set(gs);
    this.glyph.position.set(dev(sx + 14 * sc), dev(sy - (this.sitting ? 18 : couched ? 22 : 26) * sc));
    // arc for a tool call that has been running a while: busy, not hung (#114). Only a genuinely long call (3x the tool's own p95)
    // earns a mark, and only the arc: a full track circle on every busy worker read as noise (critique A4/T7). Pixel frames, 16 steps.
    const el = this.toolSince ? this.t - this.toolSince : 0;
    const n = el > this.longAfter ? Math.max(1, Math.ceil(ARC_STEPS * Math.min(1, (el - this.longAfter) / 270_000))) : 0;
    if (n !== this.progN) { this.progN = n; this.prog.visible = n > 0; if (n) this.prog.texture = arcTex(n); }
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
    this.tag.position.set(dev(p.x), dev(p.y));
  }
  /** True when the centred box overlaps this actor's visible selection/hover/alert ring (ellipse bbox, 13x17 world px). */
  ringHits(cx: number, cy: number, w: number, h: number) {
    if (this.hidden || (!this.mark.visible && !this.ring.visible)) return false;
    return Math.abs(this.mark.x - cx) * 2 < w + 30 * this.sc && Math.abs(this.mark.y - cy) * 2 < h + 34 * this.sc;
  }
  /** Screen-space floor rect after syncUi, or null when no floor bounds are set. */
  floorPx(): Rect | null { return floor ? this.flr : null; }

  /** Walking within ~1.6 tiles of the door: arrivals bunch up there, so their tags would pile into a column; a pip stands in until they are clear of it. */
  get atDoor(): boolean {
    if (this.sitting) return false;
    const f = feet(this.door);
    return Math.hypot(this.pos.x - f.x, this.pos.y - f.y) < T * 1.6;
  }
  /** Screen-space box of the name tag after syncUi (for label stacking); alerts keep their place. */
  tagBox(): Box {
    return { x: this.tag.x, y: this.tag.y, w: this.tag.width, h: this.tag.height, pri: this.alert ? 1 : 0, dir: this.lead ? 1 : undefined, own: this };
  }
  /** Screen boxes of the alert flag (anchor bottom-centre) and ring (centred): other agents' tags must not cover them (A8). */
  alertBoxes(out: Box[]) {
    if (!this.alert || !this.glyph.visible || this.low) return;
    const w = this.glyph.width, h = this.glyph.height, r = this.ringScr;
    out.push({ x: this.glyph.x, y: this.glyph.y - h, w, h, pri: 2, own: this }, { x: r.x, y: r.y - r.h / 2, w: r.w, h: r.h, pri: 2, own: this });
  }
  /** Screen box of the whole figure (feet to the top of the head, art width), for agents that need you: no bubble covers them. */
  figureBox(out: Box[]) {
    if (!this.alert || this.low || this.hidden) return;
    const sc = this.sc, h = (this.sitting ? 22 : 28) * sc, w = 16 * sc;
    out.push({ x: this.ringScr.x, y: this.ringScr.y + 12 * sc - h, w, h, pri: 2, own: this });
  }
  /** Apply a stacking offset and redraw the dark backing plate (#F3). */
  placeTag(dy: number, hide = false) {
    if (hide !== this.demoted) { // no room in the floor: status pip instead of an overlapping tag
      this.demoted = hide;
      this.tag.visible = this.plate.visible = !hide;
      this.pip.visible = hide;
    }
    if (hide) { this.drawPip(Math.max(3, this.sc * 2)); placePip(this.pip, this.headPip.x, this.headPip.y); return; }
    this.tag.y += dy;
    if (floor) this.clampTag();
    const w = this.tag.width, h = this.tag.height;
    if (w !== this.plateW || h !== this.plateH) { // re-tessellate only when the text box changes size
      this.plateW = w; this.plateH = h;
      this.plate.clear().rect(0, 0, Math.ceil(w) + 6, Math.ceil(h) + 2).fill({ color: KEY.env[0], alpha: 0.66 }); // square, like the session badges
    }
    this.plate.position.set(dev(this.tag.x - w / 2 - 3), dev(this.tag.y - 1));
  }

  destroy() {
    all.delete(this);
    this.c.destroy({ children: true });
    this.speech?.node.destroy({ children: true });
    this.toolBubble?.node.destroy({ children: true });
    this.ui.destroy({ children: true });
  }
}

/** One layer above every actor's overlay: a bubble is never covered by a neighbour's pip, ring or tag (A6). main.ts sets it. */
let bubbles: Container | null = null;
export const setBubbleLayer = (c: Container) => { bubbles = c; };
const bubbleHost = (own: Container) => bubbles ?? own;

// per-frame scratch, reused so the ticker does not allocate arrays for the layout
const bubbleBoxes: BubbleBox[] = [];
const bubbleNodes: { node: Container | null; fade: number; fl: Rect | null }[] = []; // node null = a name tag, an obstacle only
const tagList: Actor[] = [];
const tagBoxes: Box[] = [];
const alertScratch: Box[] = [];
const hidden: boolean[] = [];

function addBubble(a: Actor, b: { node: Container; born: number } | null, tool: boolean, zone: string, top: number) {
  if (!b || !b.node.visible || b.node.destroyed) return;
  const fl = a.floorPx();
  bubbleNodes.push({ node: b.node, fade: b.node.alpha, fl });
  // an alert's own words outrank a neighbour's chatter; neither may be clamped back down onto the other
  bubbleBoxes.push({ x: b.node.x, y: b.node.y, w: b.node.width, h: b.node.height, prio: tool ? 1 : a.alert ? 2.5 : 2, age: a.now - b.born, zone, tool, top }); // may rise over the wall: a bubble kept inside the floor got pushed down onto a top-row agent's body
}

/**
 * Stack overlapping speech/tool bubbles (speech > tool), fade displaced ones and cap tool bubbles per ~6-tile zone.
 * Name tags are fixed obstacles: bubbles shift up clear of them. Call after layoutTags and every actor.syncUi in a frame;
 * syncUi resets positions/alpha, so skipping this keeps the old behaviour.
 */
const bubbleActors: Actor[] = []; // per-frame scratch
export function layoutBubbles(it: Iterable<Actor>, view?: { w: number; h: number; top: number }) {
  // the caller passes map.values(): an iterator is used up by the first loop, so copy it once (the alert and figure loop
  // below used to see nothing, and bubbles covered the agents that need you)
  bubbleActors.length = 0;
  for (const a of it) bubbleActors.push(a);
  const actors = bubbleActors;
  bubbleBoxes.length = 0;
  bubbleNodes.length = 0;
  for (const a of actors) {
    if (a.hidden) continue;
    const zone = String(Math.floor(a.pos.x / (6 * T)));
    const top = view ? view.top + 4 : -Infinity;
    addBubble(a, a.speech, false, zone, top);
    addBubble(a, a.toolBubble, true, zone, top);
    if (a.low || a.demoted) continue; // no tag on screen, nothing to avoid
    const tb = a.tagBox(); // prio 3: tags place first and never move; box y is the bottom edge here
    bubbleBoxes.push({ x: tb.x, y: tb.y + tb.h, w: tb.w, h: tb.h, prio: 3, age: 0, zone, tool: false });
    bubbleNodes.push({ node: null, fade: 1, fl: null });
  }
  alertScratch.length = 0;
  for (const a of actors) if (!a.hidden) { a.alertBoxes(alertScratch); a.figureBox(alertScratch); } // and the figure itself: a bubble never sits on someone who needs you
  for (const o of alertScratch) { // an alert's flag and ring: fixed like tags, so no bubble ever covers them (x = centre, y = top; bubble boxes use the bottom edge)
    bubbleBoxes.push({ x: o.x, y: o.y + o.h, w: o.w, h: o.h, prio: 3, age: 0, zone: "", tool: false });
    bubbleNodes.push({ node: null, fade: 1, fl: null });
  }
  for (const o of obstacles) { // session badges: fixed like tags
    bubbleBoxes.push({ x: o.x, y: o.y + o.h, w: o.w, h: o.h, prio: 3, age: 0, zone: "", tool: false });
    bubbleNodes.push({ node: null, fade: 1, fl: null });
  }
  // shortcut: O(n^2) overlap scan per frame, fine for dozens of bubbles; use a grid if actors reach hundreds
  const res = stackBubbles(bubbleBoxes);
  res.forEach((r, i) => {
    const n = bubbleNodes[i].node;
    if (!n) return;
    const bx = bubbleBoxes[i];
    n.y = r.y;
    n.alpha = bubbleNodes[i].fade;
    const v = Math.round(255 * Math.max(0.55, r.alpha)); // a displaced bubble darkens its plate instead of fading: text over text never mixes (R7)
    (n.children[0] as Graphics).tint = (v << 16) | (v << 8) | v;
    n.visible = r.visible;
    const fl = bubbleNodes[i].fl;
    if (fl) n.x = clampBox({ x: n.x, y: n.y - bx.h, w: bx.w, h: bx.h }, fl).x; // sideways inside the room; vertically the stacker hides it instead
    if (view) { // sideways inside the canvas (#108/#F3); never clamped down, that put it on its own agent's body
      n.x = Math.max(bx.w / 2 + 2, Math.min(view.w - bx.w / 2 - 2, n.x));
    }
    n.x = dev(n.x); n.y = dev(n.y); // bubbles land on whole device pixels
  });
}

/** True when the centred box (cx, cy, w, h) overlaps a placed name tag or an actor's ring; valid after layoutTags. No allocation. */
export function tagHits(cx: number, cy: number, w: number, h: number): boolean {
  for (const a of all) if (a.ringHits(cx, cy, w, h)) return true;
  for (const o of obstacles) if (Math.abs(o.x - cx) * 2 < o.w + w && o.y < cy + h / 2 && o.y + o.h > cy - h / 2) return true;
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
  for (const a of actors) {
    if (a.low || a.hidden) continue;
    if (a.atDoor) { a.placeTag(0, true); continue; } // not stacked: a pip until clear of the door
    if (!a.onScreen) { a.placeTag(0, true); continue; } // off-screen: no tag (it would only peek in at the edge and collide); the pip stays off-screen with the agent
    tagList.push(a); tagBoxes.push(a.tagBox());
  }
  const n = tagList.length;
  for (const a of tagList) a.alertBoxes(tagBoxes); // fixed obstacles, placed first
  for (const o of obstacles) tagBoxes.push(o);
  hidden.length = 0;
  hidden.length = tagBoxes.length; hidden.fill(false);
  const dy = stackLabels(tagBoxes, tagList[0]?.floorPx() ?? undefined, hidden);
  let displaced = 0;
  for (let i = 0; i < n; i++) { tagList[i].placeTag(dy[i], hidden[i]); if (dy[i]) displaced++; }
  // a status pip never sits on someone else's name tag: the tag names the agent, the pip only repeats a state (A8)
  for (const a of all) {
    if (!a.low && !a.demoted) continue;
    const r = a.pip.width / 2 + 1;
    a.pip.visible = !tagList.some((o) => o !== a && o.tag.visible && Math.abs(o.tag.x - a.pip.x) * 2 < o.tag.width + 2 * r && o.tag.y < a.pip.y + r && o.tag.y + o.tag.height > a.pip.y - r);
  }
  return displaced; // main.ts: heavy stacking switches the crowd to pips
}
