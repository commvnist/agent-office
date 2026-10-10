import { test } from "node:test";
import assert from "node:assert/strict";
import { easeSpeed, stackBubbles, type BubbleBox } from "./settings.ts";
import { parseTheme, DEFAULT_THEME, setRoles, roleColor, roleIndex } from "./theme.ts";
import { mix, luma } from "./color.ts";

test("parseTheme validates, clamps and ignores unknown keys", () => {
  const t = parseTheme({ name: "x<y>", nightMax: 9, outline: "red", evil: 1, wall: { face: "#112233", bogus: "#fff" }, skins: ["#000000", "nope"] })!;
  assert.equal(t.name, "xy");
  assert.equal(t.nightMax, 1);
  assert.equal(t.outline, DEFAULT_THEME.outline);
  assert.equal(t.wall.face, "#112233");
  assert.equal(t.wall.top, DEFAULT_THEME.wall.top);
  assert.deepEqual(t.skins, ["#000000"]);
  assert.equal((t as any).evil, undefined);
  assert.equal(parseTheme("not json"), null);
  assert.equal(parseTheme([]), null);
});

test("roles get stable palette slots by sorted name; unknown roles are hashed", () => {
  setRoles(["qa", "backend", "frontend"]);
  assert.equal(roleIndex("backend"), 0);
  assert.equal(roleColor("backend"), DEFAULT_THEME.roleColors[0]);
  assert.equal(roleColor("qa"), DEFAULT_THEME.roleColors[2]);
  assert.match(roleColor("guest"), /^#[0-9a-f]{6}$/);
  assert.equal(roleColor("guest"), roleColor("guest"));
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
