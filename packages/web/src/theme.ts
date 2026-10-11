// The one built-in canvas palette plus role identity. Pure (no pixi/DOM) so role assignment is testable under node.
import { hash, hsl } from "./color.ts";

export type Theme = {
  name: string;
  skins: string[];
  hairs: string[];
  /** CVD-safe role colours, assigned in first-seen role order (see setRoles). */
  roleColors: string[];
  /** The one floor material (dark composite deck): deep seams and trim, mid panels, lit lip and rugs. */
  deck: { deep: string; mid: string; lit: string };
  wall: { face: string; top: string; line: string; base: string; trim: string };
  desk: { top: string; edge: string; front: string; inset: string };
  outline: string;
  alert: { waiting: string; blocked: string };
  /** Max night overlay alpha (0..1); kept low so alert cues stay visible at night. */
  nightMax: number;
};

// Role shirts: muted, at least 30 degrees from every status hue (style guide), so only the yellow-green (69-124) and
// blue-violet (223-324) ranges remain; neighbours differ in hue AND lightness so roles still separate under colour-vision
// deficiency (the role glyph on the chest is the shape cue). Clamping the Okabe-Ito set into these ranges merged three roles.
const ROLE_SHIRTS = ["#aac167", "#7586c7", "#55983e", "#be6ec4", "#5343a3", "#b08bd0", "#5cbc62", "#999999"];

// ---- status vocabulary (one map for every surface: ring, dot, row accent, pill, toast, legend) ----
/**
 * Loudest first. Every status is a colour AND a glyph AND a word, never colour alone (colour-vision safe).
 * permission = Claude is asking to run something (act now); turn = idle at the prompt (your move); blocked = a helper gave up.
 */
export type StatusKey = "permission" | "turn" | "blocked" | "working" | "idle";
export const STATUS: Record<StatusKey, { color: string; glyph: string; label: string }> = {
  permission: { color: "#ffb020", glyph: "!", label: "needs permission" },
  turn: { color: "#7fe3ff", glyph: "?", label: "your turn" },
  blocked: { color: "#ff5c6c", glyph: "x", label: "gave up" },
  working: { color: "#3ddc97", glyph: "", label: "working" },
  idle: { color: "#8b93ad", glyph: "", label: "idle" },
};
export const STATUS_ORDER: StatusKey[] = ["permission", "turn", "blocked", "working", "idle"]; // a helper that gave up is usually handled by its lead, so it ranks below the two states that wait on you

// ---- R2 value key: the one palette token the scene is graded to -----------------------------------
/**
 * Values are luma (Rec.601, 0..1). The room is dark and cool so every light source glows against it.
 * env: one 6-step blue-violet ramp, shadows lean violet: 0 void/seams ~5%, 1 floor ~8%, 2 recesses/wall ~13%,
 * 3 furniture bodies ~20%, 4 furniture tops ~30%, 5 lit edges ~42%. Nothing that is not a light goes above `paper` (~62%);
 * emitters (screens, lamps, LEDs, signage) sit at 85%+. Roles: cyan = machine/working emitters only, warm = lamps,
 * attention/blocked = STATUS (reserved for status), neon magenta = signage and skyline only, never status.
 * char: value bands for the character pass (face brightest, hair lifted off the floor and outline); not enforced yet.
 */
export const KEY = {
  env: ["#0d0b1a", "#131229", "#1d1e3d", "#2c3055", "#424a75", "#5b6a9b"],
  cyan: "#9af6ff",
  cyanOff: "#103338",
  warm: "#ffd98c",
  paper: "#a29e90",
  attention: STATUS.permission.color,
  blocked: STATUS.blocked.color,
  neon: "#ff3ea5",
  char: { face: [0.38, 0.85], shirt: [0.25, 0.6], hair: [0.2, 0.5], pants: [0.12, 0.25] },
} as const;
const E = KEY.env;

export const DEFAULT_THEME: Theme = {
  name: "default",
  skins: ["#f6d3b0", "#e6b48a", "#c98d5f", "#8d5a3b", "#fadcbd"],
  hairs: ["#2a1c14", "#5b3a26", "#a86a2c", "#e0bd62", "#1b1b26", "#b9482f", "#cfcfd8"],
  roleColors: ROLE_SHIRTS,
  deck: { deep: E[0], mid: E[1], lit: E[2] },
  wall: { face: E[2], top: E[3], line: E[0], base: E[1], trim: E[4] },
  desk: { top: E[4], edge: E[5], front: E[3], inset: E[2] },
  outline: "#171421",
  alert: { waiting: STATUS.permission.color, blocked: STATUS.blocked.color }, // one alert palette (R4)
  nightMax: 0.32,
};

export const theme = () => DEFAULT_THEME;

// ---- role identity (#63) ----------------------------------------------------------------------
let roles: string[] = [];
/** Register roles as they appear: colours and badge shapes follow first-seen order, so a slot never changes once given. */
export function setRoles(names: Iterable<string>) {
  for (const n of names) if (!roles.includes(n)) roles.push(n);
}
/** Role colour: palette slot by first-seen index (wraps after 8; the badge shape disambiguates), hashed hue for unknown roles. */
export function roleColor(role: string): string {
  const i = roles.indexOf(role), p = DEFAULT_THEME.roleColors;
  return i >= 0 ? p[i % p.length] : hsl(hash(role) % 360, 0.55, 0.52);
}

