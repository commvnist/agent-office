// Character art: the procedural people (workers, leads), their looks, poses and faces. Environment art lives in sprites.ts.
import type { Texture } from "pixi.js";
import { Grid, hash, hsl, shade } from "./pixel.ts";
import { contrast, luma, shadeTo } from "./color.ts";
import { roleColor, theme } from "./theme.ts";
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
/** style: 0 plain, 1 long sides, 2 spikes, 3 top-knot, 4 bob, 5 long-back. build: 1 = stocky. head: 1 = 1px shorter head. */
export type Look = { skin: string; hair: string; shirt: string; pants: string; style: 0 | 1 | 2 | 3 | 4 | 5; build: 0 | 1; head: 0 | 1; acc: Accessory; accColor: string; badge: number; team?: number; lead?: LeadLook };
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
export type PoseOpts = { expr?: Expr; lift?: boolean; dip?: boolean; drop?: number; think?: boolean; sip?: boolean };

const ROLE_ACC: Record<string, Accessory> = {
  architect: "glasses", frontend: "headphones", backend: "cap", qa: "glasses", reviewer: "tie", researcher: "bun",
};
// Walk cycle, 6 poses: contact, down, passing, then the mirror. Per pose: front/back leg lengths, body lift, arm swing,
// and [far, near] leg x offsets in the side view (the far leg is the darker one, so the alternation reads).
export const WALK_FRAMES = 6;
const LEG_L = [5, 5, 4, 5, 4, 5], LEG_R = [5, 4, 5, 5, 5, 4];
const BOB = [0, 0, 1, 0, 0, 1], SWING = [-1, -1, 0, 1, 1, 0];
const SIDE = [[-2, 2], [-1, 1], [0, 0], [2, -2], [1, -1], [0, 0]];

// 3x4 role pictograms (index = GLYPHS slot), drawn in GLYPH_INK on a dark halo so they read on any shirt
export const GLYPH_INK = "#c4c8d6";
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
    style: lead ? 0 : (((h >>> 6) % 6) as Look["style"]),
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

/** 16x24 person. Sitting bodies are drawn 7px lower so the hands rest on the desk tile below. */
/** Near-black hair fuses with the sprite outline and a dark floor (a head that "vanishes" from behind, an L-shaped side view): keep it readable. */
const HAIR_MIN_LUMA = 0.22;
const readableHair = (c: string) => (luma(c) < HAIR_MIN_LUMA ? shadeTo(c, "#8087ad", 0.5) : c);

export function person(look0: Look, dir: Dir, pose: Pose, frame: number, o: PoseOpts = {}): Grid {
  const look: Look = { ...look0, hair: readableHair(look0.hair) };
  const g = new Grid(16, 24);
  const couch = pose === "couch";
  const sit = pose !== "walk" && !couch;
  const think = pose === "sit-think" || !!o.think;
  const bd: Dir = pose === "sit-glance" ? "down" : dir; // body view; only the head turns in sit-glance
  const f = frame % WALK_FRAMES;
  const expr = o.expr ?? "neutral";
  const oy = (sit ? 7 : couch ? 3 : o.drop ?? 1) + (think ? 1 : 0); // standing sits 1px lower so the bob/breath/topknot never clip the top edge // thinking slumps 1px; drop = sit-down/stand-up transition
  const bob = !sit && (o.lift || (BOB[f] && !settings.reducedMotion)) ? -1 : 0;
  const Y = (y: number) => y + oy + bob;
  const hv = look.head, H = (y: number) => Y(y) + (o.dip ? 1 : 0), HT = (y: number) => H(y + hv); // HT: head-top rows start lower on a shorter head
  const side = dir === "side", bs = bd === "side", stocky = look.build === 1;
  const bx = bs ? (stocky ? 4 : 5) : stocky ? 3 : 4, bw = bs ? (stocky ? 7 : 6) : stocky ? 10 : 8;
  const [ax0, ax1] = stocky ? [2, 13] : [3, 12];

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
  if (look.badge >= 0 && bd !== "up") stamp(g, look.acc === "tie" && bd === "down" ? 4 : 6, Y(10), GLYPHS[look.badge], GLYPH_INK, team ? shade(team, -0.3) : "#171421"); // soft grey, not white: the face stays the brightest part (critique R3) // badge halo carries the team hue
  const L = look.lead;
  if (L && bd === "down") { // portrait lead: open collar V over a dark shirt, lapel edges, optional gold chain + pendant
    const inner = "#1a1722";
    g.rect(5, Y(10), 6, 1, inner); g.rect(6, Y(11), 4, 1, inner); g.rect(7, Y(12), 2, 3, inner);
    g.set(7, Y(11), L.dot);
    g.rect(bx + 1, Y(10), 1, 4, shade(look.shirt, -0.16)); g.rect(bx + bw - 2, Y(10), 1, 4, shade(look.shirt, -0.16));
    if (L.chain) { g.set(5, Y(10), GOLD); g.set(6, Y(11), GOLD); g.set(7, Y(12), GOLD); g.set(10, Y(10), GOLD); g.set(9, Y(11), GOLD); g.set(8, Y(12), GOLD); g.rect(7, Y(13), 2, 1, GOLD); }
  } else if (!L && (look.acc === "tie" || look.acc === "suit")) {
    if (bd === "down") { g.rect(7, Y(10), 2, 5, look.acc === "suit" ? "#c23b4a" : look.accColor); g.rect(7, Y(10), 2, 1, "#f2f2f2"); }
  }
  if (!L && look.acc === "suit" && bd === "down") { // lead: gold lapels + star badge
    g.rect(bx + 1, Y(10), 1, 3, GOLD); g.rect(bx + bw - 2, Y(10), 1, 3, GOLD);
    g.map(bx + bw - 3, Y(11), [".#.", "###", ".#."], { "#": GOLD });
  }
  const swing = sit ? 0 : SWING[f];
  const raised = expr === "stretch" && !bs && !couch;
  if (raised) {
    g.rect(ax0, Y(5), 1, 6, look.shirt); g.rect(ax1, Y(5), 1, 6, look.shirt);
    g.set(ax0, Y(4), look.skin); g.set(ax1, Y(4), look.skin);
  } else if (couch) { // forearms in, hands together on a phone
    g.rect(ax0, Y(10), 1, 4, look.shirt); g.rect(ax1, Y(10), 1, 4, look.shirt);
    g.rect(ax0 + 1, Y(13), 2, 1, look.shirt); g.rect(ax1 - 2, Y(13), 2, 1, look.shirt);
    g.rect(6, Y(13), 4, 1, look.skin); g.rect(7, Y(11), 2, 2, "#7fe3ff");
  } else if (bs) {
    const ay = sit ? Y(11) : Y(10) + swing;
    g.rect(7, ay, 2, 5, shade(look.shirt, 0.08)); g.rect(7, ay + 5, 2, 1, look.skin);
    if (expr === "stretch") { g.rect(12, Y(5), 1, 6, look.shirt); g.set(12, Y(4), look.skin); }
  } else if (sit) {
    g.rect(ax0, Y(10), 1, 4, look.shirt); g.rect(ax1, Y(10), 1, 4, look.shirt);
    const typing = frame % 2 === 0;
    g.rect(ax0, Y(14), 3, 2, look.skin);
    if (!think) { g.rect(ax1 - 2, Y(14), 3, 2, look.skin); g.rect(typing ? ax1 - 2 : ax1 - 1, Y(15), 2, 1, look.skin); }
    g.rect(typing ? ax0 + 1 : ax0, Y(15), 2, 1, look.skin);
  } else {
    g.rect(ax0, Y(10) + swing, 1, 5, look.shirt); g.rect(ax1, Y(10) - swing, 1, 5, look.shirt);
    g.set(ax0, Y(15) + swing, look.skin); g.set(ax1, Y(15) - swing, look.skin);
  }
  if (expr === "phone" && dir !== "up") g.rect(side ? 9 : 10, Y(side ? 12 : 13), 2, 1, "#7fe3ff"); // phone glow
  // head
  g.rect(4, HT(2), 8, 8 - hv, look.skin);
  const acc = look.accColor, streak = look.style >= 4;
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
  // rim light: a lit crown edge (plus a parting from behind) so the head reads as a head against any shirt or floor
  const lit = shade(look.hair, 0.14), hairDark = shade(look.hair, -0.12);
  if (dir === "up") { g.rect(5, HT(2), 6, 1, lit); g.rect(7, HT(3), 2, 4, hairDark); }
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
  separate(g, look.skin, [look.hair, lit, hairDark, look.shirt, shade(look.shirt, 0.08), team]);
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
  const key = `${lookKey(look)}:${dir}${pose}${fr}${expr}${o.lift ? "L" : ""}${o.dip ? "D" : ""}${o.think ? "T" : ""}${o.sip ? "S" : ""}${o.drop ?? 0}${settings.reducedMotion ? "r" : ""}`;
  let t = people.get(key);
  if (!t) people.set(key, (t = person(look, dir, pose, fr, { ...o, expr }).outline(theme().outline).texture()));
  return t;
};

// ---- furniture -------------------------------------------------------------------------------

// One key light from the top-left: lit rows lean warm, shadow rows lean cool (ramp-shifted hue, not plain black/white).
/** Filled box with a 1px lit top edge and darker right/bottom edges. */
