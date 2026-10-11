import { Texture } from "pixi.js";
import { luma, shade } from "./color.ts";

const HEX = /^#[0-9a-f]{6}$/i;

/** A tiny indexed-colour raster we draw sprites into, then upload as a crisp (nearest-filtered) texture. */
export class Grid {
  cells: (string | null)[];
  w: number;
  h: number;
  constructor(w: number, h: number) { // explicit fields: native TS stripping (node --test) has no parameter properties
    this.w = w;
    this.h = h;
    this.cells = new Array(w * h).fill(null);
  }
  set(x: number, y: number, c: string | null) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.cells[y * this.w + x] = c;
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.cells[y * this.w + x] : null;
  }
  rect(x: number, y: number, w: number, h: number, c: string | null) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** Draw an ASCII map; `.` is transparent, other chars look up in `pal`. */
  map(x: number, y: number, rows: string[], pal: Record<string, string>) {
    rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== "." && pal[ch] && this.set(x + i, y + j, pal[ch])));
  }
  /**
   * 1px outline on transparent pixels that touch a filled one (4-neighbourhood). Selective: each outline pixel is a darker,
   * hue-shifted version of its darkest neighbouring fill; `c` is the fallback when that cannot be darker than the fill
   * (very dark fills, non-hex fills such as baked-alpha shadows). Always an opaque hex colour.
   */
  outline(c: string) {
    const add: number[] = [], pick = new Map<string, string>();
    const col = (fill: string) => {
      let o = pick.get(fill);
      if (o === undefined) {
        o = c;
        if (HEX.test(fill)) for (const amt of [-0.4, -0.55, -0.7]) { // deepen until dark enough to read against any floor
          const d = shade(fill, amt);
          if (luma(d) <= 0.3 && luma(d) <= luma(fill) - 0.06) { o = d; break; }
        }
        pick.set(fill, o);
      }
      return o;
    };
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (!this.get(x, y) && (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1))) add.push(y * this.w + x);
    const out: string[] = add.map((i) => {
      const x = i % this.w, y = (i / this.w) | 0;
      let best = "", bl = 2;
      for (const f of [this.get(x - 1, y), this.get(x + 1, y), this.get(x, y - 1), this.get(x, y + 1)]) {
        const l = !f ? 3 : HEX.test(f) ? luma(f) : 1;
        if (f && l < bl) { bl = l; best = f; }
      }
      return col(best);
    });
    add.forEach((i, k) => (this.cells[i] = out[k]));
    return this;
  }
  texture(): Texture {
    return bake(this.w, this.h, (ctx) => {
      this.cells.forEach((c, i) => {
        if (!c) return;
        ctx.fillStyle = c;
        ctx.fillRect(i % this.w, Math.floor(i / this.w), 1, 1);
      });
    });
  }
}

/** Draw into a w x h canvas and upload it as a crisp (nearest-filtered) texture. */
export function bake(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const t = Texture.from(cv);
  t.source.scaleMode = "nearest";
  return t;
}

export { hsl, hash, shade, mix, luma } from "./color.ts";
