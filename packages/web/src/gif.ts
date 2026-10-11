// Small GIF89a encoder (own code): one global palette by median cut over 15-bit colours, LZW, looping.
// shortcut: every frame is a full frame (no delta frames) and there is no dithering; add both if exports get large or banded.

/** Up to 64 colours (power of two) for all frames, plus a 15-bit-colour -> palette index lookup. */
export function buildPalette(frames: ArrayLike<number>[], size = 64): { pal: Uint8Array; lut: Uint8Array } {
  const hist = new Uint32Array(32768), key = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  for (const d of frames) for (let i = 0; i < d.length; i += 4) hist[key(d[i], d[i + 1], d[i + 2])]++;
  const used: number[] = [];
  hist.forEach((n, k) => { if (n) used.push(k); });
  const ch = (k: number, c: number) => (k >> (10 - 5 * c)) & 31;
  let boxes: number[][] = [used.length ? used : [0]];
  while (boxes.length < size) {
    let bi = -1, bn = 0; // split the box holding the most pixels that still has two colours
    boxes.forEach((b, i) => { const n = b.length > 1 ? b.reduce((s, k) => s + hist[k], 0) : 0; if (n > bn) { bn = n; bi = i; } });
    if (bi < 0) break;
    const b = boxes[bi];
    let axis = 0, span = -1;
    for (let c = 0; c < 3; c++) { const v = b.map((k) => ch(k, c)), s = Math.max(...v) - Math.min(...v); if (s > span) { span = s; axis = c; } }
    b.sort((x, y) => ch(x, axis) - ch(y, axis));
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += hist[b[i]]; cut = i + 1; if (acc * 2 >= bn) break; }
    boxes = [...boxes.slice(0, bi), b.slice(0, cut), b.slice(cut), ...boxes.slice(bi + 1)];
  }
  const pal = new Uint8Array(size * 3), lut = new Uint8Array(32768);
  boxes.forEach((b, i) => {
    const w = b.reduce((s, k) => s + hist[k], 0) || 1;
    for (let c = 0; c < 3; c++) pal[i * 3 + c] = Math.round((b.reduce((s, k) => s + ch(k, c) * hist[k], 0) / w) * 8 + 4);
    for (const k of b) lut[k] = i;
  });
  return { pal, lut };
}
export function indexFrame(rgba: ArrayLike<number>, lut: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length >> 2);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = lut[((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)];
  return out;
}

/** GIF LZW: raw code bytes (no sub-block framing). `minCode` is 2..8 bits per index. */
export function lzw(idx: Uint8Array, minCode: number): Uint8Array {
  const clear = 1 << minCode, eoi = clear + 1, out: number[] = [];
  const dict = new Uint16Array(1 << 20); // (prefix << 8 | byte) -> code; 0 = absent (real codes start at eoi + 1)
  let bits = 0, nbits = 0, width = minCode + 1, next = eoi + 1;
  const emit = (c: number) => { bits |= c << nbits; nbits += width; while (nbits >= 8) { out.push(bits & 255); bits >>>= 8; nbits -= 8; } };
  emit(clear);
  if (idx.length) {
    let prefix = idx[0];
    for (let i = 1; i < idx.length; i++) {
      const c = idx[i], k = (prefix << 8) | c, hit = dict[k];
      if (hit) { prefix = hit; continue; }
      emit(prefix);
      dict[k] = next++;
      if (next - 1 === 1 << width && width < 12) width++; // the code just added needs one more bit
      if (next === 4096) { emit(clear); dict.fill(0); next = eoi + 1; width = minCode + 1; }
      prefix = c;
    }
    emit(prefix);
  }
  emit(eoi);
  if (nbits) out.push(bits & 255);
  return Uint8Array.from(out);
}

const le = (n: number) => [n & 255, n >> 8];
const subBlocks = (d: Uint8Array) => { const o: number[] = []; for (let i = 0; i < d.length; i += 255) { const c = d.subarray(i, i + 255); o.push(c.length, ...c); } o.push(0); return o; };
/** Header, logical screen, palette and the looping extension. `pal` holds 2^n rgb triples, n in 1..8. */
export function gifHead(w: number, h: number, pal: Uint8Array): Uint8Array {
  const n = Math.log2(pal.length / 3);
  return Uint8Array.from([...ascii("GIF89a"), ...le(w), ...le(h), 0xf0 | (n - 1), 0, 0, ...pal, 0x21, 0xff, 11, ...ascii("NETSCAPE2.0"), 3, 1, 0, 0, 0]);
}
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
/** One full frame; `delayCs` hundredths of a second. */
export function gifFrame(w: number, h: number, idx: Uint8Array, delayCs: number, palSize = 64): Uint8Array {
  const min = Math.max(2, Math.log2(palSize));
  return Uint8Array.from([0x21, 0xf9, 4, 0x04, ...le(delayCs), 0, 0, 0x2c, 0, 0, 0, 0, ...le(w), ...le(h), 0, min, ...subBlocks(lzw(idx, min))]);
}
export const GIF_TAIL = Uint8Array.of(0x3b);

/** Whole file at once (tests and small clips); the recorder streams head + frames + tail through a Blob instead. */
export function encodeGif(frames: Uint8ClampedArray[], w: number, h: number, delayCs: number): Uint8Array {
  const { pal, lut } = buildPalette(frames);
  const parts = [gifHead(w, h, pal), ...frames.map((f) => gifFrame(w, h, indexFrame(f, lut), delayCs, pal.length / 3)), GIF_TAIL];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
