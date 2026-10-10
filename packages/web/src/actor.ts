import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { Tile } from "@agent-office/core";
import { personTex, emoteTex, type Dir, type Emote, type Look } from "./sprites.ts";
import { easeSpeed, fontPx, settings, stackBubbles, type BubbleBox } from "./settings.ts";
import { theme } from "./theme.ts";

export const T = 16; // art pixels per tile
export const feet = (t: Tile) => ({ x: t.x * T + T / 2, y: t.y * T + T });
const SPEED = 3.4 * T; // art px / s

export type Step =
  | { k: "walk"; to: Tile }
  | { k: "say"; text: string; ms?: number; emote?: Emote; kind?: BubbleKind; badge?: Badge }
  | { k: "idle"; on: boolean }
  | { k: "wait"; ms: number }
  | { k: "face"; toward: { x: number; y: number } }
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

function makeBubble(text: string, kind: BubbleKind, badge?: Badge): Container {
  const st = BUBBLE_STYLE[kind];
  const small = kind === "tool";
  const t = new Text({
    text,
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
  if (badge) { const b = new Graphics(); drawBadge(b, badge, st.border, st.bg); c.addChild(b); }
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
  hop = 0;
  alert: Alert | null = null;
  idle = false;
  private t = 0; // last `now` seen in update
  get now() { return this.t; }
  private v = 0; // current walk speed (art px/s)
  private settle = 0; // 1 -> 0 arrival squash
  private nudge = 0; // 1 -> 0 chair pull-out slide
  private wasSitting = false;
  private ring = new Graphics(); // alert pulse, screen space (UI layer sits above the night overlay)
  private mark = new Graphics(); // hover / selection outline, screen space
  private glyph = new Sprite(); // enlarged alert emote, screen space
  private hover = false;
  private selected = false;

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
    this.home = home;
    this.pos = feet(spawn);
    const shadow = new Graphics().ellipse(0, -1, 6, 2.5).fill({ color: 0x000000, alpha: 0.28 });
    this.sprite.anchor.set(0.5, 1);
    this.emoteSprite.anchor.set(0.5, 1);
    this.c.addChild(shadow, this.sprite, this.emoteSprite);
    this.c.eventMode = "static";
    this.c.cursor = "pointer";
    this.c.hitArea = { contains: (x: number, y: number) => x > -12 && x < 12 && y > -30 && y < 4 } as any;
    world.addChild(this.c);
    this.tag = new Text({ text: label, style: { fontFamily: MONO, fontSize: fontPx(11), fill: 0xffffff, stroke: { color: 0x0e0d16, width: 3 } } });
    this.tag.anchor.set(0.5, 0);
    this.glyph.anchor.set(0.5, 1);
    this.glyph.texture = emoteTex("exclaim");
    this.ring.visible = this.mark.visible = this.glyph.visible = false;
    this.ui.addChild(this.ring, this.mark, this.glyph, this.tag);
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
    this.tag.text = `${this.alert === "blocked" ? "! " : ""}${this.label}${this.idle ? " (idle)" : ""}`;
    this.tag.style.fill = this.alert === "blocked" ? 0xff8a80 : 0xffffff;
  }
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
  idleStroll(to: Tile, ms: number) {
    this.queue({ k: "idle", on: true }, { k: "walk", to }, { k: "wait", ms }, { k: "idle", on: false });
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
  }
  tool(text: string) {
    if (this.toolBubble?.text === text) { this.toolBubble.left = 2600; return; }
    this.toolBubble?.node.destroy({ children: true });
    const node = makeBubble(text, "tool", "tool");
    this.ui.addChild(node);
    this.toolBubble = { node, left: 2600, text, born: this.t };
  }
  hopNow() {
    if (!settings.reducedMotion) this.hop = 1;
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
    if (next) {
      const to = feet(next), dx = to.x - this.pos.x, dy = to.y - this.pos.y, d = Math.hypot(dx, dy);
      // ease in/out over the path (constant speed under reduced motion)
      this.v = settings.reducedMotion ? SPEED : easeSpeed(this.v || SPEED * 0.25, d + (this.path.length - 1) * T, dt, SPEED);
      const m = this.v * dt;
      moving = true;
      if (Math.abs(dx) > Math.abs(dy)) { this.dir = "side"; this.flip = dx < 0; } else this.dir = dy < 0 ? "up" : "down";
      if (d <= m) { this.pos = to; this.path.shift(); } else { this.pos.x += (dx / d) * m; this.pos.y += (dy / d) * m; }
      if (!this.path.length && this.cur?.k === "walk") this.cur = null;
    } else if (this.cur?.k === "exit") {
      this.gone = true;
    } else if (this.cur && (this.cur.k === "say" || this.cur.k === "wait")) {
      this.timer -= ms;
      if (this.timer <= 0) this.cur = null;
    }
    if (!moving && this.v) { this.v = 0; if (!settings.reducedMotion) this.settle = 1; } // arrival squash
    // --- pose
    const sit = !moving && this.sitting;
    if (sit) this.dir = "down", this.flip = false;
    if (sit && !this.wasSitting && !settings.reducedMotion) this.nudge = 1; // chair pull-out
    this.wasSitting = sit;
    const still = settings.reducedMotion;
    this.frameT += ms;
    const period = moving ? 130 : sit && this.working && !still ? 150 : 600;
    if (this.frameT > period) { this.frameT = 0; this.frame++; }
    const pose = sit ? (this.working ? "sit" : "sit-think") : "walk";
    this.sprite.texture = personTex(this.look, this.dir, pose, moving || (sit && this.working && !still) ? this.frame : 0);
    this.sprite.scale.x = this.flip ? -1 : 1;
    // little hop when addressed
    if (this.hop > 0) this.hop = Math.max(0, this.hop - dt * 4);
    this.settle = Math.max(0, this.settle - dt * 6);
    this.nudge = Math.max(0, this.nudge - dt * 4);
    this.sprite.y = -Math.sin(this.hop * Math.PI) * 3 - this.nudge * 3; // up = away from the desk below
    this.sprite.scale.y = 1 - 0.1 * Math.sin(this.settle * Math.PI);
    this.c.position.set(Math.round(this.pos.x), Math.round(this.pos.y));
    this.c.zIndex = this.pos.y;
    // --- emote: explicit one wins, else thinking dots while seated and idle, else waiting-in-line
    if (this.emote && (this.emote.left -= ms) <= 0) this.emote = null;
    let e: Emote | null = this.emote?.e ?? null;
    if (!e && sit && !this.working) e = (still ? "dots1" : `dots${Math.floor(now / 350) % 3}`) as Emote;
    if (!e && this.queued && !moving) e = "question";
    if (e) { this.emoteSprite.texture = emoteTex(e); this.emoteSprite.visible = true; this.emoteSprite.y = sit ? -17 : -25; }
    else this.emoteSprite.visible = false;
    // --- bubbles
    if (this.speech && (this.speech.left -= ms) <= 0) { this.speech.node.destroy({ children: true }); this.speech = null; }
    if (this.toolBubble && (this.toolBubble.left -= ms) <= 0) { this.toolBubble.node.destroy({ children: true }); this.toolBubble = null; }
  }

  /** Position the crisp text overlay using the world's current transform. */
  syncUi(ox: number, oy: number, sc: number) {
    // neighbouring desks stagger their tool bubbles so they do not sit on top of each other
    const stagger = this.sitting ? (Math.round(this.pos.x / (T * 2)) % 2) * 26 : 0;
    const sx = ox + this.pos.x * sc, sy = oy + this.pos.y * sc;
    // seated: tag goes under the desk tile so it never covers the desk or the person
    this.tag.position.set(sx, sy + 3 + (this.sitting ? T * sc : 0));
    const headY = sy - (this.sitting ? 20 : 28) * sc - 6;
    const toolY = headY - stagger;
    if (this.speech) { this.speech.node.position.set(sx, headY); this.speech.node.alpha = 1; }
    if (this.toolBubble) {
      this.toolBubble.node.visible = !this.speech;
      this.toolBubble.node.alpha = 1;
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
    this.glyph.position.set(sx + 14 * sc, sy - (this.sitting ? 18 : 26) * sc);
  }

  destroy() {
    this.c.destroy({ children: true });
    this.ui.destroy({ children: true });
  }
}

/**
 * Stack overlapping speech/tool bubbles (speech > tool), fade displaced ones and cap tool bubbles per ~6-tile zone.
 * Call after every actor.syncUi in a frame; syncUi resets positions/alpha, so skipping this keeps the old behaviour.
 */
export function layoutBubbles(actors: Iterable<Actor>) {
  const nodes: { node: Container; box: BubbleBox }[] = [];
  for (const a of actors) {
    const zone = String(Math.floor(a.pos.x / (6 * T)));
    for (const [b, tool] of [[a.speech, false], [a.toolBubble, true]] as const) {
      if (!b || !b.node.visible || b.node.destroyed) continue;
      nodes.push({ node: b.node, box: { x: b.node.x, y: b.node.y, w: b.node.width, h: b.node.height, prio: tool ? 1 : 2, age: a.now - b.born, zone, tool } });
    }
  }
  // shortcut: O(n^2) overlap scan per frame, fine for dozens of bubbles; use a grid if actors reach hundreds
  const res = stackBubbles(nodes.map((n) => n.box));
  res.forEach((r, i) => { const n = nodes[i].node; n.y = r.y; n.alpha = r.alpha; n.visible = r.visible; });
}
