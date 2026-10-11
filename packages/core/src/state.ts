import { deskPos, FLOOR_DESKS, MAX_DESKS } from "./layout.ts";
import { crewName } from "./names.ts";
import { metaSummary, stripMeta } from "./clean.ts";
import type { Agent, Interaction, OfficeConfig, OfficeEvent, OfficeState, Run, Seat, Session, Summary, Task, Usage } from "./types.ts";

export const SCHEMA_VERSION = 1;
export const LOG_MAX = 40;
export const LIMITS = {
  sessions: 50, agents: 200, pending: 100,
  logPerSession: 30, tasks: 30, outcomes: 30, conflicts: 20, track: 100,
  summaries: 20, tree: 64, toolSamples: 64, toolStats: 32,
  pendingTtlMs: 60_000, // a SubagentStart follows its delegation within moments
  conflictWindowMs: 15_000,
};
export const emptyState = (): OfficeState => ({
  sessions: {}, agents: {}, queue: [], log: [], nextId: 1, pending: {},
  tasks: [], conflicts: [], outcomes: [], summaries: [], nextTask: 1, track: { seen: [], starts: {}, touched: {}, runs: {} },
});

/** Ids become object keys and pending-key parts: conservative charset, no Object.prototype names, no `lead:` spoofing. */
export const safeId = (v: unknown): v is string =>
  typeof v === "string" && /^[\w.:-]{1,64}$/.test(v) && !(v in Object.prototype) && !v.startsWith("lead:");

export const leadId = (session: string) => `lead:${session}`;
/** Privacy mode's project label: `session-` + 4 hex of an FNV-1a hash of the session id (stable, reveals no folder name). */
export const pseudonym = (session: string) => {
  let h = 2166136261;
  for (let i = 0; i < session.length; i++) h = Math.imul(h ^ session.charCodeAt(i), 16777619);
  return `session-${(h >>> 0).toString(16).padStart(8, "0").slice(0, 4)}`;
};
const bareType = (t: string) => t.slice(t.lastIndexOf(":") + 1).toLowerCase();

function say(s: OfficeState, i: Omit<Interaction, "id">): OfficeState {
  let log = [...s.log, { ...i, id: s.nextId }];
  const mine = log.filter((x) => x.session === i.session);
  if (mine.length > LIMITS.logPerSession) log = log.filter((x) => x !== mine[0]);
  return { ...s, log: log.slice(-LOG_MAX), nextId: s.nextId + 1 };
}

/** Plugin agents arrive namespaced ("agent-office:qa-engineer"), so match the part after the last colon too. Unmapped types keep their bare type as role. */
export function roleFor(cfg: OfficeConfig, agentType: string): string {
  const bare = bareType(agentType);
  return Object.keys(cfg.roles).find((r) => cfg.roles[r].agent.toLowerCase() === bare) ?? bare;
}

/** The configured name for a slot, or null when there is none (the caller picks a crew name). */
function seatName(cfg: OfficeConfig, role: string, kind: Seat["kind"], index: number): string | null {
  const r = cfg.roles[role];
  if (!r) return null; // unmapped type
  const list = (kind === "permanent" ? r.names : r.overflow?.names) ?? [];
  // A single overflow name is a prefix ("Temp"), not a person: only real lists name individuals.
  if (list[index] && !(kind === "overflow" && list.length === 1)) return list[index];
  return null;
}

const deskOf = (id: string) => Number(id.slice(1));
const dist = (a: number, b: number) => {
  const p = deskPos(a), q = deskPos(b);
  return Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
};
const meanDist = (i: number, ds: number[]) => ds.reduce((n, d) => n + dist(i, d), 0) / ds.length;

/**
 * Cheapest free desk of the one global pool (ties: lowest index), or null at MAX_DESKS (queue). Pure.
 * Cohesion first: a pod already owned by the session, else a fully empty pod, else any pod (tier x1000). Within a tier,
 * cost is mean distance to the session's desks (none yet: the emptiest, then lowest, pod), 0.4x mean distance to
 * same-role desks (secondary), +0.5 for a pod already 3/4 full. Core-team slots (cfg names/count) only decide kind and name.
 * Floors: a session keeps to the floor of its first desk while that floor has a free desk (any other floor costs +3000).
 */
export function allocate(cfg: OfficeConfig, state: OfficeState, role: string, session?: string): Seat | null {
  const seated = Object.values(state.agents).filter((a) => a.seat);
  const taken = new Set(seated.map((a) => deskOf(a.seat!.id)));
  const mates = seated.filter((a) => session !== undefined && a.session === session).map((a) => deskOf(a.seat!.id));
  const peers = seated.filter((a) => a.role === role).map((a) => deskOf(a.seat!.id));
  const podUse = Array.from({ length: MAX_DESKS / 4 }, () => 0);
  for (const d of taken) podUse[Math.floor(d / 4)]++;
  // Pod owner = session of the pod's lowest occupied desk (derived, no state).
  const owner = new Map<number, string>();
  for (const a of [...seated].sort((x, y) => deskOf(x.seat!.id) - deskOf(y.seat!.id))) {
    const p = Math.floor(deskOf(a.seat!.id) / 4);
    if (!owner.has(p)) owner.set(p, a.session);
  }
  let best = -1, bestCost = Infinity;
  // Compact growth: candidates are the occupied pods plus the FIRST empty pod (a session starts a fresh pod there).
  // Never beyond it: the same-role pull used to pick the pod row below a colleague, a desk the office never built.
  // The client builds every desk up to the highest one in use (buildLayout minDesks), so what is chosen here exists.
  // Every occupied pod stays a candidate wherever it is (a session's own pod may lie beyond a pod that emptied).
  // The session's floor also offers its own first empty pod, so a crew grows on its floor instead of spilling to the first gap elsewhere.
  const floorOf = (i: number) => Math.floor(i / FLOOR_DESKS);
  const home = mates.length ? floorOf(Math.min(...mates)) : -1;
  const firstEmpty = podUse.findIndex((n) => n === 0), homeEmpty = podUse.findIndex((n, p) => n === 0 && floorOf(p * 4) === home);
  for (let i = 0; i < MAX_DESKS; i++) {
    if (taken.has(i)) continue;
    const pod = Math.floor(i / 4), use = podUse[pod];
    if (use === 0 && pod !== firstEmpty && pod !== homeEmpty) continue; // never an empty pod past the first (of the office or of the session's floor)
    // Tiers dominate every other term: own pod, then a fully empty pod, then someone else's; another floor only when the session's is full.
    const tier = session !== undefined && owner.get(pod) === session ? 0 : use === 0 ? 1 : 2;
    const cost = tier * 1000 + (home >= 0 && floorOf(i) !== home ? 3000 : 0) + (mates.length ? meanDist(i, mates) : use * 100) + (peers.length ? 0.4 * meanDist(i, peers) : 0) + (use >= 3 ? 0.5 : 0);
    if (cost < bestCost) { best = i; bestCost = cost; }
  }
  if (best < 0) return null;
  // Slot within the role: lowest free core index below count, else lowest free temp index.
  const used = (kind: Seat["kind"]) => new Set(seated.filter((a) => a.role === role && a.seat!.kind === kind).map((a) => a.seat!.index));
  const lowestFree = (u: Set<number>) => { let n = 0; while (u.has(n)) n++; return n; };
  const core = lowestFree(used("permanent"));
  const kind: Seat["kind"] = core < (cfg.roles[role]?.count ?? 0) ? "permanent" : "overflow";
  const index = kind === "permanent" ? core : lowestFree(used("overflow"));
  let name = seatName(cfg, role, kind, index);
  if (name === null) {
    // Crew name: seeded by project | role | slot so a project's Nth worker of a role is the same person every run.
    const taken = new Set(seated.map((a) => a.seat!.name));
    for (const r of Object.values(cfg.roles)) for (const n of [...(r.names ?? []), ...(r.overflow?.names ?? [])]) taken.add(n);
    const sess = session !== undefined ? state.sessions[session] : undefined;
    name = crewName(`${sess?.cwd ?? sess?.project ?? session ?? ""}|${role}|${index}`, taken);
  }
  return { id: `d${best}`, role, kind, index, name };
}

/** Desks left in the office (one global pool, so `role` does not matter). Queued agents hold no seat. */
export function capacityFor(_cfg: OfficeConfig, state: OfficeState, _role?: string) {
  const free = MAX_DESKS - Object.values(state.agents).filter((a) => a.seat).length;
  return { free, total: MAX_DESKS, canSpawn: free > 0 };
}

/** Agents this id delegated to (id may be `lead:<session>`). */
export const childrenOf = (s: OfficeState, id: string): Agent[] => Object.values(s.agents).filter((a) => a.parent === id);

/** Ancestors from the immediate parent up to the lead. */
export function parentChain(s: OfficeState, id: string): string[] {
  const out: string[] = [];
  for (let p = s.agents[id]?.parent; p && !out.includes(p) && out.length < 16; p = s.agents[p]?.parent) out.push(p);
  return out;
}

/** Hand freed seats to queued agents, oldest first. Without cfg, nothing is promoted. */
function promote(cfg: OfficeConfig | undefined, s: OfficeState, t: number): OfficeState {
  if (!cfg) return { ...s, queue: s.queue.filter((id) => id in s.agents) };
  const queue: string[] = [];
  const agents = { ...s.agents };
  for (const id of s.queue) {
    const a = agents[id];
    if (!a) continue;
    const seat = allocate(cfg, { ...s, agents }, a.role, a.session);
    if (seat) agents[id] = { ...a, seat, seatedAt: t, queueWaitMs: t - (a.startedAt ?? t) };
    else queue.push(id);
  }
  return { ...s, agents, queue };
}

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const FILES_MAX = 50, TOOLS_MAX = 24, KEY_MAX = 120;

/** Count +1 for `key` in a capped counter map. Untrusted keys: own-property checks only, never inherited names. */
function bump(rec: Record<string, number> | undefined, key: string, cap: number): Record<string, number> {
  const r = rec ?? {};
  if (!Object.hasOwn(r, key) && Object.keys(r).length >= cap) {
    const low = Object.entries(r).reduce((m, x) => (x[1] < m[1] ? x : m));
    return bump(Object.fromEntries(Object.entries(r).filter(([k]) => k !== low[0])), key, cap);
  }
  return Object.fromEntries([...Object.entries(r).filter(([k]) => k !== key), [key, (Object.hasOwn(r, key) ? r[key] : 0) + 1]]);
}

/** Most-edited files, per session (all sessions when `session` is omitted). Pure. */
export function hotFiles(state: OfficeState, session?: string, limit = 8): { path: string; count: number; session: string }[] {
  return Object.values(state.sessions)
    .filter((x) => session === undefined || x.id === session)
    .flatMap((x) => Object.entries(x.files ?? {}).map(([path, count]) => ({ path, count, session: x.id })))
    .sort((a, b) => b.count - a.count || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, limit);
}

/** Tool usage summed over sessions, most used first. Pure. */
export function topTools(state: OfficeState, n = 5): { tool: string; count: number }[] {
  const m = new Map<string, number>();
  for (const x of Object.values(state.sessions)) for (const [t, c] of Object.entries(x.toolCounts ?? {})) m.set(t, (m.get(t) ?? 0) + c);
  return [...m].map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count || (a.tool < b.tool ? -1 : 1)).slice(0, n);
}

/** Billable-ish total of a session's lead usage (input + output + cache creation; cache reads excluded). */
export const usageTotalOf = (x: { usage?: Usage }): number => (x.usage ? x.usage.input + x.usage.output + x.usage.cacheCreate : 0);
const lastKeys = <T,>(o: Record<string, T>, n: number) => (Object.keys(o).length > n ? Object.fromEntries(Object.entries(o).slice(-n)) : o);

const base = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean);
/** Label sessions by folder name; when two live sessions share it, use parent/folder. */
function relabel(s: OfficeState): OfficeState {
  const names = Object.values(s.sessions).flatMap((x) => (x.cwd ? [base(x.cwd).at(-1)] : []));
  const sessions = Object.fromEntries(
    Object.entries(s.sessions).map(([id, x]) => {
      const parts = x.cwd ? base(x.cwd) : [];
      const name = parts.at(-1);
      if (!name) return [id, x];
      const dup = names.filter((n) => n === name).length > 1 && parts.length > 1;
      return [id, { ...x, project: dup ? `${parts.at(-2)}/${name}` : name }];
    }),
  );
  return { ...s, sessions };
}

/** A running total never goes down (a restarted daemon re-reads only a transcript's last 8 MB). */
const maxUsage = (old: Usage | undefined, u: Usage) => (old && usageTotalOf({ usage: old }) > usageTotalOf({ usage: u }) ? old : u);
/** A permission wait in progress ends at `t` (counted); any other wait is not counted. */
const closePerm = (x: Session, t: number): Partial<Session> => {
  const w = x.permWait;
  if (w?.since === undefined) return {};
  const ms = Math.max(0, t - w.since);
  return { permWait: { n: w.n + 1, totalMs: w.totalMs + ms, lastMs: ms } };
};
const clearWait = (x: Session, t: number): Partial<Session> => ({ waiting: false, waitKind: undefined, waitBy: undefined, ...closePerm(x, t) });
/** Does an event from `agentId` (undefined = the lead) answer the session's wait? A helper's wait (waitBy) only by that helper; the lead's only by the lead. */
const answers = (x: Session, agentId?: string) => (x.waitBy ? agentId === x.waitBy : !agentId);

const RUN0: Run = { agents: 0, tree: [], errors: 0, outcomes: { done: 0, blocked: 0, partial: 0, empty: 0 }, tools: {} };
const withRun = (s: OfficeState, id: string, f: (r: Run) => Run): OfficeState =>
  ({ ...s, track: { ...s.track!, runs: { ...s.track!.runs, [id]: f(s.track!.runs?.[id] ?? RUN0) } } });
/** Nearest-rank percentile of an ascending list. */
const pct = (asc: number[], q: number) => asc[Math.max(0, Math.ceil(q * asc.length) - 1)];

/** Record one finished call of `tool` (duration known) and return the run plus the session's refreshed toolStats. */
function sampleTool(r: Run, stats: Session["toolStats"], tool: string, ms: number, ok: boolean): [Run, NonNullable<Session["toolStats"]>] {
  let tools = r.tools, st = stats ?? {};
  if (!Object.hasOwn(tools, tool) && Object.keys(tools).length >= LIMITS.toolStats) { // evict the least sampled tool
    const low = Object.entries(tools).reduce((m, x) => (x[1].ms.length < m[1].ms.length ? x : m))[0];
    tools = Object.fromEntries(Object.entries(tools).filter(([k]) => k !== low));
    st = Object.fromEntries(Object.entries(st).filter(([k]) => k !== low));
  }
  const old = Object.hasOwn(tools, tool) ? tools[tool] : { ms: [], ok: [] };
  const cur = { ms: [...old.ms, ms].slice(-LIMITS.toolSamples), ok: [...old.ok, ok].slice(-LIMITS.toolSamples) };
  const asc = [...cur.ms].sort((a, b) => a - b);
  const row = { n: asc.length, fail: cur.ok.filter((x) => !x).length, p50: pct(asc, 0.5), p95: pct(asc, 0.95) };
  return [{ ...r, tools: { ...tools, [tool]: cur } }, { ...st, [tool]: row }];
}
/** First line of a report, bounded: the one-line result. */
const firstLine = (m?: string) => (m ?? "").split("\n")[0].trim().slice(0, 160);
const patchSession = (s: OfficeState, id: string, p: Partial<Session>): OfficeState =>
  s.sessions[id] ? { ...s, sessions: { ...s.sessions, [id]: { ...s.sessions[id], ...p } } } : s;
const patchTask = (s: OfficeState, id: string | undefined, p: Partial<Task>): OfficeState =>
  id ? { ...s, tasks: s.tasks!.map((t) => (t.id === id ? { ...t, ...p } : t)) } : s;

/** Drop pending delegations failing `keep`, and the tasks that never started because of it. */
function filterPending(s: OfficeState, keep: (j: OfficeState["pending"][string][number]) => boolean): OfficeState {
  const gone = new Set<string>();
  const pending: OfficeState["pending"] = {};
  for (const [k, list] of Object.entries(s.pending)) {
    const kept = list.filter((j) => keep(j) || (j.task && gone.add(j.task), false));
    if (kept.length) pending[k] = kept;
  }
  return gone.size ? { ...s, pending, tasks: s.tasks!.filter((t) => !gone.has(t.id)) } : { ...s, pending };
}

/** Remove a session and everything of its. Pass cfg to seat queued agents of other sessions. `endedAt` defaults to `t`. */
function endSession(cfg: OfficeConfig | undefined, s: OfficeState, session: string, t: number, endedAt = t): OfficeState {
  const agents = Object.fromEntries(Object.entries(s.agents).filter(([, a]) => a.session !== session));
  const { [session]: x, ...sessions } = s.sessions;
  const { [session]: run = RUN0, ...runs } = s.track!.runs ?? {};
  if (x) {
    const sum: Summary = {
      session, project: x.project, startedAt: x.startedAt, endedAt, durationMs: Math.max(0, endedAt - x.startedAt),
      ...(x.lastPrompt ? { prompt: x.lastPrompt } : {}), ...(x.result ? { result: x.result } : {}),
      agents: run.agents, tree: run.tree.map((a) => ({ ...a, name: a.name ?? s.agents[a.id]?.seat?.name })), errors: run.errors,
      permission: { n: x.permWait?.n ?? 0, totalMs: x.permWait?.totalMs ?? 0 }, outcomes: run.outcomes, ...(x.usage ? { usage: x.usage } : {}),
    };
    s = { ...s, summaries: [sum, ...s.summaries!].slice(0, LIMITS.summaries), track: { ...s.track!, runs } };
  }
  const pending = Object.fromEntries(Object.entries(s.pending).filter(([k]) => !k.startsWith(`${session}|`)));
  const n: OfficeState = {
    ...s, sessions, agents, pending,
    log: s.log.filter((i) => i.session !== session),
    tasks: s.tasks!.filter((x) => x.session !== session),
    conflicts: s.conflicts!.filter((c) => ![c.a, c.b].some((id) => id === leadId(session) || (s.agents[id]?.session === session))),
  };
  return relabel(promote(cfg, { ...n, queue: s.queue.filter((id) => id in agents) }, t));
}

/** DONE:/BLOCKED:/PARTIAL: prefix of an agent's final message. */
export const outcomeOf = (m?: string): Interaction["outcome"] => {
  const w = /^\s*(done|blocked|partial)\b/i.exec(m ?? "")?.[1].toLowerCase();
  return w === "done" || w === "blocked" || w === "partial" ? w : m?.trim() ? undefined : "empty";
};

/**
 * End sessions (and their agents) with no event for `ttlMs` (the summary ends at the session's last event). Pure. Pass cfg
 * to promote queued agents of surviving sessions. A helper of a live session goes too when it has been silent for ttlMs/3
 * and its lead finished a turn after the helper's last event (a ghost: interrupt or a lost SubagentStop); it files no outcome.
 */
export function sweep(state: OfficeState, now: number, ttlMs: number, cfg?: OfficeConfig) {
  let s = state;
  if (!Number.isFinite(now)) return { state: s, removed: { sessions: [] as string[], agents: [] as string[] } }; // a bad clock must not reap everything
  const removed = { sessions: [] as string[], agents: [] as string[] };
  for (const x of Object.values(state.sessions)) {
    if (now - (x.lastAt ?? x.startedAt) <= ttlMs) continue;
    removed.sessions.push(x.id);
    removed.agents.push(...Object.values(s.agents).filter((a) => a.session === x.id).map((a) => a.id));
    s = endSession(cfg, norm(s), x.id, now, x.lastAt ?? x.startedAt);
  }
  const ghosts = Object.values(s.agents).filter((a) => {
    const last = a.lastAt ?? a.startedAt ?? now, turn = s.sessions[a.session]?.turnAt;
    return now - last > ttlMs / 3 && turn !== undefined && turn > last;
  }).map((a) => a.id);
  if (ghosts.length) {
    removed.agents.push(...ghosts);
    const agents = Object.fromEntries(Object.entries(s.agents).filter(([id]) => !ghosts.includes(id)));
    s = promote(cfg, { ...s, agents, queue: s.queue.filter((id) => id in agents) }, now);
  }
  return { state: s, removed };
}

const norm = (s: OfficeState): OfficeState =>
  s.track && s.tasks && s.conflicts && s.outcomes && s.summaries && s.nextTask ? s : { ...s, tasks: s.tasks ?? [], conflicts: s.conflicts ?? [], outcomes: s.outcomes ?? [], summaries: s.summaries ?? [], nextTask: s.nextTask ?? 1, track: s.track ?? { seen: [], starts: {}, touched: {} } };

/** A helper takes a desk (or the queue) and the oldest same-type pending delegation as its task. */
function startAgent(cfg: OfficeConfig, s: OfficeState, e: Extract<OfficeEvent, { type: "agent_start" }>): OfficeState {
  if (s.agents[e.agentId] || Object.keys(s.agents).length >= LIMITS.agents) return s;
  // an id that already stopped (a stop that arrived first, or a replayed start) must not come back as a ghost holding a desk
  if (s.track!.seen.includes(`${e.session}|stopped|${e.agentId}`)) return s;
  s = filterPending(s, (j) => (j.t ?? e.t) >= e.t - LIMITS.pendingTtlMs);
  const role = roleFor(cfg, e.agentType);
  const seat = allocate(cfg, s, role, e.session);
  const key = `${e.session}|${bareType(e.agentType)}`;
  const [job, ...rest] = s.pending[key] ?? [];
  const parent = job?.from && s.agents[job.from] ? job.from : leadId(e.session);
  const confidence = job && !rest.length ? "exact" : "guess"; // guess: parallel same-type delegations, or none matched
  const agent: Agent = {
    id: e.agentId, session: e.session, agentType: e.agentType, role, seat, parent, task: job?.text,
    startedAt: e.t, lastAt: e.t, toolCount: 0, confidence, ...(seat ? { seatedAt: e.t, queueWaitMs: 0 } : {}),
  };
  const pending = { ...s.pending, [key]: rest };
  if (!rest.length) delete pending[key];
  let n: OfficeState = { ...s, agents: { ...s.agents, [e.agentId]: agent }, queue: seat ? s.queue : [...s.queue, e.agentId], pending };
  n = patchTask(n, job?.task, { status: "running", agentId: e.agentId, owner: seat?.name ?? e.agentType, startedAt: e.t });
  n = withRun(n, e.session, (r) => ({ ...r, agents: r.agents + 1,
    tree: r.tree.length < LIMITS.tree ? [...r.tree, { id: e.agentId, ...(seat ? { name: seat.name } : {}), role, parent }] : r.tree }));
  return say(n, { t: e.t, kind: "delegate", session: e.session, from: parent, to: e.agentId, text: job?.text ?? "", confidence });
}

/**
 * A tool or stop from a helper whose SubagentStart never arrived: create it (recovered) from the session's oldest pending
 * delegation, so it is never drawn as the lead and its stop files an outcome. An id that already stopped stays gone.
 */
function recoverAgent(cfg: OfficeConfig, s: OfficeState, session: string, agentId: string, t: number): OfficeState {
  if (s.outcomes!.some((o) => o.agentId === agentId && o.session === session)) return s;
  let oldest: [string, number] | undefined;
  for (const [k, l] of Object.entries(s.pending)) if (k.startsWith(`${session}|`) && l.length && (!oldest || (l[0].t ?? t) < oldest[1])) oldest = [k.slice(session.length + 1), l[0].t ?? t];
  const n = startAgent(cfg, s, { type: "agent_start", session, agentId, agentType: oldest?.[0] ?? "unknown", t });
  return n.agents[agentId] ? { ...n, agents: { ...n.agents, [agentId]: { ...n.agents[agentId], recovered: true } } } : n;
}

export function reduce(cfg: OfficeConfig, state: OfficeState, e: OfficeEvent): OfficeState {
  if (!safeId(e.session) || ("agentId" in e && e.agentId !== undefined && !safeId(e.agentId))) return state;
  let s = norm(state);
  if (e.type === "session_end") return endSession(cfg, s, e.session, e.t);

  // Gate: events for an unseen session (daemon restarted mid-run) create a "recovered" session, up to a cap.
  let sess = s.sessions[e.session];
  if (!sess) {
    if (Object.keys(s.sessions).length >= LIMITS.sessions) return s;
    sess = { id: e.session, project: e.session.slice(0, 8), waiting: false, startedAt: e.t, ...(e.type === "session_start" ? {} : { recovered: true }) };
  }
  let gaps = sess.gaps ?? 0, lastSeq = sess.lastSeq;
  if (e.seq !== undefined) {
    if (lastSeq !== undefined && e.seq !== lastSeq + 1 && e.seq !== lastSeq) gaps++; // a retried event (same seq) is not a gap
    lastSeq = e.seq;
  }
  s = { ...s, sessions: { ...s.sessions, [e.session]: { ...sess, lastAt: e.t, seq: (sess.seq ?? 0) + 1, gaps, lastSeq } } };

  const uid = "id" in e ? e.id : undefined;
  if (uid) {
    const k = `${e.session}|${e.type}|${uid}`;
    if (s.track!.seen.includes(k)) return s;
    s = { ...s, track: { ...s.track!, seen: [...s.track!.seen, k].slice(-LIMITS.track) } };
  }
  if ((e.type === "tool" || e.type === "agent_stop") && e.agentId && !s.agents[e.agentId]) s = recoverAgent(cfg, s, e.session, e.agentId, e.t);
  const ag = "agentId" in e && e.agentId ? s.agents[e.agentId] : undefined;
  if (ag) s = { ...s, agents: { ...s.agents, [ag.id]: { ...ag, lastAt: e.t } } };

  switch (e.type) {
    case "session_start": {
      const old = s.sessions[e.session];
      // Merge: resume/compact/clear keep startedAt, prompt and agents.
      const next = { ...old, project: e.project, cwd: e.cwd ?? old.cwd, branch: e.branch ?? old.branch, source: e.source ?? old.source,
        recovered: undefined, startedAt: old.recovered ? e.t : old.startedAt };
      return relabel({ ...s, sessions: { ...s.sessions, [e.session]: next } });
    }
    case "delegate": {
      s = filterPending(s, (j) => (j.t ?? e.t) >= e.t - LIMITS.pendingTtlMs);
      if (Object.values(s.pending).reduce((n, l) => n + l.length, 0) >= LIMITS.pending) return s;
      const key = `${e.session}|${bareType(e.agentType)}`;
      const task = `t${s.nextTask}`;
      const t: Task = { id: task, session: e.session, role: roleFor(cfg, e.agentType), text: e.text, status: "pending" };
      return {
        ...s, nextTask: s.nextTask! + 1,
        tasks: [...s.tasks!, t].slice(-LIMITS.tasks),
        pending: { ...s.pending, [key]: [...(s.pending[key] ?? []), { from: e.from, text: e.text, t: e.t, id: e.id, task }] },
      };
    }
    case "agent_start":
      return startAgent(cfg, s, e);
    case "agent_stop": {
      const a = s.agents[e.agentId];
      const { [e.agentId]: _, ...agents } = s.agents;
      s = { ...s, track: { ...s.track!, seen: [...s.track!.seen, `${e.session}|stopped|${e.agentId}`].slice(-LIMITS.track) } };
      let n = promote(cfg, { ...s, agents, queue: s.queue.filter((id) => id !== e.agentId) }, e.t);
      if (n.sessions[e.session].waitBy === e.agentId) n = patchSession(n, e.session, clearWait(n.sessions[e.session], e.t));
      if (a) {
        const msg = e.message ?? a.report;
        const outcome = e.outcome ?? outcomeOf(msg); // a stored line without text carries the outcome it had
        n = withRun(n, e.session, (r) => ({ ...r,
          outcomes: outcome ? { ...r.outcomes, [outcome]: r.outcomes[outcome] + 1 } : r.outcomes,
          tree: r.tree.map((x) => (x.id === a.id && !x.name && a.seat ? { ...x, name: a.seat.name } : x)) }));
        const task = n.tasks!.find((x) => x.agentId === a.id)?.id;
        n = patchTask(n, task, { status: outcome === "blocked" ? "blocked" : "done", endedAt: e.t });
        const durationMs = a.startedAt === undefined ? undefined : Math.max(0, e.t - a.startedAt);
        n = { ...n, outcomes: [{ session: e.session, project: n.sessions[e.session]?.project, agentId: a.id, name: a.seat?.name, role: a.role, outcome,
          text: firstLine(msg), task: a.task, t: e.t, durationMs }, ...n.outcomes!].slice(0, LIMITS.outcomes) };
        n = say(n, {
          t: e.t, kind: "report", session: e.session, from: a.id, to: a.parent, text: msg ?? "",
          outcome, stoppedAt: e.t, durationMs,
          toolCount: a.toolCount, queueWaitMs: a.queueWaitMs, usage: e.usage,
        });
      }
      return n;
    }
    case "tool": {
      const a = e.agentId ? s.agents[e.agentId] : undefined;
      const sess = s.sessions[e.session];
      const agents = a ? { ...s.agents, [a.id]: { ...a, ...(e.message ? { report: e.message } : {}), doing: e.tool, detail: e.detail, why: e.why, busyAt: e.t, toolCount: (a.toolCount ?? 0) + 1 } } : s.agents;
      // No agent id means the lead itself is working. Only the one who raised the wait answers it (answers()); a helper's
      // tool never lands in the session's doing, even for a helper the reducer could not create (agent cap).
      const sessions = { ...s.sessions, [sess.id]: {
        ...sess, ...(answers(sess, e.agentId) ? clearWait(sess, e.t) : {}), toolCounts: bump(sess.toolCounts, e.tool.slice(0, KEY_MAX), TOOLS_MAX),
        ...(e.detail && WRITE_TOOLS.has(e.tool) ? { files: bump(sess.files, e.detail.slice(0, KEY_MAX), FILES_MAX) } : {}),
        ...(e.agentId ? {} : { doing: e.tool, detail: e.detail, why: e.why, busyAt: e.t }),
      } };
      const track = { ...s.track! };
      if (e.id) track.starts = lastKeys({ ...track.starts, [`${e.session}|${e.id}`]: e.t }, LIMITS.track);
      let conflicts = s.conflicts!;
      // shortcut: same-session basenames only, no path or cross-session matching; add full paths when the adapter carries them.
      if (e.detail && WRITE_TOOLS.has(e.tool)) {
        const by = a ? a.id : leadId(e.session), k = `${e.session}|${e.detail}`, prior = track.touched[k];
        const last = conflicts.at(-1);
        if (prior && prior.by !== by && e.t - prior.t <= LIMITS.conflictWindowMs && !(last && last.file === e.detail && last.a === prior.by && last.b === by))
          conflicts = [...conflicts, { file: e.detail, a: prior.by, b: by, t: e.t, kind: "possible" as const }].slice(-LIMITS.conflicts);
        track.touched = lastKeys({ ...track.touched, [k]: { by, t: e.t } }, LIMITS.track);
      }
      return { ...s, agents, sessions, track, conflicts };
    }
    case "tool_end": {
      const a = e.agentId ? s.agents[e.agentId] : undefined;
      const sess = s.sessions[e.session];
      const k = e.id ? `${e.session}|${e.id}` : undefined;
      const start: number | undefined = (k ? s.track!.starts[k] : undefined) ?? (a ? a.busyAt : sess?.busyAt);
      const lastDurationMs = start === undefined ? undefined : Math.max(0, e.t - start);
      const fail = e.ok ? {} : { lastError: e.error ?? "failed" };
      const patch = (x: { errors?: number }) => ({ doing: undefined, why: undefined, lastDurationMs, ...fail, errors: (x.errors ?? 0) + (e.ok ? 0 : 1) });
      let n: OfficeState = a ? { ...s, agents: { ...s.agents, [a.id]: { ...a, ...patch(a) } } }
        : e.agentId ? s : patchSession(s, e.session, patch(sess));
      if (answers(sess, e.agentId)) n = patchSession(n, e.session, clearWait(sess, e.t));
      if (k) { const { [k]: _, ...starts } = n.track!.starts; n = { ...n, track: { ...n.track!, starts } }; }
      let stats = n.sessions[e.session].toolStats;
      n = withRun(n, e.session, (r) => {
        if (lastDurationMs !== undefined) [r, stats] = sampleTool(r, stats, e.tool.slice(0, KEY_MAX), lastDurationMs, e.ok);
        return e.ok ? r : { ...r, errors: r.errors + 1 };
      });
      if (stats !== n.sessions[e.session].toolStats) n = patchSession(n, e.session, { toolStats: stats });
      // A failed Agent call never spawns: its delegation must not be inherited by a later same-type start.
      if (!e.ok && e.id) n = filterPending(n, (j) => j.id !== e.id);
      return n;
    }
    case "message":
      return say(s, { t: e.t, kind: "message", session: e.session, from: e.from ?? leadId(e.session), to: e.to, text: e.text });
    case "prompt": {
      // Machine-generated "prompts" (background-task notifications, reminders) are not what the user typed: never show
      // them as "You ->" or keep them as the session prompt; a notification's summary becomes a quiet lead note.
      const text = stripMeta(e.text);
      if (!text) {
        const sum = metaSummary(e.text);
        const n = patchSession(s, e.session, clearWait(s.sessions[e.session], e.t));
        return sum ? say(n, { t: e.t, kind: "message", session: e.session, from: leadId(e.session), to: "user", text: sum.slice(0, 140) }) : n;
      }
      return say(patchSession(s, e.session, { prompt: text, lastPrompt: text, result: undefined, promptAt: e.t, ...clearWait(s.sessions[e.session], e.t) }), { t: e.t, kind: "prompt", session: e.session, from: "user", to: leadId(e.session), text });
    }
    case "turn_end": {
      const x = s.sessions[e.session], text = firstLine(e.message);
      let n = patchSession(s, e.session, { ...clearWait(x, e.t), doing: undefined, detail: undefined, why: undefined, prompt: undefined, result: text || undefined, turnAt: e.t,
        ...(e.usage ? { usage: maxUsage(x.usage, e.usage) } : {}) });
      // The lead's finished turn is an outcome too (its prompt -> its result line); an unprefixed answer stays undefined (neutral).
      if (x.prompt || text) n = { ...n, outcomes: [{ session: e.session, project: x.project, agentId: leadId(e.session), lead: true as const, outcome: e.outcome ?? outcomeOf(e.message),
        text, ...(x.prompt ? { task: x.prompt } : {}), t: e.t, ...(x.promptAt !== undefined ? { durationMs: Math.max(0, e.t - x.promptAt) } : {}) }, ...n.outcomes!].slice(0, LIMITS.outcomes) };
      return say(n, { t: e.t, kind: "done", session: e.session, from: leadId(e.session), to: "user", text: "" });
    }
    case "usage":
      return patchSession(s, e.session, { usage: maxUsage(s.sessions[e.session].usage, e.usage) });
    case "waiting": {
      // idle_prompt: Claude is at the prompt, so a tool or turn that never reported its end (interrupt) is over
      if (e.idle) { // the session's agents too: a tool whose end never arrived (interrupt, lost hook) would otherwise show 'running' for the 5 min cap; a live tool re-sets it on its next event
        const agents = Object.fromEntries(Object.entries(s.agents).map(([id, ag]) => [id, ag.session === e.session && ag.doing ? { ...ag, doing: undefined, detail: undefined, why: undefined } : ag]));
        s = { ...s, agents };
      }
      // Stored events from before waitKind carry no kind: idle = your turn, otherwise only text naming a permission is one.
      const waitKind = e.kind ?? (e.idle || !/permission/i.test(e.text ?? "") || /\bAskUserQuestion\b/.test(e.text ?? "") ? "turn" : "permission");
      const cur = s.sessions[e.session];
      // A permission wait starts once (a repeated prompt keeps its start); a "turn" wait ends it and is not counted.
      const pw = waitKind === "permission" ? { permWait: { n: 0, totalMs: 0, ...cur.permWait, since: cur.permWait?.since ?? e.t } } : closePerm(cur, e.t);
      return patchSession(s, e.session, { ...pw, waiting: true, waitKind, waitingText: e.text, waitBy: e.agentId, ...(e.idle ? { doing: undefined, detail: undefined, why: undefined, prompt: undefined } : {}) });
    }
  }
}
