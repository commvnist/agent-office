// The compact header toolbar (B1, V8): an Office | Sessions | History switch, two menus (Display, Export) and the
// Settings / Help buttons. Modules append their own buttons by group name; menu items close the menu when clicked.
// On a phone the whole toolbar moves into the sheet's "More" section (ui.ts), where the menus render open.
// O4: on a desktop header that does not fit, fitHeader() folds the lowest-priority items into a "More" menu.
import { el } from "./dom.ts";
import { modal } from "./dialog.ts";

const NAMES = ["Views", "Display", "Export", "More", "Setup"] as const;
const MENUS = new Set(["Display", "Export", "More"]);
const made = new Map<string, HTMLElement>(), groups = new Map<string, HTMLElement>();
export function group(tools: HTMLElement, name: Exclude<(typeof NAMES)[number], "More">): HTMLElement {
  if (!made.size) for (const n of NAMES) {
    const g = el("span", `tgrp tg-${n.toLowerCase()}`);
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", n);
    if (MENUS.has(n)) {
      const pop = el("div", "mpop");
      pop.id = `menu-${n.toLowerCase()}`;
      pop.hidden = true;
      pop.setAttribute("aria-label", n);
      const trig = el("button", "b mtg", `${n} ▾`);
      trig.type = "button";
      trig.setAttribute("aria-haspopup", "true");
      trig.setAttribute("aria-expanded", "false");
      trig.setAttribute("aria-controls", pop.id);
      const m = modal(pop, trig, () => trig.setAttribute("aria-expanded", "true"), () => trig.setAttribute("aria-expanded", "false"));
      trig.addEventListener("click", () => m.toggle());
      // any item click closes the menu; the item's own handler has already run (it was registered first).
      // More closes first (capture), so a dialog opened from inside it (Settings, Help) keeps the focus.
      pop.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("button") && !pop.closest("#more")) m.close(); }, n === "More");
      g.append(trig, pop);
      made.set(n, pop);
    } else made.set(n, g);
    groups.set(n, g);
    tools.append(g);
  }
  return made.get(name)!;
}

// ---- O4: responsive header. The pill, the view switch and Panel always show; the rest folds in this order. ----
const FOLDS = ["wm", "Display", "Export", "#privchip", "#nudge", "#sharechip", "#rec-note", "Setup"];
const marks = new Map<HTMLElement, Comment>();
let sig = "";
const foldable = (k: string) => (k.startsWith("#") ? document.getElementById(k.slice(1)) : groups.get(k)) ?? null;
/** Fold what does not fit into More; cheap to call often (a signature of width and the changing header parts gates the work). */
export function fitHeader() {
  const top = document.getElementById("top"), more = groups.get("More"), pop = made.get("More");
  if (!top || !more || !pop) return;
  const narrow = matchMedia("(max-width:800px)").matches; // phones: the toolbar lives in the sheet, the header wraps
  const s = [top.clientWidth, narrow, getComputedStyle(document.documentElement).getPropertyValue("--ts"),
    ...Array.from(top.querySelectorAll<HTMLElement>("#need,#stats,#badge,#stop-sample,#rec-note,#privchip,#sharechip,#nudge,#live")).map((e) => `${e.hidden}${e.className}${e.textContent}`)].join("|");
  if (s === sig) return;
  sig = s;
  for (const [e, c] of marks) c.after(e); // unfold everything, then fold until it fits
  top.classList.remove("f-wm", "f-stats");
  more.hidden = true;
  if (narrow) return;
  const stats = document.getElementById("stats");
  // the calm counts (#stats) shrink first; while they are cut, the menus (not the chips or Setup) still fold to make room
  const tight = (k: string) => top.scrollWidth > top.clientWidth + 1 || (FOLDS.indexOf(k) < 3 && !!stats?.textContent && stats.scrollWidth > stats.clientWidth + 1);
  for (const k of FOLDS) {
    if (!tight(k)) break;
    more.hidden = false;
    if (k === "wm") { top.classList.add("f-wm"); continue; }
    const e = foldable(k);
    if (!e) continue;
    if (!marks.has(e)) { const c = document.createComment(k); e.before(c); marks.set(e, c); }
    pop.append(e);
  }
  if (!pop.children.length) more.hidden = true; // only the wordmark went
  // still cut after folding: drop the calm counts rather than show a stray character (the pill and badges carry them)
  if (stats?.textContent && stats.scrollWidth > stats.clientWidth + 1) top.classList.add("f-stats");
}
