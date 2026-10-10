import type { Texture } from "pixi.js";
import { Grid, hash, hsl, shade, luma } from "./pixel.ts";
import { onThemeChange, roleColor, roleIndex, theme } from "./theme.ts";
import { settings } from "./settings.ts";

export const OUT = "#171421"; // default outline; the live value is theme().outline
const SHOE = "#241d2e";

export type Dir = "down" | "up" | "side";
export type Pose = "walk" | "sit" | "sit-think";
export type Accessory = "none" | "glasses" | "headphones" | "cap" | "tie" | "bun" | "suit";
export type Look = { skin: string; hair: string; shirt: string; pants: string; style: 0 | 1 | 2 | 3; acc: Accessory; accColor: string; badge: number; badgeColor: string };

const ROLE_ACC: Record<string, Accessory> = {
  architect: "glasses", frontend: "headphones", backend: "cap", qa: "glasses", reviewer: "tie", researcher: "bun",
};

/** Deterministic look: role decides outfit colour + accessory, the id decides the person. */
export function lookFor(role: string, id: string, lead = false): Look {
  const h = hash(id);
  const th = theme();
  const shirt = lead ? "#2d3a66" : roleColor(role);
  const ri = roleIndex(role);
  return {
    skin: th.skins[h % th.skins.length],
    hair: th.hairs[(h >> 3) % th.hairs.length],
    shirt,
    // role cue beyond hue: chest glyph by sorted role index (hash for unknown roles); the lead has a tie instead
    badge: lead ? -1 : (ri >= 0 ? ri : hash(role)) % BADGES.length,
    badgeColor: luma(shirt) > 0.6 ? "#171421" : "#ffffff",
    pants: lead ? "#1d2444" : "#33384d",
    style: ((h >> 6) % 4) as Look["style"],
    acc: lead ? "suit" : ROLE_ACC[role] ?? (["none", "glasses", "cap"] as Accessory[])[(h >> 9) % 3],
    accColor: hsl((hash(role) + 40) % 360, 0.6, 0.45),
  };
}

// 3x3 chest glyphs: square, diamond, x, T, ring, slash
const BADGES = [["###", "###", "###"], [".#.", "###", ".#."], ["#.#", ".#.", "#.#"], ["###", ".#.", ".#."], ["###", "#.#", "###"], ["..#", ".#.", "#.."]];

// Bounded: keyed by look+pose+theme-scoped; cleared on theme change.
const cache = new Map<string, Texture>();
onThemeChange(() => cache.clear());
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

/** 16x24 person. Sitting bodies are drawn 7px lower so the hands rest on the desk tile below. */
function person(look: Look, dir: Dir, pose: Pose, frame: number): Grid {
  const g = new Grid(16, 24);
  const sit = pose !== "walk";
  const think = pose === "sit-think";
  const f = frame % 4;
  const oy = (sit ? 7 : 0) + (think ? 1 : 0); // thinking slumps 1px
  const bob = !sit && f % 2 === 1 && !settings.reducedMotion ? -1 : 0;
  const Y = (y: number) => y + oy + bob;
  const side = dir === "side";
  const bx = side ? 5 : 4, bw = side ? 6 : 8;

  if (!sit) {
    if (side) {
      const sp = [0, 2, 0, -2][f];
      g.rect(6 - sp, 17, 2, 5, look.pants); g.rect(8 + sp, 17, 2, 5, look.pants);
      g.rect(5 - sp, 21, 3, 1, SHOE); g.rect(8 + sp, 21, 3, 1, SHOE);
    } else {
      const l = f === 1 ? 4 : 5, r = f === 3 ? 4 : 5;
      g.rect(4, 17, 3, l, look.pants); g.rect(9, 17, 3, r, look.pants);
      g.rect(4, 17 + l - 1, 3, 1, SHOE); g.rect(9, 17 + r - 1, 3, 1, SHOE);
    }
  }
  // torso + arms
  g.rect(bx, Y(10), bw, 7, look.shirt);
  g.rect(bx, Y(15), bw, 1, shade(look.shirt, -0.12));
  if (look.acc === "tie" || look.acc === "suit") {
    if (dir === "down") { g.rect(7, Y(10), 2, 5, look.acc === "suit" ? "#c23b4a" : look.accColor); g.rect(7, Y(10), 2, 1, "#f2f2f2"); }
  }
  if (look.acc === "suit" && dir === "down") { g.set(5, Y(11), "#f2f2f2"); g.set(10, Y(11), "#f2f2f2"); }
  const swing = sit ? 0 : [0, -1, 0, 1][f];
  if (side) {
    const ay = sit ? Y(11) : Y(10) + swing;
    g.rect(7, ay, 2, 5, shade(look.shirt, 0.08)); g.rect(7, ay + 5, 2, 1, look.skin);
  } else if (sit) {
    g.rect(3, Y(10), 1, 4, look.shirt); g.rect(12, Y(10), 1, 4, look.shirt);
    const typing = frame % 2 === 0;
    g.rect(3, Y(14), 3, 2, look.skin);
    if (!think) { g.rect(10, Y(14), 3, 2, look.skin); g.rect(typing ? 10 : 11, Y(15), 2, 1, look.skin); }
    g.rect(typing ? 4 : 3, Y(15), 2, 1, look.skin);
  } else {
    g.rect(3, Y(10) + swing, 1, 5, look.shirt); g.rect(12, Y(10) - swing, 1, 5, look.shirt);
    g.set(3, Y(15) + swing, look.skin); g.set(12, Y(15) - swing, look.skin);
  }
  if (look.badge >= 0 && dir !== "up") g.map(6, Y(11), BADGES[look.badge], { "#": look.badgeColor });
  // head
  g.rect(4, Y(2), 8, 8, look.skin);
  const hairBack = dir === "up";
  if (hairBack) g.rect(4, Y(2), 8, 8, look.hair);
  else {
    g.rect(4, Y(2), 8, 3, look.hair);
    if (side) g.rect(4, Y(2), 4, 7, look.hair);
    else { g.set(4, Y(5), look.hair); g.set(11, Y(5), look.hair); }
    if (look.style === 1) { g.rect(4, Y(5), 1, 5, look.hair); g.rect(11, Y(5), 1, 5, look.hair); }
    if (look.style === 2) { g.set(5, Y(1), look.hair); g.set(8, Y(1), look.hair); g.set(10, Y(1), look.hair); }
    if (look.style === 3 || look.acc === "bun") g.rect(7, Y(0), 3, 2, look.hair);
  }
  if (dir === "down") {
    g.set(6, Y(6), "#1e1a28"); g.set(9, Y(6), "#1e1a28");
    if (look.acc === "glasses") { g.rect(5, Y(6), 3, 1, "#1e1a28"); g.rect(8, Y(6), 3, 1, "#1e1a28"); }
  } else if (side) {
    g.set(9, Y(6), "#1e1a28");
    if (look.acc === "glasses") g.rect(8, Y(6), 3, 1, "#1e1a28");
  }
  if (look.acc === "headphones") { g.rect(4, Y(1), 8, 1, look.accColor); g.rect(3, Y(4), 1, 4, look.accColor); g.rect(12, Y(4), 1, 4, look.accColor); }
  if (think && dir === "down") g.rect(10, Y(8), 3, 2, look.skin); // hand on chin
  if (look.acc === "cap") { g.rect(4, Y(1), 8, 3, look.accColor); if (dir !== "up") g.rect(side ? 8 : 4, Y(4), side ? 4 : 8, 1, shade(look.accColor, -0.15)); }
  return g;
}

export const personTex = (look: Look, dir: Dir, pose: Pose, frame: number) =>
  memo(`p:${look.skin}${look.hair}${look.shirt}${look.style}${look.acc}${look.accColor}${look.badge}${look.badgeColor}:${dir}${pose}${pose === "walk" ? frame % 4 : pose === "sit" ? frame % 2 : 0}${settings.reducedMotion ? "r" : ""}`, () => person(look, dir, pose, frame));

// ---- furniture -------------------------------------------------------------------------------

export const chairTex = () =>
  memo("chair", () => {
    const g = new Grid(16, 16);
    g.rect(3, 2, 10, 11, "#3b3f55"); g.rect(4, 3, 8, 9, "#4a4f69"); g.rect(2, 10, 12, 3, "#2f3246");
    return g;
  });

/** Desk seen from the front; the monitor is angled so its screen faces the camera. */
export const deskTex = (accent: string, screen: 0 | 1 | 2 | 3) =>
  memo(`desk:${accent}:${screen}`, () => {
    const g = new Grid(16, 16);
    const d = theme().desk;
    g.rect(0, 1, 16, 5, d.top); g.rect(0, 1, 16, 1, d.edge);
    g.rect(0, 6, 16, 9, d.front); g.rect(1, 8, 6, 6, d.inset); g.rect(9, 8, 6, 6, d.inset);
    g.rect(3, 10, 2, 1, d.top); g.rect(11, 10, 2, 1, d.top);
    // monitor
    g.rect(8, -0, 7, 6, "#2a2d3b");
    g.rect(9, 1, 5, 4, screen === 0 ? "#171a24" : screen === 3 ? "#1a2230" : "#0f1c2b");
    if (screen === 3) g.rect(9, 1, 2, 1, "#3d4a63"); // dim idle screen: one faint line
    else if (screen) {
      for (let r = 0; r < 4; r++) {
        const len = 1 + ((r * 2 + screen * 3) % 4);
        g.rect(9, 1 + r, len, 1, r % 2 ? accent : "#7fe3ff");
      }
    }
    g.rect(11, 5, 1, 1, "#2a2d3b");
    // keyboard + mug
    g.rect(2, 3, 5, 2, "#d8dbe6"); g.rect(2, 3, 5, 1, "#f2f4fa");
    g.rect(0, 2, 2, 2, "#f2f2f2"); g.set(0, 2, "#c9604a");
    return g;
  });

export const laptopTex = (tier: number) =>
  memo(`laptop:${tier}`, () => {
    const g = new Grid(16, 16);
    if (tier === 0) {
      g.rect(2, 4, 12, 3, "#caa06a"); g.rect(3, 7, 2, 7, "#8d6a43"); g.rect(11, 7, 2, 7, "#8d6a43"); // stool-table
    } else {
      g.rect(0, 3, 16, 3, "#d4d7e2"); g.rect(1, 6, 1, 9, "#7e8296"); g.rect(14, 6, 1, 9, "#7e8296");
      g.rect(2, 11, 12, 1, "#7e8296");
    }
    g.rect(4, -1, 8, 5, "#c9ccd8"); g.rect(5, 0, 6, 3, "#112033"); g.rect(6, 1, 3, 1, "#7fe3ff");
    g.rect(3, 4, 10, 1, "#9a9eb0");
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

export const coffeeTex = () =>
  memo("coffee", () => {
    const g = new Grid(16, 16);
    g.rect(2, 2, 12, 13, "#3a3d4d"); g.rect(3, 3, 10, 5, "#1a1c26"); g.rect(5, 4, 6, 3, "#7a4a2a");
    g.rect(6, 10, 4, 4, "#f2f2f2"); g.rect(11, 9, 2, 1, "#e0524a");
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
    g.rect(1, 0, 14, 16, "#6b4a2d"); g.rect(2, 1, 12, 6, "#3f2c1a"); g.rect(2, 9, 12, 6, "#3f2c1a");
    ["#d85a5a", "#e8c25a", "#5a9ad8", "#6bc17a", "#b86bd8"].forEach((c, i) => { g.rect(3 + i * 2, 2, 2, 5, c); g.rect(3 + i * 2, 10, 2, 5, c === "#d85a5a" ? "#5a9ad8" : "#d85a5a"); });
    return g;
  });

export const couchTex = () =>
  memo("couch", () => {
    const g = new Grid(32, 16);
    g.rect(1, 3, 30, 7, "#6a4a8c"); g.rect(1, 3, 30, 1, "#8564ab");
    g.rect(0, 7, 4, 8, "#583c76"); g.rect(28, 7, 4, 8, "#583c76");
    g.rect(4, 9, 11, 5, "#7d5ba3"); g.rect(17, 9, 11, 5, "#7d5ba3");
    return g;
  });

// ---- floor / wall tiles ----------------------------------------------------------------------

export const woodTex = (v: number) =>
  memoRaw(`wood${v % 2}`, () => {
    const g = new Grid(16, 16);
    const w = theme().wood;
    g.rect(0, 0, 16, 16, v % 2 ? w.b : w.a);
    for (let y = 0; y < 16; y += 4) g.rect(0, y, 16, 1, w.grain);
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
  dots1: [".....", "#....", ".....", ".....", "....."],
  flag: ["##...", "####.", "##...", "#....", "#...."],
};
export type Emote = "exclaim" | "check" | "question" | "bulb" | "heart" | "flag" | "dots0" | "dots1" | "dots2";
const EMOTE_COLOR: Record<string, string> = { exclaim: "#ffd84a", check: "#5be37d", question: "#8fd0ff", bulb: "#ffe08a", heart: "#ff7a9a", flag: "#ff4a4a" };
export const emoteTex = (e: Emote) =>
  memo(`emote:${e}`, () => {
    const g = new Grid(9, 9);
    if (e.startsWith("dots")) {
      const n = Number(e[4]) + 1;
      for (let i = 0; i < 3; i++) g.rect(1 + i * 3, 4, 2, 2, i < n ? "#e8e8f4" : "#6b6f86");
    } else g.map(2, 1, ICONS[e], { "#": EMOTE_COLOR[e] });
    return g;
  });

export const whiteTex = () => memoRaw("white", () => { const g = new Grid(1, 1); g.set(0, 0, "#ffffff"); return g; });
