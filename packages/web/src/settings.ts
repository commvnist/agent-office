// Visual settings + pure motion/text/bubble helpers (no pixi/DOM so they are testable under node).
//
// API for main.ts:
//   settings.reducedMotion / settings.textScale  mutable; call actor.refreshText() on every actor after changing textScale
//   setTextScale(n)                              clamps to 0.8..2
//   burstAllowed()                               false under reduced motion: skip confetti/puff bursts
//   theme.ts: setRoles(names), roleColor(role), theme() (one built-in palette)
//   actor.ts: Actor.setAlert("waiting"|"blocked"|null), setHover(b), setSelected(b), refreshText(), idleStroll(tile, ms),
//             speak(text, kind, ms, badge?) with kind "blocked" and badge "prompt"|"delegate"|"report"|"tool"|"message",
//             Step {k:"say", badge?}, layoutBubbles(actors) (call after every actor.syncUi each frame)
//   Scene: constructor registers zone roles via setRoles; Scene.night is the overlay (UI layer sits above it already)
//   Decorative effects (puffs, confetti) must never carry text; only hook-derived bubbles carry text + a badge.

export type FollowMode = "off" | "busiest";
const KEY = "agent-office.settings";
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { return {}; } })();
export const settings = {
  reducedMotion: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  textScale: 1,
  /** WCAG 2.2.2 pause: stops ambient loops only (dust, steam, bubbles, breath, quirks, strolls); real activity still animates. */
  ambientPaused: saved.ambientPaused === true,
  /** Camera eases to the busiest agent; a manual pan/zoom pauses it for FOLLOW_PAUSE_MS. */
  follow: (saved.follow === "busiest" ? "busiest" : "off") as FollowMode,
};
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ ambientPaused: settings.ambientPaused, follow: settings.follow })); } catch { /* storage may be blocked */ } };
// Boot cleanup: keys of the removed fun-level/CRT/auto-focus/theme options.
if (["funLevel", "crt", "autoFocusAlerts", "attentionPulse"].some((k) => k in saved)) persist();
try { localStorage.removeItem("ao.theme"); } catch { /* storage may be blocked */ }
export const setFollow = (m: FollowMode) => { if (m === "off" || m === "busiest") { settings.follow = m; persist(); } };
export const setAmbientPaused = (b: boolean) => { settings.ambientPaused = b; persist(); };
/** Ambient loops run only when neither reduced motion nor the pause control is on. */
export const ambientOn = () => !settings.reducedMotion && !settings.ambientPaused;

/** Freeze: main.ts stops advancing animation and holds snapshots while `on`; `since` is the wall time it froze (the clock the scene keeps showing). */
export const frozen = { on: false, since: 0 };
export function setFrozen(on: boolean, now = Date.now()) {
  if (frozen.on === on) return;
  frozen.on = on;
  frozen.since = on ? now : 0;
}
export const burstAllowed = () => !settings.reducedMotion;
export const setTextScale = (n: number) => { settings.textScale = Math.max(0.8, Math.min(2, Number.isFinite(n) ? n : 1)); };

/**
 * Scene-relative text: in-scene text (name tags, bubbles, plaques) keeps its size relative to the world, so zooming in makes it
 * bigger. `k` is 1 at the default fit scale REF_SC and proportional above/below it, quantized to quarters so text is re-rasterised in
 * steps, not every wheel tick. No legibility floor (owner): text shrinks with the world like everything else; zoom in to read it.
 */
export const REF_SC = 2.4;
export const textZoom = { k: 1 };
/** Feed the current world scale; true when the quantized factor changed (callers re-style their text). */
export const setSceneScale = (sc: number): boolean => {
  const k = Number.isFinite(sc) && sc > 0 ? Math.max(0.125, Math.min(6, Math.round((sc / REF_SC) * 8) / 8)) : 1; // eighths: steps fine enough to track the world when zoomed out
  const changed = k !== textZoom.k;
  textZoom.k = k;
  return changed;
};

/** On-screen font px: base * textScale * scene zoom factor, so in-scene text keeps one size relative to the world (O3). */
export const fontPx = (base: number) => Math.max(1, Math.round(base * settings.textScale * textZoom.k));

/** Walk speed with acceleration/deceleration; `remaining` is distance left to the final tile. Never drops below 25% so it always arrives. */
export function easeSpeed(v: number, remaining: number, dt: number, max: number, accel = max * 5): number {
  const brake = (v * v) / (2 * accel);
  const nv = remaining <= brake ? v - accel * dt : v + accel * dt;
  return Math.max(max * 0.25, Math.min(max, nv));
}

export type BubbleBox = { x: number; y: number; w: number; h: number; prio: number; age: number; zone: string; tool: boolean; top?: number };
export type BubbleOut = { y: number; alpha: number; visible: boolean };
/**
 * Stack overlapping bubbles (x = centre, y = bottom edge, screen px). Higher prio first, then newer (smaller age).
 * Overlaps shift up; each shift fades 25% (max 50%); at most `maxTools` tool bubbles stay visible per zone.
 * A bubble that would rise past its `top` (the HUD edge) is hidden: clamping it back down would overprint its own agent (A6).
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
    // fixed obstacles (prio >= 3: tags, alert rings and flags, figures, badges) never move: overlapping each other is fine,
    // shifting them would move the obstacle away from the thing it protects
    if (it.prio >= 3) { placed.push({ l, r, t: it.y - it.h, b: it.y }); continue; }
    let clear = false;
    for (let guard = 0; guard < 32; guard++) {
      const hit = placed.find((p) => l < p.r && r > p.l && y - it.h < p.b && y > p.t);
      if (!hit) { clear = true; break; }
      y = hit.t - 2;
      shifts++;
    }
    // no clear spot found, or no room above its agent before the HUD edge: hidden, never pushed down onto the body (A6)
    if (!clear || (it.top !== undefined && y - it.h < it.top)) { out[i].visible = false; continue; }
    out[i].y = y;
    out[i].alpha = it.prio >= 2.5 ? 1 : 1 - 0.25 * Math.min(2, shifts); // an alert's own words never fade
    placed.push({ l, r, t: y - it.h, b: y });
  }
  return out;
}
