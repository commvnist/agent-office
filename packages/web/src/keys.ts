// Global shortcuts (#125) and the in-app Help dialog (#160). P and Escape stay in panel.ts and dialog.ts.
import { office } from "./api.ts";
import { ignoreKey } from "./camera.ts";
import { $, announce, btn, el } from "./dom.ts";
import { modal } from "./dialog.ts";
import { group } from "./toolbar.ts";
import { cycleFollow, jumpLatest } from "./actions.ts";
import { register } from "./palette.ts";

const SHORTCUTS: [string, string][] = [
  ["n / N", "Next / previous session or agent that needs you"],
  ["[ / ]", "Previous / next agent"],
  ["g", "Jump to next pod row (wing)"],
  ["/", "Focus the session filter (opens the panel)"],
  ["?", "This help"],
  ["P", "Presenter mode"],
  ["+ / -", "Zoom in / out (= and _ work too)"],
  ["Arrows", "Pan the camera"],
  ["f", "Zoom to and follow the selected agent"],
  ["Shift+F", "Follow the busiest agent on / off"],
  ["u", "Jump to the agent that changed most recently"],
  ["Esc", "Close the top dialog, view or presenter; then clear the selection"],
  ["0, drag, wheel", "Camera reset, pan, zoom"],
  [".", "Freeze / resume the view (new activity waits; the chip shows how many)"],
  ["Ctrl/Cmd+K or :", "Command palette: jump to an agent or session, switch view, open Settings"],
  ["j / k", "Next / previous ACTIVITY item (Enter selects its agent)"],
  ["+ / - / 0 / arrows", "In the Timeline: zoom, reset, pan; drag selects a range, double-click zooms to it"],
];
const STREAM: [string, string][] = [
  ["?overlay or ?preset=obs-1080 / obs-720", "Transparent page for an OBS Browser Source: panel and toolbar hidden, stage fixed at 1920x1080 or 1280x720, sound and text toasts off, Private on"],
  ["?kiosk", "Wallboard: fullscreen, rotates office / wall / timeline every 20 s, pauses 60 s after you interact, keeps the screen awake; Esc leaves"],
  ["?streamsafe=0|1", "Override Stream-safe (Settings): hide prompt, path and tool text in overlay, presenter, wall and kiosk"],
  ["Copy link", "Copies a URL with the selection, scope, view and filters in the #fragment; nothing is sent anywhere"],
];
const DOCS = ["README.md", "docs/ARCHITECTURE.md", "docs/event-api.md", "docs/data-model.md"];

function cycle(ids: string[], dir: 1 | -1, none: string) {
  if (!ids.length) { announce(none); return; }
  const i = ids.indexOf(office.selected ?? "");
  const id = ids[i < 0 ? (dir > 0 ? 0 : ids.length - 1) : (i + dir + ids.length) % ids.length];
  office.select(id);
  office.focus(id);
}

export function bindKeys(tools: HTMLElement) {
  const dlg = el("div", "dlg");
  dlg.id = "help";
  dlg.hidden = true;
  dlg.setAttribute("role", "dialog");
  dlg.setAttribute("aria-label", "Help");
  document.body.append(dlg);
  const open = btn("Help", "Shortcuts, daemon address, config location (?)", () => m.toggle());
  open.setAttribute("aria-haspopup", "dialog");
  group(tools, "Setup").append(open);
  const m = modal(dlg, open, () => {
    const e = office.source.liveEnvelope() ?? office.getEnvelope();
    const facts: [string, string][] = [
      ["Daemon", location.host],
      ["Version", e?.version ?? "unknown"],
      ["Config", "office.json in ~/.agent-office (or $AGENT_OFFICE_HOME); check: node scripts/office.mjs doctor"],
      ["Motion", "Settings: Reduce motion and Pause ambient motion. Effects are never tied to what you do or when you look."],
      ["Docs", DOCS.join(", ") + " (in the repository)"],
    ];
    dlg.replaceChildren(el("b", "", "Help"),
      ...facts.map(([k, v]) => { const r = el("div", "srow"); r.append(el("span", "k", k), el("span", "", v)); return r; }),
      el("b", "", "Streaming and sharing"),
      ...STREAM.map(([k, v]) => { const r = el("div", "srow"); r.append(el("kbd", "", k), el("span", "", v)); return r; }),
      el("b", "", "Shortcuts"),
      ...SHORTCUTS.map(([k, v]) => { const r = el("div", "srow"); r.append(el("kbd", "", k), el("span", "", v)); return r; }),
      btn("Close", "Close help", () => m.close()));
  });
  register("Open Help", () => m.open());
  register("Jump to the latest agent (u)", jumpLatest);
  // Shift+F is ours: camera.ts also maps "F" to focus, so take it first (capture) and mark it handled
  addEventListener("keydown", (e) => {
    if (e.key !== "F" || !e.shiftKey || ignoreKey(e)) return;
    e.preventDefault(); e.stopPropagation();
    cycleFollow();
  }, true);
  addEventListener("keydown", (e) => {
    if (ignoreKey(e)) return;
    const acts = office.actors();
    if (e.key === "n" || e.key === "N") cycle(acts.filter((a) => a.status === "waiting" || a.status === "blocked").map((a) => a.id), e.key === "n" ? 1 : -1, "Nothing needs you right now");
    else if (e.key === "[" || e.key === "]") cycle(acts.map((a) => a.id), e.key === "]" ? 1 : -1, "No agents on the floor");
    else if (e.key === "/") {
      e.preventDefault();
      if (document.body.classList.contains("presenter")) { announce("Presenter mode hides the panel: press P to leave it"); return; }
      if (document.body.classList.contains("collapsed")) $("tg").click();
      $("fd-session").focus();
    } else if (e.key === "j" || e.key === "k") {
      if (document.body.classList.contains("presenter")) return;
      if (document.body.classList.contains("collapsed")) $("tg").click();
      const rows = Array.from(document.querySelectorAll<HTMLElement>("#feed .it .row")), i = rows.indexOf(document.activeElement as HTMLElement);
      const to = i < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, i + (e.key === "j" ? 1 : -1)));
      rows[to]?.focus();
    } else if (e.key === "?") m.toggle();
    else if (e.key === "u") jumpLatest();
    else if (e.key === "f" && !office.selected) announce("Select an agent first, then press f");
  });
}
