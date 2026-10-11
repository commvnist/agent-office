import { test } from "node:test";
import assert from "node:assert/strict";
import { contrast, luma, ramp, shade, toLuma } from "./color.ts";

const hue = (hex: string) => {
  const n = parseInt(hex.slice(1), 16), [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (!d) return NaN;
  return 60 * (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
};
const sat = (hex: string) => { // HSL saturation
  const n = parseInt(hex.slice(1), 16), v = [n >> 16, (n >> 8) & 255, n & 255].map((x) => x / 255), mx = Math.max(...v), mn = Math.min(...v);
  return mx === mn ? 0 : (mx - mn) / (1 - Math.abs(mx + mn - 1));
};
const delta = (a: number, b: number) => ((a - b + 540) % 360) - 180;
const BASES = ["#e69f00", "#56b4e9", "#009e73", "#d55e00", "#cc79a7", "#3355ff", "#8d6a43", "#8a8fa8"];

test("ramp: luma rises monotonically, the middle step is the base, shadows cool and lights warm", () => {
  for (const c of BASES) {
    const r = ramp(c, 5);
    assert.equal(r.length, 5);
    assert.equal(r[2], c);
    for (let i = 1; i < r.length; i++) assert.ok(luma(r[i]) > luma(r[i - 1]), `${c} step ${i}`);
    const toward = (to: number, from: string, c2: string) => Math.abs(delta(to, hue(c2))) <= Math.abs(delta(to, hue(from))) + 1e-6;
    assert.ok(toward(255, c, r[0]), `${c} shadow hue moves toward blue-violet`); // never away from it
    assert.ok(toward(55, c, r[4]), `${c} light hue moves toward yellow`);
    const moved = Math.abs(delta(hue(r[0]), hue(c)));
    assert.ok(moved <= 17, `${c}: shift capped near 16 degrees (got ${moved})`);
  }
});

test("ramp: saturation peaks mid-ramp; shade(0) is identity and shade keeps the sign of the change", () => {
  for (const c of ["#e69f00", "#3355ff", "#009e73"]) {
    const r = ramp(c, 5);
    assert.ok(sat(r[2]) >= sat(r[0]) && sat(r[2]) >= sat(r[4]), c);
  }
  assert.equal(shade("#445566", 0), "#445566");
  for (const c of BASES) {
    assert.ok(luma(shade(c, 0.1)) > luma(c), c);
    assert.ok(luma(shade(c, -0.1)) < luma(c), c);
  }
  assert.match(shade("#ffffff", -0.2), /^#[0-9a-f]{6}$/);
});

test("contrast pushes a colour away from the reference by the minimum luma delta", () => {
  const c = contrast("#f0e442", "#f6d3b0", 0.14);
  assert.ok(Math.abs(luma(c) - luma("#f6d3b0")) >= 0.14);
  assert.equal(contrast("#223344", "#f6d3b0", 0.14), "#223344");
});

test("toLuma lands on the target value and keeps the hue", () => {
  for (const c of ["#3fa14c", "#d85a5a", "#aab4cc", "#5a4a2c"]) for (const t of [0.14, 0.3, 0.6]) {
    const o = toLuma(c, t);
    assert.ok(Math.abs(luma(o) - t) < 0.01, `${c} -> ${o}`);
    assert.ok(Math.abs(delta(hue(o), hue(c))) < 4, `${c} -> ${o}`);
  }
});
