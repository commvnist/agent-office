// Pure parts of the DOM fun layer (palette, highlight cards, sparklines, rings). No DOM, no pixi.

// ---- command palette: subsequence scoring ----
/** -1 when `q` is not a subsequence of `text`; higher is better (word starts and runs score, shorter text wins ties). */
export function fuzzy(q: string, text: string): number {
  const n = q.toLowerCase().replace(/\s+/g, ""), s = text.toLowerCase();
  if (!n) return 0;
  let score = 0, from = 0, run = 0;
  for (const ch of n) {
    const i = s.indexOf(ch, from);
    if (i < 0) return -1;
    run = i === from && from > 0 ? run + 1 : 0;
    score += 1 + run * 2 + (i === 0 || /[\s\-_/·:]/.test(s[i - 1]) ? 4 : 0);
    from = i + 1;
  }
  return score - s.length * 0.01;
}
export function rank<T>(q: string, items: readonly T[], text: (t: T) => string, max = 8): T[] {
  if (!q.trim()) return items.slice(0, max);
  return items.map((it) => ({ it, s: fuzzy(q, text(it)) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.it);
}

// ---- highlight card: "<who> <outcome>: <task> (<dur>)" ----
export type Highlight = { who: string; what: string; dur: string; outcome: "done" | "blocked" | "partial" | "" };
export function parseHighlight(text: string): Highlight {
  const m = /^(.+?) (done|blocked|partial): (.*?)(?: \(([^()]+)\))?$/s.exec(text);
  return m ? { who: m[1], outcome: m[2] as Highlight["outcome"], what: m[3], dur: m[4] ?? "" } : { who: "", what: text, dur: "", outcome: "" };
}
export const OUTCOME_GLYPH = { done: "✓", blocked: "✕", partial: "~", "": "·" } as const;

// ---- sparklines ----
/** Count of `times` per bin, oldest first, `bins` bins of `binMs` ending at `now`. */
export function sparkBuckets(times: readonly number[], now: number, bins = 30, binMs = 60_000): number[] {
  const out = new Array<number>(bins).fill(0);
  for (const t of times) {
    const age = Math.floor((now - t) / binMs);
    if (age >= 0 && age < bins) out[bins - 1 - age]++;
  }
  return out;
}
/** Growth of a cumulative counter per bin from {t,total} samples (sorted by t); a drop (new session) counts as 0. */
export function deltaBuckets(samples: readonly { t: number; total: number }[], now: number, bins = 30, binMs = 60_000): number[] {
  const out = new Array<number>(bins).fill(0);
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i].total - samples[i - 1].total, age = Math.floor((now - samples[i].t) / binMs);
    if (d > 0 && age >= 0 && age < bins) out[bins - 1 - age] += d;
  }
  return out;
}
/** SVG polyline points for values in a w x h box. */
export function sparkPoints(v: readonly number[], w: number, h: number): string {
  const max = Math.max(1, ...v);
  return v.map((y, i) => `${(v.length < 2 ? 0 : (i / (v.length - 1)) * w).toFixed(1)},${(h - 1 - (y / max) * (h - 2)).toFixed(1)}`).join(" ");
}

// ---- activity rings ----
export type Ring = { r: number; circ: number; dash: number };
/** Concentric rings, outermost first: each ring's arc is `vals[i] / total` of its circumference. */
export function ringMath(vals: readonly number[], total: number, r0 = 11, step = 4): Ring[] {
  return vals.map((v, i) => {
    const r = r0 - i * step, circ = 2 * Math.PI * r;
    return { r, circ, dash: total > 0 ? circ * Math.max(0, Math.min(1, v / total)) : 0 };
  });
}
