// Pure helpers over stored /history events: replay markers (#183), timeline rows (#194), CSV export (#184). No DOM;
// fetchHistory is the one shared /history client for the replay and the timeline.
import type { OfficeEvent } from "@agent-office/core";

export type Marker = { i: number; kind: "blocked" | "waiting" | "error" | "session_start" };
/** Landmarks of an event list; `i` is the replay position (events applied) just after the event. */
export function markers(events: OfficeEvent[]): Marker[] {
  const out: Marker[] = [];
  events.forEach((e, i) => {
    const kind = e.type === "waiting" ? "waiting" : e.type === "session_start" ? "session_start" : e.type === "tool_end" && !e.ok ? "error"
      : e.type === "agent_stop" && /^\s*blocked\b/i.test(e.message ?? "") ? "blocked" : null;
    if (kind) out.push({ i: i + 1, kind });
  });
  return out;
}

export type Bar = { s: number; e: number; kind: "session" | "agent" };
export type Row = { session: string; label: string; bars: Bar[] };
/** One row per session (lead bar) followed by its agents; open bars end at the last event time. */
export function gantt(events: OfficeEvent[]): { t0: number; t1: number; rows: Row[] } {
  const t0 = events.length ? events[0].t : 0, t1 = events.length ? events[events.length - 1].t : 0;
  const rows = new Map<string, Row>(), open = new Map<string, Bar>();
  const row = (s: string, label = s) => rows.get(s) ?? (rows.set(s, { session: s, label, bars: [] }), rows.get(s)!);
  for (const e of events) {
    if (e.type === "session_start") { const b: Bar = { s: e.t, e: t1, kind: "session" }; row(e.session, e.project).bars.push(b); open.set(e.session, b); }
    else if (e.type === "session_end") { const b = open.get(e.session); if (b) { b.e = e.t; open.delete(e.session); } }
    else if (e.type === "agent_start") {
      const r = row(e.session), b: Bar = { s: e.t, e: t1, kind: "agent" };
      r.bars.push(b); open.set(e.session + "/" + e.agentId, b);
    } else if (e.type === "agent_stop") { const k = e.session + "/" + e.agentId, b = open.get(k); if (b) { b.e = e.t; open.delete(k); } }
  }
  return { t0, t1, rows: [...rows.values()] };
}

// ---- waterfall timeline (#194): one row per session and per agent, plus the pure view/range maths the canvas uses ----
export type WRow = { session: string; id?: string; label: string; kind: "session" | "agent"; role: string; s: number; e: number; open: boolean; outcome?: "done" | "blocked" | "partial" };
const OUTCOME = /^\s*(done|blocked|partial)\b/i;
/** Session row first, then its agents by start time. Agents stopped with a DONE/BLOCKED/PARTIAL prefix carry the outcome; unstopped bars are `open`. */
export function waterfall(events: OfficeEvent[]): { t0: number; t1: number; rows: WRow[]; times: number[] } {
  const t0 = events.length ? events[0].t : 0, t1 = events.length ? events[events.length - 1].t : 0;
  const by = new Map<string, { head: WRow; kids: Map<string, WRow> }>();
  const get = (id: string, t: number, label = id.slice(0, 8)) => {
    let g = by.get(id);
    if (!g) { g = { head: { session: id, label, kind: "session", role: "session", s: t, e: t1, open: true }, kids: new Map() }; by.set(id, g); }
    return g;
  };
  for (const e of events) {
    if (e.type === "session_start") { const g = get(e.session, e.t, e.project); g.head.label = e.project; g.head.s = Math.min(g.head.s, e.t); }
    else if (e.type === "session_end") { const g = get(e.session, e.t); g.head.e = e.t; g.head.open = false; }
    else if (e.type === "agent_start") {
      const g = get(e.session, e.t);
      g.kids.set(e.agentId, { session: e.session, id: e.agentId, label: `${e.agentType.replace(/^.*:/, "")} ${e.agentId.slice(0, 6)}`, kind: "agent", role: e.agentType, s: e.t, e: t1, open: true });
    } else if (e.type === "agent_stop") {
      const k = get(e.session, e.t).kids.get(e.agentId);
      if (k) { k.e = e.t; k.open = false; const o = OUTCOME.exec(e.message ?? "")?.[1].toLowerCase(); if (o) k.outcome = o as WRow["outcome"]; }
    }
  }
  const rows: WRow[] = [];
  for (const g of [...by.values()].sort((a, b) => a.head.s - b.head.s)) rows.push(g.head, ...[...g.kids.values()].sort((a, b) => a.s - b.s));
  return { t0, t1, rows, times: events.map((e) => e.t) };
}

export type View = { t0: number; t1: number };
export const MIN_SPAN = 1000;
const fit = (v: View, full: View): View => {
  const span = Math.min(Math.max(MIN_SPAN, v.t1 - v.t0), Math.max(MIN_SPAN, full.t1 - full.t0));
  const t0 = Math.max(full.t0, Math.min(v.t0, full.t1 - span));
  return { t0, t1: t0 + span };
};
/** factor > 1 zooms in around `anchor` (a time); the anchor keeps its screen position. Clamped to the data and to MIN_SPAN. */
export function zoomView(v: View, factor: number, anchor: number, full: View): View {
  const k = 1 / factor;
  return fit({ t0: anchor - (anchor - v.t0) * k, t1: anchor + (v.t1 - anchor) * k }, full);
}
export const panView = (v: View, dt: number, full: View): View => fit({ t0: v.t0 + dt, t1: v.t1 + dt }, full);
/** Pixel drag x0..x1 over a plot starting at `left` and `width` wide -> a sorted time range inside the view. */
export function pickRange(x0: number, x1: number, left: number, width: number, v: View): View {
  const at = (x: number) => v.t0 + (Math.max(0, Math.min(width, x - left)) / Math.max(1, width)) * (v.t1 - v.t0);
  const a = at(x0), b = at(x1);
  return a <= b ? { t0: a, t1: b } : { t0: b, t1: a };
}
const lowerBound = (xs: number[], x: number) => { let lo = 0, hi = xs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m + 1; else hi = m; } return lo; };
/** Duration, events (binary search over the sorted times) and agent bars that overlap the range. */
export function rangeStats(w: { rows: WRow[]; times: number[] }, r: View) {
  return {
    ms: r.t1 - r.t0,
    events: lowerBound(w.times, r.t1 + 1) - lowerBound(w.times, r.t0),
    agents: w.rows.filter((x) => x.kind === "agent" && x.s <= r.t1 && x.e >= r.t0).length,
  };
}

const COLS = ["t", "type", "session", "agentId", "agentType", "tool", "ok", "detail", "text", "error", "message"] as const;
// Quote and neutralise spreadsheet formulas: cell text is untrusted.
const cell = (v: unknown) => {
  let s = v === undefined || v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (events: OfficeEvent[]) =>
  [COLS.join(","), ...events.map((e) => COLS.map((c) => cell((e as Record<string, unknown>)[c])).join(","))].join("\n") + "\n";
export const toJsonl = (events: OfficeEvent[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

// shortcut: the server returns the newest HISTORY_LIMIT events in range; for more, the user narrows the range.
export const HISTORY_LIMIT = 2000;
/** since/until are epoch ms; until is inclusive and 0 means now. Trimmed client-side too, in case the daemon ignores it. */
export async function fetchHistory(since: number, until = 0, priv = false): Promise<{ events: OfficeEvent[]; limited: boolean }> {
  const q = `/history?since=${since}&limit=${HISTORY_LIMIT}${until ? `&until=${until}` : ""}${priv ? "&private=1" : ""}`;
  const r = await fetch(q, { credentials: "same-origin" });
  if (!r.ok) throw new Error(r.status === 401 ? "unauthorized (open the page via the daemon URL)" : `HTTP ${r.status}`);
  const raw: OfficeEvent[] = (await r.json()).events ?? [];
  return { events: until ? raw.filter((e) => e.t <= until) : raw, limited: raw.length >= HISTORY_LIMIT };
}
