// Full-area views that sit over the stage: compact wall (#198, no canvas drawing, bare `wall` token in the URL hash) and daily timeline (#194).
// shortcut: the canvas keeps running underneath (hiding it would give pixi a 0x0 resize); stop the ticker if CPU matters on a wall display.
import { office } from "./api.ts";
import { btn, el, renderIf } from "./dom.ts";
import { MIN_SPAN, fetchHistory, historyRange, pickRange, panView, rangeStats, waterfall, zoomView, type View as Span } from "./history.ts";
import { roleColor } from "./theme.ts";
import { aggLine, look, outcomeLook, permLine, sessionAgg, statusKey, statusWord } from "./triage.ts";
import { replayRange, toggleReplay } from "./modes.ts";
import { store } from "./dom.ts";
import { ignoreKey } from "./camera.ts";
import { fmtAge, fmtDur, fmtTokens } from "./logic.ts";
import { t } from "./i18n.ts";
import { group } from "./toolbar.ts";
import { buildLink, parseLink } from "./sharelogic.ts";
import { cycleFollow, following } from "./actions.ts";
import { register } from "./palette.ts";
import { hideText } from "./stream.ts";
import type { OfficeEvent } from "@agent-office/core";

type View = "" | "wall" | "timeline";
let pipGrid: HTMLElement | null = null; // the floating window's tile grid, while it is open
const HOUR = 3600e3, REFRESH_MS = 30_000;
/** Keeps the other hash tokens (sel, s, k, a written by ui.ts) and sets the view token: bare `wall`, `v=timeline`. */
function setViewToken(v: View) {
  const h = buildLink({ ...parseLink(location.hash), v });
  if (location.hash !== h) history.replaceState(null, "", h || location.pathname + location.search);
}

function renderWall(box: HTMLElement) {
  if (box === wallGrid && pipGrid) renderWall0(pipGrid);
  renderWall0(box);
  if (box === wallGrid) renderEnded(endedBox);
}
let wallGrid: HTMLElement, endedBox: HTMLElement;
/** The Sessions view's "Ended" list from state.summaries (newest first). */
function renderEnded(box: HTMLElement) {
  const list = office.getEnvelope()?.state.summaries ?? [], now = Date.now();
  const rows = list.map((x) => ({ x, ago: fmtAge(now - x.endedAt) }));
  renderIf(box, JSON.stringify(rows.map((r) => [r.x.session, r.x.endedAt, r.ago])), () => {
    if (!rows.length) return [];
    const grid = el("div", "wallgrid");
    grid.append(...rows.map(({ x, ago }) => {
      const d = el("div", "tile ended"), o = x.outcomes;
      d.style.setProperty("--st", (x.errors || o.blocked ? look("blocked") : outcomeLook("")).color);
      const outs = el("span", "k", `${t("agent", { n: x.agents })} · `);
      outs.append(...([["done", o.done], ["partial", o.partial], ["blocked", o.blocked]] as const).flatMap(([k, n], i) => {
        const g = el("span", "", `${outcomeLook(k).glyph} ${n}`);
        g.title = `${n} ${outcomeLook(k).label}`;
        return i ? [" ", g] : [g];
      }));
      const perm = x.permission.n ? `${x.permission.n} permission wait${x.permission.n === 1 ? "" : "s"} · ${fmtDur(x.permission.totalMs)} total` : "no permission waits";
      d.append(el("b", "", x.project), el("span", "", `ended ${ago === "just now" ? ago : `${ago} ago`} · ran ${fmtDur(x.durationMs)}`), outs,
        el("span", x.errors ? "er" : "k", `${x.errors} error${x.errors === 1 ? "" : "s"}`), el("span", "k", perm), el("span", "k", fmtTokens(x.usage) || "no tokens recorded"));
      return d;
    }));
    const h = el("h2", "", "ENDED ");
    h.append(el("span", "cnt", `(${rows.length})`));
    return [h, grid];
  });
}
function renderWall0(box: HTMLElement) {
  const e = office.getEnvelope(), now = Date.now();
  if (!e) return;
  const acts = office.actors();
  const tiles = office.sessions().map((s) => {
    const ss = e.state.sessions[s.id];
    const agg = sessionAgg(acts.filter((a) => a.session === s.id).map((a) => statusKey(a.lead && s.waiting && a.status !== "blocked" ? "waiting" : a.status, ss)));
    const state = s.waiting && !agg.agents ? statusKey("waiting", ss) : agg.worst;
    const errors = ss?.errors ?? 0;
    const perm = permLine(ss?.permWait, now, fmtDur);
    return { s, state, age: fmtAge(now - s.startedAt), tok: fmtTokens(s.usage), errors, perm, line: aggLine(agg) };
  });
  renderIf(box, JSON.stringify(tiles.map((x) => [x.s.id, x.s.project, x.state, x.age, x.tok, x.errors, x.s.agents, x.perm, x.line])), () =>
    tiles.length ? tiles.map((x) => {
      const b = el("button", "tile");
      b.type = "button";
      b.style.setProperty("--st", look(x.state).color);
      b.append(el("b", "", x.s.project), el("span", "", statusWord(x.state)), el("span", "k", [x.age, t("agent", { n: x.s.agents }), x.line].filter(Boolean).join(" · ")),
        el("span", "k", x.tok || "no tokens yet"), el("span", x.errors ? "er" : "k", `${x.errors} error${x.errors === 1 ? "" : "s"}`));
      if (x.perm) b.append(el("span", "k", x.perm));
      b.addEventListener("click", () => { office.select(x.s.lead); setView(""); });
      return b;
    }) : [el("div", "k pad", "No sessions yet. Start Claude Code with the plugin; they appear here.")]);
}

// ---- waterfall timeline: canvas 2D, only the visible rows are drawn ----
const RH = 20, AXIS = 22, STEPS = [1, 5, 10, 30, 60, 300, 600, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 24 * 3600].map((x) => x * 1000);
const OUT_GLYPH = { done: "✓", blocked: "✕", partial: "~" } as const;
type TL = { events: OfficeEvent[]; w: ReturnType<typeof waterfall>; full: Span; view: Span; sel: Span | null; limited: boolean; fit: boolean };
let tl: TL | null = null, tlToken = 0;
/** The History range (X3, P2): a preset, or custom from/to. Recomputed on every reset so "Today" and "7 days" follow the clock. */
const RANGES = [["last", "Since your last visit"], ["today", "Today"], ["day", "Last 24 hours"], ["week", "Last 7 days"], ["custom", "Custom range"]] as const;
let rangeKey: (typeof RANGES)[number][0] = "last", custom = { since: 0, until: 0 }, range = { since: 0, until: 0 };
/** "since you were last here" (X3): the time this page was last visible, from the previous visit. */
const lastSeen = Number(store.get("lastSeen")) || 0;
const seen = () => { if (!document.hidden) store.set("lastSeen", String(Date.now())); };
setInterval(seen, 60_000);
document.addEventListener("visibilitychange", seen);
const hm = (ms: number, sec = false) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(sec ? { second: "2-digit" } : {}) });
/** A time with its weekday and date when it is not today (multi-day ranges). */
const stamp = (ms: number, sec = false) => new Date(ms).toDateString() === new Date().toDateString() ? hm(ms, sec) : `${new Date(ms).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${hm(ms, sec)}`;

/** reset = fetch the range anew; refresh = append what is newer than the last event; older = prepend the page before the first one. */
async function loadTimeline(msg: HTMLElement, redraw: () => void, how: "reset" | "refresh" | "older" = "refresh") {
  const my = ++tlToken;
  if (how === "reset" || !tl) { tl = null; range = historyRange(rangeKey, Date.now(), lastSeen, custom); how = "reset"; }
  const prev = tl?.events ?? [];
  try {
    // shortcut: a refresh asks from the last event's ms + 1, so an event stored later with that same ms is missed; key by seq if it matters
    const since = how === "refresh" && prev.length ? Math.max(range.since, prev[prev.length - 1].t + 1) : range.since;
    const until = how === "older" && prev.length ? prev[0].t - 1 : range.until;
    const { events: got, limited } = await fetchHistory(since, until, office.source.private);
    if (my !== tlToken) return;
    const events = how === "older" ? [...got, ...prev] : how === "refresh" ? [...prev, ...got] : got;
    const w = waterfall(events), full = { t0: w.t0, t1: Math.max(w.t1, w.t0 + MIN_SPAN) };
    // keep a zoomed range across the 30 s refresh; a fitted view follows the data
    const pre = !tl && lastSeen > full.t0 && lastSeen < full.t1 ? { t0: lastSeen, t1: full.t1 } : null; // first load: pre-select what happened while away
    tl = { events, w, full, limited: how === "refresh" ? tl!.limited : limited, view: tl && !tl.fit ? tl.view : full, sel: tl ? tl.sel : pre, fit: !tl || tl.fit };
    msg.hidden = true;
    if (!w.rows.length) { msg.hidden = false; msg.className = "k pad"; msg.textContent = tl.limited ? "No sessions in the newest page of this range: Load older." : "No stored events in this range. Pick a wider range, or run a Claude Code session; the daemon keeps its history."; }
    redraw();
  } catch (e) {
    if (my === tlToken) { msg.hidden = false; msg.className = "warn pad"; msg.textContent = `Could not load history: ${(e as Error).message}. Check that the daemon is running (node scripts/office.mjs status).`; }
  }
}

function buildTimeline(root: HTMLElement) {
  const msg = el("div", "k pad", "loading…"), info = el("div", "k pad"), legend = el("div", "tl-legend");
  const wrap = el("div", "tlwrap"), cv = el("canvas"), sizer = el("div");
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", "Timeline of sessions and agents over the chosen range. Bars are coloured by role; the legend lists outcomes.");
  wrap.append(cv, sizer);
  const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888";
  const left = () => Math.min(150, Math.max(70, Math.floor(wrap.clientWidth * 0.28)));
  const plot = () => ({ l: left(), w: Math.max(10, wrap.clientWidth - left() - 10) });
  const timeAt = (x: number) => { const p = plot(), v = tl!.view; return v.t0 + (Math.max(0, Math.min(p.w, x - p.l)) / p.w) * (v.t1 - v.t0); };
  const priv = hideText;
  const names = () => {
    const st = office.getEnvelope()?.state, m = new Map<string, string>();
    for (const o of (st as { outcomes?: { agentId: string; name?: string }[] } | undefined)?.outcomes ?? []) if (o.name) m.set(o.agentId, o.name);
    for (const a of Object.values(st?.agents ?? {})) if (a.seat?.name) m.set(a.id, a.seat.name);
    for (const a of office.actors()) m.set(a.id, a.label);
    return m;
  };
  const rowAt = (y: number) => tl?.w.rows[Math.floor((y - AXIS + wrap.scrollTop) / RH)];
  /** Row click (X3): select that agent (or the session's lead) on the floor and go back to the office. */
  const pickRow = (y: number, go: boolean) => {
    const r = rowAt(y), id = r && (r.kind === "agent" ? r.id : `lead:${r.session}`);
    if (!id) return;
    if (!office.actors().some((a) => a.id === id)) { info.textContent = "That agent is no longer on the floor; select its range and Replay it."; return; }
    office.select(id); // the panel card shows it beside the timeline
    if (go) { setView(""); office.focus(id); }
  };

  function infoText() {
    if (!tl || !tl.w.rows.length) return "";
    const r = tl.sel ?? tl.view, st = rangeStats(tl.w, r);
    const dur = st.ms < 60_000 ? `${(st.ms / 1000).toFixed(st.ms < 10_000 ? 1 : 0)}s` : fmtAge(st.ms);
    const what = `${stamp(r.t0, true)} to ${stamp(r.t1, true)} · ${dur} · ${t("event", { n: st.events })} · ${t("agent", { n: st.agents })}`;
    const away = tl.sel && tl.sel.t0 === lastSeen ? "Since you were last here: " : "Selected ";
    return (tl.sel ? `${away}${what} (double-click to zoom, or Replay this range)` : `Showing ${what}`) + (tl.limited ? " · older events in this range are not loaded yet (Load older)" : "");
  }
  function draw() {
    if (!tl || !tl.w.rows.length) { info.textContent = ""; cv.width = cv.height = 0; return; }
    const dpr = devicePixelRatio || 1, W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    sizer.style.height = `${Math.max(0, tl.w.rows.length * RH + AXIS - H)}px`;
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fg = css("--fg"), mute = css("--mute"), line = css("--line"), panel = css("--panel"), acc = css("--acc"), bad = css("--bad"), warn = css("--warn"), good = css("--good");
    g.fillStyle = panel; g.fillRect(0, 0, W, H);
    g.font = `${11 * (Number(css("--ts")) || 1)}px ui-monospace,Menlo,monospace`; g.textBaseline = "middle";
    const { l, w: pw } = plot(), v = tl.view, span = v.t1 - v.t0, x = (t: number) => l + ((t - v.t0) / span) * pw;
    // time grid
    const step = STEPS.find((s) => (s / span) * pw >= 70) ?? STEPS[STEPS.length - 1];
    g.fillStyle = mute; g.textAlign = "center";
    for (let t = Math.ceil(v.t0 / step) * step; t <= v.t1; t += step) {
      const px = Math.round(x(t)) + 0.5;
      g.strokeStyle = line; g.beginPath(); g.moveTo(px, AXIS - 4); g.lineTo(px, H); g.stroke();
      g.fillText(step >= 6 * HOUR ? stamp(t) : hm(t, step < 60_000), px, AXIS / 2 - 2);
    }
    // rows: cull to the scrolled window
    const top = wrap.scrollTop, i0 = Math.max(0, Math.floor(top / RH)), i1 = Math.min(tl.w.rows.length, Math.ceil((top + H - AXIS) / RH));
    const clipL = (txt: string, maxW: number) => { while (txt.length > 1 && g.measureText(txt).width > maxW) txt = txt.slice(0, -2) + "…"; return txt; };
    let sess = 0;
    const nm = names();
    for (let i = 0; i < i1; i++) {
      const r = tl.w.rows[i];
      if (r.kind === "session") sess++;
      if (i < i0) continue;
      const y = AXIS + i * RH - top, mid = y + RH / 2;
      g.textAlign = "start"; g.fillStyle = r.kind === "session" ? fg : mute;
      g.fillText(clipL(priv() ? (r.kind === "session" ? `session ${sess}` : r.role) : r.kind === "agent" && r.id && nm.has(r.id) ? `${nm.get(r.id)} · ${r.role.replace(/^.*:/, "")}` : r.label, l - 12 - (r.kind === "agent" ? 10 : 0)), (r.kind === "agent" ? 14 : 4), mid);
      if (r.e < v.t0 || r.s > v.t1) continue;
      const a = Math.max(l, x(r.s)), b = Math.min(l + pw, x(r.e)), bw = Math.max(2, b - a);
      if (r.kind === "session") { g.fillStyle = line; g.fillRect(a, y + 7, bw, RH - 14); continue; }
      g.fillStyle = roleColor(r.role); g.globalAlpha = r.open ? 0.55 : 0.9;
      g.fillRect(a, y + 3, bw, RH - 6); g.globalAlpha = 1;
      if (r.open) { g.setLineDash([3, 3]); g.strokeStyle = fg; g.strokeRect(a + 0.5, y + 3.5, bw - 1, RH - 7); g.setLineDash([]); }
      if (r.outcome) {
        g.strokeStyle = r.outcome === "blocked" ? bad : r.outcome === "partial" ? warn : good; g.lineWidth = 2;
        g.strokeRect(a + 1, y + 4, Math.max(1, bw - 2), RH - 8); g.lineWidth = 1;
        if (bw > 16) { g.fillStyle = fg; g.textAlign = "right"; g.fillText(OUT_GLYPH[r.outcome], a + bw - 3, mid); }
      }
    }
    // axis strip stays on top of scrolled rows
    g.fillStyle = panel; g.fillRect(0, 0, W, AXIS - 4); g.fillStyle = mute; g.textAlign = "center";
    for (let t = Math.ceil(v.t0 / step) * step; t <= v.t1; t += step) g.fillText(step >= 6 * HOUR ? stamp(t) : hm(t, step < 60_000), Math.round(x(t)), AXIS / 2 - 2);
    if (tl.sel) {
      const a = x(Math.max(tl.sel.t0, v.t0)), b = x(Math.min(tl.sel.t1, v.t1));
      g.fillStyle = acc; g.globalAlpha = 0.2; g.fillRect(a, 0, Math.max(1, b - a), H); g.globalAlpha = 1;
      g.strokeStyle = acc; g.strokeRect(a + 0.5, 0.5, Math.max(1, b - a), H - 1);
    }
    info.textContent = infoText();
    rp.disabled = !tl.sel;
    older.hidden = !tl.limited;
  }
  const set = (v: Span, sel: Span | null = tl!.sel) => { tl!.view = v; tl!.sel = sel; tl!.fit = v.t0 === tl!.full.t0 && v.t1 === tl!.full.t1; draw(); };
  const reset = () => tl && set(tl.full, null);
  const zoom = (f: number, anchor?: number) => {
    if (!tl) return;
    const c = anchor ?? (tl.sel ? (tl.sel.t0 + tl.sel.t1) / 2 : (tl.view.t0 + tl.view.t1) / 2);
    set(zoomView(tl.view, f, c, tl.full));
  };

  // pointer: drag selects, two pointers pinch, wheel zooms (shift/horizontal pans)
  const ptrs = new Map<number, number>();
  let drag: number | null = null, pinch: { d: number; v: Span; c: number } | null = null, moved = false;
  let cleared: { sel: { t0: number; t1: number }; at: number } | null = null; // the selection a plain click just cleared (dblclick zooms to it)
  cv.style.touchAction = "none";
  cv.addEventListener("pointerdown", (e) => {
    const x = e.clientX - cv.getBoundingClientRect().left;
    if (!tl) return;
    if (x < plot().l) { pickRow(e.clientY - cv.getBoundingClientRect().top, true); return; }
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, x);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.max(1, Math.abs(a - b)), v: tl.view, c: timeAt((a + b) / 2) };
      drag = null;
    } else { drag = x; moved = false; }
  });
  cv.addEventListener("pointermove", (e) => {
    if (!tl || !ptrs.has(e.pointerId)) return;
    const x = e.clientX - cv.getBoundingClientRect().left;
    ptrs.set(e.pointerId, x);
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      tl.view = zoomView(pinch.v, Math.abs(a - b) / pinch.d, pinch.c, tl.full);
      tl.fit = false; draw();
    } else if (drag !== null) {
      if (Math.abs(x - drag) > 3) moved = true;
      if (moved) { tl.sel = pickRange(drag, x, plot().l, plot().w, tl.view); draw(); }
    }
  });
  const up = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (drag !== null && !moved && tl?.sel) { cleared = { sel: tl.sel, at: Date.now() }; tl.sel = null; draw(); } // a plain click clears the selection
    else if (drag !== null && !moved) pickRow(e.clientY - cv.getBoundingClientRect().top, false);
    if (!ptrs.size) drag = null;
  };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  cv.addEventListener("dblclick", (e) => {
    if (!tl) return;
    const x = e.clientX - cv.getBoundingClientRect().left;
    if (x < plot().l) return;
    // the first click of a double-click has just cleared the selection: zoom to what it was
    const sel = tl.sel ?? (cleared && Date.now() - cleared.at < 500 ? cleared.sel : null);
    if (sel && sel.t1 - sel.t0 > 0) set(zoomView({ t0: sel.t0, t1: sel.t1 }, 1, 0, tl.full), null);
    else zoom(2, timeAt(x));
  });
  cv.addEventListener("wheel", (e) => {
    if (!tl) return;
    const x = e.clientX - cv.getBoundingClientRect().left;
    if (x < plot().l) return; // over the labels: normal vertical scroll
    e.preventDefault();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      set(panView(tl.view, ((e.deltaX || e.deltaY) / plot().w) * (tl.view.t1 - tl.view.t0), tl.full));
    } else zoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), timeAt(x)); // ctrl+wheel is a trackpad pinch: deltas are small
  }, { passive: false });
  wrap.addEventListener("scroll", draw, { passive: true });
  new ResizeObserver(draw).observe(wrap);
  // keys while the view is open: + / - zoom, 0 resets, arrows pan; the camera must not also zoom the hidden office
  addEventListener("keydown", (e) => {
    if (root.hidden || ignoreKey(e) || !tl) return;
    const k = e.key;
    if (k === "+" || k === "=") zoom(1.5);
    else if (k === "-" || k === "_") zoom(1 / 1.5);
    else if (k === "0") reset();
    else if (k === "ArrowLeft" || k === "ArrowRight") set(panView(tl.view, (k === "ArrowRight" ? 0.2 : -0.2) * (tl.view.t1 - tl.view.t0), tl.full));
    else return;
    e.preventDefault(); e.stopPropagation();
  }, true);

  const bar = el("div", "pad tlbar");
  const rp = btn("Replay this range", "Play the selected range back through the office (drag on the timeline to select)", () => { if (tl?.sel) { replayRange(tl.sel.t0, tl.sel.t1); setView(""); } });
  rp.disabled = true;
  // range: presets plus custom from/to (the replay bar's datetime-local inputs)
  const reload = () => { msg.hidden = false; msg.className = "k pad"; msg.textContent = "loading…"; void loadTimeline(msg, redrawAll, "reset"); };
  const sel = el("select");
  sel.setAttribute("aria-label", "History range");
  for (const [v, l] of RANGES) { const o = el("option", "", l); o.value = v; sel.append(o); }
  const when = (label: string) => { const i = el("input"), w = el("label", "k", `${label} `); i.type = "datetime-local"; w.append(i); w.hidden = true; return { i, w }; };
  const { i: from, w: fromW } = when("From"), { i: to, w: toW } = when("To");
  const setCustom = () => { custom = { since: from.valueAsNumber ? new Date(from.value).getTime() : 0, until: to.valueAsNumber ? new Date(to.value).getTime() : 0 }; if (custom.since) reload(); };
  from.addEventListener("change", setCustom); to.addEventListener("change", setCustom);
  sel.addEventListener("change", () => { rangeKey = sel.value as typeof rangeKey; fromW.hidden = toW.hidden = rangeKey !== "custom"; if (rangeKey !== "custom" || custom.since) reload(); });
  const older = btn("Load older", "Load the page of events before the oldest one shown", () => { older.disabled = true; void loadTimeline(msg, redrawAll, "older").finally(() => { older.disabled = false; }); });
  older.hidden = true;
  bar.append(el("b", "", "History"), sel, fromW, toW, older, rp,
    btn("Replay…", "Pick a replay range by time (opens the replay controls in the panel)", () => { toggleReplay(true); setView(""); }),
    btn("Fit", "Fit the whole range to the screen", () => tl && set(tl.full)),
    btn("Reset", "Fit and clear the selection (0)", reset),
    btn("−", "Zoom out (-)", () => zoom(1 / 1.5)), btn("+", "Zoom in (+)", () => zoom(1.5)),
    btn("Close", "Close the timeline", () => setView("")));
  root.append(bar, info, legend, msg, wrap);
  const legendFill = () => {
    const roles = [...new Set((tl?.w.rows ?? []).filter((r) => r.kind === "agent").map((r) => r.role))].slice(0, 10);
    legend.replaceChildren(...roles.map((r) => { const i = el("span", "lgi"); const sw = el("i", "sw"); sw.style.background = roleColor(r); i.append(sw, el("span", "", priv() ? "role" : r)); return i; }),
      el("span", "lgi", "✓ done"), el("span", "lgi", "✕ blocked"), el("span", "lgi", "~ partial"), el("span", "lgi", "dashed = still running"), el("span", "lgi", "grey bar = session"),
      el("span", "lgi k", "Click a row to find that agent. Drag to select a range, double-click to zoom, wheel/pinch zoom, +/-/0 keys. Times are local."));
  };
  const redrawAll = () => { legendFill(); draw(); };
  return { load: async () => { await loadTimeline(msg, redrawAll); }, draw };
}

let setView: (v: View) => void = () => {};
let shown: View = "";
/** For kiosk.ts and the palette: switch views without clicking toolbar buttons. */
export const showView = (v: View) => setView(v);
export const currentView = () => shown;
export function bindViews(tools: HTMLElement) {
  const wall = el("div", "view"), tlRoot = el("div", "view tlview");
  wall.id = "wall"; tlRoot.id = "timeline";
  wall.hidden = tlRoot.hidden = true;
  const grid = el("div", "wallgrid");
  wallGrid = grid;
  endedBox = el("section");
  endedBox.setAttribute("aria-label", "Ended sessions");
  wall.append(grid, endedBox);
  document.body.append(wall, tlRoot);
  const timeline = buildTimeline(tlRoot);
  const bo = btn("Office", "The live office (1)", () => setView(""));
  const bw = btn("Sessions", "One tile per session, no office drawing (2; #wall in the URL)", () => setView("wall"));
  const bt = btn("History", "Timeline since your last visit (or today, 7 days, a custom range); replay a range through the office (3)", () => setView("timeline"));
  bo.setAttribute("aria-pressed", "true"); bw.setAttribute("aria-pressed", "false"); bt.setAttribute("aria-pressed", "false");
  // freeze: hold incoming snapshots and show the last applied state; the chip counts what is waiting
  const bf = btn("Freeze", "Hold the view on what it shows now; new activity waits until you resume (.)", () => office.freeze.toggle());
  bf.setAttribute("aria-pressed", "false");
  const chip = el("div", "frozen-chip"), chipText = el("span");
  chip.id = "frozen";
  chip.setAttribute("role", "status");
  chip.hidden = true;
  chip.append(chipText, " ", btn("Resume", "Apply the newest state now (.)", () => office.freeze.set(false), "b sm"));
  document.body.append(chip);
  office.freeze.onChange(() => {
    const on = office.freeze.on;
    bf.setAttribute("aria-pressed", String(on));
    chip.hidden = !on;
    chipText.textContent = `Frozen · ${office.freeze.held} new`;
  });
  group(tools, "Views").append(bo, bw, bt);
  const g = group(tools, "Display");
  const bfo = btn("Follow", "Camera follows the busiest agent (Shift+F)", cycleFollow);
  const syncFollow = () => bfo.setAttribute("aria-pressed", String(following()));
  syncFollow();
  document.addEventListener("ao:follow", syncFollow);
  office.subscribe(syncFollow);
  g.append(bf, bfo);
  register("View: Office (1)", () => setView(""));
  register("View: Sessions wall (2)", () => setView("wall"));
  register("View: History timeline (3)", () => setView("timeline"));
  register("View: Freeze", () => office.freeze.toggle());
  register("View: Follow busiest (Shift+F)", cycleFollow);
  // floating compact window: Document Picture-in-Picture (Chromium); feature-detected, absent elsewhere
  const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow(o: { width: number; height: number }): Promise<Window> } }).documentPictureInPicture;
  if (dpip) {
    let win: Window | null = null, back: View = "";
    g.append(btn("Float", "Open the compact wall in a small always-on-top window", async () => {
      if (win) { win.close(); return; }
      try {
        const w = await dpip.requestWindow({ width: 360, height: 440 });
        for (const sheet of Array.from(document.styleSheets)) { // copy the page styles: cssRules text, else the link href
          const st = w.document.createElement("style");
          try { st.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n"); w.document.head.append(st); }
          catch { if (sheet.href) { const lk = w.document.createElement("link"); lk.rel = "stylesheet"; lk.href = sheet.href; w.document.head.append(lk); } }
        }
        w.document.documentElement.style.cssText = document.documentElement.style.cssText;
        w.document.body.className = document.body.className;
        const pg = el("div", "wallgrid");
        pg.style.cssText = "padding:6px";
        w.document.body.append(pg);
        win = w; pipGrid = pg; back = cur;
        setView(""); // the main window shows the office again while the wall floats
        renderWall(grid);
        w.addEventListener("pagehide", () => { win = null; pipGrid = null; if (back === "wall") setView("wall"); });
      } catch { /* denied: the main view simply stays */ }
    }));
  }
  let cur: View = "";
  setView = (v) => {
    cur = shown = v;
    wall.hidden = v !== "wall"; tlRoot.hidden = v !== "timeline";
    bo.setAttribute("aria-pressed", String(!v)); bw.setAttribute("aria-pressed", String(v === "wall")); bt.setAttribute("aria-pressed", String(v === "timeline"));
    if (v !== "timeline") tlToken++; // drop a fetch still in flight
    setViewToken(v);
    if (v === "wall") renderWall(grid);
    if (v === "timeline") void timeline.load();
  };
  office.subscribe(() => { if (cur === "wall" || pipGrid) renderWall(grid); });
  setInterval(() => { if (cur === "wall" || pipGrid) renderWall(grid); }, 1000); // ages tick between snapshots
  setInterval(() => { if (cur === "timeline") void timeline.load(); }, REFRESH_MS);
  addEventListener("keydown", (e) => {
    if (ignoreKey(e)) return;
    if (e.key === ".") office.freeze.toggle();
    else if (e.key === "1" || e.key === "2" || e.key === "3") setView((["", "wall", "timeline"] as const)[Number(e.key) - 1]);
  });
  addEventListener("hashchange", () => { const v = parseLink(location.hash).v; if (v !== cur) setView(v); });
  const v0 = parseLink(location.hash).v;
  if (v0) setView(v0);
  // Escape: the top layer only. Dialogs stop the event first (dialog.ts); presenter preventDefaults it; leaving presenter takes the Esc, not the Wall.
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !cur || e.defaultPrevented || document.body.classList.contains("presenter")) return;
    e.preventDefault(); e.stopPropagation();
    setView("");
  });
}
