// The compact header toolbar (B1, V8): an Office | Sessions | History switch, two menus (Display, Export) and the
// Settings / Help buttons. Modules append their own buttons by group name; menu items close the menu when clicked.
// On a phone the whole toolbar moves into the sheet's "More" section (ui.ts), where the menus render open.
import { el } from "./dom.ts";
import { modal } from "./dialog.ts";

const NAMES = ["Views", "Display", "Export", "Setup"] as const;
const MENUS = new Set(["Display", "Export"]);
const made = new Map<string, HTMLElement>();
export function group(tools: HTMLElement, name: (typeof NAMES)[number]): HTMLElement {
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
      // any item click closes the menu; the item's own handler has already run (it was registered first)
      pop.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("button") && !pop.closest("#more")) m.close(); });
      g.append(trig, pop);
      made.set(n, pop);
    } else made.set(n, g);
    tools.append(g);
  }
  return made.get(name)!;
}
