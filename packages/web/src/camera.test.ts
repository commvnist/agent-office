import { test } from "node:test";
import assert from "node:assert/strict";
import { Camera, ignoreKey, isNarrow, phoneScale, pickAuto } from "./camera.ts";

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

test("view offsets land on whole device pixels", () => {
  const c = new Camera();
  c.panBy(3.3, 1.7);
  for (const d of [1, 1.5, 2]) { const v = c.view(1.37, 801, 601, 34, 400, 300, null, 0, d); assert.equal(v.ox * d, Math.round(v.ox * d)); assert.equal(v.oy * d, Math.round(v.oy * d)); }
});

test("narrow stages: phones and tall tablets, never desktop", () => {
  assert.ok(isNarrow(390, 760) && isNarrow(360, 600) && isNarrow(768, 990));
  assert.ok(!isNarrow(1245, 750) && !isNarrow(900, 700));
});

test("phoneScale shows about 14 tiles and fills a short room's stage, never under 12 tiles", () => {
  const lh = 20 * 16 + 12;
  assert.equal(phoneScale(390, 100, lh), 390 / 224); // tall room: 14 tiles across
  const s = phoneScale(390, 760, lh);
  assert.ok(s >= 390 / 224 && s <= 390 / 192); // 14..12 tiles across
  assert.ok(Math.abs(s - Math.min(760 / lh, 390 / 192)) < 1e-9);
});

test("pickAuto: alert, else working, else rest; lowest id, sticky", () => {
  const rest = { x: 5, y: 6 };
  const c = [{ id: "b", x: 1, y: 1, working: true }, { id: "a", x: 2, y: 2, working: true }, { id: "z", x: 3, y: 3, alert: true }];
  assert.equal(pickAuto(c, null, rest).id, "z");
  assert.equal(pickAuto(c.slice(0, 2), null, rest).id, "a");
  assert.equal(pickAuto(c.slice(0, 2), "b", rest).id, "b");
  assert.deepEqual(pickAuto([{ id: "q", x: 0, y: 0 }], null, rest), { id: null, ...rest });
});

test("phone view follows the auto point and never shows past the walls", () => {
  const c = new Camera();
  c.phone = true;
  c.autoPos = { x: 0, y: 0 };
  const v = c.view(3, 390, 700, 40, 320, 400, null, 0); // 960 px wide world in a 390 stage
  assert.ok(v.ox <= 0 && v.ox + 320 * 3 >= 390 && v.oy <= 40 && v.oy + 400 * 3 >= 40 + 700);
  c.panBy(1, 1);
  assert.equal(c.autoFollow, false);
  c.toggleFitAll();
  assert.ok(c.fitAll && c.zoom === 1);
  c.toggleFitAll();
  assert.ok(!c.fitAll && c.autoFollow);
});

test("X7: on a phone a room shorter than the stage hangs from the header, whatever the follow point", () => {
  const c = new Camera();
  c.phone = true;
  c.autoPos = { x: 160, y: 190 }; // far down the room: a centred fit would pan it down and leave a band above
  for (let i = 0; i < 5; i++) c.view(1, 390, 700, 140, 320, 200, null, 0.1);
  assert.equal(c.view(1, 390, 700, 140, 320, 200).oy, 140);
  const fold = new Camera(); // an unfolded phone (693x830) is not "phone" but is portrait: still no band above the room
  assert.equal(fold.view(2, 693, 830, 100, 320, 200).oy, 100);
  assert.equal(new Camera().view(2, 1300, 700, 40, 320, 200).oy, 40 + (700 - 400) / 2, "landscape keeps the room centred");
});
