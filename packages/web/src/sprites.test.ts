import { test } from "node:test";
import assert from "node:assert/strict";
import { awayFromStatus, glyphInk, grade, person, lookFor, personTex, STATUS_HUES, teamColor, type Look } from "./sprites.ts";
import { DEFAULT_THEME, KEY, STATUS } from "./theme.ts";
import { shade } from "./color.ts";

const base: Look = { skin: "#e6b48a", hair: "#5b3a26", shirt: "#e8e8f0", pants: "#33384d", style: 0, build: 0, head: 0, acc: "none", accColor: "#d33a8a", badge: 3 };
const STYLES = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const px = (l: Look, d: "down" | "up" | "side", p: "walk" | "sit" | "sit-think", f = 0, o = {}) => person(l, d, p, f, o).cells.join();

test("every style, build, expression and pose draws inside the 16x24 grid", () => {
  for (const style of STYLES)
    for (const build of [0, 1] as const)
      for (const d of ["down", "up", "side"] as const)
        for (const cut of [0, 1, 2, 3] as const)
          assert.ok(person({ ...base, style, build, head: build, cut }, d, "sit", 0).cells.some(Boolean));
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
  for (const style of STYLES)
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
  const FEATURE = new Set(["#1e1a28", "#8fe0ff", "#7fe3ff", "#ffffff", "#171421"]); // eyes, sweat, phone glow, glyph halo (+ glyph ink below)
  let n = 0;
  for (const shirt of OKABE) for (const skin0 of DEFAULT_THEME.skins) for (const hair of DEFAULT_THEME.hairs)
    for (const style of STYLES) for (const dir of ["down", "up", "side"] as const) {
      const look0: Look = { ...base, shirt, skin: skin0, hair, style, build: (style % 2) as 0 | 1, head: 0, team: style * 2, cut: (style % 4) as 0 | 1 | 2 | 3 };
      const look = grade(look0), skin = look.skin;
      const pose = style % 2 ? "sit" : style % 3 ? "walk" : "sit-think";
      const g = person(look0, dir, pose, 0);
      const mouth = shade(skin, -0.4);
      g.cells.forEach((c, i) => {
        if (c !== skin) return;
        for (const o of nb(g, i % 16, (i / 16) | 0)) {
          if (!o || o === skin || FEATURE.has(o) || o === glyphInk(look) || o === mouth || o === look.accColor || o === shade(look.accColor, -0.15)) continue;
          n++;
          assert.ok(Math.abs(luma(o) - luma(skin)) >= 0.115, `${shirt} ${skin} ${hair} s${style} ${dir}: ${o} next to skin`);
        }
      });
    }
  assert.ok(n > 1000);
});

test("C6 no isolated single pixels inside hair or shirt clusters (deliberate features excepted)", () => {
  for (const style of STYLES) for (const build of [0, 1] as const) for (const dir of ["down", "up", "side"] as const)
    for (const pose of ["walk", "sit", "sit-think"] as const) for (const frame of [0, 1, 2, 3, 4, 5])
      for (const acc of ["none", "glasses", "headphones", "cap", "suit"] as const) {
        const look0: Look = { ...base, style, build, head: build, acc, hair: "#a86a2c", shirt: "#3355ff", team: 3, cut: ((style + frame) % 4) as 0 | 1 | 2 | 3 };
        const look = grade(look0);
        const FEATURE = new Set(["#1e1a28", "#8fe0ff", "#7fe3ff", "#ffffff", glyphInk(look), "#171421", "#f2c14e", "#c23b4a", shade("#c23b4a", -0.12)]);
        const g = person(look0, dir, pose, frame, { raise: frame === 3 });
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
    // a figure graded wholly dark (darkest skin: shirt, hair and pants all under ~0.3) may outline in one near-black; the rest must vary
    if (luma(skin) > 0.5) assert.ok(distinct.size > 1, `outline is selective, not one global colour: ${shirt} ${skin} s${style} ${dir} ${[...distinct]}`);
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
    assert.ok(l.hair && l.skin && l.acc && l.style >= 0 && l.style <= 7, `agent-${i}`);
  }
});

test("leads are variations of one portrait: curly dark hair, aviators, light blazer, stocky; varied by id; nothing clipped", () => {
  const looks = Array.from({ length: 24 }, (_, i) => lookFor("lead", `lead-${i}`, true));
  assert.ok(looks.every((l) => l.build === 1 && l.lead), "stocky, with the portrait variant");
  assert.ok(new Set(looks.map((l) => l.lead!.jacket)).size >= 4, "blazer colours vary");
  assert.ok(new Set(looks.map((l) => l.lead!.lens)).size >= 3, "lens tints vary");
  assert.ok(new Set(looks.map((l) => l.lead!.beard)).size >= 2, "beard styles vary");
  for (const l of looks) for (const dir of ["down", "side", "up"] as const) for (const [pose, frame] of [["walk", 0], ["walk", 1], ["sit", 0]] as const) {
    const g = person(l, dir, pose, frame, {});
    g.outline("#171421");
    for (let x = 0; x < 16; x++) { const c = g.cells[x]; assert.ok(c === null || c === "#171421", `top row clipped: ${dir} ${pose} f${frame}`); }
  }
});

const hueOf = (hex: string) => { const n = parseInt(hex.slice(1), 16), [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255]; const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60; };
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

test("STATUS_HUES are the saturated STATUS colours, and shirts keep 30 degrees from all of them", () => {
  assert.deepEqual(STATUS_HUES.map(Math.round), ["permission", "working", "turn", "blocked"].map((k) => Math.round(hueOf(STATUS[k as keyof typeof STATUS].color))));
  for (let h = 0; h < 360; h += 7) for (const s of STATUS_HUES) assert.ok(hueGap(awayFromStatus(h), s) >= 30 - 1e-9, `${h}`);
  assert.equal(awayFromStatus(280), 280); // already clear: unchanged
  for (const shirt of [...OKABE, "#ff0000", "#3355ff"]) { const c = grade({ ...base, shirt }).shirt; if (c !== shirt || hueOf(c) === hueOf(c)) for (const s of STATUS_HUES) if (luma(c) > 0 && !/^#(..)\1\1$/.test(c)) assert.ok(hueGap(hueOf(c), s) >= 29, `${shirt} -> ${c}`); }
});

test("R2 grading: skin on the face band; no body pixel is brighter than the face (props, glare and emitters excepted)", () => {
  const PROPS = new Set(["#7fe3ff", "#8fe0ff", "#f4f1e6", "#6b4a2e"]); // phone glow, sweat, mug
  for (const skin of DEFAULT_THEME.skins) for (const shirt of [...OKABE, "#ffffff"]) for (const hair of [...DEFAULT_THEME.hairs, "#000000"]) {
    const l = grade({ ...base, skin, shirt, hair, acc: "tie", accColor: "#f0f0a0" });
    assert.ok(luma(l.skin) >= KEY.char.face[0] - 0.01 && luma(l.skin) <= KEY.char.face[1] + 0.01, skin);
    assert.ok(luma(l.hair) >= KEY.char.hair[0] - 0.01, `${hair} lifted off the floor`);
    for (const o of [{}, { sip: true }, { raise: true }]) {
      const g = person({ ...base, skin, shirt, hair, acc: "tie", accColor: "#f0f0a0" }, "down", "sit", 0, o);
      for (const c of g.cells) if (c && !PROPS.has(c)) assert.ok(luma(c) <= luma(l.skin) + 0.005, `${skin} ${shirt} ${hair}: ${c} brighter than the face`);
    }
  }
  for (const l of Array.from({ length: 12 }, (_, i) => lookFor("lead", `lead-${i}`, true))) {
    const g = person(l, "down", "sit", 0), lens = new Set([l.lead!.lens, shade(l.lead!.lens, 0.25)]); // aviators: glare is allowed
    const sk = grade(l).skin;
    for (const c of g.cells) if (c && !lens.has(c) && c !== "#b5655b") assert.ok(luma(c) <= luma(sk) + 0.005, `lead ${c}`);
  }
});

test("F1 variants: hair styles and shirt cuts vary by id and change the silhouette or sleeves", () => {
  const looks = Array.from({ length: 64 }, (_, i) => lookFor("backend", `a-${i}`));
  assert.equal(new Set(looks.map((l) => l.style)).size, 8);
  assert.equal(new Set(looks.map((l) => l.cut)).size, 4);
  assert.deepEqual(lookFor("backend", "a-3"), lookFor("backend", "a-3")); // deterministic
  const mask = (l: Look, d: "down" | "up" | "side") => person(l, d, "walk", 0).cells.map((c) => (c ? 1 : 0)).join("");
  const plain = { ...base, acc: "none" as const };
  for (const d of ["down", "up", "side"] as const) {
    for (const style of [6, 7] as const) assert.notEqual(style === 6 && d === "up" ? px({ ...plain, style }, d, "walk") : mask({ ...plain, style }, d), style === 6 && d === "up" ? px(plain, d, "walk") : mask(plain, d), `style ${style} ${d} silhouette`); // a ponytail from behind lies on the back
    assert.notEqual(mask({ ...plain, cut: 3 }, d), mask(plain, d), `hood ${d} silhouette`);
  }
  for (const cut of [1, 2] as const) assert.notEqual(px({ ...plain, cut }, "down", "walk"), px(plain, "down", "walk"), `cut ${cut}`);
  assert.equal(mask({ ...plain, cut: 3, acc: "headphones" }, "down"), mask({ ...plain, acc: "headphones" }, "down"), "no hood over headphones");
  const lead = lookFor("lead", "L", true), helper = { ...lead, lead: undefined, acc: "none" as const };
  assert.ok(mask(lead, "down").split("").filter((c) => c === "1").length > mask(helper, "down").split("").filter((c) => c === "1").length, "lead silhouette cue: padded shoulders");
});

test("F2 poses: working, idle and waiting differ in shape at pod scale (not only the face)", () => {
  const mask = (p: "sit" | "sit-think", o = {}) => person(base, "down", p, 0, o).cells.map((c) => (c ? 1 : 0)).join("");
  const work = mask("sit"), idle = mask("sit-think"), wait = mask("sit-think", { raise: true });
  assert.equal(new Set([work, idle, wait]).size, 3);
  const top = (m: string) => Math.floor(m.indexOf("1") / 16);
  assert.ok(top(idle) < top(work), "idle leans back (1px up, off the desk)");
  assert.ok(top(wait) < top(idle), "waiting: a hand above the head line");
  const handsCentre = (p: "sit" | "sit-think") => { const g = person(base, "down", p, 0); let n = 0; for (let x = 6; x <= 9; x++) if (g.get(x, 22) === base.skin) n++; return n; };
  assert.ok(handsCentre("sit") === 4 && handsCentre("sit-think") === 0, "working hands meet on the keyboard; idle hands are off it");
});

test("graded role shirts stay pairwise distinct (no two roles collapse to one shirt)", () => {
  const base = lookFor("qa", "x", false);
  const shirts = DEFAULT_THEME.roleColors.map((shirt) => grade({ ...base, lead: undefined, shirt }).shirt);
  const lum = (h: string) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
  for (let i = 0; i < shirts.length; i++) for (let j = i + 1; j < shirts.length; j++) {
    const grey = /^#(..)\1\1$/.test(shirts[i]) || /^#(..)\1\1$/.test(shirts[j]);
    assert.ok(grey || hueGap(hueOf(shirts[i]), hueOf(shirts[j])) >= 18 || Math.abs(lum(shirts[i]) - lum(shirts[j])) >= 0.06, `${DEFAULT_THEME.roleColors[i]} vs ${DEFAULT_THEME.roleColors[j]}: ${shirts[i]} ~ ${shirts[j]}`);
  }
});
