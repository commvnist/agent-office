import { test } from "node:test";
import assert from "node:assert/strict";
import { easeSpeed, stackBubbles, type BubbleBox } from "./settings.ts";
import { DEFAULT_THEME, setRoles, roleColor } from "./theme.ts";
import { mix, luma } from "./color.ts";

test("roles get palette slots in first-seen order and keep them; unregistered roles are hashed", () => {
  setRoles(["qa", "backend"]);
  setRoles(["frontend", "qa"]);
  assert.equal(roleColor("backend"), DEFAULT_THEME.roleColors[1]);
  assert.equal(roleColor("frontend"), DEFAULT_THEME.roleColors[2]);
  assert.match(roleColor("general-purpose"), /^#[0-9a-f]{6}$/);
  assert.equal(roleColor("general-purpose"), roleColor("general-purpose"));
});

test("easeSpeed accelerates, brakes near the end and never stalls", () => {
  assert.ok(easeSpeed(10, 1000, 0.1, 50) > 10);
  assert.ok(easeSpeed(50, 1, 0.1, 50) < 50);
  assert.equal(easeSpeed(0, 0, 0.1, 40), 10);
});

const box = (o: Partial<BubbleBox>): BubbleBox => ({ x: 100, y: 100, w: 50, h: 20, prio: 1, age: 0, zone: "0", tool: false, ...o });
test("stackBubbles stacks overlaps, speech wins, caps tool bubbles per zone", () => {
  const r = stackBubbles([box({ tool: true, prio: 1 }), box({ prio: 2 })]);
  assert.equal(r[1].y, 100); // speech keeps its place
  assert.ok(r[0].y < 100 - 19 && r[0].alpha < 1);
  const many = stackBubbles([0, 1, 2, 3].map((i) => box({ tool: true, x: i * 200, age: i })));
  assert.equal(many.filter((m) => m.visible).length, 3);
  assert.equal(many[3].visible, false); // oldest dropped
});

test("colour helpers", () => {
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.ok(luma("#ffffff") > 0.99);
});

test("freeze records when it started and clears on thaw; repeats are no-ops", async () => {
  const { frozen, setFrozen } = await import("./settings.ts");
  setFrozen(true, 1234);
  assert.deepEqual({ ...frozen }, { on: true, since: 1234 });
  setFrozen(true, 9999);
  assert.equal(frozen.since, 1234);
  setFrozen(false);
  assert.deepEqual({ ...frozen }, { on: false, since: 0 });
});

test("follow only accepts known modes", async () => {
  const { settings, setFollow } = await import("./settings.ts");
  setFollow("busiest");
  assert.equal(settings.follow, "busiest");
  setFollow("sideways" as never);
  assert.equal(settings.follow, "busiest");
  setFollow("off");
});

test("scene-relative text: 1 at the reference scale, proportional both ways, quantized, no floor (O3)", async () => {
  const { setSceneScale, fontPx, textZoom, REF_SC, settings: st } = await import("./settings.ts");
  st.textScale = 1;
  setSceneScale(REF_SC);
  assert.equal(textZoom.k, 1);
  assert.equal(fontPx(12), 12);
  assert.equal(setSceneScale(REF_SC * 2), true); // zooming in doubles it
  assert.equal(fontPx(12), 24);
  assert.equal(setSceneScale(REF_SC * 2 + 0.01), false); // within an eighth step: no re-rasterise
  setSceneScale(REF_SC / 2);
  assert.equal(fontPx(12), 6); // zoomed out: it shrinks with the world, no legibility floor
  assert.equal(setSceneScale(NaN), true); // bad input falls back to 1
  assert.equal(textZoom.k, 1);
});

test("stackBubbles hides a bubble that cannot rise clear instead of letting a clamp overprint it (A6)", () => {
  const box = (o: Partial<BubbleBox>): BubbleBox => ({ x: 0, y: 100, w: 40, h: 20, prio: 2, age: 0, zone: "z", tool: false, ...o });
  const r = stackBubbles([box({ prio: 2.5, top: 70 }), box({ age: 5, top: 70 })]);
  assert.equal(r[0].visible, true);
  assert.equal(r[1].visible, false, "no room above the alert bubble");
  assert.equal(stackBubbles([box({ top: 40 }), box({ age: 5, top: 40 })])[1].y, 78, "room: it stacks");
});

test("stackBubbles: a shifted alert bubble keeps full opacity", () => {
  const box = (o: Partial<BubbleBox>): BubbleBox => ({ x: 0, y: 100, w: 40, h: 20, prio: 2, age: 0, zone: "z", tool: false, ...o });
  const r = stackBubbles([box({ prio: 3 }), box({ prio: 2.5 })]);
  assert.equal(r[1].alpha, 1);
});
