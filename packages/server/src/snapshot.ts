import { pseudonym, type OfficeState } from "@agent-office/core";

/** Blank `src` once: the same source object always maps to the same blanked object, so patches can diff by identity. */
const blanked = new WeakMap<object, unknown>();
const memo = <T extends object, R>(src: T, f: (x: T) => R): R => {
  if (!blanked.has(src)) blanked.set(src, f(src));
  return blanked.get(src) as R;
};
const each = <T extends object, R>(rec: Record<string, T>, f: (x: T) => R) => Object.fromEntries(Object.entries(rec).map(([k, x]) => [k, memo(x, f)]));

/** Client view of the state: internal `track` removed; with `priv`, free text blanked and projects pseudonymised (structure and tool names stay). */
export type Public = Omit<OfficeState, "track"> & { crew?: Record<string, Crew> };
export function publicState(state: OfficeState, priv: boolean): Public {
  const { track: _, ...rest } = state;
  if (!priv) return rest;
  return {
    ...rest,
    sessions: each(rest.sessions, (x) => ({ ...x, project: pseudonym(x.id), prompt: undefined, lastPrompt: undefined, result: undefined, why: undefined, detail: undefined, waitingText: undefined, waits: x.waits?.map(({ text: _, ...w }) => w), lastError: undefined, cwd: undefined, branch: undefined, files: undefined })),
    agents: each(rest.agents, (a) => ({ ...a, task: undefined, report: undefined, why: undefined, detail: undefined, lastError: undefined })),
    log: memo(rest.log, (l) => l.map((i) => memo(i, (x) => ({ ...x, text: "" })))),
    tasks: rest.tasks && memo(rest.tasks, (l) => l.map((t) => ({ ...t, text: "" }))),
    outcomes: rest.outcomes && memo(rest.outcomes, (l) => l.map((o) => ({ ...o, project: pseudonym(o.session), text: "", task: undefined }))),
    summaries: rest.summaries && memo(rest.summaries, (l) => l.map((x) => ({ ...x, project: pseudonym(x.session), prompt: undefined, result: undefined }))),
    conflicts: rest.conflicts && memo(rest.conflicts, (l) => l.map((c) => ({ ...c, file: "" }))),
    pending: each(rest.pending, (l) => l.map((j) => ({ ...j, text: "" }))),
  };
}

/** Per-session counts for the summary level of detail: agents = working (in a tool) + waiting (seated, between tools) + queued (no desk); blocked = BLOCKED reports among state.outcomes. */
export type Crew = { agents: number; working: number; waiting: number; blocked: number; queued: number };
/** Level of detail "summary": no agents, log, tasks or pending, plus `crew` counts per session; `session` keeps that one session in full. */
export function lodState(st: Public, session?: string): Public {
  const crew: Record<string, Crew> = {};
  for (const id of Object.keys(st.sessions)) crew[id] = { agents: 0, working: 0, waiting: 0, blocked: 0, queued: 0 };
  for (const a of Object.values(st.agents)) {
    const c = crew[a.session];
    if (!c) continue;
    c.agents++;
    if (!a.seat) c.queued++; else if (a.doing) c.working++; else c.waiting++;
  }
  for (const o of st.outcomes ?? []) if (o.outcome === "blocked" && crew[o.session]) crew[o.session].blocked++;
  const mine = <T extends { session: string }>(l: T[] = []) => l.filter((x) => x.session === session);
  return {
    ...st, crew,
    agents: Object.fromEntries(Object.entries(st.agents).filter(([, a]) => a.session === session)),
    log: mine(st.log), tasks: mine(st.tasks),
    pending: Object.fromEntries(Object.entries(st.pending).filter(([k]) => session !== undefined && k.startsWith(`${session}|`))),
  };
}

/** A view as sent: envelope head (everything but state) and the public state. */
export type Snap = { head: Record<string, unknown>; st: Public };
const MAPS = ["sessions", "agents", "pending"] as const;
const sameList = (a: unknown, b: unknown) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]));

/**
 * The `event: patch` body from `prev` to `cur` (contract 3). Maps diff by reference (the reducer is immutable, privacy
 * blanking is memoized), null = key removed; the log by id (drop from the front, append); other keys whole when changed.
 * `head` holds changed envelope fields (null = removed). `rev` is the patch's own field.
 */
export function diffEnvelope(prev: Snap, cur: Snap) {
  const p: { epoch: unknown; rev: unknown; base: unknown; head?: Record<string, unknown>; maps?: Record<string, Record<string, unknown>>; keys?: Record<string, unknown>; log?: { drop: number; add: unknown[] } } =
    { epoch: cur.head.epoch, rev: cur.head.rev, base: prev.head.rev };
  for (const k of new Set([...Object.keys(prev.head), ...Object.keys(cur.head)])) {
    if (k === "rev" || JSON.stringify(prev.head[k]) === JSON.stringify(cur.head[k])) continue;
    (p.head ??= {})[k] = cur.head[k] ?? null;
  }
  const a = prev.st as Record<string, any>, b = cur.st as Record<string, any>;
  for (const k of Object.keys(b)) {
    if (k === "log") continue;
    if ((MAPS as readonly string[]).includes(k)) {
      const m: Record<string, unknown> = {};
      for (const id of Object.keys(b[k])) if (a[k]?.[id] !== b[k][id]) m[id] = b[k][id];
      for (const id of Object.keys(a[k] ?? {})) if (!(id in b[k])) m[id] = null;
      if (Object.keys(m).length) (p.maps ??= {})[k] = m;
    } else if (k === "crew" ? JSON.stringify(a[k]) !== JSON.stringify(b[k]) : !sameList(a[k], b[k])) (p.keys ??= {})[k] = b[k];
  }
  const ol: { id: number }[] = a.log, nl: { id: number }[] = b.log;
  if (!sameList(ol, nl)) {
    const drop = nl.length ? ol.findIndex((x) => x.id === nl[0].id) : ol.length;
    const kept = drop < 0 ? -1 : ol.length - drop;
    if (kept >= 0 && kept <= nl.length && ol.slice(drop).every((x, i) => x.id === nl[i].id)) p.log = { drop, add: nl.slice(kept) };
    else (p.keys ??= {}).log = nl;
  }
  return p;
}

/**
 * Envelope JSON of at most `max` characters. Too big: trim the least important lists (log, outcomes, tasks, conflicts,
 * per-session file counts), then empty them, and mark the envelope `degraded` with a reason. The update is never dropped.
 */
export const fitEnvelope = (head: Record<string, unknown>, st: Public, max: number): string => fit(head, st, max).json;
/** fitEnvelope plus whether it had to trim (a degraded envelope is always streamed in full, never patched). */
export function fit(head: Record<string, unknown>, st: Public, max: number): { json: string; degraded: boolean } {
  const full = JSON.stringify({ ...head, state: st });
  if (full.length <= max) return { json: full, degraded: false };
  const reason = `state is ${Math.round(full.length / 1024)} KB, over the ${Math.round(max / 1024)} KB cap: activity log, outcomes, tasks and file counts are trimmed`;
  const sessions = Object.fromEntries(Object.entries(st.sessions).map(([k, x]) => [k, { ...x, files: undefined }]));
  const lite = { ...st, sessions, log: st.log.slice(-10), outcomes: st.outcomes?.slice(0, 5), tasks: st.tasks?.slice(-10), conflicts: [] };
  const a = JSON.stringify({ ...head, degraded: true, degradedReason: reason, state: lite });
  if (a.length <= max) return { json: a, degraded: true };
  return { json: JSON.stringify({ ...head, degraded: true, degradedReason: reason, state: { ...lite, log: [], outcomes: [], tasks: [], pending: {} } }), degraded: true };
}
