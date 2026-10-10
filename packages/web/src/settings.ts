// Visual settings + pure motion/text/bubble helpers (no pixi/DOM so they are testable under node).
//
// API for main.ts (all additive; nothing here is required for the old behaviour):
//   settings.reducedMotion / settings.textScale  mutable; call actor.refreshText() on every actor after changing textScale
//   setTextScale(n)                              clamps to 0.8..2
//   burstAllowed()                               false under reduced motion: skip confetti/puff bursts
//   theme.ts: THEMES, applyTheme(t), parseTheme(json), setRoles(names), roleColor(role), theme()
//             after applyTheme the scene must be rebuilt (same path as the band-count rebuild) and actors' looks refreshed via lookFor
//   actor.ts: Actor.setAlert("waiting"|"blocked"|null), setHover(b), setSelected(b), refreshText(), idleStroll(tile, ms),
//             speak(text, kind, ms, badge?) with kind "blocked" and badge "prompt"|"delegate"|"report"|"tool"|"message",
//             Step {k:"say", badge?}, layoutBubbles(actors) (call after every actor.syncUi each frame)
//   Scene: constructor registers zone roles via setRoles; Scene.night is the overlay (UI layer sits above it already)
//   Decorative effects (puffs, confetti) must never carry text; only hook-derived bubbles carry text + a badge.

export const settings = {
  reducedMotion: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  textScale: 1,
};
export const burstAllowed = () => !settings.reducedMotion;
export const setTextScale = (n: number) => { settings.textScale = Math.max(0.8, Math.min(2, Number.isFinite(n) ? n : 1)); };

/** On-screen font px: base * textScale, never below 10px. */
export const fontPx = (base: number) => Math.max(10, Math.round(base * settings.textScale));

/** Walk speed with acceleration/deceleration; `remaining` is distance left to the final tile. Never drops below 25% so it always arrives. */
export function easeSpeed(v: number, remaining: number, dt: number, max: number, accel = max * 5): number {
  const brake = (v * v) / (2 * accel);
  const nv = remaining <= brake ? v - accel * dt : v + accel * dt;
  return Math.max(max * 0.25, Math.min(max, nv));
}

export type BubbleBox = { x: number; y: number; w: number; h: number; prio: number; age: number; zone: string; tool: boolean };
export type BubbleOut = { y: number; alpha: number; visible: boolean };
/**
 * Stack overlapping bubbles (x = centre, y = bottom edge, screen px). Higher prio first, then newer (smaller age).
 * Overlaps shift up; each shift fades 25% (max 50%); at most `maxTools` tool bubbles stay visible per zone.
 */
export function stackBubbles(items: BubbleBox[], maxTools = 3): BubbleOut[] {
  const out: BubbleOut[] = items.map((b) => ({ y: b.y, alpha: 1, visible: true }));
  const placed: { l: number; r: number; t: number; b: number }[] = [];
  const perZone = new Map<string, number>();
  const order = items.map((_, i) => i).sort((a, b) => items[b].prio - items[a].prio || items[a].age - items[b].age);
  for (const i of order) {
    const it = items[i];
    if (it.tool) {
      const n = perZone.get(it.zone) ?? 0;
      if (n >= maxTools) { out[i].visible = false; continue; }
      perZone.set(it.zone, n + 1);
    }
    const l = it.x - it.w / 2, r = it.x + it.w / 2;
    let y = it.y, shifts = 0;
    for (let guard = 0; guard < 12; guard++) {
      const hit = placed.find((p) => l < p.r && r > p.l && y - it.h < p.b && y > p.t);
      if (!hit) break;
      y = hit.t - 2;
      shifts++;
    }
    out[i].y = y;
    out[i].alpha = 1 - 0.25 * Math.min(2, shifts);
    placed.push({ l, r, t: y - it.h, b: y });
  }
  return out;
}
