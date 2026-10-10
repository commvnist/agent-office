// Theme palettes. Pure (no pixi/DOM) so parseTheme and role assignment are testable under node.
import { hash, hsl } from "./color.ts";

export type Theme = {
  name: string;
  skins: string[];
  hairs: string[];
  /** CVD-safe role colours, assigned by sorted role-name order (see setRoles). */
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
  carpet: { base: "#8a8fa8", fleck: "#7b809a", edge: "#767b94", zoneMix: 0.55, lobby: "#aab4e0" },
  wall: { face: "#4b4768", top: "#5d5880", line: "#413d5c", base: "#2f2c44", trim: "#6b658f" },
  desk: { top: "#c79a63", edge: "#dfb67c", front: "#8d6a43", inset: "#7a5a38" },
  outline: "#171421",
  alert: { waiting: "#ffd84a", blocked: "#ff4a4a" },
  nightMax: 0.32,
};

export const HIGH_CONTRAST_THEME: Theme = {
  ...DEFAULT_THEME,
  name: "high-contrast",
  roleColors: ["#ffb000", "#648fff", "#00c389", "#ffffff", "#785ef0", "#fe6100", "#dc267f", "#a0a0a0"],
  wood: { a: "#3a2b1c", b: "#352719", grain: "#241a10" },
  carpet: { base: "#5c6078", fleck: "#545870", edge: "#4a4e66", zoneMix: 0.35, lobby: "#7f89b8" },
  wall: { face: "#22203a", top: "#34315a", line: "#1a1830", base: "#0f0e1c", trim: "#8f88c8" },
  outline: "#000000",
  alert: { waiting: "#ffe14a", blocked: "#ff3030" },
  nightMax: 0.18,
};

export const LIGHT_THEME: Theme = {
  ...DEFAULT_THEME,
  name: "light",
  wood: { a: "#c9a979", b: "#c2a273", grain: "#a98a5c" },
  carpet: { base: "#c9cce0", fleck: "#bcc0d6", edge: "#b0b4cc", zoneMix: 0.7, lobby: "#d8def5" },
  wall: { face: "#9a97bd", top: "#aeaad0", line: "#8c88b0", base: "#6f6b94", trim: "#c9c5e8" },
  nightMax: 0.14,
};

export const THEMES: Record<string, Theme> = { default: DEFAULT_THEME, "high-contrast": HIGH_CONTRAST_THEME, light: LIGHT_THEME };

let active: Theme = DEFAULT_THEME;
const listeners: (() => void)[] = [];
export const theme = () => active;
/** Sprite code registers here to drop its texture cache; the scene must be rebuilt by the caller after applyTheme. */
export const onThemeChange = (fn: () => void) => void listeners.push(fn);
export function applyTheme(t: Theme) {
  active = t;
  listeners.forEach((f) => f());
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Merge `input` onto `base` following base's shape: unknown keys ignored, colours must be #rrggbb, numbers clamped to 0..1. */
function merge<T>(base: T, input: unknown): T {
  if (Array.isArray(base)) {
    if (!Array.isArray(input)) return base;
    const ok = input.filter((v): v is string => typeof v === "string" && HEX.test(v)).slice(0, 16);
    return (ok.length ? ok : base) as T;
  }
  if (typeof base === "string") return (typeof input === "string" && HEX.test(input) ? input : base) as T;
  if (typeof base === "number") return (typeof input === "number" && Number.isFinite(input) ? Math.max(0, Math.min(1, input)) : base) as T;
  if (base && typeof base === "object") {
    const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(base)) out[k] = k === "name" ? base[k as keyof T] : merge(base[k as keyof T], Object.hasOwn(src, k) ? src[k] : undefined);
    return out as T;
  }
  return base;
}

/** Validate a theme pack (parsed JSON or JSON text) from /themes/<name>.json. Missing/invalid fields fall back to default; null if not an object. */
export function parseTheme(json: unknown): Theme | null {
  let v = json;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const t = merge(DEFAULT_THEME, v);
  const n = (v as { name?: unknown }).name;
  t.name = typeof n === "string" ? n.replace(/[^\w .-]/g, "").slice(0, 32) || "custom" : "custom";
  return t;
}

// ---- role identity (#63) ----------------------------------------------------------------------
let roles: string[] = [];
/** Register the known roles; colours and badge shapes follow sorted name order so they are stable across sessions. */
export function setRoles(names: Iterable<string>) {
  roles = [...new Set(names)].sort();
}
/** Index in the sorted known-role list, or -1 for unknown (guest) roles. */
export const roleIndex = (role: string) => roles.indexOf(role);
/** Role colour: palette slot by sorted index (wraps after 8; the badge shape disambiguates), hashed hue for unknown roles. */
export function roleColor(role: string): string {
  const i = roles.indexOf(role), p = active.roleColors;
  return i >= 0 ? p[i % p.length] : hsl(hash(role) % 360, 0.55, 0.52);
}
