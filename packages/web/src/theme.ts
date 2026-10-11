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

// Okabe-Ito: the standard colour-blind-safe categorical set.
const OKABE = ["#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7", "#999999"];

export const DEFAULT_THEME: Theme = {
  name: "default",
  skins: ["#f6d3b0", "#e6b48a", "#c98d5f", "#8d5a3b", "#fadcbd"],
  hairs: ["#2a1c14", "#5b3a26", "#a86a2c", "#e0bd62", "#1b1b26", "#b9482f", "#cfcfd8"],
  roleColors: OKABE,
  deck: { deep: "#1c2036", mid: "#2a3050", lit: "#3a4366" },
  wall: { face: "#232a45", top: "#2d3556", line: "#171b30", base: "#1c2238", trim: "#4a5578" },
  desk: { top: "#56648f", edge: "#7a8ab8", front: "#3a4366", inset: "#2d3454" },
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
