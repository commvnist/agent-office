// Toolbar grouping (F15): captioned groups so the buttons read as View / Data / Output / Setup instead of one wrapped row.
import { el } from "./dom.ts";

const NAMES = ["View", "Data", "Output", "Setup"] as const;
const made = new Map<string, HTMLElement>();
export function group(tools: HTMLElement, name: (typeof NAMES)[number]): HTMLElement {
  if (!made.size) for (const n of NAMES) {
    const g = el("span", "tgrp");
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", n);
    g.append(el("span", "tcap", n));
    made.set(n, g);
    tools.append(g);
  }
  return made.get(name)!;
}
