import { test } from "node:test";
import assert from "node:assert/strict";
import { Camera, ignoreKey } from "./camera.ts";

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

test("a world taller than the viewport hangs from the top; centerOn and minScale", () => {
  const c = new Camera();
  const tall = [2, 800, 600, 34, 320, 400] as const; // 800 art px tall at 2x > 600
  assert.equal(c.view(...tall).oy, 34);
  c.centerOn(100, 500);
  const v = c.view(...tall);
  assert.ok(Math.abs(v.ox + 100 * v.sc - 400) <= 1 && Math.abs(v.oy + 500 * v.sc - 334) <= 1);
  c.reset();
  c.minScale = 1.5;
  c.zoomBy(0.1);
  assert.equal(c.view(...tall).sc, 1.5); // zoom floored at minScale/fit
  c.minScale = 0;
});

test("ignoreKey skips form controls and modified keys", () => {
  assert.equal(ignoreKey({ target: { tagName: "SELECT" } }), true);
  assert.equal(ignoreKey({ target: { tagName: "DIV", isContentEditable: true } }), true);
  assert.equal(ignoreKey({ target: { tagName: "CANVAS" }, ctrlKey: true }), true);
  assert.equal(ignoreKey({ target: { tagName: "CANVAS" } }), false);
});

test("shake is capped (3 px light, 6 px heavy), alternates and decays to zero; HUD-facing pan is untouched", async () => {
  const { Camera, shakeOffset, SHAKE_LIGHT, SHAKE_HEAVY } = await import("./camera.ts");
  for (let t = 0.05; t <= 1; t += 0.05) {
    assert.ok(Math.abs(shakeOffset(t, SHAKE_LIGHT, 1)) <= SHAKE_LIGHT);
    assert.ok(Math.abs(shakeOffset(t, SHAKE_HEAVY, 0)) <= SHAKE_HEAVY);
  }
  assert.equal(shakeOffset(0, 3, 1), 0);
  const c = new Camera();
  const rest = new Camera().view(1, 800, 600, 0, 400, 300, null, 1 / 60).ox;
  c.shake(true);
  let max = 0, frames = 0, v = c.view(1, 800, 600, 0, 400, 300, null, 1 / 60);
  for (; frames < 120; frames++) { v = c.view(1, 800, 600, 0, 400, 300, null, 1 / 60); max = Math.max(max, Math.abs(v.ox - rest)); }
  assert.ok(max <= SHAKE_HEAVY && max >= 2, `max ${max}`);
  assert.equal(v.ox, rest); // trauma has decayed
});

test("easeFocus eases the zoom to 2x and a manual zoom cancels it", async () => {
  const { Camera } = await import("./camera.ts");
  const c = new Camera();
  c.reset();
  c.easeFocus("a");
  assert.equal(c.zoom, 1);
  c.view(1, 800, 600, 0, 400, 300, { x: 10, y: 10 }, 0.1);
  assert.ok(c.zoom > 1 && c.zoom < 2);
  for (let i = 0; i < 60; i++) c.view(1, 800, 600, 0, 400, 300, { x: 10, y: 10 }, 0.1);
  assert.equal(c.zoom, 2);
  c.reset();
  c.easeFocus("a");
  c.zoomBy(1.1);
  assert.equal(c.zoomGoal, null);
});
