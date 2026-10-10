import { test } from "node:test";
import assert from "node:assert/strict";
import { Camera } from "./camera.ts";

const V = [2, 800, 600, 34, 320, 200] as const; // fit, W, H, top, layout w/h in art px

test("default view is the centred fit", () => {
  const v = new Camera().view(...V);
  assert.equal(v.sc, 2);
  assert.equal(v.ox, 80);
  assert.equal(v.oy, Math.round(34 + 300 - 200));
});

test("zoomBy keeps the point under the cursor fixed", () => {
  const c = new Camera();
  c.view(...V);
  const before = { x: (500 - 80) / 2, y: (300 - 134) / 2 }; // world point under screen (500,300)
  c.zoomBy(2, 500, 300);
  const v = c.view(...V);
  assert.equal(v.sc, 4);
  assert.ok(Math.abs(v.ox + before.x * v.sc - 500) <= 1);
  assert.ok(Math.abs(v.oy + before.y * v.sc - 300) <= 1);
});

test("reset, clamp and follow", () => {
  const c = new Camera();
  c.view(...V);
  c.zoomBy(100);
  assert.equal(c.zoom, 8);
  c.reset();
  assert.equal(c.zoom, 1);
  c.focus("a");
  assert.equal(c.zoom, 2);
  const v = c.view(...V, { x: 40, y: 30 }, 0);
  assert.ok(Math.abs(v.ox + 40 * v.sc - 400) <= 1);
  assert.ok(Math.abs(v.oy + 30 * v.sc - (34 + 300)) <= 1);
  c.panBy(5, 5);
  assert.equal(c.follow, null);
});
