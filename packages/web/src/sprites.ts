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
  const key = `${lookKey(look)}:${dir}${pose}${fr}${expr}${o.lift ? "L" : ""}${o.dip ? "D" : ""}${o.think ? "T" : ""}${o.sip ? "S" : ""}${o.drop ?? 0}${settings.reducedMotion ? "r" : ""}`;
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

// chair upholstery: slate, teal, plum, amber (outer, back, base)
const CHAIRS = [["#3b3f55", "#4a4f69", "#2f3246"], ["#2c4f58", "#3a6b78", "#223d45"], ["#4a3556", "#62466f", "#382a42"], ["#5a4a2c", "#7a6338", "#44381f"]];
export const CHAIR_STYLES = CHAIRS.length;
export const chairTex = (v = 0) =>
  memo(`chair:${v}`, () => {
    const g = new Grid(16, 16), c = CHAIRS[v % CHAIRS.length];
    slab(g, 3, 2, 10, 11, c[0]); slab(g, 4, 3, 8, 9, c[1]); slab(g, 2, 10, 12, 3, c[2]);
    return g;
  });

/** Drafting stool for standing-desk pods: a small round seat on a thin post with a foot ring (the occupant perches, not sits). */
export const stoolTex = (v = 0) =>
  memo(`stool:${v}`, () => {
    const g = new Grid(16, 16), c = CHAIRS[v % CHAIRS.length];
    slab(g, 4, 8, 8, 3, c[1]); g.rect(4, 8, 8, 1, c[0]); g.rect(7, 11, 2, 4, "#2a2d3b"); g.rect(4, 14, 8, 1, "#171a24"); g.rect(5, 15, 6, 1, "rgba(26,20,40,0.22)");
    return g;
  });

/** The table tile that joins two desks of a bench pod: same top and front as a desk, with a shared item on it (plant, papers, hub, mugs). */
export const benchTex = (v: number) =>
  memo(`bench:${Math.abs(v) % 4}`, () => {
    const g = new Grid(16, 16), d = theme().desk;
    slab(g, 0, 1, 16, 5, d.top); g.rect(0, 1, 16, 1, d.edge);
    slab(g, 0, 6, 16, 9, d.front); g.rect(1, 8, 14, 6, d.inset); g.rect(3, 10, 2, 1, d.top); g.rect(11, 10, 2, 1, d.top);
    const k = Math.abs(v) % 4;
    if (k === 0) { g.rect(6, 3, 4, 3, "#a0633a"); g.rect(5, 0, 6, 3, "#4fa05a"); g.rect(7, 0, 2, 1, "#7fd18a"); }
    else if (k === 1) { g.rect(4, 2, 5, 3, "#e8e4d6"); g.rect(5, 1, 5, 3, "#cfcab8"); }
    else if (k === 2) { g.rect(5, 3, 6, 2, "#2a2d3b"); g.rect(7, 3, 1, 1, "#7fe3ff"); g.rect(9, 3, 1, 1, "#7fe3ff"); }
    else { g.rect(4, 2, 3, 3, "#e9edf5"); g.rect(9, 2, 3, 3, "#c0524d"); }
    return g;
  });

/**
 * Desk seen from the front; the monitor is angled so its screen faces the camera.
 * variant 0: single monitor + lamp + mug (steam wisps while working); 1: dual-monitor rig.
 */
export const deskTex = (accent: string, screen: 0 | 1 | 2 | 3, variant: 0 | 1 = 0, style: 0 | 1 | 2 = 0) =>
  memo(`desk:${accent}:${screen}:${variant}:${style}`, () => {
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
    if (style === 1) { // standing: the cabinet becomes two raised legs and a thin riser, so the top reads higher
      g.rect(1, 7, 14, 8, null); g.rect(2, 7, 2, 8, d.front); g.rect(12, 7, 2, 8, d.front); g.rect(2, 7, 12, 1, shade(d.front, -0.2));
      g.rect(4, 14, 8, 1, shade(d.front, -0.2));
    } else if (style === 2) { // carrel: low fabric screens down both sides
      for (const x of [0, 14]) { g.rect(x, 0, 2, 15, "#3b4a6e"); g.rect(x, 0, 2, 1, "#6a7aa8"); }
    }
    return g;
  });

export const laptopTex = (tier: number) =>
  memo(`laptop:${tier}`, () => {
    const g = new Grid(16, 16);
    if (tier === 0) {
      slab(g, 2, 4, 12, 3, "#5a6a98"); g.rect(3, 7, 2, 7, "#3a4366"); g.rect(11, 7, 2, 7, "#2d3454"); // stool-table
    } else {
      slab(g, 0, 3, 16, 3, "#d4d7e2"); g.rect(1, 6, 1, 9, "#7e8296"); g.rect(14, 6, 1, 9, "#666a7e");
      g.rect(2, 11, 12, 1, "#7e8296");
    }
    g.rect(4, -1, 8, 5, "#c9ccd8"); g.rect(5, 0, 6, 3, "#112033"); g.rect(6, 1, 3, 1, "#7fe3ff");
    g.rect(3, 4, 10, 1, "#9a9eb0");
    return g;
  });

/** Wall-hugging server rack; `blink` flips which LEDs are lit. */
/** One cabinet of the server bank. `pos` 0/1/2 = left/middle/right: all the same height, LED rows on the same y, a 1px lit seam where racks meet so the three read as one row. */
export const rackTex = (blink: 0 | 1, pos: 0 | 1 | 2 = 0) =>
  memo(`rack:${blink}:${pos}`, () => {
    const g = new Grid(16, 16);
    g.rect(0, 0, 16, 16, "#2e3144");
    g.rect(0, 0, 16, 1, "#4a5170"); // lit top edge
    g.rect(0, 15, 16, 1, "#171a24"); // base
    if (pos !== 2) g.rect(15, 0, 1, 15, "#4a5170"); // lit seam against the next cabinet
    if (pos !== 0) g.rect(0, 1, 1, 14, "#1f2233"); // shadowed seam on this side
    for (let i = 0; i < 4; i++) {
      g.rect(2, 2 + i * 3, 11, 2, "#1b1d2b"); g.rect(3, 2 + i * 3, 5, 1, "#3a3e55");
      g.set(10, 3 + i * 3, (i + blink) % 2 ? "#5be37d" : "#2c5a3a"); g.set(11, 3 + i * 3, (i + blink) % 3 ? "#2c5a3a" : "#ffb347");
    }
    return g;
  });

/** Wall sconce: a bracket plate with a lit lens; the pool under it comes from lights(). 16x16, placed 10px below the cove. */
export const sconceTex = () =>
  memo("sconce", () => {
    const g = new Grid(16, 16);
    g.rect(7, 0, 2, 5, "#4a5578"); g.rect(5, 5, 6, 2, "#2d3556"); g.rect(6, 7, 4, 1, "#dcecff"); g.set(7, 8, "#9fd8ee"); g.set(8, 8, "#9fd8ee");
    return g;
  });

/** Floor lamp: weighted base, pole, warm shade. 16x16 (one tile). */
export const floorLampTex = () =>
  memo("floorlamp", () => {
    const g = new Grid(16, 16);
    g.rect(5, 14, 6, 2, "#2a2f45"); g.rect(7, 6, 2, 8, "#5a6490");
    g.rect(4, 1, 8, 5, "#ffc870"); g.rect(4, 1, 8, 1, "#ffe3a8"); g.rect(5, 6, 6, 1, "#a8743a");
    return g;
  });

/** Pod junction box: 6x4 dark steel with a lit top edge; the status LED is a separate pooled sprite at (4,1). */
export const junctionTex = () =>
  memo("junction", () => {
    const g = new Grid(6, 4);
    g.rect(0, 0, 6, 4, "#1c2030"); g.rect(0, 0, 6, 1, "#5a6490"); g.rect(0, 3, 6, 1, "#10131f");
    return g;
  });

/** How busy the office is, 0..1: more working seats and a bigger working share of the seated both raise it. 0 when nobody is seated. */
export const activity = (working: number, used: number) =>
  used <= 0 ? 0 : Math.min(1, (Math.min(working, used) / 6) * 0.7 + (Math.min(working, used) / used) * 0.3);

/** Deterministic 0..1 noise for LED `i` at time step `step`: no Math.random in the hot path. */
export const ledNoise = (i: number, step: number) => (Math.imul(Math.imul(i + 1, 374761393) ^ Math.imul(step + 1, 668265263), 2246822519) >>> 8) / 16777216;

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
    slab(g, 1, 0, 14, 16, "#3a4366"); g.rect(2, 1, 12, 6, "#171b30"); g.rect(2, 9, 12, 6, "#171b30"); g.rect(2, 1, 12, 1, "#10131f"); g.rect(2, 9, 12, 1, "#10131f");
    ["#d85a5a", "#e8c25a", "#5a9ad8", "#6bc17a", "#b86bd8"].forEach((c, i) => { g.rect(3 + i * 2, 2, 2, 5, c); g.rect(3 + i * 2, 10, 2, 5, c === "#d85a5a" ? "#5a9ad8" : "#d85a5a"); });
    return g;
  });

export const couchTex = () =>
  memo("couch", () => {
    const g = new Grid(32, 16);
    slab(g, 1, 3, 30, 7, "#3b4a6e");
    slab(g, 0, 7, 4, 8, "#323f5f"); slab(g, 28, 7, 4, 8, "#323f5f");
    slab(g, 4, 9, 11, 5, "#4a5a82"); slab(g, 17, 9, 11, 5, "#4a5a82");
    return g;
  });

/** 16x32 phone booth (1x2 tiles): frosted door facing +x, a dim status strip over it. */
export const boothTex = () =>
  memo("booth", () => {
    const g = new Grid(16, 32);
    slab(g, 1, 0, 14, 32, "#2d3556"); g.rect(3, 3, 9, 24, "#1c2238"); g.rect(4, 4, 7, 22, "#2a3a58"); g.rect(4, 4, 7, 1, "#4a5a82");
    g.rect(12, 8, 2, 14, "#171b30"); g.rect(5, 1, 6, 1, "#7fe3ff"); g.rect(5, 28, 6, 2, "#171b30");
    return g;
  });

export const fridgeTex = () =>
  memo("fridge", () => {
    const g = new Grid(16, 16);
    slab(g, 3, 0, 10, 16, "#aab4cc"); g.rect(3, 6, 10, 1, "#6a7390"); g.rect(11, 2, 1, 3, "#4a5068"); g.rect(11, 8, 1, 4, "#4a5068");
    return g;
  });

/** Low lounge table, 32x16 (two tiles): same composite as the desks, with a lit edge. */
export const tableTex = () =>
  memo("table", () => {
    const g = new Grid(32, 16), d = theme().desk;
    slab(g, 3, 5, 26, 6, d.top); g.rect(3, 5, 26, 1, d.edge); g.rect(5, 11, 2, 3, d.front); g.rect(25, 11, 2, 3, d.front);
    g.rect(13, 6, 5, 3, "#e8e4d6"); g.rect(21, 6, 3, 3, "#c0524d");
    return g;
  });

/** Armchair facing the table (+x); the scene mirrors it for the right-hand side. */
export const armchairTex = () =>
  memo("armchair", () => {
    const g = new Grid(16, 16);
    slab(g, 2, 3, 12, 11, "#3b4a6e"); slab(g, 3, 5, 9, 7, "#4a5a82"); slab(g, 1, 7, 3, 7, "#323f5f");
    return g;
  });

/** Round collaboration table; k = 0 carries the projector, k = 1 a hub and papers. */
export const huddleTex = (k: number) =>
  memo(`huddle:${k & 1}`, () => {
    const g = new Grid(16, 16), d = theme().desk;
    g.rect(2, 3, 12, 10, d.top); g.rect(4, 1, 8, 14, d.top); g.rect(4, 13, 8, 2, d.front); g.rect(2, 11, 12, 2, d.front);
    g.rect(4, 1, 8, 1, d.edge);
    if (k & 1) { g.rect(5, 6, 4, 3, "#e8e4d6"); g.rect(10, 6, 2, 2, "#2a2d3b"); g.set(10, 6, "#7fe3ff"); }
    else { g.rect(6, 5, 5, 4, "#2a2d3b"); g.rect(6, 5, 5, 1, "#4a5068"); g.set(9, 7, "#7fe3ff"); g.set(10, 7, "#7fe3ff"); }
    return g;
  });

// ---- wall tile + floor print -----------------------------------------------------------------

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

export const whiteTex = () => memoRaw("white", () => { const g = new Grid(1, 1); g.set(0, 0, "#ffffff"); return g; });

// ---- fun layer (flairfx.ts): cosmetics only ----------------------------------------------------

/** Sleeping cat curled on a cushion, 10x6. */
export const catTex = () => memo("cat", () => {
  const g = new Grid(10, 6);
  g.rect(1, 2, 8, 3, "#e8a45c"); g.rect(2, 1, 3, 2, "#e8a45c"); g.set(2, 0, "#e8a45c"); g.set(4, 0, "#e8a45c");
  g.rect(6, 2, 2, 1, "#c27a38"); g.rect(3, 3, 1, 1, "#1d1b2b"); g.rect(8, 4, 2, 1, "#e8a45c"); g.rect(1, 4, 8, 1, "#c27a38");
  return g;
});

// ---- environment helpers (pure) ----------------------------------------------------------------

/** 0..1 desaturation of a desk: grows from 30 s to 5 min of real silence; the boolean `stale` alone means fully stale. */
export const staleK = (idleMs?: number, stale?: boolean) =>
  idleMs === undefined ? (stale ? 1 : 0) : Math.round(Math.max(0, Math.min(1, (idleMs - 30000) / 270000)) * 4) / 4;

/** Queue chips drawn on a desk: up to 5, and `more` is true when the queue is deeper than that (a "+" is drawn). */
export const chipStack = (depth = 0) => ({ n: Math.max(0, Math.min(5, Math.floor(depth))), more: depth > 5 });

// 3x5 pixel font for floor plates and wall signage (letters/digits used there only)
const FONT_ROWS: Record<string, string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"], B: ["##.", "#.#", "##.", "#.#", "##."], C: [".##", "#..", "#..", "#..", ".##"],
  E: ["###", "#..", "##.", "#..", "###"], F: ["###", "#..", "##.", "#..", "#.."], G: [".##", "#..", "#.#", "#.#", ".##"],
  I: ["###", ".#.", ".#.", ".#.", "###"], N: ["##.", "#.#", "#.#", "#.#", "#.#"], O: ["###", "#.#", "#.#", "#.#", "###"],
  P: ["##.", "#.#", "##.", "#..", "#.."], S: [".##", "#..", ".#.", "..#", "##."], T: ["###", ".#.", ".#.", ".#.", ".#."],
  0: ["###", "#.#", "#.#", "#.#", "###"], 1: [".#.", "##.", ".#.", ".#.", "###"], 2: ["##.", "..#", ".#.", "#..", "###"],
  3: ["##.", "..#", ".#.", "..#", "##."], 4: ["#.#", "#.#", "###", "..#", "..#"], 5: ["###", "#..", "##.", "..#", "##."],
  6: [".##", "#..", "###", "#.#", "###"], 7: ["###", "..#", ".#.", ".#.", ".#."], 8: ["###", "#.#", "###", "#.#", "###"],
  9: ["###", "#.#", "###", "..#", "##."],
};
/** Width in px of `text` in the 3x5 font (1px gap between glyphs). */
export const pxTextW = (text: string) => Math.max(0, text.length * 4 - 1);
/** Draw `text` in the 3x5 pixel font at (x, y) on a 2D canvas; unknown characters are skipped (blank). */
export function drawPx(c: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  c.fillStyle = color;
  [...text].forEach((ch, i) => FONT_ROWS[ch]?.forEach((row, j) => [...row].forEach((v, k) => { if (v === "#") c.fillRect(x + i * 4 + k, y + j, 1, 1); })));
}

// ---- ambient courier: a figure that is deliberately not an agent (own palette, hi-vis cap and band, a parcel; no tag) ------
const COURIER: Look = { skin: "#d9a07a", hair: "#2a1d12", shirt: "#4f5d3a", pants: "#2a2f3a", style: 0, build: 0, head: 0, acc: "cap", accColor: "#d7ff3a", badge: -1 };
const courierCache: Record<string, Texture> = {};
export function courierTex(dir: Dir, frame: number): Texture {
  const k = `${dir}${frame % WALK_FRAMES}${settings.reducedMotion ? "r" : ""}`;
  return (courierCache[k] ??= (() => {
    const g = person(COURIER, dir, "walk", frame);
    g.rect(4, 13, 8, 2, "#d7ff3a"); // hi-vis band, even-width and mirrored
    if (dir !== "up") { g.rect(5, 15, 6, 4, "#b88a55"); g.rect(7, 15, 2, 4, "#8a6238"); } // parcel held in front
    return g.outline(theme().outline).texture();
  })());
}
