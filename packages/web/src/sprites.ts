import type { Texture } from "pixi.js";
import { Grid, hash, hsl, shade } from "./pixel.ts";
import { contrast, luma, shadeTo } from "./color.ts";
import { roleColor, theme } from "./theme.ts";
import { settings } from "./settings.ts";
import { Lru, lookKey } from "./lru.ts";
import type { ToolIconName } from "./choreo.ts";

const SHOE = "#241d2e";
const DARK = "#1e1a28";
const GOLD = "#f2c14e";

export type Dir = "down" | "up" | "side";
export type Pose = "walk" | "sit" | "sit-think" | "sit-glance" | "couch"; // sit-glance: seated body, head in side view; couch: lounging, phone in hands
export type Accessory = "none" | "glasses" | "headphones" | "cap" | "tie" | "bun" | "suit";
/** Face/pose overlay chosen by the actor's state or idle quirk. Part of the texture key. */
export type Expr = "neutral" | "focus" | "stuck" | "happy" | "worry" | "yawn" | "stretch" | "phone";
/** style: 0 plain, 1 long sides, 2 spikes, 3 top-knot, 4 bob, 5 long-back. build: 1 = stocky. head: 1 = 1px shorter head. */
export type Look = { skin: string; hair: string; shirt: string; pants: string; style: 0 | 1 | 2 | 3 | 4 | 5; build: 0 | 1; head: 0 | 1; acc: Accessory; accColor: string; badge: number; team?: number };
/** Team colour buckets (30 degrees of hue each): the session's repo hue shows on the hem and badge halo so a team reads as a team. */
export const TEAMS = 12;
export const teamColor = (b: number) => hsl(b * 30 + 15, 0.6, 0.5);
export type PoseOpts = { expr?: Expr; lift?: boolean; dip?: boolean; drop?: number; think?: boolean };

const ROLE_ACC: Record<string, Accessory> = {
  architect: "glasses", frontend: "headphones", backend: "cap", qa: "glasses", reviewer: "tie", researcher: "bun",
};
// Walk cycle, 6 poses: contact, down, passing, then the mirror. Per pose: front/back leg lengths, body lift, arm swing,
// and [far, near] leg x offsets in the side view (the far leg is the darker one, so the alternation reads).
const WALK_FRAMES = 6;
const LEG_L = [5, 5, 4, 5, 4, 5], LEG_R = [5, 4, 5, 5, 5, 4];
const BOB = [0, 0, 1, 0, 0, 1], SWING = [-1, -1, 0, 1, 1, 0];
const SIDE = [[-2, 2], [-1, 1], [0, 0], [2, -2], [1, -1], [0, 0]];

// 3x4 role pictograms (index = GLYPHS slot), drawn white on a dark halo so they read on any shirt
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
    hair: th.hairs[(h >>> 3) % th.hairs.length],
    shirt: lead ? "#2d3a66" : roleColor(role),
    badge: lead ? -1 : gi, // the lead wears a tie, lapels and a star instead
    pants: lead ? "#1d2444" : "#33384d",
    style: ((h >>> 6) % 6) as Look["style"],
    build: ((h >>> 12) & 1) as 0 | 1,
    head: ((h >>> 13) & 1) as 0 | 1,
    acc: lead ? "suit" : ROLE_ACC[role] ?? (["none", "glasses", "cap"] as Accessory[])[(h >>> 9) % 3],
    accColor: hsl((hash(role) + 40) % 360, 0.6, 0.45),
    ...(team === undefined ? {} : { team: ((Math.trunc(team) % TEAMS) + TEAMS) % TEAMS }),
  };
}

// Static furniture/emote textures: a small fixed set (roles x screens). 
const cache = new Map<string, Texture>();
// People: one texture per look x dir x pose x frame x expression/lift/dip/drop, so capped; evicted textures are destroyed.
// shortcut: assumes fewer than ~PEOPLE_MAX distinct textures live on screen at once (actors re-fetch every frame), raise it if the office grows.
const PEOPLE_MAX = 2048; // 6-pose walks cost ~1.5x textures per look (each ~1.5 KB)
const people = new Lru<Texture>(PEOPLE_MAX, (t) => t.destroy(true));
const memo = (key: string, make: () => Grid) => {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make().outline(theme().outline).texture()));
  return t;
};
const memoRaw = (key: string, make: () => Grid) => {
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
  if (look.badge >= 0 && bd !== "up") stamp(g, look.acc === "tie" && bd === "down" ? 4 : 6, Y(10), GLYPHS[look.badge], "#ffffff", team ? shade(team, -0.3) : "#171421"); // badge halo carries the team hue
  if (look.acc === "tie" || look.acc === "suit") {
    if (bd === "down") { g.rect(7, Y(10), 2, 5, look.acc === "suit" ? "#c23b4a" : look.accColor); g.rect(7, Y(10), 2, 1, "#f2f2f2"); }
  }
  if (look.acc === "suit" && bd === "down") { // lead: gold lapels + star badge
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
    if (streak) g.rect(9, H(4), 1, 4, acc);
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
  if (look.acc === "headphones") { g.rect(4, HT(1), 8, 1, acc); g.rect(3, H(4), 1, 4, acc); g.rect(12, H(4), 1, 4, acc); }
  if (think && dir === "down") g.rect(9, H(8), 3, 2, look.skin); // hand on chin
  if (look.acc === "cap") { g.rect(4, HT(1), 8, 3, acc); if (dir !== "up") g.rect(side ? 8 : 4, HT(4), side ? 4 : 8, 1, shade(acc, -0.15)); }
  separate(g, look.skin, [look.hair, lit, hairDark, look.shirt, shade(look.shirt, 0.08), team]);
  return g;
}

/** Where skin touches one of `body` with nearly equal value (pale shirt on pale skin, blonde fringe), that pixel takes a separating value. */
const SEP_MIN = 0.12;
function separate(g: Grid, skin: string, body: (string | null)[]) {
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
function face(g: Grid, expr: Expr, eyes: number[], m: number, H: (y: number) => number, skin: string) {
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
  const key = `${lookKey(look)}:${dir}${pose}${fr}${expr}${o.lift ? "L" : ""}${o.dip ? "D" : ""}${o.think ? "T" : ""}${o.drop ?? 0}${settings.reducedMotion ? "r" : ""}`;
  let t = people.get(key);
  if (!t) people.set(key, (t = person(look, dir, pose, fr, { ...o, expr }).outline(theme().outline).texture()));
  return t;
};

// ---- furniture -------------------------------------------------------------------------------

// One key light from the top-left: lit rows lean warm, shadow rows lean cool (ramp-shifted hue, not plain black/white).
/** Filled box with a 1px lit top edge and darker right/bottom edges. */
function slab(g: Grid, x: number, y: number, w: number, h: number, c: string) {
  g.rect(x, y, w, h, c);
  g.rect(x, y, w, 1, shade(c, 0.12));
  g.rect(x + w - 1, y + 1, 1, h - 1, shade(c, -0.15));
  g.rect(x + 1, y + h - 1, w - 1, 1, shade(c, -0.15));
}

/** 14x4 contact shadow, alpha baked; sprites place it under a desk/chair (and actors, if they want it). */
export const shadowTex = () =>
  memoRaw("shadow", () => {
    const g = new Grid(14, 4);
    g.rect(2, 0, 10, 4, "rgba(26,20,40,0.22)"); g.rect(0, 1, 14, 2, "rgba(26,20,40,0.22)");
    return g;
  });

export const chairTex = () =>
  memo("chair", () => {
    const g = new Grid(16, 16);
    slab(g, 3, 2, 10, 11, "#3b3f55"); slab(g, 4, 3, 8, 9, "#4a4f69"); slab(g, 2, 10, 12, 3, "#2f3246");
    return g;
  });

/**
 * Desk seen from the front; the monitor is angled so its screen faces the camera.
 * variant 0: single monitor + lamp + mug (steam wisps while working); 1: dual-monitor rig.
 */
export const deskTex = (accent: string, screen: 0 | 1 | 2 | 3, variant: 0 | 1 = 0) =>
  memo(`desk:${accent}:${screen}:${variant}`, () => {
    const g = new Grid(16, 16);
    const d = theme().desk;
    slab(g, 0, 1, 16, 5, d.top); g.rect(0, 1, 16, 1, d.edge);
    slab(g, 0, 6, 16, 9, d.front); g.rect(1, 8, 6, 6, d.inset); g.rect(9, 8, 6, 6, d.inset);
    g.rect(3, 10, 2, 1, d.top); g.rect(11, 10, 2, 1, d.top);
    const base = screen === 0 ? "#171a24" : screen === 3 ? "#1a2230" : "#12304a";
    const content = (x: number, rows: number, w: number) => {
      if (screen === 3) g.rect(x, 1 + (variant && x < 8 ? 1 : 0), 2, 1, "#3d4a63"); // dim idle screen: one faint line
      else if (screen) for (let r = 0; r < rows; r++) g.rect(x, (variant && x < 8 ? 2 : 1) + r, 1 + ((r * 2 + screen * 3) % w), 1, r % 2 ? accent : "#7fe3ff");
    };
    // right monitor: bevel on top, 2x1 stand
    g.rect(8, 0, 7, 6, "#2a2d3b"); g.rect(8, 0, 7, 1, "#4a5068");
    g.rect(9, 1, 5, 4, base);
    content(9, 4, 4);
    g.rect(11, 6, 2, 1, "#2a2d3b");
    if (variant) {
      g.rect(0, 1, 6, 4, "#2a2d3b"); g.rect(0, 1, 6, 1, "#4a5068"); // leaves x6..7 free for the role item
      g.rect(1, 2, 4, 2, base);
      content(1, 2, 3);
      g.rect(2, 5, 2, 2, "#2a2d3b");
      g.rect(1, 5, 6, 1, "#d8dbe6");
    } else {
      g.rect(4, 1, 1, 1, "#2a2d3b"); g.rect(3, 2, 3, 1, "#2a2d3b"); // lamp pole + base; the shade is drawn per state
      g.rect(3, 3, 5, 2, "#d8dbe6"); g.rect(3, 3, 5, 1, "#f2f4fa");
      g.rect(0, 2, 2, 2, "#f2f2f2"); g.set(0, 2, "#c9604a");
      if (screen === 1) { g.set(0, 1, "#dfe6f5"); g.set(1, 0, "#dfe6f5"); }
      else if (screen === 2) { g.set(0, 0, "#dfe6f5"); g.set(1, 1, "#dfe6f5"); }
    }
    return g;
  });

export const laptopTex = (tier: number) =>
  memo(`laptop:${tier}`, () => {
    const g = new Grid(16, 16);
    if (tier === 0) {
      slab(g, 2, 4, 12, 3, "#caa06a"); g.rect(3, 7, 2, 7, "#8d6a43"); g.rect(11, 7, 2, 7, "#6f5333"); // stool-table
    } else {
      slab(g, 0, 3, 16, 3, "#d4d7e2"); g.rect(1, 6, 1, 9, "#7e8296"); g.rect(14, 6, 1, 9, "#666a7e");
      g.rect(2, 11, 12, 1, "#7e8296");
    }
    g.rect(4, -1, 8, 5, "#c9ccd8"); g.rect(5, 0, 6, 3, "#112033"); g.rect(6, 1, 3, 1, "#7fe3ff");
    g.rect(3, 4, 10, 1, "#9a9eb0");
    return g;
  });

/** Wall-hugging server rack; `blink` flips which LEDs are lit. */
export const rackTex = (blink: 0 | 1) =>
  memo(`rack:${blink}`, () => {
    const g = new Grid(16, 16);
    slab(g, 2, 0, 12, 16, "#2e3144");
    for (let i = 0; i < 4; i++) {
      g.rect(3, 1 + i * 4, 10, 3, "#1b1d2b"); g.rect(4, 2 + i * 4, 5, 1, "#3a3e55");
      g.set(11, 2 + i * 4, (i + blink) % 2 ? "#5be37d" : "#2c5a3a"); g.set(12, 2 + i * 4, (i + blink) % 3 ? "#2c5a3a" : "#ffb347");
    }
    return g;
  });

export const plantTex = () =>
  memo("plant", () => {
    const g = new Grid(16, 16);
    g.rect(5, 9, 6, 6, "#a8643c"); g.rect(5, 9, 6, 1, "#c78250");
    g.rect(7, 4, 2, 6, "#2f7d3a");
    g.rect(3, 3, 4, 3, "#3fa14c"); g.rect(9, 2, 4, 4, "#46b256"); g.rect(5, 0, 6, 4, "#3fa14c");
    return g;
  });

/** `on`: status lamp green while any session is active, red otherwise. */
export const coffeeTex = (on = false) =>
  memo(`coffee:${on}`, () => {
    const g = new Grid(16, 16);
    g.rect(2, 2, 12, 13, "#3a3d4d"); g.rect(3, 3, 10, 5, "#1a1c26"); g.rect(5, 4, 6, 3, "#7a4a2a");
    g.rect(6, 10, 4, 4, "#f2f2f2"); g.rect(11, 9, 2, 1, on ? "#5be37d" : "#e0524a");
    return g;
  });

export const coolerTex = () =>
  memo("cooler", () => {
    const g = new Grid(16, 16);
    g.rect(4, 0, 8, 7, "#9ad7f5"); g.rect(5, 1, 6, 5, "#c9ecfb");
    g.rect(3, 7, 10, 8, "#d9dce8"); g.rect(5, 9, 2, 2, "#4aa3e0"); g.rect(9, 9, 2, 2, "#e0524a");
    return g;
  });

export const shelfTex = () =>
  memo("shelf", () => {
    const g = new Grid(16, 16);
    slab(g, 1, 0, 14, 16, "#6b4a2d"); g.rect(2, 1, 12, 6, "#3f2c1a"); g.rect(2, 9, 12, 6, "#3f2c1a"); g.rect(2, 1, 12, 1, "#2a1c10"); g.rect(2, 9, 12, 1, "#2a1c10");
    ["#d85a5a", "#e8c25a", "#5a9ad8", "#6bc17a", "#b86bd8"].forEach((c, i) => { g.rect(3 + i * 2, 2, 2, 5, c); g.rect(3 + i * 2, 10, 2, 5, c === "#d85a5a" ? "#5a9ad8" : "#d85a5a"); });
    return g;
  });

export const couchTex = () =>
  memo("couch", () => {
    const g = new Grid(32, 16);
    slab(g, 1, 3, 30, 7, "#6a4a8c");
    slab(g, 0, 7, 4, 8, "#583c76"); slab(g, 28, 7, 4, 8, "#583c76");
    slab(g, 4, 9, 11, 5, "#7d5ba3"); slab(g, 17, 9, 11, 5, "#7d5ba3");
    return g;
  });

// ---- floor / wall tiles ----------------------------------------------------------------------

export const woodTex = (v: number) =>
  memoRaw(`wood${v % 2}`, () => {
    const g = new Grid(16, 16);
    const w = theme().wood;
    g.rect(0, 0, 16, 16, v % 2 ? w.b : w.a);
    const lit = shade(v % 2 ? w.b : w.a, 0.05); // plank top catches the key light just under each seam
    for (let y = 0; y < 16; y += 4) { g.rect(0, y, 16, 1, w.grain); g.rect(0, y + 1, 16, 1, lit); }
    g.rect(v % 2 ? 5 : 11, 0, 1, 4, w.grain); g.rect(v % 2 ? 12 : 3, 8, 1, 4, w.grain);
    return g;
  });

export const carpetTex = (v: number) =>
  memoRaw(`carpet${v % 2}`, () => {
    const g = new Grid(16, 16);
    const c = theme().carpet;
    g.rect(0, 0, 16, 16, c.base);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x * 7 + y * 13 + v * 5) % 11 === 0) g.set(x, y, c.fleck);
    g.rect(0, 15, 16, 1, c.edge); g.rect(15, 0, 1, 16, c.edge);
    return g;
  });

export const wallTex = () =>
  memoRaw("wall", () => {
    const g = new Grid(16, 32);
    const w = theme().wall;
    g.rect(0, 0, 16, 26, w.face); g.rect(0, 0, 16, 2, w.top);
    for (let y = 6; y < 26; y += 6) g.rect(0, y, 16, 1, w.line);
    g.rect(0, 26, 16, 6, w.base); g.rect(0, 26, 16, 1, w.trim);
    return g;
  });

// ---- emotes ----------------------------------------------------------------------------------

const ICONS: Record<string, string[]> = {
  exclaim: ["..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  check: [".....", "....#", "...#.", "#.#..", ".#..."],
  question: [".###.", "#...#", "...#.", "..#..", ".....", "..#.."],
  bulb: [".###.", "#####", "#####", ".###.", "..#..", "..#.."],
  heart: [".#.#.", "#####", "#####", ".###.", "..#.."],
  flag: ["##...", "####.", "##...", "#....", "#...."],
};
export type Emote = "exclaim" | "check" | "question" | "bulb" | "heart" | "flag" | "dots0" | "dots1" | "dots2";
const EMOTE_COLOR: Record<string, string> = { exclaim: "#ffd84a", check: "#5be37d", question: "#8fd0ff", bulb: "#ffe08a", heart: "#ff7a9a", flag: "#ff4a4a" };
// 11x7 thought cloud: # outline, o fill; the dots are lit left to right
const CLOUD = ["..###.###..", ".#ooo#ooo#.", "#ooooooooo#", "#ooooooooo#", ".#ooooooo#.", "..#######..", ".....#....."];
export const emoteTex = (e: Emote) =>
  memo(`emote:${e}`, () => {
    if (e.startsWith("dots")) {
      const g = new Grid(11, 7), n = Number(e[4]) + 1;
      g.map(0, 0, CLOUD, { "#": "#2a2d3f", o: "#f4f5fb" });
      for (let i = 0; i < 3; i++) g.set(3 + i * 2, 3, i < n ? "#2a2d3f" : "#b4b8cc");
      return g;
    }
    const g = new Grid(9, 9);
    g.map(2, 1, ICONS[e], { "#": EMOTE_COLOR[e] });
    return g;
  });

// 7x7 white glyphs, tinted by the caller; one cached texture per tool family
const TOOL_ICONS: Record<ToolIconName, string[]> = {
  book: [".......", "##...##", "###.###", "###.###", "###.###", ".##.##.", "......."],
  term: [".......", "#......", ".#.....", "..#....", ".#.....", "#..####", "......."],
  pencil: [".....##", "....###", "...###.", "..###..", ".###...", "##.#...", "##....."],
  globe: ["..###..", ".#.#.#.", "#..#..#", "#######", "#..#..#", ".#.#.#.", "..###.."],
  arrow: [".......", "...#...", "....#..", "#######", "....#..", "...#...", "......."],
  lens: [".###...", "#...#..", "#...#..", "#...#..", ".###...", "....#..", ".....#."],
};
export const toolIconTex = (k: ToolIconName) => memoRaw(`tool:${k}`, () => { const g = new Grid(7, 7); g.map(0, 0, TOOL_ICONS[k], { "#": "#ffffff" }); return g; });

// 11x11 amber "loop" glyph: top half drawn, the bottom half is its 180 degree rotation (two circular arrows)
const LOOP_TOP = ["...xxxx....", "..x....x...", ".x......x..", ".x....xxxxx", ".x.....xxx.", ".x......x.."];
export const loopTex = () => memoRaw("loop", () => {
  const g = new Grid(11, 11);
  LOOP_TOP.forEach((row, y) => [...row].forEach((c, x) => { if (c === "x") { g.set(x, y, "#ffb020"); g.set(10 - x, 10 - y, "#ffb020"); } }));
  return g.outline("#1d1b2b");
});

export const whiteTex = () => memoRaw("white", () => { const g = new Grid(1, 1); g.set(0, 0, "#ffffff"); return g; });

// ---- fun layer (flairfx.ts): cosmetics only ----------------------------------------------------

/** Sleeping cat curled on a cushion, 10x6. */
export const catTex = () => memo("cat", () => {
  const g = new Grid(10, 6);
  g.rect(1, 2, 8, 3, "#e8a45c"); g.rect(2, 1, 3, 2, "#e8a45c"); g.set(2, 0, "#e8a45c"); g.set(4, 0, "#e8a45c");
  g.rect(6, 2, 2, 1, "#c27a38"); g.rect(3, 3, 1, 1, "#1d1b2b"); g.rect(8, 4, 2, 1, "#e8a45c"); g.rect(1, 4, 8, 1, "#c27a38");
  return g;
});
