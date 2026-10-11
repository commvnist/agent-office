import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPalette, encodeGif, indexFrame, lzw } from "./gif.ts";

/** Reference GIF LZW decoder (spec algorithm, written independently of the encoder). */
function unlzw(data: Uint8Array, minCode: number): number[] {
  const clear = 1 << minCode, eoi = clear + 1;
  let table: number[][] = [], width = minCode + 1, bits = 0, nbits = 0, pos = 0, prev: number[] | null = null;
  const reset = () => { table = []; for (let i = 0; i < clear; i++) table.push([i]); table.push([], []); width = minCode + 1; prev = null; };
  reset();
  const out: number[] = [];
  for (;;) {
    while (nbits < width) { if (pos >= data.length) return out; bits |= data[pos++] << nbits; nbits += 8; }
    const c = bits & ((1 << width) - 1);
    bits >>>= width; nbits -= width;
    if (c === clear) { reset(); continue; }
    if (c === eoi) return out;
    const e: number[] | null = c < table.length ? table[c] : prev && [...prev, prev[0]];
    assert.ok(e, `bad code ${c}`);
    out.push(...e!);
    if (prev) table.push([...prev, e![0]]);
    prev = e!;
    if (table.length === 1 << width && width < 12) width++;
  }
}

test("LZW round-trips through a reference decoder, across table resets", () => {
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) >> 8;
  for (const [n, k, min] of [[0, 4, 2], [1, 4, 2], [300, 4, 2], [60_000, 64, 6], [60_000, 2, 2], [20_000, 256, 8]] as const) {
    const idx = Uint8Array.from({ length: n }, (_, i) => (i % 97 < 40 ? 3 % k : rnd() % k)); // runs plus noise
    assert.deepEqual(unlzw(lzw(idx, min), min), [...idx], `n=${n} k=${k}`);
  }
});

test("palette keeps distinct colours and the file is a looping GIF89a", () => {
  const f = new Uint8ClampedArray(4 * 16);
  for (let i = 0; i < 16; i++) f.set(i < 8 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
  const { pal, lut } = buildPalette([f]);
  const idx = indexFrame(f, lut);
  assert.notEqual(idx[0], idx[15]);
  assert.deepEqual([...pal.subarray(idx[0] * 3, idx[0] * 3 + 3)].map((v) => v > 200), [true, false, false]);
  const g = encodeGif([f, f], 4, 4, 10);
  assert.equal(String.fromCharCode(...g.subarray(0, 6)), "GIF89a");
  assert.equal(g[g.length - 1], 0x3b);
  assert.equal(g[6] | (g[7] << 8), 4);
});
