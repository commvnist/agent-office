// Command palette (Ctrl/Cmd+K or ":"): fuzzy list of agents, sessions, views and dialogs.
// Results are set with textContent; Esc and focus return come from dialog.ts's modal().
import { office } from "./api.ts";
import { ignoreKey } from "./camera.ts";
import { announce, btn, el } from "./dom.ts";
import { modal } from "./dialog.ts";
import { rank } from "./funlogic.ts";
import { statusKey, statusWord } from "./triage.ts";
import { hostOnly } from "./sharelogic.ts";

export type Cmd = { label: string; run: () => void };
// Modules register their own handlers here, so no command depends on a toolbar button's label.
const registry: Cmd[] = [];
export const register = (label: string, run: () => void) => { registry.push({ label, run: () => { run(); announce(label); } }); };
let opener = () => {};
/** Help's "Command palette" button. */
export const openPalette = () => opener();

export function bindPalette() {
  const dlg = el("div", "dlg pal"), input = el("input"), list = el("ul"), count = el("div", "sr");
  dlg.id = "palette";
  dlg.hidden = true;
  dlg.setAttribute("role", "dialog");
  dlg.setAttribute("aria-label", "Command palette");
  input.type = "text";
  input.placeholder = "Jump to an agent, switch view, open settings…";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", "Command");
  input.setAttribute("aria-controls", "pal-list");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-autocomplete", "list");
  list.id = "pal-list";
  list.setAttribute("role", "listbox");
  count.setAttribute("role", "status");
  dlg.append(input, list, count);
  document.body.append(dlg);
  // not in the toolbar (V8: menus plus the palette): Ctrl+K, ":" and Help open it; focus returns to where it was
  const open = btn("Commands", "Command palette (Ctrl+K or :)", () => m.toggle());

  const all = (): Cmd[] => {
    const priv = office.privacy || office.source.private;
    const agents = office.actors().map((a) => ({
      label: `Agent: ${a.label} · ${a.lead ? "lead" : a.role} · ${statusWord(statusKey(a.status, office.getEnvelope()?.state.sessions[a.session]))}${a.task && !priv ? ` · ${a.task.slice(0, 40)}` : ""}`,
      run: () => { office.select(a.id); office.focus(a.id); },
    }));
    const sessions = office.sessions().map((s) => ({ label: `Session: ${s.project}`, run: () => { office.select(s.lead); office.focus(s.lead); } }));
    return [
      ...(office.source.liveEnvelope()?.remote ? registry.filter((c) => !hostOnly(c.label)) : registry), // a paired phone: view-only
      ...sessions, ...agents,
    ];
  };
  let shown: Cmd[] = [], sel = 0;
  const paint = () => {
    list.replaceChildren(...shown.map((c, i) => {
      const li = el("li", "pi", c.label);
      li.id = `pal-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === sel));
      li.addEventListener("click", () => run(i));
      return li;
    }));
    input.setAttribute("aria-activedescendant", shown.length ? `pal-${sel}` : "");
    list.children[sel]?.scrollIntoView({ block: "nearest" });
  };
  const render = () => {
    shown = rank(input.value, all(), (c) => c.label, 9);
    sel = 0;
    count.textContent = `${shown.length} results`;
    paint();
    if (!shown.length) list.append(el("li", "k pad", "No match"));
  };
  const run = (i: number) => {
    const c = shown[i];
    if (!c) return;
    m.close();
    c.run();
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length) { sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length; paint(); }
    } else if (e.key === "Enter") { e.preventDefault(); run(sel); }
  });
  const m = modal(dlg, open, () => { input.value = ""; render(); });
  opener = () => m.open();
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); m.toggle(); }
    else if (e.key === ":" && !ignoreKey(e)) { e.preventDefault(); if (dlg.hidden) m.open(); }
  });
}
