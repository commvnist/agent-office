// Pure logic for the canvas fun layer (no pixi, no DOM): combo digit layout, weather picker, delight spawner.
// The pooled sprites that draw these live in flairfx.ts.

// ---- combo number labels ("x5", "x10", "x20") ----------------------------------------------------
/** Atlas order of the 3x5 pixel glyphs. */
export const GLYPHS = "x0123456789";
export const GLYPH_W = 3, GLYPH_H = 5, GLYPH_GAP = 1;
/** Atlas indices for a short label; unknown characters are dropped, at most `max` glyphs. */
export function labelGlyphs(text: string, max = 4): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const i = GLYPHS.indexOf(ch);
    if (i >= 0 && out.length < max) out.push(i);
  }
  return out;
}
/** Pixel width of `n` glyphs laid out left to right; glyph i starts at i * (GLYPH_W + GLYPH_GAP). */
export const labelWidth = (n: number) => (n > 0 ? n * (GLYPH_W + GLYPH_GAP) - GLYPH_GAP : 0);

// ---- weather -------------------------------------------------------------------------------------
export type Weather = "sunny" | "cloudy" | "rain";
export const RAIN_ERRORS = 3, RAIN_WINDOW_MS = 5 * 60_000, SUN_WINDOW_MS = 10 * 60_000;
/** Rain when >= 3 errors in 5 min; sunny when something finished in the last 10 min and nothing errored; clouds otherwise. */
export function pickWeather(done: readonly number[], errs: readonly number[], now: number): Weather {
  let recent = 0, any = false;
  for (const t of errs) {
    if (now - t < RAIN_WINDOW_MS) recent++;
    if (now - t < SUN_WINDOW_MS) any = true;
  }
  if (recent >= RAIN_ERRORS) return "rain";
  if (!any && done.some((t) => now - t < SUN_WINDOW_MS)) return "sunny";
  return "cloudy";
}
/** Append a timestamp to a bounded signal list (oldest dropped). */
export function pushSignal(a: number[], t: number, max = 48) {
  a.push(t);
  if (a.length > max) a.splice(0, a.length - max);
}

// ---- rare delights -------------------------------------------------------------------------------
export type DelightKind = "confetti-gold" | "cat-on-couch"; // the rainbow wash and the disco floor tint were removed (owner: no physical source)
export const DELIGHT_MS: Record<DelightKind, number> = { "confetti-gold": 1600, "cat-on-couch": 40_000 };
export type Delight = { kind: DelightKind; until: number; seat: number };
export const isDelight = (k: unknown): k is DelightKind => typeof k === "string" && Object.hasOwn(DELIGHT_MS, k);
/**
 * One decided delight -> something to draw. The cat needs a free couch seat (`freeSeat` index, -1 = none; a live one is
 * replaced rather than doubled); a repeat of a running kind just extends it. Max 3 live; returns null when nothing is drawn.
 */
export function planDelight(kind: DelightKind, now: number, live: readonly Delight[], freeSeat = -1): Delight | null {
  if (kind === "cat-on-couch" && (freeSeat < 0 || live.some((d) => d.kind === kind))) return null;
  if (kind !== "confetti-gold" && live.some((d) => d.kind === kind && d.until > now)) return null;
  if (live.length >= 3 && kind !== "confetti-gold") return null;
  return { kind, until: now + DELIGHT_MS[kind], seat: kind === "cat-on-couch" ? freeSeat : -1 };
}
