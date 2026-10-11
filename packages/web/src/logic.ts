// Pure helpers for the DOM chrome (no pixi, no DOM): radar, feed filters, formatting, share-poster model.
import type { OfficeState, Usage } from "@agent-office/core";
import type { ActorInfo, FeedItem, SessionInfo } from "./api.ts";

export const fmtAge = (ms: number) => {
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

const num = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
/** Cache reads re-count the whole context every turn, so they are shown apart from fresh input. */
export const fmtTokens = (u?: Usage) =>
  u ? `new in ${num.format(u.input)} · cached ${num.format(u.cacheRead + u.cacheCreate)} · out ${num.format(u.output)}` : "";
export const sumUsage = (us: (Usage | undefined)[]): Usage =>
  us.reduce<Usage>((t, u) => ({ input: t.input + (u?.input ?? 0), output: t.output + (u?.output ?? 0), cacheRead: t.cacheRead + (u?.cacheRead ?? 0), cacheCreate: t.cacheCreate + (u?.cacheCreate ?? 0) }), { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });

/** Tokens/min (input + output + cache writes) between the oldest and newest of the recent samples; 0 until 10 s apart. */
export function burnRate(samples: { t: number; total: number }[]): number {
  const a = samples[0], b = samples[samples.length - 1];
  return a && b && b.t - a.t >= 10_000 ? Math.max(0, ((b.total - a.total) / (b.t - a.t)) * 60_000) : 0;
}
export const usageTotal = (u?: Usage) => (u ? u.input + u.output + u.cacheCreate : 0);

/** Elapsed time for a row: "42s", then the coarse `fmtAge` form. */
export const fmtDur = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.floor(ms / 1000))}s` : fmtAge(ms));
/** Stable hue 0..359 per project name, for a colour accent that survives reloads. */
const HUE_BANDS: [number, number][] = [[64, 129], [218, 315]];
const HUE_SPAN = HUE_BANDS.reduce((n, [lo, hi]) => n + hi - lo, 0);
/** Any hash onto an identity hue that is never a status hue or the magenta neon (see choreo.ts sessionHue). */
export function safeHue(n: number): number {
  let p = (n >>> 0) % HUE_SPAN;
  for (const [lo, hi] of HUE_BANDS) { if (p < hi - lo) return lo + p; p -= hi - lo; }
  return 220;
}
export const projectHue = (name: string) => safeHue([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));

/** Shell-safe `cd` line (single quotes; embedded quotes escaped). */
export const cdCommand = (cwd: string) => `cd '${cwd.replace(/'/g, `'\\''`)}'`;

// shortcut: fixed tokens/min flag for "runaway", make it a setting if it misfires
export const BURN_HOT = 200_000;
export const burnHot = (rate: number) => rate > BURN_HOT;
export const HOT_MS = 120_000; // burn must stay hot this long before one alert
export const LONG_TOOL_MS = 5 * 60_000; // one tool call running longer than this alerts once

/** Edge detector: true once when `on` has held for `ms` (per key); resets when it goes off. Caller keeps the map. */
export function sustained(m: Map<string, { since: number; fired: boolean }>, key: string, on: boolean, now: number, ms: number): boolean {
  if (!on) { m.delete(key); return false; }
  const e = m.get(key) ?? { since: now, fired: false };
  m.set(key, e);
  if (e.fired || now - e.since < ms) return false;
  return (e.fired = true);
}

/** Scale and offset that make a cw x ch image cover a w x h box (centred, overflow clipped by the caller). */
export function coverFit(cw: number, ch: number, w: number, h: number) {
  const s = Math.max(w / cw, h / ch);
  return { s, x: (w - cw * s) / 2, y: (h - ch * s) / 2 };
}

/** Escalation tier by how long it has waited: 0 under 5 min, 1 under 15, 2 beyond. */
export const tierOf = (ms: number) => (ms >= 900_000 ? 2 : ms >= 300_000 ? 1 : 0);
export type RadarItem = { key: string; kind: "blocked" | "waiting" | "stuck"; id: string; label: string; project: string; since: number; tier: number; reason?: string; session?: string };
/**
 * Things that need a human: helpers that gave up, waiting sessions, sessions mid-turn with no event for `stuckMs`, helpers
 * silent for 3x that. `since(key, fallback)` returns when the condition was first seen (caller keeps the map).
 * C6: with `state.outcomes` (current daemons) a gave-up row is a blocked outcome of a live session that is newer than the
 * session's latest prompt and not `seen`; it outlives the 45 s desk hold, a reload and a second page. Older daemons: blocked actors.
 */
export function radar(actors: ActorInfo[], state: OfficeState, now: number, since: (key: string, fallback: number) => number, stuckMs = 120_000, seen: (key: string) => boolean = () => false): RadarItem[] {
  const out: RadarItem[] = [];
  const add = (i: Omit<RadarItem, "tier">) => out.push({ ...i, tier: tierOf(now - i.since) });
  if (state.outcomes) {
    for (const o of state.outcomes) {
      const s = state.sessions[o.session], key = gaveUpKey(o);
      if (o.outcome !== "blocked" || o.lead || !s || o.t <= (s.promptAt ?? 0) || seen(key)) continue;
      add({ key, kind: "blocked", id: o.agentId, label: o.name ?? o.role ?? o.agentId, project: o.project ?? s.project, since: o.t, reason: o.text, session: o.session });
    }
  } else for (const a of actors) {
    if (!a.lead && a.status === "blocked") add({ key: `blocked:${a.id}`, kind: "blocked", id: a.id, label: a.label, project: a.project, since: since(`blocked:${a.id}`, now), session: a.session });
  }
  for (const s of Object.values(state.sessions)) {
    const id = `lead:${s.id}`;
    // X3: on your turn the lead's own last message is the reason, not "Claude is waiting for your input"
    if (s.waiting) add({ key: `waiting:${s.id}`, kind: "waiting", id: s.waitBy ?? id, label: (s.waitBy && actors.find((x) => x.id === s.waitBy)?.label) || s.project, project: s.project, since: since(`waiting:${s.id}`, s.lastAt ?? now), reason: (s.waitKind !== "permission" && s.result) || s.waitingText, session: s.id });
    // a tool in flight (s.doing) may legitimately be silent for a long time: allow 3x
    else if (s.prompt && s.lastAt && now - s.lastAt > (s.doing ? stuckMs * 3 : stuckMs)) add({ key: `stuck:${s.id}`, kind: "stuck", id, label: s.project, project: s.project, since: s.lastAt, session: s.id });
  }
  // C7: a seated helper silent for 3x the threshold (a lost stop or an interrupt), unless the wait it raised is open
  for (const a of Object.values(state.agents)) {
    const s = state.sessions[a.session];
    if (!a.seat || !a.lastAt || now - a.lastAt <= stuckMs * 3 || (s?.waiting && s.waitBy === a.id)) continue;
    add({ key: `stuck:${a.id}`, kind: "stuck", id: a.id, label: actors.find((x) => x.id === a.id)?.label ?? a.seat.name ?? a.role, project: s?.project ?? a.session, since: a.lastAt, session: a.session });
  }
  const rank = { blocked: 0, waiting: 1, stuck: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.since - b.since);
}
/** The Seen key of a gave-up outcome (no "@": notify.ts uses it for escalation tiers). */
export const gaveUpKey = (o: { agentId: string; t: number }) => `blocked:${o.agentId}:${o.t}`;

/** Tab title: `(2) waiting: api - Agent Office` (first item that needs you); unchanged when nothing does. */
export const titleFor = (items: RadarItem[], base = "Agent Office") => {
  if (!items.length) return base;
  const first = items.find((i) => i.kind !== "stuck") ?? items[0];
  return `(${items.length}) ${items.every((i) => i.kind === "waiting") ? "waiting" : "needs you"}: ${first.project} - ${base}`;
};

export type FeedFilter = { session: string; kind: string; agent: string; muted: Set<string> };
export const filterFeed = (items: FeedItem[], f: FeedFilter) =>
  items.filter((i) =>
    (!f.session || i.session === f.session) && (!f.kind || i.kind === f.kind) &&
    (!f.agent || i.from === f.agent || i.to === f.agent) && !f.muted.has(i.from));

/** Stored feed filters (`ao.filters`): hand-edited or old values of the wrong type fall back to the default. */
export function sanitizeFilters(raw: unknown) {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    session: str(o.session), kind: str(o.kind), agent: str(o.agent),
    muted: Array.isArray(o.muted) ? o.muted.filter((x): x is string => typeof x === "string") : [],
    grouped: o.grouped === true,
  };
}

export const GAP_MS = 5 * 60_000;
/** Newest first: for each row, the quiet time between it and the newer row above it, or 0 when under GAP_MS. */
export const quietBefore = (shown: FeedItem[]) => shown.map((f, i) => { const gap = i ? shown[i - 1].t - f.t : 0; return gap > GAP_MS ? gap : 0; });
export const bySession = (items: FeedItem[]) => {
  const by = new Map<string, FeedItem[]>();
  for (const i of items) (by.get(i.session ?? "") ?? by.set(i.session ?? "", []).get(i.session ?? "")!).push(i);
  return by;
};

/** Session sort bucket: 0 a blocked agent, 1 waiting for you, 2 busy, 3 idle lead. */
export const urgency = (s: SessionInfo, acts: ActorInfo[]) =>
  acts.some((a) => a.session === s.id && a.status === "blocked") ? 0 : s.waiting ? 1 : acts.find((a) => a.id === s.lead)?.status === "idle" ? 3 : 2;

export const RANK: Record<string, number> = { blocked: 0, waiting: 1, queued: 2, working: 3, thinking: 4, idle: 5 };
export type RosterRow = { a: ActorInfo; s: string };
/** One group per session, the most urgent first (then project name); inside a group the lead, then by RANK, then label. */
export function rosterGroups(rows: RosterRow[], projectOf: (sid: string) => string) {
  const groups = new Map<string, RosterRow[]>();
  for (const r of rows) (groups.get(r.a.session) ?? groups.set(r.a.session, []).get(r.a.session)!).push(r);
  return [...groups].map(([s, g]) => {
    g.sort((x, y) => +y.a.lead - +x.a.lead || RANK[x.s] - RANK[y.s] || x.a.label.localeCompare(y.a.label));
    return { s, g, rank: Math.min(...g.map((r) => RANK[r.s])) };
  }).sort((x, y) => x.rank - y.rank || projectOf(x.s).localeCompare(projectOf(y.s)));
}

export const WHO: Record<string, (f: FeedItem) => string> = {
  prompt: (f) => `You → ${f.to}`,
  done: (f) => `${f.from} finished`,
  // plain sentences for a viewer: who did what, not who-to-whom
  report: (f) => `${f.from} ${f.outcome === "blocked" ? "gave up" : (f.outcome as string) === "partial" ? "is partly done" : f.outcome === "done" ? "finished" : "reported"}`, // C3: only DONE reads as finished
  delegate: (f) => `${f.from} → ${f.to}${f.confidence === "guess" ? " (?)" : ""}`,
  message: (f) => (f.to === "user" ? `${f.from} says` : `${f.from} → ${f.to}`),
  conflict: (f) => `${f.from} ↔ ${f.to} (possible conflict)`,
};
/** The caption body: a report's "DONE:/BLOCKED:/PARTIAL:" prefix is already in the headline, so it is dropped here. */
export const captionText = (f: FeedItem) => (f.kind === "report" ? f.text.replace(/^\s*(?:DONE|BLOCKED|PARTIAL)\b:?\s*/i, "") : f.text);
export const whoLine = (f: FeedItem) => (WHO[f.kind] ?? ((x) => `${x.from} → ${x.to}`))(f);

/** Canvas aria-label: structure only, never free text. */
export function summary(actors: ActorInfo[], sessions: SessionInfo[]): string {
  if (!sessions.length) return "Agent Office: no sessions";
  const n = (s: string) => actors.filter((a) => a.status === s).length;
  const parts = ["working", "thinking", "queued", "waiting", "blocked"].map((s) => [s, n(s)] as const).filter(([, c]) => c).map(([s, c]) => `${c} ${s}`);
  return `Agent Office: ${sessions.length} session${sessions.length === 1 ? "" : "s"}, ${actors.length} people${parts.length ? ": " + parts.join(", ") : ""}`;
}

/** Share poster content. Names and counts only: no prompt, tool or path text. */
export function posterModel(state: OfficeState, now: number) {
  const sessions = Object.values(state.sessions), agents = Object.values(state.agents);
  const started = sessions.reduce((m, s) => Math.min(m, s.startedAt), now);
  const tasks = state.tasks ?? [];
  const name = (a: (typeof agents)[number]) => (a.seat?.name ?? a.role);
  const longest = agents.reduce<{ name: string; minutes: number } | null>((m, a) => {
    const minutes = Math.round((now - (a.startedAt ?? now)) / 60_000);
    return !m || minutes > m.minutes ? { name: name(a), minutes } : m;
  }, null);
  return {
    sessions: sessions.length,
    agents: agents.map((a) => ({ name: name(a), role: a.role })),
    done: tasks.filter((t) => t.status === "done").length,
    blocked: tasks.filter((t) => t.status === "blocked").length,
    minutes: sessions.length ? Math.max(0, Math.round((now - started) / 60_000)) : 0,
    tokens: sessions.reduce((n, s) => n + usageTotal(s.usage), 0),
    errors: [...sessions, ...agents].reduce((n, x) => n + (x.errors ?? 0), 0),
    longest,
  };
}

/** Owner of each pod (4 desks each): the project with most agents in it (ties: first seen); "" for an empty pod. Keys are seat ids `d<N>`. */
export function podOwners(projects: Map<string, string>, pods: number): string[] {
  const tally: Map<string, number>[] = Array.from({ length: pods }, () => new Map());
  for (const [seat, project] of projects) {
    const n = /^d(\d+)$/.exec(seat)?.[1];
    const t = n === undefined ? undefined : tally[Math.floor(Number(n) / 4)];
    if (t) t.set(project, (t.get(project) ?? 0) + 1);
  }
  return tally.map((t) => [...t].reduce<[string, number]>((b, e) => (e[1] > b[1] ? e : b), ["", 0])[0]);
}

/** The visible window in art px: where the viewport sits in the world, for the minimap rectangle. */
export function viewRect(v: { sc: number; ox: number; oy: number }, W: number, top: number, H: number) {
  return { x: -v.ox / v.sc, y: (top - v.oy) / v.sc, w: W / v.sc, h: H / v.sc };
}

/** Freeze (#freeze): while `isOn()`, offer() keeps only the newest value and counts the rest; take() hands it back on resume. */
export function holder<T>(isOn: () => boolean) {
  let held: T | null = null, n = 0;
  return {
    offer(v: T): boolean { if (!isOn()) return false; held = v; n++; return true; },
    get n() { return n; },
    take(): T | null { const h = held; held = null; n = 0; return h; },
  };
}

/** Roster status groups, most urgent first. There is no "ended" actor state in the engine (finished agents leave the floor). */
export const GROUPS = [["need", "Needs you"], ["work", "Working"], ["idle", "Idle"]] as const;
export type GroupId = (typeof GROUPS)[number][0];
export const groupOf = (status: string): GroupId => (status === "blocked" || status === "waiting" ? "need" : status === "idle" ? "idle" : "work");
/** Non-empty groups in order, rows keyed by effective status; per-session ordering inside a group is rosterGroups' job. */
export function statusGroups(rows: RosterRow[]) {
  return GROUPS.map(([id, title]) => ({ id, title, rows: rows.filter((r) => groupOf(r.s) === id) })).filter((g) => g.rows.length);
}

/** Non-cached input + output: what the spend alarm counts (cache reads re-count context every turn). */
export const spendTokens = (u?: Usage) => (u ? u.input + u.output : 0);
/** true once, when a session's total goes from under `limit` to at/over it. First sighting is a baseline, never an alert. */
export function spendCrossed(was: Map<string, boolean>, id: string, total: number, limit: number): boolean {
  if (!(limit > 0)) { was.delete(id); return false; }
  const above = total >= limit, prev = was.get(id);
  was.set(id, above);
  return prev === false && above;
}

export type ChimeKind = "blocked" | "waiting" | "finished";
/**
 * Pure chime scheduler: a key sounds once, at most one chime per GLOBAL_MS, and at most one per kind per KIND_MS.
 * `mark` records an accepted chime; the caller plays only when it returns true.
 */
export function chimeGate(globalMs = 1500, kindMs = 6000) {
  const seen = new Set<string>(), last = new Map<string, number>();
  let any = -Infinity;
  return (kind: ChimeKind, key: string, now: number): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 300) seen.delete(seen.values().next().value!);
    if (now - any < globalMs || now - (last.get(kind) ?? -Infinity) < kindMs) return false;
    any = now; last.set(kind, now);
    return true;
  };
}
