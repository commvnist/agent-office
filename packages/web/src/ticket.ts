import type { Texture } from "pixi.js";
import { Grid } from "./pixel.ts";

const cache: Record<string, Texture> = {};
/** Folded-paper ticket, 9x9, nearest-filtered; `check` adds the green tick of a DONE report. Tint for partial/blocked. */
export function ticketTex(check: boolean): Texture {
  const k = check ? "c" : "p";
  return (cache[k] ??= (() => {
    const g = new Grid(9, 9);
    g.rect(1, 1, 7, 7, "#f4f1e6");
    g.rect(1, 1, 7, 1, "#ffffff");
    g.rect(6, 1, 2, 2, "#c9c3ae"); // folded corner
    if (check) { g.set(2, 5, "#2fa84f"); g.set(3, 6, "#2fa84f"); g.set(4, 5, "#2fa84f"); g.set(5, 4, "#2fa84f"); g.set(6, 3, "#2fa84f"); }
    else { g.rect(2, 4, 4, 1, "#9a947f"); g.rect(2, 6, 3, 1, "#9a947f"); }
    return g.outline("#1d1b2b").texture();
  })());
}
