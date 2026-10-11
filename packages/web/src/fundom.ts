// DOM fun layer, quiet by default: toasts, commentary ticker (a slim strip that fades in only for something new), highlight
// cards, sparklines. Listens for `ao:fun` on document. All event text is set with textContent only.
import type { FunEvent } from "@agent-office/core";
import { office } from "./api.ts";
import { $, announce, el } from "./dom.ts";
import { settings } from "./settings.ts";
import { fmtAge, usageTotal } from "./logic.ts";
import { deltaBuckets, OUTCOME_GLYPH, parseHighlight, ringMath, sparkBuckets, sparkPoints, toastGate, toastKind, toastModel } from "./funlogic.ts";

const TOAST_MS = 5000, HL_MS = 6000, TICK_MS = 6000;
const pick = (id?: string) => {
  if (!id || !office.actors().some((a) => a.id === id)) { announce("That agent has left the floor"); return; }
  office.select(id); office.focus(id); office.pulse(id);
};
/**
 * Show `node` in `host`, keeping at most `max` (oldest drops); returns the dismiss fn.
 * `ms` 0 = until dismissed (errors). The timer pauses while the pointer or focus is inside and restarts on leave.
 */
function transient(host: HTMLElement, list: HTMLElement[], node: HTMLElement, ms: number, max: number) {
  if (settings.reducedMotion) node.classList.add("still");
  host.append(node);
  list.push(node);
  while (list.length > max) list.shift()!.remove();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gone = () => { clearTimeout(timer); node.remove(); const i = list.indexOf(node); if (i >= 0) list.splice(i, 1); };
  const arm = () => { clearTimeout(timer); if (ms) timer = setTimeout(gone, ms); };
  const hold = () => clearTimeout(timer);
  node.addEventListener("pointerenter", hold);
  node.addEventListener("focusin", hold);
  node.addEventListener("pointerleave", arm);
  node.addEventListener("focusout", arm);
  arm();
  return gone;
}

// ---- toasts (bottom-left, max 3, rate limited): rare delights ----
const toasts: HTMLElement[] = [], gate = toastGate();
function toast(e: FunEvent) {
  if (!toastKind(e.kind) || !gate(Date.now(), e.rare)) return;
  const m = toastModel(e), box = el("div", `toast ${e.kind}`), main = el("button", "tmain");
  main.type = "button";
  main.title = "Dismiss";
  const ic = el("span", "ti", m.icon);
  ic.setAttribute("aria-hidden", "true");
  const tx = el("span", "tt");
  tx.append(el("b", "", m.title), el("span", "", m.line));
  main.append(ic, tx);
  box.append(main);
  const gone = transient($("toasts"), toasts, box, TOAST_MS, 3);
  main.addEventListener("click", gone);
}

// ---- commentary ticker: shown for TICK_MS when there is something new, then hidden ----
let tickHover = false, tickPending = "", tickTimer: ReturnType<typeof setTimeout> | undefined;
function say(text: string) {
  const tk = $("ticker");
  if (tickHover) { tickPending = text; return; }
  tk.firstElementChild!.textContent = text;
  tk.classList.add("show");
  document.body.classList.add("tick");
  clearTimeout(tickTimer);
  tickTimer = setTimeout(() => { tk.classList.remove("show"); document.body.classList.remove("tick"); }, TICK_MS);
}

// ---- highlight cards (top-right) ----
const cards: HTMLElement[] = [];
function highlight(e: FunEvent) {
  const h = parseHighlight(e.text), b = el("button", `hl ${h.outcome}`);
  b.type = "button";
  b.title = "Select this agent";
  const g = el("span", "hg", OUTCOME_GLYPH[h.outcome]);
  g.setAttribute("aria-hidden", "true");
  const tx = el("span", "tt");
  tx.append(el("b", "", h.who || "Highlight"), el("span", "", h.what));
  b.append(g, tx);
  if (h.dur) b.append(el("span", "k", h.dur));
  if (h.outcome === "blocked") b.setAttribute("role", "alert"); // announced at once, and kept until dismissed
  const gone = transient($("hl"), cards, b, h.outcome === "blocked" ? 0 : HL_MS, 2);
  b.addEventListener("click", () => { pick(e.actorId); gone(); });
}

// ---- activity rings for a session card: working / done (idle) / blocked share of its agents ----
const RING_COLORS = ["var(--good)", "var(--mute)", "var(--bad)"];
export function ringsEl(c: { working: number; done: number; blocked: number; total: number }): SVGElement {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 28 28"); svg.setAttribute("width", "28"); svg.setAttribute("height", "28");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${c.total} agent${c.total === 1 ? "" : "s"}: ${c.working} working, ${c.done} done, ${c.blocked} blocked or waiting`);
  svg.classList.add("rings");
  ringMath([c.working, c.done, c.blocked], c.total, 12, 4).forEach((r, i) => {
    for (const arc of [false, true]) {
      const o = document.createElementNS(SVGNS, "circle");
      o.setAttribute("cx", "14"); o.setAttribute("cy", "14"); o.setAttribute("r", String(r.r)); o.setAttribute("fill", "none");
      o.setAttribute("stroke-width", "3");
      if (arc) {
        o.setAttribute("stroke", RING_COLORS[i]);
        o.setAttribute("stroke-dasharray", `${r.dash.toFixed(1)} ${r.circ.toFixed(1)}`);
        o.setAttribute("transform", "rotate(-90 14 14)");
      } else { o.setAttribute("stroke", "var(--line)"); }
      svg.append(o);
    }
  });
  return svg;
}

// ---- sparklines (events/min and tokens/min, last 30 min; memory only) ----
const evTimes: number[] = [], tokSamples: { t: number; total: number }[] = [];
const MIN30 = 30 * 60_000;
const SVGNS = "http://www.w3.org/2000/svg";
function spark(label: string) {
  const row = el("div", "sp");
  const svg = document.createElementNS(SVGNS, "svg"), line = document.createElementNS(SVGNS, "polyline");
  svg.setAttribute("viewBox", "0 0 90 18"); svg.setAttribute("width", "90"); svg.setAttribute("height", "18"); svg.setAttribute("aria-hidden", "true");
  line.setAttribute("fill", "none"); line.setAttribute("stroke", "currentColor"); line.setAttribute("stroke-width", "1.5");
  svg.append(line);
  const val = el("span", "k");
  row.append(el("span", "k", label), svg, val);
  return { row, set: (v: number[], text: string) => { line.setAttribute("points", sparkPoints(v, 90, 18)); val.textContent = text; row.setAttribute("aria-label", `${label}: ${text}`); } };
}
const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(Math.round(n)));
let sp: { e: ReturnType<typeof spark>; t: ReturnType<typeof spark> } | null = null;
function sparks() {
  const host = $("spark"), now = Date.now();
  if (!sp) { sp = { e: spark("events/min"), t: spark("tokens/min") }; host.append(sp.e.row, sp.t.row); }
  const ev = sparkBuckets(evTimes, now), tk = deltaBuckets(tokSamples, now);
  // J2: an empty meter reads as broken, so say what the quiet means instead
  const lastEv = evTimes.at(-1), ago = lastEv ? fmtAge(now - lastEv) : "";
  sp.e.set(ev, !lastEv ? "idle: no events yet" : ev.slice(-1)[0] ? `${ev.slice(-1)[0]}/min` : `idle, last event ${ago === "just now" ? ago : `${ago} ago`}`);
  const hasUsage = office.sessions().some((x) => x.usage);
  sp.t.set(tk, !hasUsage ? "no token data yet" : `~${kfmt(tk.slice(-5).reduce((a, c) => a + c, 0) / 5)}/min`);
}
function sampleSignals() {
  const now = Date.now(), total = office.sessions().reduce((n, s) => n + usageTotal(s.usage), 0);
  if (!tokSamples.length || tokSamples.at(-1)!.total !== total) tokSamples.push({ t: now, total });
  while (tokSamples.length && now - tokSamples[0].t > MIN30) tokSamples.shift();
  while (evTimes.length && now - evTimes[0] > MIN30) evTimes.shift();
  if (!document.hidden) sparks();
}

export function bindFun() {
  const tk = $("ticker");
  tk.addEventListener("mouseenter", () => { tickHover = true; });
  tk.addEventListener("mouseleave", () => { tickHover = false; if (tickPending) { const p = tickPending; tickPending = ""; say(p); } });
  document.addEventListener("ao:fun", (ev) => {
    const e = (ev as CustomEvent<FunEvent>).detail;
    if (!e || typeof e.text !== "string") return;
    if (e.kind === "highlight") { highlight(e); say(e.text); }
    else if (e.kind === "commentary") say(e.text);
    else toast(e);
  });
  office.onFeed(() => { if (office.source.mode !== "replay") evTimes.push(Date.now()); if (evTimes.length > 4000) evTimes.shift(); });
  setInterval(sampleSignals, 5000);
  sampleSignals();
}
