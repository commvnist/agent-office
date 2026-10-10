// Manual zoom/pan + focus-follow on top of the fit-to-window scale (#72). The math is pure; bindPointer is the only DOM part.
// zoom 1 / pan 0 is exactly the old centred fit.

export type View = { sc: number; ox: number; oy: number };
const KEY = "agent-office.camera";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class Camera {
  zoom = 1;
  panX = 0; // screen px offset from the centred position
  panY = 0;
  follow: string | null = null;
  /** true once the current pointer gesture moved: taps on actors should be ignored. */
  dragged = false;
  private last = { sc: 1, ox: 0, oy: 0, cx: 0, cy: 0, lw: 1, lh: 1 };

  constructor() { this.load(); }

  /** Final transform for this frame. `target` is the followed actor's art-space position (eased towards when set). */
  view(fit: number, W: number, H: number, top: number, lw: number, lh: number, target?: { x: number; y: number } | null, dt = 0): View {
    const sc = fit * this.zoom, cx = W / 2, cy = top + H / 2;
    if (this.follow && target) {
      const k = dt > 0 ? Math.min(1, dt * 6) : 1;
      this.panX += (-(target.x - lw / 2) * sc - this.panX) * k;
      this.panY += (-(target.y - lh / 2) * sc - this.panY) * k;
    }
    this.panX = clamp(this.panX, -lw * sc, lw * sc);
    this.panY = clamp(this.panY, -lh * sc, lh * sc);
    const ox = Math.round(cx - (lw / 2) * sc + this.panX), oy = Math.round(cy - (lh / 2) * sc + this.panY);
    this.last = { sc, ox, oy, cx, cy, lw, lh };
    return { sc, ox, oy };
  }

  /** Multiply the zoom, keeping the screen point (sx, sy) (default: viewport centre) fixed. */
  zoomBy(f: number, sx?: number, sy?: number) {
    const L = this.last, z = clamp(this.zoom * f, 0.5, 8), k = z / this.zoom;
    if (k === 1) return;
    const px = sx ?? L.cx, py = sy ?? L.cy;
    this.panX = px - (px - L.ox) * k - L.cx + (L.lw / 2) * L.sc * k;
    this.panY = py - (py - L.oy) * k - L.cy + (L.lh / 2) * L.sc * k;
    this.zoom = z;
    this.save();
  }
  panBy(dx: number, dy: number) {
    this.follow = null;
    this.panX += dx;
    this.panY += dy;
    this.save();
  }
  reset() {
    this.zoom = 1; this.panX = this.panY = 0; this.follow = null;
    this.save();
  }
  setFollow(id: string | null) { this.follow = id; }
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

/** Wheel/pinch zoom, drag pan, double-click or "0" to reset. */
export function bindPointer(el: HTMLElement, cam: Camera = camera) {
  el.style.touchAction = "none";
  const pts = new Map<number, { x: number; y: number }>();
  let pinch = 0, moved = 0;
  const local = (e: { clientX: number; clientY: number }) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = local(e);
    cam.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
  }, { passive: false });
  el.addEventListener("pointerdown", (e) => {
    pts.set(e.pointerId, local(e));
    cam.dragged = false;
    moved = 0;
    if (pts.size === 2) pinch = dist();
  });
  el.addEventListener("pointermove", (e) => {
    const o = pts.get(e.pointerId);
    if (!o) return;
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 2) {
      const d = dist(), m = [...pts.values()];
      if (pinch > 0) cam.zoomBy(d / pinch, (m[0].x + m[1].x) / 2, (m[0].y + m[1].y) / 2);
      pinch = d;
      cam.dragged = true;
    } else if (pts.size === 1) {
      moved += Math.abs(p.x - o.x) + Math.abs(p.y - o.y);
      if (moved > 4) { cam.dragged = true; cam.panBy(p.x - o.x, p.y - o.y); }
    }
  });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); pinch = 0; };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("dblclick", () => cam.reset());
  addEventListener("keydown", (e) => {
    if (e.key === "0" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) cam.reset();
  });
}
