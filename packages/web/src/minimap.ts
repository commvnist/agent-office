// Minimap (bottom-right of the stage, left of the side panel; collapsible): pods coloured by project, the viewport rectangle, click/drag to move the camera, `g` to hop wings,
// PageUp/PageDown to move between floors (each floor is a numbered strip on the map).
// Hidden while the whole office is on screen. DOM-only (no pixi), redrawn on change and at most 4 Hz.
import { deskPos, FLOOR_DESKS, floorsOf, floorTop, podRow, type Layout } from "@agent-office/core";
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
  let layout: Layout | null = null, owners: string[] = [], dirty = true, drawnAt = 0, last = "", wing = -1, viewY = 0;
  const wingOwners = (w: number) => [...new Set(owners.filter((o, p) => o && podRow(p) === w))];
  /** Tile rows [y0, y1) of floor f: the first floor also holds the wall and lobby, the last one the waiting row and lounge. */
  const band = (l: Layout, f: number) => [f === 0 ? 0 : floorTop(f) - 1, f + 1 >= floorsOf(l) ? l.rows : floorTop(f + 1) - 1];
  const floorAt = (l: Layout, y: number) => { let f = 0; while (f + 1 < floorsOf(l) && y >= band(l, f + 1)[0]) f++; return f; };

  const moveTo = (e: PointerEvent) => {
    if (!layout) return;
    const r = c.getBoundingClientRect();
    camera.centerOn(((e.clientX - r.left) / r.width) * layout.cols * T, ((e.clientY - r.top) / r.height) * layout.rows * T);
  };
  c.addEventListener("pointerdown", (e) => { c.setPointerCapture(e.pointerId); moveTo(e); });
  c.addEventListener("pointermove", (e) => { if (e.buttons) moveTo(e); });

  addEventListener("keydown", (e) => {
    if (e.defaultPrevented || ignoreKey(e) || !layout) return;
    if (e.key === "PageUp" || e.key === "PageDown") {
      const n = floorsOf(layout), f = Math.max(0, Math.min(n - 1, floorAt(layout, viewY) + (e.key === "PageUp" ? -1 : 1))), [y0, y1] = band(layout, f);
      camera.centerOn((layout.cols * T) / 2, ((y0 + y1) / 2) * T);
      const mine = [...new Set(owners.filter((o, p) => o && Math.floor((p * 4) / FLOOR_DESKS) === f))];
      announce(`Floor ${f + 1} of ${n}: ${mine.length ? mine.join(", ") : "empty"}`);
      e.preventDefault();
      return;
    }
    if (e.key !== "g" && e.key !== "G") return;
    const n = layout.zones.length;
    wing = (wing + 1) % n;
    const z = layout.zones[wing], mine = wingOwners(wing);
    camera.centerOn((z.x + z.w / 2) * T, (z.y + 2) * T);
    announce(`Wing ${wing + 1} of ${n}: ${mine.length ? mine.join(", ") : "empty"}`);
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
      const by = l.zones.map((_, w) => wingOwners(w).join(", ") || "empty");
      c.setAttribute("aria-label", `Office map${floorsOf(l) > 1 ? ` (${floorsOf(l)} floors, PageUp/PageDown)` : ""}: ${by.map((s, w) => `wing ${w + 1}: ${s}`).join("; ")}`);
    },
    /** Per frame: cheap early-outs, then at most one redraw per MIN_MS. `view` is the world transform; `top`/`H`/`W` the stage viewport. */
    draw(view: { sc: number; ox: number; oy: number }, W: number, top: number, H: number, now: number, suppress: boolean) {
      if (!layout) return;
      const lw = layout.cols * T, lh = layout.rows * T;
      viewY = ((top + H / 2 - view.oy) / view.sc) / T; // tile row at the viewport centre: PageUp/PageDown step from the floor shown
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
      const nf = floorsOf(layout);
      if (nf > 1) { // floor strips: a rule between floors and the floor number at the left margin, the floor in view brighter
        const cur = floorAt(layout, viewY);
        g.font = "8px ui-monospace, monospace";
        g.textBaseline = "top";
        for (let f = 0; f < nf; f++) {
          const y = Math.round(band(layout, f)[0] * T * s);
          if (f) { g.fillStyle = "rgba(127,227,255,.45)"; g.fillRect(0, y, c.width, 1); }
          g.fillStyle = f === cur ? "#7fe3ff" : "rgba(223,228,255,.55)";
          g.fillText(String(f + 1), 1, y + 2);
        }
      }
      g.strokeStyle = "#fff";
      g.lineWidth = 1;
      g.strokeRect(Math.round(r.x * s) + 0.5, Math.round(r.y * s) + 0.5, Math.round(r.w * s), Math.round(r.h * s));
    },
  };
}
