// Pixi side of the fun layer: pooled floating combo numbers.
// Weather, rainbow and cat live in scene.ts (they need the window geometry). Pure rules: flair.ts.
import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import { Grid, bake } from "./pixel.ts";
import { GLYPHS, labelGlyphs, labelWidth } from "./flair.ts";

const DIGITS: Record<string, string[]> = {
  x: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", "###", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", "..#", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
};
let atlas: Texture[] | null = null;
/** One 5x7 cell per glyph (3x5 body + 1px dark outline) in a single baked strip; cells step 4px so neighbours share the outline. */
function glyphTextures(): Texture[] {
  if (atlas) return atlas;
  const g = new Grid(GLYPHS.length * 4 + 1, 7);
  [...GLYPHS].forEach((ch, i) => g.map(i * 4 + 1, 1, DIGITS[ch], { "#": "#ffffff" }));
  g.outline("#1d1b2b");
  const base = g.texture();
  return (atlas = [...GLYPHS].map((_, i) => new Texture({ source: base.source, frame: new Rectangle(i * 4, 0, 5, 7) })));
}

const FLOAT_MS = 900, RISE = 14, MAX_FLOATERS = 6, MAX_GLYPHS = 4;
type Floater = { c: Container; s: Sprite[]; life: number; y0: number };

/** Combo numbers that float up from a desk: 6 pooled containers of 4 glyph sprites each, no Text objects. */
export class Floaters {
  private pool: Floater[] = [];
  private next = 0;
  constructor(parent: Container) {
    const tex = glyphTextures();
    for (let i = 0; i < MAX_FLOATERS; i++) {
      const c = new Container();
      c.visible = false;
      c.eventMode = "none";
      const s = Array.from({ length: MAX_GLYPHS }, (_, k) => { const sp = new Sprite(tex[0]); sp.x = k * 4; c.addChild(sp); return sp; });
      parent.addChild(c);
      this.pool.push({ c, s, life: FLOAT_MS, y0: 0 });
    }
  }
  /** Start a label centred on (x, y); recycles the oldest slot when all are busy. */
  label(x: number, y: number, text: string, tint: number) {
    const f = this.pool.find((p) => p.life >= FLOAT_MS) ?? this.pool[this.next++ % this.pool.length];
    const g = labelGlyphs(text, MAX_GLYPHS), tex = glyphTextures();
    f.s.forEach((sp, i) => {
      sp.visible = i < g.length;
      if (i < g.length) { sp.texture = tex[g[i]]; sp.tint = tint; }
    });
    f.c.position.set(Math.round(x - labelWidth(g.length) / 2 - 1), Math.round(y));
    f.y0 = f.c.y;
    f.life = 0;
    f.c.alpha = 1;
    f.c.visible = true;
  }
  update(dt: number) {
    for (const f of this.pool) {
      if (f.life >= FLOAT_MS) continue;
      f.life += dt * 1000;
      if (f.life >= FLOAT_MS) { f.c.visible = false; continue; }
      const u = f.life / FLOAT_MS;
      f.c.y = Math.round(f.y0 - RISE * (1 - (1 - u) * (1 - u)));
      f.c.alpha = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
    }
  }
}
