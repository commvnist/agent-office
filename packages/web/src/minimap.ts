// Minimap (bottom-right of the stage, left of the side panel; collapsible): pods coloured by project, the viewport rectangle, click/drag to move the camera, `g` to hop wings.
// Hidden while the whole office is on screen. DOM-only (no pixi), redrawn on change and at most 4 Hz.
import { deskPos, PODS_PER_ROW, type Layout } from "@agent-office/core";
import { camera, ignoreKey } from "./camera.ts";
import { hsl } from "./color.ts";
import { announce, store } from "./dom.ts";
import { projectHue, viewRect } from "./logic.ts";

const T = 16, MAX_W = 120, MAX_H = 80, MIN_MS = 250, MIN_STAGE_W = 600;

export function bindMinimap(host: HTMLElement) {
  const wrap = document.createElement("div");
  wrap.id = "mm";
  wrap.hidden = true;
  const c = document.createElement("canvas");
  c.id = "minimap";
  c.setAttribute("role", "img");
  const tog = document.createElement("button");
  tog.type = "button";
  let shut = store.get("minimap") === "0";
  const fold = () => {
    c.hidden = shut;
    tog.textContent = shut ? "Map" : "\u00d7";
    tog.title = shut ? "Show the minimap" : "Hide the minimap";
    tog.setAttribute("aria-label", tog.title);
    tog.setAttribute("aria-expanded", String(!shut));
  };
  tog.addEventListener("click", () => { shut = !shut; store.set("minimap", shut ? "0" : "1"); fold(); });
  fold();
  wrap.append(c, tog);
  host.append(wrap);
  const g = c.getContext("2d")!;
  let layout: Layout | null = null, owners: string[] = [], dirty = true, drawnAt = 0, last = "", wing = -1;

  const moveTo = (e: PointerEvent) => {
    if (!layout) return;
    const r = c.getBoundingClientRect();
    camera.centerOn(((e.clientX - r.left) / r.width) * layout.cols * T, ((e.clientY - r.top) / r.height) * layout.rows * T);
  };
  c.addEventListener("pointerdown", (e) => { c.setPointerCapture(e.pointerId); moveTo(e); });
  c.addEventListener("pointermove", (e) => { if (e.buttons) moveTo(e); });

  addEventListener("keydown", (e) => {
    if ((e.key !== "g" && e.key !== "G") || e.defaultPrevented || ignoreKey(e) || !layout) return;
    const n = layout.zones.length;
    wing = (wing + 1) % n;
    const z = layout.zones[wing], mine = new Set(owners.slice(wing * PODS_PER_ROW, (wing + 1) * PODS_PER_ROW).filter(Boolean));
    camera.centerOn((z.x + z.w / 2) * T, (z.y + 2) * T);
    announce(`Wing ${wing + 1} of ${n}: ${mine.size ? [...mine].join(", ") : "empty"}`);
    e.preventDefault();
  });

  return {
    /** New floor plan or pod owners (cheap; the redraw itself is throttled). */
    set(l: Layout, o: string[]) {
      const k = o.join("\u0001");
      if (l === layout && k === owners.join("\u0001")) return;
      if (l !== layout) { const k = Math.min(MAX_W / l.cols, MAX_H / l.rows); c.width = Math.round(l.cols * k); c.height = Math.round(l.rows * k); c.style.width = `${c.width}px`; c.style.height = `${c.height}px`; }
      layout = l;
      owners = o;
      wing = Math.min(wing, l.zones.length - 1);
      dirty = true;
      const by = l.zones.map((_, w) => [...new Set(o.slice(w * PODS_PER_ROW, (w + 1) * PODS_PER_ROW).filter(Boolean))].join(", ") || "empty");
      c.setAttribute("aria-label", `Office map: ${by.map((s, w) => `wing ${w + 1}: ${s}`).join("; ")}`);
    },
    /** Per frame: cheap early-outs, then at most one redraw per MIN_MS. `view` is the world transform; `top`/`H`/`W` the stage viewport. */
    draw(view: { sc: number; ox: number; oy: number }, W: number, top: number, H: number, now: number, suppress: boolean) {
      if (!layout) return;
      const lw = layout.cols * T, lh = layout.rows * T;
      const fits = view.ox >= -1 && view.oy >= top - 1 && view.ox + lw * view.sc <= W + 1 && view.oy + lh * view.sc <= top + H + 1;
      const hide = suppress || fits || W < MIN_STAGE_W;
      if (wrap.hidden !== hide) wrap.hidden = hide;
      if (hide || shut) return;
      const r = viewRect(view, W, top, H), key = `${view.sc}|${Math.round(r.x)}|${Math.round(r.y)}`;
      if (!dirty && key === last) return;
      if (now - drawnAt < MIN_MS) return;
      dirty = false; last = key; drawnAt = now;
      const s = c.width / lw;
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = "rgba(20,18,31,.85)";
      g.fillRect(0, 0, c.width, c.height);
      for (let p = 0; p * 4 < layout.props.length; p++) {
        const t = deskPos(p * 4), o = owners[p];
        g.fillStyle = o ? hsl(projectHue(o), 0.5, 0.55) : "#3a3850";
        g.fillRect(Math.round(t.x * T * s), Math.round(t.y * T * s), Math.max(2, Math.round(3 * T * s)), Math.max(2, Math.round(4 * T * s)));
      }
      g.strokeStyle = "#fff";
      g.lineWidth = 1;
      g.strokeRect(Math.round(r.x * s) + 0.5, Math.round(r.y * s) + 0.5, Math.round(r.w * s), Math.round(r.h * s));
    },
  };
}
