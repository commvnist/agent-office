import test from "node:test";
import assert from "node:assert/strict";
import { labelGlyphs, labelWidth, pickWeather, planDelight, pushSignal } from "./flair.ts";

test("combo digits lay out as x + digits, 4px pitch", () => {
  assert.deepEqual(labelGlyphs("x5"), [0, 6]);
  assert.deepEqual(labelGlyphs("x20"), [0, 3, 1]);
  assert.deepEqual(labelGlyphs("x!1"), [0, 2]);
  assert.equal(labelWidth(3), 11);
  assert.equal(labelWidth(0), 0);
});

test("weather: rain on clustered errors, sun on clean done, cloud otherwise", () => {
  const now = 1_000_000;
  assert.equal(pickWeather([], [], now), "cloudy");
  assert.equal(pickWeather([now - 60_000], [], now), "sunny");
  assert.equal(pickWeather([now - 11 * 60_000], [], now), "cloudy");
  assert.equal(pickWeather([now - 60_000], [now - 9 * 60_000], now), "cloudy");
  assert.equal(pickWeather([now - 60_000], [now - 1000, now - 2000, now - 3000], now), "rain");
  assert.equal(pickWeather([], [now - 1000, now - 2000, now - 6 * 60_000], now), "cloudy");
  const a: number[] = [];
  for (let i = 0; i < 100; i++) pushSignal(a, i, 10);
  assert.equal(a.length, 10);
  assert.equal(a[0], 90);
});

test("delights: cat needs a free seat and is not doubled; disco does not stack; confetti always", () => {
  const now = 5000;
  assert.equal(planDelight("cat-on-couch", now, [], -1), null);
  const cat = planDelight("cat-on-couch", now, [], 1)!;
  assert.deepEqual([cat.seat, cat.until], [1, now + 40_000]);
  assert.equal(planDelight("cat-on-couch", now, [cat], 0), null);
  const rb = planDelight("disco-mini", now, [])!;
  assert.equal(planDelight("disco-mini", now + 1000, [rb]), null);
  assert.ok(planDelight("disco-mini", now + 7_000, [rb]));
  assert.ok(planDelight("confetti-gold", now, [rb, cat, rb]));
});
