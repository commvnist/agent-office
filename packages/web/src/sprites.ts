import type { Texture } from "pixi.js";
import { Grid, shade } from "./pixel.ts";
import { hsl, toLuma } from "./color.ts";
import { KEY, STATUS, theme } from "./theme.ts";
import { settings } from "./settings.ts";
import type { ToolIconName } from "./choreo.ts";

// Character art moved to people.ts (re-exported here, so importers are unchanged).
import { memo, memoRaw, person, WALK_FRAMES, type Dir, type Look } from "./people.ts";
export * from "./people.ts";
// Environment art is graded to the R2 value key (theme.ts KEY): env ramp E[0..5], emitters at 85%+, paper the brightest non-light.
const E = KEY.env, CY = KEY.cyan, PAPER = KEY.paper;
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

// chair upholstery: slate, teal, plum, amber (outer ~20%, back ~27%, base ~14%)
const CHAIRS = ["#3b3f55", "#2c4f58", "#4a3556", "#5a4a2c"].map((c) => [toLuma(c, 0.2), toLuma(c, 0.27), toLuma(c, 0.14)]);
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
    slab(g, 4, 8, 8, 3, c[1]); g.rect(4, 8, 8, 1, c[0]); g.rect(7, 11, 2, 4, E[2]); g.rect(4, 14, 8, 1, E[0]); g.rect(5, 15, 6, 1, "rgba(26,20,40,0.22)");
    return g;
  });

/** A vacant chair or stool (R8): the room's own env ramp, so it never reads as a lit block, with a 1 px trim in the last occupant's session hue (-1: none). */
export const vacantChairTex = (stool: boolean, hue: number) =>
  memo(`vchair:${+stool}:${hue}`, () => {
    const g = new Grid(16, 16), trim = hue >= 0 ? hsl(hue, 0.5, 0.5) : E[4];
    if (stool) { slab(g, 4, 8, 8, 3, E[3]); g.rect(4, 8, 8, 1, trim); g.rect(7, 11, 2, 4, E[2]); g.rect(4, 14, 8, 1, E[0]); return g; }
    slab(g, 3, 2, 10, 11, E[3]); slab(g, 4, 3, 8, 9, E[4]); slab(g, 2, 10, 12, 3, E[3]); g.rect(4, 2, 8, 1, trim);
    return g;
  });

/** The table tile that joins two desks of a bench pod: same top and front as a desk, with a shared item on it (plant, papers, hub, mugs). */
export const benchTex = (v: number) =>
  memo(`bench:${Math.abs(v) % 4}`, () => {
    const g = new Grid(16, 16), d = theme().desk;
    slab(g, 0, 1, 16, 5, d.top); g.rect(0, 1, 16, 1, d.edge);
    slab(g, 0, 6, 16, 9, d.front); g.rect(1, 8, 14, 6, d.inset); g.rect(3, 10, 2, 1, d.top); g.rect(11, 10, 2, 1, d.top);
    const k = Math.abs(v) % 4;
    if (k === 0) { g.rect(6, 3, 4, 3, toLuma("#a0633a", 0.28)); g.rect(5, 0, 6, 3, toLuma("#4fa05a", 0.3)); g.rect(7, 0, 2, 1, toLuma("#7fd18a", 0.45)); }
    else if (k === 1) { g.rect(4, 2, 5, 3, PAPER); g.rect(5, 1, 5, 3, shade(PAPER, -0.08)); }
    else if (k === 2) { g.rect(5, 3, 6, 2, E[1]); g.rect(7, 3, 1, 1, CY); g.rect(9, 3, 1, 1, CY); }
    else { g.rect(4, 2, 3, 3, PAPER); g.rect(9, 2, 3, 3, toLuma("#c0524d", 0.3)); }
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
    const base = screen === 0 ? E[0] : screen === 3 ? E[1] : "#12304a"; // lit glass stays a deep blue so the content glows
    const content = (x: number, rows: number, w: number) => {
      if (screen === 3) g.rect(x, 1 + (variant && x < 8 ? 1 : 0), 2, 1, E[3]); // dim idle screen: one faint line
      else if (screen) for (let r = 0; r < rows; r++) g.rect(x, (variant && x < 8 ? 2 : 1) + r, 1 + ((r * 2 + screen * 3) % w), 1, r % 2 ? accent : CY);
    };
    // right monitor: bevel on top, 2x1 stand; the bezel (E2) sits between floor and desk top so it reads against both
    g.rect(8, 0, 7, 6, E[2]); g.rect(8, 0, 7, 1, E[4]);
    g.rect(9, 1, 5, 4, base);
    content(9, 4, 4);
    g.rect(11, 6, 2, 1, E[2]);
    if (variant) {
      g.rect(0, 1, 6, 4, E[2]); g.rect(0, 1, 6, 1, E[4]); // leaves x6..7 free for the role item
      g.rect(1, 2, 4, 2, base);
      content(1, 2, 3);
      g.rect(2, 5, 2, 2, E[2]);
      g.rect(1, 5, 6, 1, shade(PAPER, -0.1));
    } else {
      g.rect(4, 1, 1, 1, E[1]); g.rect(3, 2, 3, 1, E[1]); // lamp pole + base; the shade is drawn per state
      g.rect(3, 3, 5, 2, shade(PAPER, -0.1)); g.rect(3, 3, 5, 1, PAPER);
      g.rect(0, 2, 2, 2, PAPER); g.set(0, 2, toLuma("#c9604a", 0.3));
      const steam = toLuma("#dfe6f5", 0.55);
      if (screen === 1) { g.set(0, 1, steam); g.set(1, 0, steam); }
      else if (screen === 2) { g.set(0, 0, steam); g.set(1, 1, steam); }
    }
    if (style === 1) { // standing: the cabinet becomes two raised legs and a thin riser, so the top reads higher
      g.rect(1, 7, 14, 8, null); g.rect(2, 7, 2, 8, d.front); g.rect(12, 7, 2, 8, d.front); g.rect(2, 7, 12, 1, shade(d.front, -0.2));
      g.rect(4, 14, 8, 1, shade(d.front, -0.2));
    } else if (style === 2) { // carrel: low fabric screens down both sides
      for (const x of [0, 14]) { g.rect(x, 0, 2, 15, E[3]); g.rect(x, 0, 2, 1, E[5]); }
    }
    return g;
  });

export const laptopTex = (tier: number) =>
  memo(`laptop:${tier}`, () => {
    const g = new Grid(16, 16);
    if (tier === 0) {
      slab(g, 2, 4, 12, 3, E[4]); g.rect(3, 7, 2, 7, E[3]); g.rect(11, 7, 2, 7, E[2]); // stool-table
    } else {
      slab(g, 0, 3, 16, 3, toLuma("#d4d7e2", 0.42)); g.rect(1, 6, 1, 9, toLuma("#7e8296", 0.3)); g.rect(14, 6, 1, 9, toLuma("#666a7e", 0.24));
      g.rect(2, 11, 12, 1, toLuma("#7e8296", 0.3));
    }
    g.rect(4, -1, 8, 5, toLuma("#c9ccd8", 0.45)); g.rect(5, 0, 6, 3, "#112033"); g.rect(6, 1, 3, 1, CY);
    g.rect(3, 4, 10, 1, toLuma("#9a9eb0", 0.36));
    return g;
  });

/**
 * One cabinet of the server bank, 13 px wide (geometry.ts CAB_W; the bank is inset 8 px from the room edge). `pos` 0/1/2 = left/middle/right:
 * same height, LED rows on the same y, a 1px lit seam where cabinets meet so the three read as one row. `blink` flips which LEDs are lit.
 */
export const rackTex = (blink: 0 | 1, pos: 0 | 1 | 2 = 0) =>
  memo(`rack:${blink}:${pos}`, () => {
    const g = new Grid(13, 16);
    g.rect(0, 0, 13, 16, E[2]);
    g.rect(0, 0, 13, 1, E[4]); // lit top edge
    g.rect(0, 15, 13, 1, E[0]); // base
    if (pos !== 2) g.rect(12, 0, 1, 15, E[4]); // lit seam against the next cabinet
    if (pos !== 0) g.rect(0, 1, 1, 14, E[1]); // shadowed seam on this side
    for (let i = 0; i < 4; i++) {
      g.rect(1, 2 + i * 3, 11, 2, E[0]); g.rect(2, 2 + i * 3, 5, 1, E[3]);
      g.set(9, 3 + i * 3, (i + blink) % 2 ? CY : KEY.cyanOff); g.set(10, 3 + i * 3, (i + blink) % 3 ? KEY.cyanOff : KEY.warm);
    }
    return g;
  });

/** Wall sconce: wall plate, short arm and a flared shade lit from below; the halo and pool come from lights(). 16x16, top on the y=3 baseline. Even-width, mirrored about the tile centre. */
export const sconceTex = () =>
  memo("sconce", () => {
    const g = new Grid(16, 16);
    g.rect(6, 0, 4, 2, E[3]); g.rect(7, 2, 2, 3, E[4]); // wall plate, arm
    g.rect(6, 5, 4, 1, E[4]); g.rect(5, 6, 6, 2, E[3]); g.rect(4, 8, 8, 2, E[3]); // shade, flaring down
    g.set(5, 6, E[5]); g.set(4, 8, E[5]); // top-left key light on the shade
    g.rect(4, 10, 8, 1, "#dcecff"); g.rect(6, 11, 4, 1, CY); // lit rim, bulb glow under it
    return g;
  });

/** Floor lamp: weighted base, thin pole, a dark cap over a flared warm shade with a darker rim (reads as a lamp, not a stool). 16x16. */
export const floorLampTex = () =>
  memo("floorlamp", () => {
    const g = new Grid(16, 16);
    g.rect(5, 14, 6, 2, E[2]); g.rect(5, 14, 6, 1, E[4]); g.rect(7, 7, 2, 7, E[4]); g.set(7, 7, E[5]);
    g.rect(6, 0, 4, 1, E[3]); // cap
    g.rect(5, 1, 6, 2, KEY.warm); g.rect(4, 3, 8, 3, KEY.warm); g.rect(5, 1, 2, 1, "#ffe9c0"); // flared shade, top-left highlight
    g.rect(4, 6, 8, 1, toLuma("#a8743a", 0.4)); // lower rim
    return g;
  });

/** Pod junction box: 6x4 dark steel with a lit top edge; the status LED is a separate pooled sprite at (4,1). */
export const junctionTex = () =>
  memo("junction", () => {
    const g = new Grid(6, 4);
    g.rect(0, 0, 6, 4, E[1]); g.rect(0, 0, 6, 1, E[4]); g.rect(0, 3, 6, 1, E[0]);
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
    const leaf = toLuma("#3fa14c", 0.28);
    g.rect(5, 9, 6, 6, toLuma("#a8643c", 0.28)); g.rect(5, 9, 6, 1, toLuma("#c78250", 0.36));
    g.rect(7, 4, 2, 6, toLuma("#2f7d3a", 0.2));
    g.rect(3, 3, 4, 3, leaf); g.rect(9, 2, 4, 4, toLuma("#46b256", 0.34)); g.rect(5, 0, 6, 4, leaf);
    return g;
  });

/** `on`: status lamp green while any session is active, red otherwise. `wisp` 0/1: a two-frame steam wisp off the top vent (-1: none). */
export const coffeeTex = (on = false, wisp = -1) =>
  memo(`coffee:${on}:${wisp}`, () => {
    const g = new Grid(16, 16);
    g.rect(2, 2, 12, 13, E[3]); g.rect(2, 2, 12, 1, E[4]); g.rect(3, 3, 10, 5, E[0]); g.rect(5, 4, 6, 3, toLuma("#7a4a2a", 0.22));
    g.rect(6, 10, 4, 4, PAPER); g.rect(11, 9, 2, 1, on ? "#5be37d" : "#e0524a");
    const steam = "rgba(223,230,245,0.55)";
    if (wisp === 0) { g.set(7, 1, steam); g.set(8, 0, steam); }
    else if (wisp === 1) { g.set(8, 1, steam); g.set(7, 0, steam); }
    return g;
  });

export const coolerTex = () =>
  memo("cooler", () => {
    const g = new Grid(16, 16);
    g.rect(4, 0, 8, 7, toLuma("#9ad7f5", 0.45)); g.rect(5, 1, 6, 5, toLuma("#c9ecfb", 0.55));
    g.rect(3, 7, 10, 8, toLuma("#d9dce8", 0.42)); g.rect(5, 9, 2, 2, "#4aa3e0"); g.rect(9, 9, 2, 2, "#e0524a");
    return g;
  });

export const shelfTex = () =>
  memo("shelf", () => {
    const g = new Grid(16, 16);
    slab(g, 1, 0, 14, 16, E[3]); g.rect(2, 1, 12, 6, E[1]); g.rect(2, 9, 12, 6, E[1]); g.rect(2, 1, 12, 1, E[0]); g.rect(2, 9, 12, 1, E[0]);
    const books = ["#d85a5a", "#e8c25a", "#5a9ad8", "#6bc17a", "#b86bd8"].map((c) => toLuma(c, 0.32));
    books.forEach((c, i) => { g.rect(3 + i * 2, 2, 2, 5, c); g.rect(3 + i * 2, 10, 2, 5, i ? books[0] : books[2]); });
    return g;
  });

/**
 * Couch seen from behind (it faces its table, above it): arms and two seat cushions, then the high back along the bottom edge.
 * `back` draws the back rail alone: the scene stacks it over a seated figure, so only the head and shoulders show above it.
 */
export const couchTex = (back = false) =>
  memo(`couch:${back}`, () => {
    const g = new Grid(32, 16);
    if (!back) {
      for (const x of [0, 28]) { slab(g, x, 2, 4, 8, shade(E[3], -0.04)); g.rect(x, 2, 4, 1, E[4]); } // arm rests, front to back
      for (const x of [4, 16]) { slab(g, x, 3, 12, 7, E[4]); g.rect(x, 3, 4, 1, E[5]); } // seat cushions, lit front edge
    }
    slab(g, 0, 9, 32, 7, E[3]); g.rect(0, 9, 32, 1, E[4]); g.rect(1, 9, 6, 1, E[5]); // high back, rim light from the top left
    return g;
  });

/** 16x32 phone booth (1x2 tiles): frosted door facing +x, a dim status strip over it. */
export const boothTex = () =>
  memo("booth", () => {
    const g = new Grid(16, 32);
    slab(g, 1, 0, 14, 32, E[3]); g.rect(3, 3, 9, 24, E[1]); g.rect(4, 4, 7, 22, E[2]); g.rect(4, 4, 7, 1, E[4]);
    g.rect(12, 8, 2, 14, E[0]); g.rect(5, 1, 6, 1, CY); g.rect(5, 28, 6, 2, E[0]);
    return g;
  });

export const fridgeTex = () =>
  memo("fridge", () => {
    const g = new Grid(16, 16);
    slab(g, 3, 0, 10, 16, E[5]); g.rect(3, 5, 10, 1, E[1]); g.rect(3, 6, 10, 1, shade(E[5], 0.1)); // freezer seam, lit lip below it
    g.rect(10, 1, 1, 3, E[0]); g.rect(10, 8, 1, 5, E[0]); g.set(11, 1, E[3]); g.set(11, 8, E[3]); // door handles
    return g;
  });

/** Low lounge table, 32x16 (two tiles): same composite as the desks, with a lit edge. */
export const tableTex = () =>
  memo("table", () => {
    const g = new Grid(32, 16), d = theme().desk;
    slab(g, 3, 5, 26, 6, d.top); g.rect(3, 5, 26, 1, d.edge); g.rect(3, 10, 26, 1, d.front); g.rect(5, 11, 2, 3, d.front); g.rect(25, 11, 2, 3, d.front);
    g.rect(7, 13, 18, 1, "rgba(13,11,26,0.45)"); // shadow under the top, between the legs
    g.rect(13, 6, 5, 3, PAPER); g.rect(21, 6, 3, 3, toLuma("#c0524d", 0.3));
    return g;
  });

/** Armchair seen from behind, facing up toward the lounge table like the couch: arm rests, seat, high back on the bottom edge. Symmetric, never mirrored. */
export const armchairTex = () =>
  memo("armchair", () => {
    const g = new Grid(16, 16);
    for (const x of [1, 12]) { slab(g, x, 3, 3, 8, shade(E[3], -0.04)); g.rect(x, 3, 3, 1, E[4]); }
    slab(g, 4, 4, 8, 6, E[4]); g.rect(4, 4, 3, 1, E[5]);
    slab(g, 1, 9, 14, 6, E[3]); g.rect(1, 9, 14, 1, E[4]); g.rect(2, 9, 4, 1, E[5]);
    return g;
  });

/** Round collaboration table; k = 0 carries the projector, k = 1 a hub and papers. */
export const huddleTex = (k: number) =>
  memo(`huddle:${k & 1}`, () => {
    const g = new Grid(16, 16), d = theme().desk;
    g.rect(2, 3, 12, 10, d.top); g.rect(4, 1, 8, 14, d.top); g.rect(4, 13, 8, 2, d.front); g.rect(2, 11, 12, 2, d.front);
    g.rect(4, 1, 8, 1, d.edge);
    if (k & 1) { g.rect(5, 6, 4, 3, PAPER); g.rect(10, 6, 2, 2, E[1]); g.set(10, 6, CY); }
    else { g.rect(6, 5, 5, 4, E[1]); g.rect(6, 5, 5, 1, E[3]); g.set(9, 7, CY); g.set(10, 7, CY); }
    return g;
  });

/**
 * Holo-map table (critique L5), 32x16: a low dark plinth whose top is the map: a dim cyan coastline lit into the glass, one
 * city and a waypoint. Grounded (nothing hovers: a floating projection read as debris) and still. Raw, with its own outline.
 */
export const holoTex = () =>
  memoRaw("holo", () => {
    const g = new Grid(32, 16), o = theme().outline, D = toLuma(CY, 0.32); // land: a dim step of the emitter cyan
    g.rect(5, 8, 22, 8, o); slab(g, 6, 9, 20, 6, E[3]); g.rect(6, 9, 20, 4, E[1]); // glass top over the plinth
    g.rect(6, 13, 20, 1, E[4]); g.set(6, 13, E[5]); // front lip catches the light
    // an asymmetric coastline (a symmetric pair of lights reads as a face), brighter on its upper edge
    g.map(8, 9, [".###....##.....", "#####..####....", ".##....#####..."], { "#": D });
    g.map(8, 9, [".###....##....."], { "#": CY });
    g.set(10, 10, KEY.paper); g.set(19, 11, KEY.warm);
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
  cross: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  message: [".....", "#####", "##.##", "#.#.#", "#####"], // an envelope: something arrived, nothing needs you
  wait: [".....", ".....", ".....", ".....", ".....", "#.#.#"], // queued for a desk: an ellipsis, not "?"
};
export type Emote = "exclaim" | "check" | "question" | "bulb" | "heart" | "flag" | "cross" | "message" | "wait" | "dots0" | "dots1" | "dots2";
// amber "!" and cyan "?" mean only "needs you" (R1): arrivals and queueing are paper
const EMOTE_COLOR: Record<string, string> = { exclaim: STATUS.permission.color, check: "#5be37d", question: STATUS.turn.color, bulb: "#ffe08a", heart: "#ff7a9a", flag: "#ff4a4a", cross: STATUS.blocked.color, message: KEY.paper, wait: KEY.paper };
// 11x7 thought cloud: # outline, o fill; the dots are lit left to right
const CLOUD = ["..###.###..", ".#ooo#ooo#.", "#ooooooooo#", "#ooooooooo#", ".#ooooooo#.", "..#######..", ".....#....."];
/**
 * Alert ring as a pixel sprite at art scale (it snaps with the 16px art instead of a smooth vector stroke).
 * Shape carries the state as well as colour: permission = 4 solid arcs, turn = a dotted ring, blocked = 6 short arcs.
 */
export const ringTex = (kind: "permission" | "turn" | "blocked") =>
  memo(`ring:${kind}`, () => {
    const R = 12, C = 13, g = new Grid(27, 27), col = STATUS[kind].color;
    for (let y = 0; y < 27; y++) for (let x = 0; x < 27; x++) {
      const dx = x - C, dy = y - C, d = Math.hypot(dx, dy), a = (Math.atan2(dy, dx) + Math.PI * 2.25) % (Math.PI * 2);
      if (Math.abs(d - R) < 0.6) {
        const on = kind === "turn" ? Math.floor(a / (Math.PI / 16)) % 2 === 0
          : (a % ((Math.PI * 2) / (kind === "permission" ? 4 : 6))) < ((Math.PI * 2) / (kind === "permission" ? 4 : 6)) * 0.62;
        if (on) g.set(x, y, col);
      } else if (kind !== "turn" && Math.abs(d - (R - 3)) < 0.5) g.set(x, y, col + "59"); // faint inner ring (35% alpha)
    }
    return g;
  });

/** Long tool call progress (R6): the alert ring's 1 px circle, lit clockwise from the top for `n` of 16 steps; white, tinted by the caller. */
export const ARC_STEPS = 16;
export const arcTex = (n: number) =>
  memoRaw(`arc:${n}`, () => {
    const R = 12, C = 13, g = new Grid(27, 27);
    for (let y = 0; y < 27; y++) for (let x = 0; x < 27; x++) {
      const dx = x - C, dy = y - C, a = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2); // 0 at the top, clockwise
      if (Math.abs(Math.hypot(dx, dy) - R) < 0.6 && a < (Math.PI * 2 * n) / ARC_STEPS) g.set(x, y, "#ffffff");
    }
    return g;
  });

export const emoteTex = (e: Emote) =>
  memo(`emote:${e}`, () => {
    if (e.startsWith("dots")) {
      const g = new Grid(11, 7), n = Number(e[4]) + 1;
      // paper, not white: the face stays the brightest part of a figure (R6)
      g.map(0, 0, CLOUD, { "#": "#2a2d3f", o: KEY.paper });
      for (let i = 0; i < 3; i++) g.set(3 + i * 2, 3, i < n ? E[1] : E[4]);
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
/** Bubble corner-chip glyphs per hook event type, 7x7 white like the tool icons (tinted by the caller, drawn at a whole-number scale). */
const BADGE_ICONS: Record<string, string[]> = {
  prompt: [".......", ".#.....", ".##....", "..##...", ".##....", ".#.....", "......."],
  delegate: TOOL_ICONS.arrow,
  report: [".......", "......#", ".....##", "#...##.", "##.##..", ".###...", "..#...."],
  guess: ["..###..", ".#...#.", ".....#.", "....#..", "...#...", ".......", "...#..."],
  tool: ["...#...", ".#####.", ".#.#.#.", ".#.#.#.", ".#.#.#.", ".#####.", "...#..."],
  message: [".......", "#######", "##...##", "#.#.#.#", "#..#..#", "#######", "......."],
};
export const badgeIconTex = (k: string) => memoRaw(`badge:${k}`, () => { const g = new Grid(7, 7); g.map(0, 0, BADGE_ICONS[k] ?? BADGE_ICONS.message, { "#": "#ffffff" }); return g; });

/** 9x9 status pip, one per state (shape, not colour alone): dot = working, "!"/"?" = waiting, x = gave up, square = queued, ring = idle. */
export const PIP = 9;
const DISC = ["..#####..", ".#ooooo#.", "#ooooooo#", "#ooooooo#", "#ooooooo#", "#ooooooo#", "#ooooooo#", ".#ooooo#.", "..#####.."];
const PIP_GLYPH: Record<string, string[]> = {
  permission: ["....#....", "....#....", "....#....", ".........", "....#...."],
  turn: ["...###...", ".....#...", "....#....", ".........", "....#...."],
  blocked: ["..#...#..", "...#.#...", "....#....", "...#.#...", "..#...#.."],
};
export function pipGrid(s: string, wait: "permission" | "turn" = "permission"): Grid {
  const g = new Grid(PIP, PIP), rim = E[0];
  if (s === "queued") { g.rect(0, 0, PIP, PIP, rim); g.rect(1, 1, PIP - 2, PIP - 2, KEY.text.fg); return g; }
  if (s === "working") { g.map(0, 0, DISC, { "#": rim, o: STATUS.working.color }); return g; }
  if (s === "waiting" || s === "blocked") {
    const k = s === "blocked" ? "blocked" : wait;
    g.map(0, 0, DISC, { "#": rim, o: STATUS[k].color });
    g.map(0, 2, PIP_GLYPH[k], { "#": k === "blocked" ? KEY.text.fg : E[0] });
    return g;
  }
  g.map(0, 0, DISC, { "#": STATUS.idle.color }); // idle / thinking: an empty ring
  return g;
}
export const pipTex = (s: string, wait: "permission" | "turn" = "permission") => memoRaw(`pip:${s}:${s === "waiting" ? wait : ""}`, () => pipGrid(s, wait));

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


/** Expanding alert pulse as three pixel-ring frames (radius 4, 6, 8 art px), white for tinting: no vector stroke at device scale (R5). */
export const pulseTex = (i: number) =>
  memoRaw(`pulse${i}`, () => {
    const r = [4, 6, 8][i] ?? 8, n = 2 * r + 1, g = new Grid(n, n);
    for (let a = 0; a < 360; a += 2) g.set(Math.round(r + r * Math.cos((a * Math.PI) / 180)), Math.round(r + r * Math.sin((a * Math.PI) / 180)), "#ffffff");
    return g;
  });
