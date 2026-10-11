// Colonist bar: a slim strip of tiny agent portraits with status rings above the stage. Hidden at <= 6 agents; overflow shows "+N".
// The portrait is a 12x12 canvas head painted from the same Look the scene uses, cached per look (no pixi texture needed).
import { office, type ActorInfo } from "./api.ts";
import { $, el, sync } from "./dom.ts";
import { RANK } from "./logic.ts";
import { lookKey } from "./lru.ts";
import { grade, lookFor, type Look } from "./sprites.ts";
import { look as stLook, statusKey, statusWord } from "./triage.ts";

const MIN_AGENTS = 7, SLOT = 28;
const heads = new Map<string, ImageData>();
const DARK = "#1e1a28";

function head(look0: Look): ImageData {
  const k = lookKey(look0);
  let d = heads.get(k);
  if (d) return d;
  const look = grade(look0); // the same graded colours as the figure on the canvas
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
  if (look.style === 6) px(9, 4, 1, 5, look.hair); // ponytail out past the head
  if (look.style === 7) px(2, 1, 8, 2, look.hair), px(2, 3, 1, 3, look.hair), px(9, 3, 1, 3, look.hair); // puffy crown
  if (look.acc === "cap") px(2, 3, 8, 1, look.accColor);
  px(4, 5, 1, 1, DARK); px(7, 5, 1, 1, DARK);
  if (look.acc === "glasses") px(3, 5, 6, 1, look.accColor), px(4, 5, 1, 1, DARK), px(7, 5, 1, 1, DARK);
  heads.set(k, (d = g.getImageData(0, 0, 12, 12)));
  return d;
}

const eff = (a: ActorInfo) => (a.lead && a.status !== "blocked" && office.getEnvelope()?.state.sessions[a.session]?.waiting ? "waiting" : a.status);

export function bindColonists() {
  const bar = $("colony"), cache = new Map<string, HTMLButtonElement>();
  // B7: "+N · 2 need you" opens the panel's agent list
  const more = el("button", "cb more");
  more.type = "button";
  more.addEventListener("click", () => {
    if (document.body.classList.contains("collapsed")) $("tg").click();
    const l = $("lists") as HTMLDetailsElement, ag = $("sec-agents") as HTMLDetailsElement;
    l.open = ag.open = true;
    ag.scrollIntoView({ block: "nearest" });
  });
  const render = () => {
    // B7: grouped by session (most urgent session first), then by state inside it
    const all = office.actors(), urg = new Map<string, number>();
    for (const a of all) urg.set(a.session, Math.min(urg.get(a.session) ?? 9, RANK[eff(a)] ?? 9));
    const acts = [...all].sort((a, b) => (urg.get(a.session)! - urg.get(b.session)!) || a.project.localeCompare(b.project) || (RANK[eff(a)] ?? 9) - (RANK[eff(b)] ?? 9) || a.label.localeCompare(b.label));
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
      const a = vis[i], s = eff(a), k = statusKey(s, st?.sessions[a.session]), lk = stLook(k);
      const cls = `cb ${s}`;
      if (b.className !== cls) b.className = cls;
      b.style.setProperty("--ring", k === "idle" ? "var(--line)" : lk.color);
      if (b.dataset.g !== lk.glyph) b.dataset.g = lk.glyph; // the glyph badge: never colour alone (A2)
      const label = `${a.label} (${a.project}), ${a.lead ? "session lead" : a.role}, ${statusWord(k)}${a.task && !priv ? `: ${a.task.slice(0, 60)}` : ""}`;
      if (b.title !== label) { b.title = label; b.setAttribute("aria-label", label); }
      b.setAttribute("aria-pressed", String(office.selected === a.id));
      const lk2 = `${lookKey(lookFor(a.role, a.id, a.lead))}`;
      if (b.dataset.k !== lk2) { b.dataset.k = lk2; (b.firstChild as HTMLCanvasElement).getContext("2d")!.putImageData(head(lookFor(a.role, a.id, a.lead)), 0, 0); }
    });
    const hiddenNeed = acts.slice(vis.length).filter((a) => ["waiting", "blocked"].includes(eff(a))).length;
    more.textContent = extra ? `+${extra}${hiddenNeed ? ` · ${hiddenNeed} need you` : ""}` : "";
    more.hidden = !extra;
    more.title = `${extra} more agents: open the Agents list`;
    bar.append(more);
  };
  office.subscribe(render);
  office.onSelect(render);
  addEventListener("resize", render);
  setInterval(render, 1000);
}
