// Colonist bar: a slim strip of tiny agent portraits with status rings above the stage. Hidden at <= 6 agents; overflow shows "+N".
// The portrait is a 12x12 canvas head painted from the same Look the scene uses, cached per look (no pixi texture needed).
import { office, type ActorInfo } from "./api.ts";
import { $, el, sync } from "./dom.ts";
import { loopOf, RANK } from "./logic.ts";
import { lookKey } from "./lru.ts";
import { lookFor, type Look } from "./sprites.ts";

const MIN_AGENTS = 7, SLOT = 28;
const heads = new Map<string, ImageData>();
const DARK = "#1e1a28";

function head(look: Look): ImageData {
  const k = lookKey(look);
  let d = heads.get(k);
  if (d) return d;
  const c = document.createElement("canvas");
  c.width = c.height = 12;
  const g = c.getContext("2d")!;
  const px = (x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  px(2, 9, 8, 3, look.shirt);
  px(3, 3, 6, 6, look.skin);
  px(3, 2, 6, 2, look.hair);
  if (look.style === 1 || look.style === 4 || look.style === 5) px(2, 3, 1, 5, look.hair), px(9, 3, 1, 5, look.hair);
  if (look.style === 2) [3, 5, 7].forEach((x) => px(x, 1, 1, 1, look.hair));
  if (look.style === 3) px(5, 0, 2, 2, look.hair);
  if (look.acc === "cap") px(2, 3, 8, 1, look.accColor);
  px(4, 5, 1, 1, DARK); px(7, 5, 1, 1, DARK);
  if (look.acc === "glasses") px(3, 5, 6, 1, look.accColor), px(4, 5, 1, 1, DARK), px(7, 5, 1, 1, DARK);
  heads.set(k, (d = g.getImageData(0, 0, 12, 12)));
  return d;
}

const eff = (a: ActorInfo) => (a.lead && a.status !== "blocked" && office.getEnvelope()?.state.sessions[a.session]?.waiting ? "waiting" : a.status);

export function bindColonists() {
  const bar = $("colony"), cache = new Map<string, HTMLButtonElement>();
  const more = el("span", "cb more");
  const render = () => {
    const acts = [...office.actors()].sort((a, b) => (RANK[eff(a)] ?? 9) - (RANK[eff(b)] ?? 9) || a.label.localeCompare(b.label));
    const show = acts.length >= MIN_AGENTS;
    bar.hidden = !show;
    document.documentElement.style.setProperty("--cb-h", show ? `${bar.offsetHeight || 30}px` : "0px");
    if (!show) return;
    const cap = Math.max(4, Math.floor((bar.clientWidth - 16) / SLOT));
    const vis = acts.length > cap ? acts.slice(0, cap - 1) : acts, extra = acts.length - vis.length;
    const priv = office.privacy || office.source.private, st = office.getEnvelope()?.state;
    const nodes = sync(bar, cache, vis.map((a) => a.id), (id) => {
      const b = el("button", "cb"), c = el("canvas");
      b.type = "button";
      c.width = c.height = 12;
      b.append(c);
      b.addEventListener("click", () => { office.select(id); office.focus(id); office.pulse(id); });
      b.addEventListener("mouseenter", () => document.dispatchEvent(new CustomEvent("ao:hover", { detail: id })));
      b.addEventListener("mouseleave", () => document.dispatchEvent(new CustomEvent("ao:hover", { detail: null })));
      return b;
    });
    nodes.forEach((b, i) => {
      const a = vis[i], s = eff(a), loop = !!(st && loopOf(st, a.id));
      const cls = `cb ${s}${loop ? " loop" : ""}`;
      if (b.className !== cls) b.className = cls;
      const label = `${a.label}, ${a.lead ? "session lead" : a.role}, ${s}${loop ? ", looping" : ""}${a.task && !priv ? `: ${a.task.slice(0, 60)}` : ""}`;
      if (b.title !== label) { b.title = label; b.setAttribute("aria-label", label); }
      b.setAttribute("aria-pressed", String(office.selected === a.id));
      const k = `${lookKey(lookFor(a.role, a.id, a.lead))}`;
      if (b.dataset.k !== k) { b.dataset.k = k; (b.firstChild as HTMLCanvasElement).getContext("2d")!.putImageData(head(lookFor(a.role, a.id, a.lead)), 0, 0); }
    });
    more.textContent = extra ? `+${extra}` : "";
    more.hidden = !extra;
    more.title = `${extra} more agents (see the AGENTS list)`;
    bar.append(more);
  };
  office.subscribe(render);
  office.onSelect(render);
  addEventListener("resize", render);
  setInterval(render, 1000);
}
