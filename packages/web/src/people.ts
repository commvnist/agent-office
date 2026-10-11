// Character art: the procedural people (workers, leads), their looks, poses and faces. Environment art lives in sprites.ts.
import type { Texture } from "pixi.js";
import { Grid, hash, hsl, shade } from "./pixel.ts";
import { contrast, luma, toLuma } from "./color.ts";
import { KEY, roleColor, theme } from "./theme.ts";
import { settings } from "./settings.ts";
import { Lru, lookKey } from "./lru.ts";

const SHOE = "#241d2e";
const DARK = "#1e1a28";
const GOLD = "#f2c14e";

export type Dir = "down" | "up" | "side";
export type Pose = "walk" | "sit" | "sit-think" | "sit-glance" | "couch"; // sit-glance: seated body, head in side view; couch: lounging, phone in hands
export type Accessory = "none" | "glasses" | "headphones" | "cap" | "tie" | "bun" | "suit";
/** Face/pose overlay chosen by the actor's state or idle quirk. Part of the texture key. */
export type Expr = "neutral" | "focus" | "stuck" | "happy" | "worry" | "yawn" | "stretch" | "phone";
/** style: 0 plain, 1 long sides, 2 spikes, 3 top-knot, 4 bob, 5 long-back, 6 ponytail, 7 puffy. build: 1 = stocky. head: 1 = 1px shorter head.
 * cut: 0 long sleeves, 1 short sleeves, 2 two-tone raglan sleeves, 3 hoodie (hood up unless a cap/headphones/bun is in the way). */
export type Look = { skin: string; hair: string; shirt: string; pants: string; style: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; build: 0 | 1; head: 0 | 1; acc: Accessory; accColor: string; badge: number; cut?: 0 | 1 | 2 | 3; team?: number; lead?: LeadLook };
/** The session lead's portrait variant: curly dark hair, beard, tinted aviators, light blazer over an open patterned shirt, gold chain. */
export type LeadLook = { jacket: string; lens: string; beard: 0 | 1 | 2; chain: 0 | 1; dot: string };
const LEAD_JACKETS = ["#e8dcc0", "#d6bf94", "#c9ccd6", "#b6cde0", "#e6c1b8", "#cfd8c4"];
const LEAD_LENS = ["#ff9a3c", "#ffc040", "#ff6b8a", "#4fd6c8", "#c58bff"];
const LEAD_HAIR = ["#4a3528", "#3f3350", "#34404f", "#523a2e"]; // near-black, but bright enough that the contrast lift leaves them alone
const LEAD_DOTS = ["#a63a3a", "#c9a227", "#3a7ca5", "#7a4fa3"];
const LEAD_BEARD: (0 | 1 | 2)[] = [0, 0, 0, 1, 2]; // mostly full beards, some stubble, some goatees
/** Team colour buckets (30 degrees of hue each): the session's repo hue shows on the hem and badge halo so a team reads as a team. */
export const TEAMS = 12;
export const teamColor = (b: number) => hsl(b * 30 + 15, 0.6, 0.5);
export type PoseOpts = { expr?: Expr; lift?: boolean; dip?: boolean; drop?: number; think?: boolean; sip?: boolean; raise?: boolean }; // raise: one hand up (waiting on you)

const ROLE_ACC: Record<string, Accessory> = {
  architect: "glasses", frontend: "headphones", backend: "cap", qa: "glasses", reviewer: "tie", researcher: "bun",
};
// Walk cycle, 6 poses: contact, down, passing, then the mirror. Per pose: front/back leg lengths, body lift, arm swing,
// and [far, near] leg x offsets in the side view (the far leg is the darker one, so the alternation reads).
export const WALK_FRAMES = 6;
const LEG_L = [5, 5, 4, 5, 4, 5], LEG_R = [5, 4, 5, 5, 5, 4];
const BOB = [0, 0, 1, 0, 0, 1], SWING = [-1, -1, 0, 1, 1, 0];
const SIDE = [[-2, 2], [-1, 1], [0, 0], [2, -2], [1, -1], [0, 0]];

// 3x4 role pictograms (index = GLYPHS slot), drawn in glyphInk(look) on a dark halo so they read on any shirt
const GLYPHS = [
  ["#.#", "###", "#.#", "###"], // ruler: architect
  ["###", "#.#", "###", ".#."], // monitor: frontend
  ["###", "###", "...", "###"], // server stack: backend
  [".#.", "###", "#.#", "###"], // clipboard: qa
  ["..#", ".##", "##.", "#.."], // pen: reviewer
  ["##.", "##.", ".#.", "..#"], // magnifier: researcher
  ["#.#", "###", "###", "#.#"], // gear: devops
  ["##.", "###", "###", "###"], // page: docs
  ["###", "###", "###", ".#."], // shield: security
  [".#.", "###", "###", ".#."], // fallbacks for unknown roles: gem, cross, hook
  ["#.#", ".#.", "#.#", ".#."],
  ["###", ".#.", ".#.", ".#."],
];
const ROLE_GLYPH: [RegExp, number][] = [[/architect/, 0], [/front/, 1], [/back/, 2], [/qa|test/, 3], [/review/, 4], [/research/, 5], [/ops/, 6], [/doc/, 7], [/secur/, 8]];

/** Deterministic look: role decides outfit colour + accessory + glyph, the id decides the person. */
export function lookFor(role: string, id: string, lead = false, team?: number): Look {
  const h = hash(id);
  const th = theme();
  const gi = ROLE_GLYPH.find(([re]) => re.test(role))?.[1] ?? 9 + (hash(role) % 3);
  return {
    skin: th.skins[h % th.skins.length],
    hair: lead ? LEAD_HAIR[(h >>> 3) % LEAD_HAIR.length] : th.hairs[(h >>> 3) % th.hairs.length],
    shirt: lead ? LEAD_JACKETS[(h >>> 4) % LEAD_JACKETS.length] : roleColor(role),
    badge: lead ? -1 : gi, // the lead wears a tie, lapels and a star instead
    pants: lead ? "#1d2444" : "#33384d",
    style: lead ? 0 : (((h >>> 6) % 8) as Look["style"]),
    cut: lead ? 0 : (((h >>> 24) & 3) as 0 | 1 | 2 | 3),
    build: lead ? 1 : (((h >>> 12) & 1) as 0 | 1),
    head: lead ? 0 : (((h >>> 13) & 1) as 0 | 1),
    acc: lead ? "suit" : ROLE_ACC[role] ?? (["none", "glasses", "cap"] as Accessory[])[(h >>> 9) % 3],
    accColor: hsl((hash(role) + 40) % 360, 0.6, 0.45),
    ...(team === undefined ? {} : { team: ((Math.trunc(team) % TEAMS) + TEAMS) % TEAMS }),
    ...(lead ? { lead: { jacket: LEAD_JACKETS[(h >>> 4) % LEAD_JACKETS.length], lens: LEAD_LENS[(h >>> 7) % LEAD_LENS.length], beard: LEAD_BEARD[(h >>> 10) % LEAD_BEARD.length], chain: ((h >>> 20) & 1) as 0 | 1, dot: LEAD_DOTS[(h >>> 22) % LEAD_DOTS.length] } } : {}),
  };
}

// Static furniture/emote textures: a small fixed set (roles x screens). 
const cache = new Map<string, Texture>();
// People: one texture per look x dir x pose x frame x expression/lift/dip/drop, so capped; evicted textures are destroyed.
// shortcut: assumes fewer than ~PEOPLE_MAX distinct textures live on screen at once (actors re-fetch every frame), raise it if the office grows.
const PEOPLE_MAX = 2048; // 6-pose walks cost ~1.5x textures per look (each ~1.5 KB)
const people = new Lru<Texture>(PEOPLE_MAX, (t) => t.destroy(true));
export const memo = (key: string, make: () => Grid) => {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make().outline(theme().outline).texture()));
  return t;
};
export const memoRaw = (key: string, make: () => Grid) => {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make().texture()));
  return t;
};

/** Glyph rows stamped with a 1px halo (8-neighbourhood), so it is legible on any background. */
function stamp(g: Grid, x: number, y: number, rows: string[], fill: string, halo: string) {
  rows.forEach((r, j) => [...r].forEach((c, i) => { if (c === "#") for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) g.set(x + i + a, y + j + b, halo); }));
  g.map(x, y, rows, { "#": fill });
}

// ---- R2 grading: people sit on the KEY.char value bands; the face is the brightest part of every figure -----------------
/** Status hues (STATUS permission, working, turn, blocked; idle is grey): shirts keep 30 degrees away so a shirt never reads as a status. */
export const STATUS_HUES = [39, 154, 193, 354];
const hueSat = (hex: string) => {
  const n = parseInt(hex.slice(1), 16), [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  if (!d) return { h: 0, s: 0 };
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: d / (1 - Math.abs(2 * l - 1)) };
};
const far = (h: number) => STATUS_HUES.every((s) => Math.abs(((h - s + 540) % 360) - 180) >= 30);
/** The nearest hue at least 30 degrees from every status hue. */
export const awayFromStatus = (h: number) => { for (let d = 0; d <= 180; d++) for (const x of [h - d, h + d]) if (far((x + 360) % 360)) return (x + 360) % 360; return h; };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const band = (c: string, lo: number, hi: number) => { const l = luma(c); return l < lo || l > hi ? toLuma(c, clamp(l, lo, hi)) : c; };
/** Muted (saturation <= 0.45) and out of the status hues, then onto the shirt band under the face. */
const cloth = (c: string, hi: number) => {
  const { h, s } = hueSat(c);
  const m = s > 0.08 ? hsl(awayFromStatus(h), Math.min(s, 0.45), 0.5) : c; // greys stay grey
  return toLuma(m, clamp(luma(c), KEY.char.shirt[0], hi));
};
/** The look as drawn: skin in the face band, shirt/hair/accessories below the face, dark hair lifted off the navy floor and outline. */
export function grade(l: Look): Look {
  const C = KEY.char, skin = band(l.skin, C.face[0], C.face[1]), top = luma(skin);
  const shirt = cloth(l.shirt, Math.min(C.shirt[1], top - 0.1));
  return {
    ...l, skin, shirt,
    hair: band(l.hair, C.hair[0] + 0.02, Math.min(C.hair[1], top - 0.12)), // room for the rim light under the face
    pants: band(l.pants, C.pants[0], C.pants[1]),
    accColor: band(l.accColor, 0, top - 0.04),
    ...(l.lead ? { lead: { ...l.lead, jacket: shirt } } : {}),
  };
}
/** Role pictogram ink: a light step of the shirt (critique R3), still darker than the face. `look` is graded. */
export const glyphInk = (look: Look) => toLuma(look.shirt, Math.max(luma(look.shirt) + 0.08, luma(look.skin) - 0.04));

/** 16x24 person. Sitting bodies are drawn 7px lower so the hands rest on the desk tile below. */
export function person(look0: Look, dir: Dir, pose: Pose, frame: number, o: PoseOpts = {}): Grid {
  const hooded = look0.cut === 3 && !look0.lead && look0.acc !== "cap" && look0.acc !== "headphones" && look0.acc !== "bun";
  const graded = grade(look0);
  // a raised hood is drawn as hair in the shirt colour (crown, sides, back), plus a column each side that widens the head
  const look: Look = hooded ? { ...graded, hair: shade(graded.shirt, -0.08), style: 1 } : graded;
  const g = new Grid(16, 24);
  const couch = pose === "couch";
  const sit = pose !== "walk" && !couch;
  const think = !!o.think; // hand on chin
  const leaned = pose === "sit-think"; // idle at the desk: leaned back 1px off the desk, arms down, hands off the keyboard
  const bd: Dir = pose === "sit-glance" ? "down" : dir; // body view; only the head turns in sit-glance
  const f = frame % WALK_FRAMES;
  const expr = o.expr ?? "neutral";
  const oy = (sit ? 7 : couch ? 3 : o.drop ?? 1) - (leaned ? 1 : 0); // standing sits 1px lower so the bob/breath/topknot never clip the top edge; drop = sit-down/stand-up transition
  const bob = !sit && (o.lift || (BOB[f] && !settings.reducedMotion)) ? -1 : 0;
  const Y = (y: number) => y + oy + bob;
  const hv = look.head, H = (y: number) => Y(y) + (o.dip ? 1 : 0), HT = (y: number) => H(y + hv); // HT: head-top rows start lower on a shorter head
  const side = dir === "side", bs = bd === "side", stocky = look.build === 1;
  const bx = bs ? (stocky ? 4 : 5) : stocky ? 3 : 4, bw = bs ? (stocky ? 7 : 6) : stocky ? 10 : 8;
  const [ax0, ax1] = stocky ? [2, 13] : [3, 12];
  const cut = hooded ? 3 : look.cut ?? 0, sleeve = cut === 2 && look.style !== 5 ? shade(look.shirt, -0.1) : look.shirt; // raglan: two-tone sleeves (long-back hair hides them and would leave a 1px stub)
  const gold = luma(GOLD) > luma(look.skin) - 0.02 ? toLuma(GOLD, luma(look.skin) - 0.02) : GOLD;
  const arm = (x: number, y: number, w: number, h: number, c = sleeve) => { g.rect(x, y, w, h, c); if (cut === 1 && h > 2) g.rect(x, y + 2, w, h - 2, look.skin); }; // short sleeves: forearm skin

  if (couch) { // thighs forward (toward the viewer), shins down over the seat edge
    g.rect(4, 20, 3, 3, look.pants); g.rect(9, 20, 3, 3, look.pants);
    g.rect(4, 23, 3, 1, SHOE); g.rect(9, 23, 3, 1, SHOE);
  } else if (!sit) {
    if (bs) { // far leg drawn first and a step darker; near leg over it. Toes point forward (+x).
      const [fd, nd] = SIDE[f], fl = f === 5 ? 4 : 5, nl = f === 2 ? 4 : 5;
      g.rect(6 + fd, 17, 2, fl, shade(look.pants, -0.1)); g.rect(6 + fd, 17 + fl - 1, 3, 1, SHOE);
      g.rect(8 + nd, 17, 2, nl, look.pants); g.rect(8 + nd, 17 + nl - 1, 3, 1, SHOE);
    } else {
      const l = LEG_L[f], r = LEG_R[f];
      g.rect(4, 17, 3, l, look.pants); g.rect(9, 17, 3, r, look.pants);
      g.rect(4, 17 + l - 1, 3, 1, SHOE); g.rect(9, 17 + r - 1, 3, 1, SHOE);
    }
  }
  // torso (stretched by the bob so the waist never gaps) + role pictogram under the tie
  g.rect(bx, Y(10), bw, 7 - bob, look.shirt);
  const team = look.team === undefined ? null : teamColor(look.team);
  g.rect(bx, Y(15) - bob, bw, 1, team ?? shade(look.shirt, -0.12)); // hem and badge halo: the team colour when the session has one
  if (look.badge >= 0 && bd !== "up") stamp(g, look.acc === "tie" && bd === "down" ? 4 : 6, Y(10), GLYPHS[look.badge], glyphInk(look), team ? shade(team, -0.3) : "#171421"); // soft grey, not white: the face stays the brightest part (critique R3) // badge halo carries the team hue
  const L = look.lead;
  if (L && bd === "down") { // portrait lead: open collar V over a dark shirt, lapel edges, optional gold chain + pendant
    const inner = "#1a1722";
    g.rect(5, Y(10), 6, 1, inner); g.rect(6, Y(11), 4, 1, inner); g.rect(7, Y(12), 2, 3, inner);
    g.set(7, Y(11), L.dot);
    g.rect(bx + 1, Y(10), 1, 4, shade(look.shirt, -0.16)); g.rect(bx + bw - 2, Y(10), 1, 4, shade(look.shirt, -0.16));
    if (L.chain) { g.set(5, Y(10), gold); g.set(6, Y(11), gold); g.set(7, Y(12), gold); g.set(10, Y(10), gold); g.set(9, Y(11), gold); g.set(8, Y(12), gold); g.rect(7, Y(13), 2, 1, gold); }
  } else if (!L && (look.acc === "tie" || look.acc === "suit")) {
    if (bd === "down") { g.rect(7, Y(10), 2, 5, look.acc === "suit" ? "#c23b4a" : look.accColor); g.rect(7, Y(10), 2, 1, shade(look.acc === "suit" ? "#c23b4a" : look.accColor, -0.12)); } // knot: a darker fold, not white (the face stays brightest)
  }
  if (L && bd !== "side") { g.rect(ax0 - 1, Y(10), 1, 2, shade(look.shirt, -0.16)); g.rect(ax1 + 1, Y(10), 1, 2, shade(look.shirt, -0.16)); } // lead cue: padded blazer shoulders, the widest silhouette in the room
  const swing = sit ? 0 : SWING[f];
  const raised = expr === "stretch" && !bs && !couch;
  const hand = o.raise && !bs && !couch && !raised; // waiting on you: the right hand goes up beside the head
  if (hand) { g.rect(ax1, Y(10), 1, 1, sleeve); g.rect(ax1 + 1, Y(3), 1, 8, sleeve); g.rect(ax1 + 1, Y(1), 1, 2, look.skin); } // one column outside the head, hair and ear cups; the hand clears the crown
  if (raised) {
    g.rect(ax0, Y(5), 1, 6, look.shirt); g.rect(ax1, Y(5), 1, 6, look.shirt);
    g.set(ax0, Y(4), look.skin); g.set(ax1, Y(4), look.skin);
  } else if (couch && dir === "up") { // lounging, seen from behind: arms at the sides (the couch back hides the rest)
    g.rect(ax0, Y(10), 1, 4, look.shirt); g.rect(ax1, Y(10), 1, 4, look.shirt);
  } else if (couch) { // forearms in, hands together on a phone
    g.rect(ax0, Y(10), 1, 4, look.shirt); g.rect(ax1, Y(10), 1, 4, look.shirt);
    g.rect(ax0 + 1, Y(13), 2, 1, look.shirt); g.rect(ax1 - 2, Y(13), 2, 1, look.shirt);
    g.rect(6, Y(13), 4, 1, look.skin); g.rect(7, Y(11), 2, 2, KEY.cyan);
  } else if (bs) {
    const ay = sit ? Y(11) : Y(10) + swing;
    arm(7, ay, 2, 5, cut === 2 ? sleeve : shade(look.shirt, 0.08)); g.rect(7, ay + 5, 2, 1, look.skin);
    if (expr === "stretch") { g.rect(12, Y(5), 1, 6, look.shirt); g.set(12, Y(4), look.skin); }
  } else if (sit && leaned) { // arms hang at the sides, hands rest out of sight: nothing on the keyboard
    arm(ax0, Y(10), 1, 5); if (!hand) arm(ax1, Y(10), 1, 5);
    g.set(ax0, Y(15), look.skin); if (!hand && !think) g.set(ax1, Y(15), look.skin);
  } else if (sit) { // working: forearms along the desk edge, both hands meet on the keyboard in the middle; a knuckle lifts, alternating per typing frame
    const typing = frame % 2 === 0, fore = cut === 1 ? look.skin : sleeve, both = !hand && !think;
    arm(ax0, Y(10), 1, 5); g.rect(ax0, Y(15), 3, 1, fore); g.rect(ax0 + 3, Y(15), both ? ax1 - ax0 - 5 : 2, 1, look.skin);
    const knuckle = (x: number) => { if (bd !== "up") g.set(x, Y(14), look.skin); }; // from behind the body hides them
    knuckle(typing ? ax0 + 3 : ax0 + 4);
    if (both) { arm(ax1, Y(10), 1, 5); g.rect(ax1 - 2, Y(15), 3, 1, fore); knuckle(typing ? ax1 - 4 : ax1 - 3); }
  } else {
    arm(ax0, Y(10) + swing, 1, 5); if (!hand) arm(ax1, Y(10) - swing, 1, 5);
    g.set(ax0, Y(15) + swing, look.skin); if (!hand) g.set(ax1, Y(15) - swing, look.skin);
  }
  if (expr === "phone" && dir !== "up") g.rect(side ? 9 : 10, Y(side ? 12 : 13), 2, 1, KEY.cyan); // phone glow: a machine emitter, not the your-turn cyan
  // head
  g.rect(4, HT(2), 8, 8 - hv, look.skin);
  const acc = look.accColor, wide = hooded || look.style === 7;
  if (look.style === 7) g.rect(3, HT(1), 10, 4, look.hair); // puffy: a crown wider than the head
  if (look.style === 6) { if (dir === "up") g.rect(7, H(10), 2, 3, look.hair); else g.rect(side ? 3 : 12, H(3), 1, 5, look.hair); } // ponytail: down the back, or out past the head
  if (dir === "up") {
    g.rect(4, HT(2), 8, 8 - hv, look.hair);
    if (look.style === 4) g.rect(5, H(10), 6, 1, look.hair);
    if (look.style === 5) g.rect(5, H(10), 6, 4, look.hair);
    // no back-view streak: it was a 1px stub at x=9 (1.5px right of centre) that read as a stray mark on a faded entrant at the door
  } else {
    g.rect(4, HT(2), 8, 3, look.hair);
    if (side) g.rect(4, HT(2), 4, 8 - hv, look.hair);
    else if (look.acc !== "cap") { g.set(4, H(5), look.hair); g.set(11, H(5), look.hair); } // sideburns; the cap brim would leave them as single pixels
    if (look.style === 1) { g.rect(4, H(5), 1, 5, look.hair); if (!side) g.rect(11, H(5), 1, 5, look.hair); } // side: the face edge stays skin
    if (look.style === 2) { g.set(5, HT(1), look.hair); g.set(8, HT(1), look.hair); g.set(10, HT(1), look.hair); }
    if (look.style === 3 || look.acc === "bun") g.rect(7, HT(1), 3, 2, look.hair); // topknot: starts one row below the sprite top so its outline is kept
    if (look.style === 4) { // bob: chin-length sides
      if (side) g.rect(8, H(5), 1, 3, look.hair); else { g.rect(4, H(5), 2, 4, look.hair); g.rect(10, H(5), 2, 4, look.hair); }
      g.rect(side ? 5 : 4, H(5), 1, 3, acc); // outer column: glasses would cut an inner streak into single pixels
    }
    if (look.style === 5) { // long back: falls past the shoulders
      if (side) { g.rect(3, H(4), 2, 9, look.hair); g.rect(3, H(6), 1, 5, acc); }
      else { g.rect(3, H(4), 2, 9, look.hair); g.rect(11, H(4), 2, 9, look.hair); g.rect(12, H(7), 1, 5, acc); }
    }
  }
  if (L) { // curly hair: bumps along the crown and curls down the sides to the ears
    for (const x of side ? [4, 6, 8] : [4, 6, 8, 10]) g.set(x, HT(1), look.hair);
    if (dir === "down") { g.rect(4, H(5), 1, 3, look.hair); g.rect(11, H(5), 1, 3, look.hair); }
    if (dir !== "up") { // a forehead under the curls, then the beard on the jaw (rows 8-9) with a lip pixel
      g.rect(dir === "down" ? 5 : 8, H(4), dir === "down" ? 6 : 4, 1, look.skin);
      const bc = shade(look.hair, 0.02), stub = shade(look.skin, -0.2), lip = "#b5655b";
      if (dir === "down") {
        if (L.beard === 0) { g.rect(4, H(8), 8, 2, bc); g.set(4, H(7), bc); g.set(11, H(7), bc); g.rect(7, H(8), 2, 1, lip); }
        else if (L.beard === 1) { g.rect(4, H(8), 8, 2, stub); g.rect(7, H(8), 2, 1, lip); }
        else { g.rect(5, H(7), 6, 1, bc); g.rect(6, H(8), 4, 2, bc); g.rect(7, H(8), 2, 1, lip); }
      } else if (L.beard === 0) { g.rect(6, H(8), 6, 2, bc); g.rect(9, H(7), 3, 1, bc); }
      else if (L.beard === 1) g.rect(7, H(8), 5, 2, stub);
      else { g.rect(8, H(7), 3, 1, bc); g.rect(9, H(8), 3, 2, bc); }
    }
  }
  if (wide) { g.rect(3, HT(3), 1, 4, look.hair); if (!side) g.rect(12, HT(3), 1, 4, look.hair); } // hood rim / puffy sides
  // rim light: a lit crown edge plus the key-light (left) edge, so dark hair reads against the navy floor, chairs and outline
  const lit = toLuma(shade(look.hair, 0.14), Math.min(luma(shade(look.hair, 0.14)), luma(look.skin) - 0.02)), xl = wide ? 3 : 4;
  for (let y = HT(1); y <= HT(3); y++) if (g.get(xl, y) === look.hair) g.set(xl, y, lit);
  if (dir === "up") { // back of the head: a lit crown row and a skin nape row under the hair, no dark slab (it read as a hole)
    g.rect(5, HT(2), 6, 1, lit);
    if (!hooded && look.style !== 4 && look.style !== 5 && look.style !== 6) g.rect(5, H(9), 6, 1, look.skin);
  }
  else g.rect(side ? 4 : 5, HT(2), side ? 5 : 6, 1, lit);
  if (dir === "down") {
    g.set(6, H(6), DARK); g.set(9, H(6), DARK);
    if (look.acc === "glasses") { g.rect(5, H(6), 3, 1, DARK); g.rect(8, H(6), 3, 1, DARK); }
  } else if (side) {
    g.set(9, H(6), DARK);
    if (look.acc === "glasses") g.rect(8, H(6), 3, 1, DARK);
  }
  if (dir !== "up") face(g, expr, dir === "down" ? [6, 9] : [9], dir === "down" ? 6 : 8, H, look.skin);
  if (L && dir !== "up") { // tinted aviators over the eyes (after the face so the eyes stay hidden)
    const lens = L.lens, glint = shade(lens, 0.25);
    if (dir === "down") { g.rect(5, H(5), 2, 2, lens); g.rect(9, H(5), 2, 2, lens); g.rect(7, H(5), 2, 1, DARK); g.set(4, H(5), DARK); g.set(11, H(5), DARK); g.set(5, H(5), glint); g.set(9, H(5), glint); }
    else { g.rect(8, H(5), 3, 2, lens); g.rect(5, H(5), 3, 1, DARK); g.set(11, H(5), DARK); g.set(8, H(5), glint); }
  }
  if (look.acc === "headphones") { g.rect(4, HT(1), 8, 1, acc); g.rect(3, H(4), 1, 4, acc); g.rect(12, H(4), 1, 4, acc); }
  if (o.sip && dir === "down") { g.rect(10, H(6), 3, 3, "#f4f1e6"); g.rect(10, H(6), 3, 1, "#6b4a2e"); g.set(13, H(7), "#f4f1e6"); g.rect(9, H(9), 3, 1, look.skin); } // mug raised to the face
  else if (think && dir === "down") g.rect(9, H(8), 3, 2, look.skin); // hand on chin
  if (look.acc === "cap") { g.rect(4, HT(1), 8, 3, acc); if (dir !== "up") g.rect(side ? 8 : 4, HT(4), side ? 4 : 8, 1, shade(acc, -0.15)); }
  separate(g, look.skin, [look.hair, lit, look.shirt, sleeve, shade(look.shirt, 0.08), team]);
  return g;
}

/** Where skin touches one of `body` with nearly equal value (pale shirt on pale skin, blonde fringe), that pixel takes a separating value. */
const SEP_MIN = 0.12;
export function separate(g: Grid, skin: string, body: (string | null)[]) {
  const ls = luma(skin), fix = new Map<string, string>();
  for (const c of body) if (c && c !== skin && Math.abs(luma(c) - ls) < SEP_MIN) fix.set(c, contrast(c, skin, SEP_MIN + 0.02));
  if (!fix.size) return;
  const hit: number[] = [];
  g.cells.forEach((c, i) => {
    if (!c || !fix.has(c)) return;
    const x = i % g.w, y = (i / g.w) | 0;
    if (g.get(x - 1, y) === skin || g.get(x + 1, y) === skin || g.get(x, y - 1) === skin || g.get(x, y + 1) === skin) hit.push(i);
  });
  for (const i of hit) g.cells[i] = fix.get(g.cells[i]!)!;
}

/** Brows, mouth, sweat: `eyes` are the eye columns (the first is the left one), `m` the leftmost of a 4px mouth. */
export function face(g: Grid, expr: Expr, eyes: number[], m: number, H: (y: number) => number, skin: string) {
  const mouth = shade(skin, -0.4);
  const left = (x: number) => x < 8;
  if (expr === "focus") for (const x of eyes) g.rect(left(x) ? x - 1 : x, H(5), 2, 1, DARK);
  else if (expr === "worry") {
    for (const x of eyes) { g.set(left(x) ? x - 1 : x + 1, H(5), DARK); g.set(x, H(4), DARK); }
    g.rect(m + 1, H(8), 2, 1, mouth); g.set(m, H(9), mouth); g.set(m + 3, H(9), mouth);
  } else if (expr === "stuck") {
    g.set(12, H(5), "#8fe0ff"); g.set(12, H(6), "#8fe0ff");
    [0, 1, 0, 1].forEach((d, i) => g.set(m + i, H(8 + d), mouth));
  } else if (expr === "happy") {
    for (const x of eyes) { g.set(x, H(6), skin); g.set(x - 1, H(6), DARK); g.set(x, H(5), DARK); g.set(x + 1, H(6), DARK); }
    [0, 1, 1, 0].forEach((d, i) => g.set(m + i, H(8 + d), mouth));
  } else if (expr === "yawn") g.rect(m + 1, H(8), 2, 2, DARK);
}

export const personTex = (look: Look, dir: Dir, pose: Pose, frame: number, o: PoseOpts = {}) => {
  // a back view shows no face, so face expressions share the neutral texture there
  const expr = dir === "up" && o.expr !== "stretch" ? "neutral" : o.expr ?? "neutral";
  const fr = pose === "walk" ? frame % WALK_FRAMES : pose === "sit" || pose === "sit-glance" ? frame % 2 : 0;
  const key = `${lookKey(look)}:${dir}${pose}${fr}${expr}${o.lift ? "L" : ""}${o.dip ? "D" : ""}${o.think ? "T" : ""}${o.sip ? "S" : ""}${o.raise ? "R" : ""}${o.drop ?? 0}${settings.reducedMotion ? "r" : ""}`;
  let t = people.get(key);
  if (!t) people.set(key, (t = person(look, dir, pose, fr, { ...o, expr }).outline(theme().outline, true).texture())); // selective: soft on the lit edge (R8)
  return t;
};

// ---- furniture -------------------------------------------------------------------------------

// One key light from the top-left: lit rows lean warm, shadow rows lean cool (ramp-shifted hue, not plain black/white).
/** Filled box with a 1px lit top edge and darker right/bottom edges. */
