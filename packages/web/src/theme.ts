// The one built-in canvas palette plus role identity. Pure (no pixi/DOM) so role assignment is testable under node.
import { hash, hsl } from "./color.ts";

export type Theme = {
  name: string;
  skins: string[];
  hairs: string[];
  /** CVD-safe role colours, assigned in first-seen role order (see setRoles). */
  roleColors: string[];
  wood: { a: string; b: string; grain: string };
  carpet: { base: string; fleck: string; edge: string; zoneMix: number; lobby: string };
  wall: { face: string; top: string; line: string; base: string; trim: string };
  desk: { top: string; edge: string; front: string; inset: string };
  outline: string;
  alert: { waiting: string; blocked: string };
  /** Max night overlay alpha (0..1); kept low so alert cues stay visible at night. */
  nightMax: number;
};

// Okabe-Ito: the standard colour-blind-safe categorical set.
const OKABE = ["#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7", "#999999"];

export const DEFAULT_THEME: Theme = {
  name: "default",
  skins: ["#f6d3b0", "#e6b48a", "#c98d5f", "#8d5a3b", "#fadcbd"],
  hairs: ["#2a1c14", "#5b3a26", "#a86a2c", "#e0bd62", "#1b1b26", "#b9482f", "#cfcfd8"],
  roleColors: OKABE,
  wood: { a: "#745739", b: "#6e5238", grain: "#5a4129" },
  carpet: { base: "#8a8fa8", fleck: "#7b809a", edge: "#767b94", zoneMix: 0.7, lobby: "#aab4e0" },
  wall: { face: "#4b4768", top: "#5d5880", line: "#413d5c", base: "#2f2c44", trim: "#6b658f" },
  desk: { top: "#c79a63", edge: "#dfb67c", front: "#8d6a43", inset: "#7a5a38" },
  outline: "#171421",
  alert: { waiting: "#ffd84a", blocked: "#ff4a4a" },
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
