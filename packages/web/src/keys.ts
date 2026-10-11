// Global shortcuts (#125) and the in-app Help dialog (#160). P and Escape stay in panel.ts and dialog.ts.
import { office } from "./api.ts";
import { ignoreKey } from "./camera.ts";
import { $, announce, btn, el } from "./dom.ts";
import { modal } from "./dialog.ts";
import { group } from "./toolbar.ts";
import { cycleFollow, jumpLatest } from "./actions.ts";
import { openPalette, register } from "./palette.ts";
import { STATUS, STATUS_ORDER } from "./theme.ts";
import { statusWord } from "./triage.ts";

// X7: the key map grouped by the loop it serves; the long tail lives in the command palette
const KEYMAP: [string, [string, string][]][] = [
  ["Triage", [
    ["n / N", "Next / previous agent or session that needs you"],
    ["f", "Zoom to and follow the selected agent"],
    ["Esc", "Close the top dialog or view; then clear the selection; then the session scope"],
  ]],
  ["Navigate", [
    ["[ / ]", "Previous / next agent"],
    ["u", "Jump to the agent that changed most recently"],
    ["g", "Jump to next pod row (wing)"],
    ["j / k", "Next / previous Activity item (Enter selects its agent)"],
    ["/", "Focus the session filter (opens the panel)"],
    ["+ / - / 0 / arrows", "Zoom, reset, pan (in History: the timeline)"],
    ["Shift+F", "Follow the busiest agent on / off"],
  ]],
  ["Views", [
    ["1 / 2 / 3", "Office / Sessions / History"],
    ["P", "Present (big captions, panel hidden)"],
    [".", "Freeze / resume the live view (the chip counts what is waiting)"],
    ["Ctrl/Cmd+K or :", "Command palette: every action, agent and session"],
    ["?", "This help"],
  ]],
];
const STREAM: [string, string][] = [
  ["?overlay or ?preset=obs-1080 / obs-720", "Transparent page for an OBS Browser Source: panel and toolbar hidden, sound and toasts off, text hidden"],
  ["?kiosk", "Wallboard: fullscreen, rotates office / sessions, holds the office while something needs you; Esc leaves"],
  ["?streamsafe=0|1", "Override Stream-safe (Settings > Privacy)"],
];
/** The one legend (A1/A2): every status is a colour, a glyph and a word. */
const legend = (): [string, string][] => [
  ...STATUS_ORDER.map((k): [string, string] => [statusWord(k), {
    permission: "Claude is asking to run something: approve or deny it in that terminal.",
    turn: "Claude finished its turn and waits for your reply.",
    blocked: "A helper gave up and reported back; its lead often handles it.",
    working: "Busy: shown quietly on purpose.",
    idle: "Nothing running.",
  }[k]]),
  ["… no activity", "A session mid-turn with no events for a while (NEEDS YOU, Stuck after)."],
  ["? on a bubble", "Attribution is a guess: several or no matching delegations."],
  ["thin line", "Lead to active helper; highlighted for the selected agent's chain."],
  ["spark", "Two agents edited the same file: a possible conflict."],
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
  dlg.setAttribute("aria-labelledby", "help-h");
  document.body.append(dlg);
  const open = btn("?", "Help: what the office shows, the legend, keys, daemon address (?)", () => m.toggle());
  open.setAttribute("aria-haspopup", "dialog");
  open.setAttribute("aria-label", "Help");
  group(tools, "Setup").append(open);
  const kv = (k: string, v: string, key = false, col = "") => { const r = el("div", "kv"); const a = el(key ? "kbd" : "span", key ? "" : "k", k); if (col) a.style.color = col; r.append(a, el("span", "", v)); return r; };
  const m = modal(dlg, open, () => {
    const e = office.source.liveEnvelope() ?? office.getEnvelope();
    const facts: [string, string][] = [
      ["Daemon", location.host],
      ["Version", e?.version ?? "unknown"],
      ["Config", "office.json in ~/.agent-office (or $AGENT_OFFICE_HOME); check: node scripts/office.mjs doctor"],
      ["Motion", "Settings: Reduce motion and Pause ambient motion. Effects are never tied to what you do or when you look."],
      ["Docs", DOCS.join(", ") + " (in the repository)"],
    ];
    const head = el("div", "dhead"), h = el("h2", "", "Help");
    h.id = "help-h";
    const x = btn("×", "Close help (Esc)", () => m.close(), "b sm");
    x.setAttribute("aria-label", "Close help");
    head.append(h, x);
    const sec = (t: string) => el("h3", "", t);
    dlg.replaceChildren(head,
      el("p", "", "Each Claude Code session is a lead at the door; the helpers it delegates to sit at desks. NEEDS YOU lists what waits on you, the card says why and what to do, Recently done lists what came back."),
      btn("Command palette (Ctrl+K)", "Every action, agent and session by name", () => { m.close(); openPalette(); }),
      sec("Legend"), ...legend().map(([k, v], i) => kv(k, v, false, i < STATUS_ORDER.length ? STATUS[STATUS_ORDER[i]].color : "")),
      ...KEYMAP.flatMap(([g, rows]) => [sec(`Keys: ${g}`), ...rows.map(([k, v]) => kv(k, v, true))]),
      sec("Streaming and wall displays"), ...STREAM.map(([k, v]) => kv(k, v, true)),
      sec("About"), ...facts.map(([k, v]) => kv(k, v)));
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
