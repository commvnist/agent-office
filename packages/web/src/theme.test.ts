import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_THEME, KEY, STATUS } from "./theme.ts";
import { luma } from "./color.ts";

const hue = (hex: string) => {
  const n = parseInt(hex.slice(1), 16), [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  return 60 * (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
};
const near = (c: string, want: number, tol = 0.02) => assert.ok(Math.abs(luma(c) - want) <= tol, `${c}: luma ${luma(c).toFixed(3)}, want ~${want}`);

test("R2 value key: a 6-step blue-violet env ramp with floor ~8%, furniture tops ~30%, strictly rising", () => {
  const E = KEY.env;
  assert.equal(E.length, 6);
  [0.05, 0.08, 0.13, 0.2, 0.3, 0.42].forEach((v, i) => near(E[i], v));
  for (let i = 1; i < E.length; i++) assert.ok(luma(E[i]) > luma(E[i - 1]) + 0.025, `step ${i} separates`);
  for (const c of E) assert.ok(hue(c) >= 220 && hue(c) <= 260, `${c} is blue-violet`);
});

test("R2 value key: emitters glow at 85%+, nothing else reaches them, the theme surfaces sit on the ramp", () => {
  for (const c of [KEY.cyan, KEY.warm]) assert.ok(luma(c) >= 0.85, c);
  assert.ok(luma(KEY.paper) <= 0.65 && luma(KEY.cyanOff) < 0.2, "paper is the brightest non-light; an unlit LED stays dark");
  const { deck, wall, desk } = DEFAULT_THEME;
  near(deck.mid, 0.08); near(desk.top, 0.3);
  for (const c of [...Object.values(deck), ...Object.values(wall), ...Object.values(desk)]) assert.ok((KEY.env as readonly string[]).includes(c), `${c} on the ramp`);
});

test("R2 roles: status keeps its colours, decorative neon is magenta and is not a status colour", () => {
  assert.equal(KEY.attention, STATUS.permission.color);
  assert.equal(KEY.blocked, STATUS.blocked.color);
  assert.ok(hue(KEY.neon) > 300 && hue(KEY.neon) < 345);
  assert.ok(!Object.values(STATUS).some((s) => s.color === KEY.neon));
  for (const [lo, hi] of Object.values(KEY.char)) assert.ok(lo < hi && lo > luma(KEY.env[1]), "character bands sit above the floor");
});
