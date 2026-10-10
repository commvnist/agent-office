import { Texture } from "pixi.js";

/** A tiny indexed-colour raster we draw sprites into, then upload as a crisp (nearest-filtered) texture. */
export class Grid {
  cells: (string | null)[];
  constructor(public w: number, public h: number) {
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
  /** 1px outline on transparent pixels that touch a filled one (4-neighbourhood). */
  outline(c: string) {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (!this.get(x, y) && (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1))) add.push(y * this.w + x);
    for (const i of add) this.cells[i] = c;
    return this;
  }
  texture(): Texture {
    const cv = document.createElement("canvas");
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext("2d")!;
    this.cells.forEach((c, i) => {
      if (!c) return;
      ctx.fillStyle = c;
      ctx.fillRect(i % this.w, Math.floor(i / this.w), 1, 1);
    });
    const t = Texture.from(cv);
    t.source.scaleMode = "nearest";
    return t;
  }
}

export { hsl, hash, shade, mix, luma } from "./color.ts";
