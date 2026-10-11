// Manual zoom/pan + focus-follow on top of the fit-to-window scale (#72). The math is pure; bindPointer is the only DOM part.
// zoom 1 / pan 0 is exactly the old centred fit.

import { settings } from "./settings.ts";

export type View = { sc: number; ox: number; oy: number };
export const SHAKE_LIGHT = 3, SHAKE_HEAVY = 6; // px caps
/** Shake displacement in whole px: proportional to trauma (0..1), never beyond `cap`, alternating sign per tick. */
export const shakeOffset = (trauma: number, cap: number, tick: number) =>
  trauma <= 0 ? 0 : Math.min(cap, Math.ceil(cap * Math.min(1, trauma))) * (tick % 2 ? 1 : -1);
const KEY = "agent-office.camera";
const PHONE_TILES = 14, PHONE_MIN_TILES = 12;
/** A stage too narrow to show the whole room legibly: phone portrait, or any tall stage. */
export const isNarrow = (W: number, H: number) => W <= 560 || W / Math.max(1, H) < 0.8;
/** Phone fit: about 14 tiles across (never fewer than 12), taller if the room is short so the stage is filled. `lh` is the room height in art px incl. spare. */
export function phoneScale(W: number, H: number, lh: number, tile = 16) {
  return Math.max(W / (PHONE_TILES * tile), Math.min(H / lh, W / (PHONE_MIN_TILES * tile)));
}
export type AutoCand = { id: string; x: number; y: number; alert?: boolean; working?: boolean };
/** Default phone focus: an alert agent, else a working one, else `rest` (the door aisle). Lowest id wins; `cur` is kept while it still qualifies so the camera never ping-pongs. */
export function pickAuto(c: AutoCand[], cur: string | null, rest: { x: number; y: number }): { id: string | null; x: number; y: number } {
  for (const k of ["alert", "working"] as const) {
    const m = c.filter((a) => a[k]);
    const w = m.find((a) => a.id === cur) ?? m.reduce<AutoCand | null>((b, a) => (!b || a.id < b.id ? a : b), null);
    if (w) return w;
  }
  return { id: null, ...rest };
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class Camera {
  zoom = 1;
  panX = 0; // screen px offset from the centred position
  panY = 0;
  follow: string | null = null;
  /** Lowest legible on-screen scale (screen px per art px); zooming out stops there and the world is panned instead. Set by main.ts. */
  minScale = 0;
  /** true once the current pointer gesture moved: taps on actors should be ignored. */
  dragged = false;
  /** Wall time of the last user pan/zoom/reset; follow stays out of the way for a few seconds after it. */
  touched = 0;
  /** Set by main.ts when a double-click landed on an actor, so the canvas dblclick does not reset the view. */
  actorDbl = 0;
  /** Set by main.ts: keyboard "f" follows the selected actor. */
  focusSelected: (() => void) | null = null;
  /** Eased zoom target (follow mode); any user zoom/pan/reset cancels it. */
  zoomGoal: number | null = null;
  /** Set by main.ts each frame: narrow stage, so the room is not fit whole; the view follows `autoPos` (pickAuto) until the user pans or picks "fit all". */
  phone = false;
  fitAll = false;
  autoFollow = true;
  autoPos: { x: number; y: number } | null = null;
  /** This frame's view without the shake: the minimap and other HUD draw from it, so only the world moves. */
  still: View = { sc: 1, ox: 0, oy: 0 };
  private trauma = 0;
  private cap = 0;
  private shakeT = 0;
  private last = { sc: 1, ox: 0, oy: 0, cx: 0, top: 0, H: 0, lw: 1, lh: 1 };

  constructor() { this.load(); }

  /** Camera shake: light (a blocked agent) is capped at 3 px and gone in ~150 ms, heavy at 6 px and ~200 ms. Moves the world only; reduced motion turns it off. */
  shake(heavy = false) {
    if (settings.reducedMotion) return;
    this.trauma = Math.max(this.trauma, heavy ? 1 : 0.7);
    this.cap = Math.max(this.cap, heavy ? SHAKE_HEAVY : SHAKE_LIGHT);
  }

  /** Final transform for this frame. `target` is the followed actor's art-space position (eased towards when set). */
  view(fit: number, W: number, H: number, top: number, lw: number, lh: number, target?: { x: number; y: number } | null, dt = 0, dpr = 1): View {
    if (this.zoomGoal !== null) {
      const kz = dt > 0 ? Math.min(1, dt * 4) : 1;
      this.zoom = Math.abs(this.zoomGoal - this.zoom) < 0.01 ? this.zoomGoal : this.zoom + (this.zoomGoal - this.zoom) * kz;
      if (this.zoom === this.zoomGoal) this.zoomGoal = null;
    }
    if (fit > 0 && fit * this.zoom < this.minScale) this.zoom = this.minScale / fit;
    const sc = fit * this.zoom, cx = W / 2;
    this.last = { sc, ox: 0, oy: 0, cx, top, H, lw, lh };
    const cy = this.anchorY(sc);
    const auto = this.phone && !this.fitAll && this.autoFollow && !this.follow ? this.autoPos : null;
    if ((this.follow && target) || auto) {
      const t = (this.follow && target) || auto!;
      const k = dt > 0 ? Math.min(1, dt * (auto ? 3 : 6)) : 1;
      this.panX += (-(t.x - lw / 2) * sc - this.panX) * k;
      this.panY += (this.panYFor(t.y, sc) - this.panY) * k;
    }
    this.panX = clamp(this.panX, -lw * sc, lw * sc);
    this.panY = clamp(this.panY, -lh * sc, lh * sc);
    if (this.phone && !this.fitAll) { // a room larger than the stage never slides off it: no dead band beside or below the walls
      if (lw * sc > W) this.panX = clamp(this.panX, -(lw * sc - W) / 2, (lw * sc - W) / 2);
      if (lh * sc > H) this.panY = clamp(this.panY, H - lh * sc, 0);
    }
    const snap = (n: number) => Math.round(n * dpr) / dpr; // whole device pixels: art pixel edges never straddle a physical pixel
    const ox = snap(cx - (lw / 2) * sc + this.panX), oy = snap(cy - (lh / 2) * sc + this.panY);
    this.last.ox = ox;
    this.last.oy = oy;
    this.still.sc = sc; this.still.ox = ox; this.still.oy = oy;
    if (this.trauma <= 0) return { sc, ox, oy };
    const k = shakeOffset(this.trauma, this.cap, Math.floor(this.shakeT / 30)); // alternates every 30ms; the pan itself is untouched
    this.shakeT += dt * 1000;
    this.trauma = Math.max(0, this.trauma - dt * 5);
    if (this.trauma === 0) this.cap = this.shakeT = 0;
    return { sc, ox: ox + k, oy: oy + (this.cap > SHAKE_LIGHT ? Math.trunc(k / 2) : 0) };
  }

  /** Screen y the world's vertical middle sits on at zero pan: a world taller than the viewport hangs from the top (wall,
   * lobby, first pods) instead of showing its middle; at equal height both agree. */
  private anchorY(sc: number) {
    const L = this.last;
    return L.lh * sc > L.H ? L.top + (L.lh * sc) / 2 : L.top + L.H / 2;
  }
  /** panY that puts art y on the viewport centre at scale `sc`. */
  private panYFor(y: number, sc: number) {
    const L = this.last;
    return L.top + L.H / 2 - y * sc - this.anchorY(sc) + (L.lh / 2) * sc;
  }

  /** Multiply the zoom, keeping the screen point (sx, sy) (default: viewport centre) fixed. */
  zoomBy(f: number, sx?: number, sy?: number) {
    this.zoomGoal = null;
    const L = this.last, z = clamp(this.zoom * f, Math.max(0.5, this.minScale / (L.sc / this.zoom)), 8), k = z / this.zoom;
    if (k === 1) return;
    this.touched = Date.now();
    const px = sx ?? L.cx, py = sy ?? L.top + L.H / 2, nsc = L.sc * k;
    this.panX = px - (px - L.ox) * k - L.cx + (L.lw / 2) * nsc;
    this.panY = py - (py - L.oy) * k - this.anchorY(nsc) + (L.lh / 2) * nsc;
    this.zoom = z;
    this.save();
  }
  /** Put the art point (x, y) at the viewport centre (minimap clicks, wing jumps); needs one view() first. */
  centerOn(x: number, y: number) {
    this.zoomGoal = null;
    this.follow = null;
    this.autoFollow = false;
    this.touched = Date.now();
    this.panX = -(x - this.last.lw / 2) * this.last.sc;
    this.panY = this.panYFor(y, this.last.sc);
    this.save();
  }
  panBy(dx: number, dy: number) {
    this.zoomGoal = null;
    this.follow = null;
    this.autoFollow = false;
    this.touched = Date.now();
    this.panX += dx;
    this.panY += dy;
    this.save();
  }
  reset() {
    this.zoom = 1; this.panX = this.panY = 0; this.follow = null; this.zoomGoal = null;
    this.fitAll = false; this.autoFollow = true;
    this.touched = Date.now();
    this.save();
  }
  /** Phone "fit all" toggle: the whole room at the fitted scale, or back to the followed close view. */
  toggleFitAll() {
    this.fitAll = !this.fitAll;
    this.autoFollow = !this.fitAll;
    this.follow = null; this.zoom = 1; this.zoomGoal = null; this.panX = this.panY = 0;
    this.touched = Date.now();
    this.save();
  }
  setFollow(id: string | null) { this.follow = id; }
  /** Follow `id`, easing the zoom up to 2x instead of cutting (follow mode). */
  easeFocus(id: string | null) {
    this.follow = id;
    if (id && this.zoom < 2) this.zoomGoal = 2;
  }
  /** Follow `id` at no less than 2x. */
  focus(id: string | null) {
    this.follow = id;
    if (id && this.zoom < 2) this.zoom = 2;
  }

  private save() {
    try { localStorage.setItem(KEY, JSON.stringify({ zoom: this.zoom, panX: this.panX, panY: this.panY })); } catch { /* storage may be blocked */ }
  }
  private load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (v && [v.zoom, v.panX, v.panY].every(Number.isFinite)) { this.zoom = clamp(v.zoom, 0.5, 8); this.panX = v.panX; this.panY = v.panY; }
    } catch { /* ignore */ }
  }
}
export const camera = new Camera();

/** True when a key press belongs to a form control or carries a modifier, so camera shortcuts must stay out of it (#164). */
export function ignoreKey(e: { target: unknown; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const t = e.target as { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null;
  const tag = t?.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!t?.isContentEditable || t?.getAttribute?.("role") === "slider";
}
const PAN = 48;
const KEYS: Record<string, (c: Camera) => void> = {
  "0": (c) => c.reset(),
  "+": (c) => c.zoomBy(1.25),
  "=": (c) => c.zoomBy(1.25),
  "-": (c) => c.zoomBy(0.8),
  "_": (c) => c.zoomBy(0.8),
  ArrowLeft: (c) => c.panBy(PAN, 0),
  ArrowRight: (c) => c.panBy(-PAN, 0),
  ArrowUp: (c) => c.panBy(0, PAN),
  ArrowDown: (c) => c.panBy(0, -PAN),
  f: (c) => c.focusSelected?.(),
  F: (c) => c.focusSelected?.(),
};

/** Wheel/pinch zoom, drag pan (two fingers only for touch when `ao.twoFingerPan` is set), keys +/- arrows F 0, double-click to reset. */
export function bindPointer(el: HTMLElement, cam: Camera = camera) {
  el.style.touchAction = "none";
  const pts = new Map<number, { x: number; y: number }>();
  let pinch = 0, moved = 0, mid: { x: number; y: number } | null = null;
  // shortcut: opt-in via localStorage until the settings dialog exposes it
  const twoFinger = () => { try { return localStorage.getItem("ao.twoFingerPan") === "1"; } catch { return false; } };
  const local = (e: { clientX: number; clientY: number }) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = local(e);
    cam.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
  }, { passive: false });
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId); // so the matching pointerup still reaches us when the drag ends over the top bar
    pts.set(e.pointerId, local(e));
    cam.dragged = false;
    moved = 0;
    if (pts.size === 2) { pinch = dist(); mid = null; }
  });
  el.addEventListener("pointermove", (e) => {
    const o = pts.get(e.pointerId);
    if (!o) return;
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 2) {
      const d = dist(), m = [...pts.values()], mx = (m[0].x + m[1].x) / 2, my = (m[0].y + m[1].y) / 2;
      if (pinch > 0) cam.zoomBy(d / pinch, mx, my);
      if (mid) cam.panBy(mx - mid.x, my - mid.y); // two-finger pan
      mid = { x: mx, y: my };
      pinch = d;
      cam.dragged = true;
    } else if (pts.size === 1 && !(e.pointerType === "touch" && twoFinger())) {
      moved += Math.abs(p.x - o.x) + Math.abs(p.y - o.y);
      if (moved > 4) { cam.dragged = true; cam.panBy(p.x - o.x, p.y - o.y); }
    }
  });
  const up = (e: PointerEvent) => {
    pts.delete(e.pointerId); pinch = 0; mid = null;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("dblclick", () => { if (Date.now() - cam.actorDbl > 400) cam.reset(); }); // a double-click on an actor focuses it instead
  addEventListener("keydown", (e) => {
    if (e.defaultPrevented || ignoreKey(e)) return; // the roster handles arrows itself (it runs first)
    const f = KEYS[e.key];
    if (f) { f(cam); e.preventDefault(); }
  });
}
