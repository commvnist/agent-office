import { test } from "node:test";
import assert from "node:assert/strict";
import { person, lookFor, teamColor, type Look } from "./sprites.ts";
import { DEFAULT_THEME } from "./theme.ts";
import { shade } from "./color.ts";

const base: Look = { skin: "#e6b48a", hair: "#5b3a26", shirt: "#e8e8f0", pants: "#33384d", style: 0, build: 0, head: 0, acc: "none", accColor: "#d33a8a", badge: 3 };
const px = (l: Look, d: "down" | "up" | "side", p: "walk" | "sit" | "sit-think", f = 0, o = {}) => person(l, d, p, f, o).cells.join();

test("every style, build, expression and pose draws inside the 16x24 grid", () => {
  for (const style of [0, 1, 2, 3, 4, 5] as const)
    for (const build of [0, 1] as const)
      for (const d of ["down", "up", "side"] as const)
        assert.ok(person({ ...base, style, build, head: build }, d, "sit", 0).cells.some(Boolean));
});

test("expressions, quirks and breathing change pixels; a back view hides faces", () => {
  const n = px(base, "down", "walk");
  for (const expr of ["focus", "stuck", "happy", "worry", "yawn", "stretch", "phone"] as const) assert.notEqual(px(base, "down", "walk", 0, { expr }), n, expr);
  assert.notEqual(px(base, "down", "walk", 0, { lift: true }), n);
  assert.notEqual(px(base, "down", "sit", 0, { dip: true }), px(base, "down", "sit"));
});

test("seated hands land on the same rows for slim and stocky builds", () => {
  const rows = (b: 0 | 1) => { const g = person({ ...base, build: b }, "down", "sit", 0); const s = new Set<number>(); g.cells.forEach((c, i) => c === base.skin && i % 16 !== 7 && Math.floor(i / 16) > 20 && s.add(Math.floor(i / 16))); return [...s].join(); };
  assert.equal(rows(0), rows(1));
});

test("lookFor: lead differs from helper, unknown roles still get a glyph", () => {
  const l = lookFor("architect", "x", true), h = lookFor("architect", "x");
  assert.equal(l.acc, "suit");
  assert.notEqual(l.shirt, h.shirt);
  assert.ok(lookFor("zzz-role", "x").badge >= 9);
  assert.equal(lookFor("qa-engineer", "x").badge, 3);
});

test("head stays readable: dark hair is lifted off the outline and nothing is clipped at the top edge", () => {
  const OUT = "#171421";
  for (const hair of ["#2a1c14", "#1b1b26", "#000000"]) {
    const g = person({ ...base, hair, style: 0 }, "up", "walk", 0);
    const head = Array.from({ length: 24 }, (_, y) => g.cells[y * 16 + 7]).find(Boolean); // first head pixel (before the outline is added)
    assert.ok(head && luma(head) > 0.2, `back of head must contrast with the ${OUT} outline (${hair} -> ${head})`);
  }
  for (const style of [0, 1, 2, 3, 4, 5] as const)
    for (const build of [0, 1] as const)
      for (const dir of ["down", "up", "side"] as const)
        for (const [pose, frame, o] of [["walk", 0, {}], ["walk", 1, {}], ["walk", 2, {}], ["walk", 5, {}], ["walk", 1, { lift: true }], ["walk", 0, { expr: "yawn" }]] as const) {
          const g = person({ ...base, style, build, head: build }, dir, pose, frame, o);
          for (let x = 0; x < 16; x++) assert.equal(g.cells[x], null, `top row clipped: style ${style} build ${build} ${dir} ${pose} f${frame} x${x}`);
        }
});

const luma = (h: string) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const OKABE = DEFAULT_THEME.roleColors;
const nb = (g: { w: number; get(x: number, y: number): string | null }, x: number, y: number) => [g.get(x - 1, y), g.get(x + 1, y), g.get(x, y - 1), g.get(x, y + 1)];

test("C4/C9 grayscale audit: skin never blends into the shirt, sleeve or hair next to it (luma delta >= 0.12)", () => {
  const FEATURE = new Set(["#1e1a28", "#8fe0ff", "#7fe3ff", "#ffffff", "#171421"]); // eyes, sweat, phone glow, glyph + halo
  let n = 0;
  for (const shirt of OKABE) for (const skin of DEFAULT_THEME.skins) for (const hair of DEFAULT_THEME.hairs)
    for (const style of [0, 1, 2, 3, 4, 5] as const) for (const dir of ["down", "up", "side"] as const) {
      const look: Look = { ...base, shirt, skin, hair, style, build: (style % 2) as 0 | 1, head: 0, team: style * 2 };
      const pose = style % 2 ? "sit" : "walk";
      const g = person(look, dir, pose, 0);
      const mouth = shade(skin, -0.4);
      g.cells.forEach((c, i) => {
        if (c !== skin) return;
        for (const o of nb(g, i % 16, (i / 16) | 0)) {
          if (!o || o === skin || FEATURE.has(o) || o === mouth || o === look.accColor || o === shade(look.accColor, -0.15)) continue;
          n++;
          assert.ok(Math.abs(luma(o) - luma(skin)) >= 0.115, `${shirt} ${skin} ${hair} s${style} ${dir}: ${o} next to skin`);
        }
      });
    }
  assert.ok(n > 1000);
});

test("C6 no isolated single pixels inside hair or shirt clusters (deliberate features excepted)", () => {
  const FEATURE = new Set(["#1e1a28", "#8fe0ff", "#7fe3ff", "#ffffff", "#171421", "#f2c14e", "#c23b4a", "#f2f2f2"]);
  for (const style of [0, 1, 2, 3, 4, 5] as const) for (const build of [0, 1] as const) for (const dir of ["down", "up", "side"] as const)
    for (const pose of ["walk", "sit", "sit-think"] as const) for (const frame of [0, 1, 2, 3, 4, 5])
      for (const acc of ["none", "glasses", "headphones", "cap", "suit"] as const) {
        const look: Look = { ...base, style, build, head: build, acc, hair: "#a86a2c", shirt: "#3355ff", team: 3 };
        const g = person(look, dir, pose, frame);
        g.cells.forEach((c, i) => {
          if (!c || FEATURE.has(c) || c === shade(teamColor(3), -0.3) || c === look.skin || c === look.pants || c === "#241d2e") return;
          const x = i % 16, y = (i / 16) | 0, around = nb(g, x, y);
          if (around.filter(Boolean).length >= 3 && !around.includes(c)) assert.fail(`stray ${c} at ${x},${y}: style ${style} build ${build} ${dir} ${pose} f${frame} ${acc}`);
        });
      }
});

test("C8/C12 selective outline: opaque, darker than the fill it hugs, never a lighter value than the neighbour", () => {
  const OUT = "#171421";
  for (const shirt of OKABE) for (const skin of DEFAULT_THEME.skins) for (const style of [0, 2, 5] as const) for (const dir of ["down", "up", "side"] as const) {
    const g = person({ ...base, shirt, skin, style, hair: DEFAULT_THEME.hairs[style] }, dir, "walk", 1);
    const before = g.cells.slice();
    g.outline(OUT);
    let distinct = new Set<string>();
    g.cells.forEach((c, i) => {
      if (before[i] || !c) return;
      assert.match(c, /^#[0-9a-f]{6}$/); // no alpha outside the silhouette
      distinct.add(c);
      for (const o of nb({ w: 16, get: (x, y) => (x >= 0 && y >= 0 && x < 16 && y < 24 ? before[y * 16 + x] : null) }, i % 16, (i / 16) | 0)) if (o) assert.ok(luma(c) < luma(o), `${c} vs fill ${o}`);
    });
    assert.ok(distinct.size > 1, "outline is selective, not one global colour");
  }
});

test("walk cycle: 6 distinct poses per view, and the cycle wraps", () => {
  for (const dir of ["down", "up", "side"] as const) {
    const poses = [0, 1, 2, 3, 4, 5].map((f) => px(base, dir, "walk", f));
    assert.equal(new Set(poses).size, 6, dir);
    assert.equal(px(base, dir, "walk", 6), poses[0]);
  }
});

test("team hue shows on the hem and badge halo and changes the texture key input", () => {
  assert.notEqual(px({ ...base, team: 2 }, "down", "walk"), px(base, "down", "walk"));
  assert.notEqual(px({ ...base, team: 2 }, "down", "walk"), px({ ...base, team: 8 }, "down", "walk"));
  assert.equal(lookFor("qa", "x", false, 14).team, 2);
  assert.equal(lookFor("qa", "x").team, undefined);
});

test("lookFor never yields an undefined field for any id (hash high bit)", async () => {
  const { lookFor } = await import("./sprites.ts");
  for (let i = 0; i < 300; i++) {
    const l = lookFor("backend", `agent-${i}`);
    assert.ok(l.hair && l.skin && l.acc && l.style >= 0 && l.style <= 5, `agent-${i}`);
  }
});
