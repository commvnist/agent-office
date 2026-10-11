// Pure colour helpers (no pixi, no DOM) so they can be unit-tested under node.
export function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const toHex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

const hslOf = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
};
const SHADOW_HUE = 255, LIGHT_HUE = 55, SHIFT = 16; // shadows lean violet-blue, highlights lean yellow, by up to SHIFT degrees
/** One ramp step: `t` -1 (deepest shadow) .. 1 (brightest light) shifts hue; `dl` is the lightness change. Saturation peaks at t = 0. */
function step(hex: string, t: number, dl: number): string {
  const c = hslOf(hex), goal = t < 0 ? SHADOW_HUE : LIGHT_HUE, d = ((goal - c.h + 540) % 360) - 180, a = Math.abs(t);
  const h = c.h + Math.sign(d) * Math.min(Math.abs(d), SHIFT * a);
  const s = Math.min(1, Math.max(c.s, 0.05 * a) * (1 - 0.3 * t * t)); // greys pick up a little of the shift hue
  const at = (l: number) => hsl(((h % 360) + 360) % 360, s, Math.max(0, Math.min(1, l)));
  let out = at(c.l + dl);
  // violet has more red than pure blue: keep the value moving the way the step says (shadows never end up lighter)
  for (let k = 0; k < 12 && t !== 0 && (t < 0 ? luma(out) >= luma(hex) : luma(out) <= luma(hex)); k++) out = at(c.l + dl + Math.sign(t) * 0.03 * (k + 1));
  return out;
}

/** `steps` colours from shadow to light around `hex` (the middle step is `hex`): hue-shifted, not just darker/lighter RGB; luma strictly rises. */
export function ramp(hex: string, steps: number): string[] {
  const n = Math.max(1, Math.round(steps)), out: string[] = new Array(n);
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / mid - 1 : 0;
    out[i] = Math.abs(t) < 1e-9 ? hex : step(hex, t, t * 0.24);
  }
  for (let i = Math.floor(mid) - 1; i >= 0; i--) // outward from the base: each step must be darker (lighter) than the one inside it
    for (let k = 1; k < 12 && luma(out[i]) >= luma(out[i + 1]) - 0.02; k++) out[i] = step(hex, (i / mid) - 1, (i / mid - 1) * 0.24 - 0.03 * k);
  for (let i = Math.ceil(mid) + 1; i < n; i++)
    for (let k = 1; k < 12 && luma(out[i]) <= luma(out[i - 1]) + 0.02; k++) out[i] = step(hex, i / mid - 1, (i / mid - 1) * 0.24 + 0.03 * k);
  return out;
}

/** Lighten (amt > 0) or darken (amt < 0) by about `amt` of the value range, through the same hue-shifted ramp. */
export function shade(hex: string, amt: number): string {
  if (amt === 0) return hex;
  return step(hex, Math.max(-1, Math.min(1, amt / 0.25)), amt);
}

/** Linear blend a -> b by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

/** Rough perceived brightness 0..1, to pick a readable glyph colour on a coloured shirt. */
export function luma(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Blend toward a tint (cool shadow / warm light); same maths as `mix`. */
export const shadeTo = mix;

/** Move `c`'s lightness (hue-shifted) until its luma differs from `ref`'s by at least `min`; goes away from `ref`, the other way when that hits black/white. */
export function contrast(c: string, ref: string, min: number): string {
  const lr = luma(ref);
  for (const dir of [luma(c) <= lr ? -1 : 1, luma(c) <= lr ? 1 : -1])
    for (let k = 0; k <= 8; k++) {
      const o = shade(c, dir * k * 0.06);
      if (Math.abs(luma(o) - lr) >= min) return o;
    }
  return c;
}
