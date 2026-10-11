import { deskPos, MAX_DESKS } from "./layout.ts";
import { crewName } from "./names.ts";
import { metaSummary, stripMeta } from "./clean.ts";
import type { Agent, Interaction, OfficeConfig, OfficeEvent, OfficeState, Seat, Session, Task, Usage } from "./types.ts";

export const SCHEMA_VERSION = 1;
export const LOG_MAX = 40;
export const LIMITS = {
  sessions: 50, agents: 200, pending: 100,
  logPerSession: 30, tasks: 30, conflicts: 20, track: 100,
  pendingTtlMs: 60_000, // a SubagentStart follows its delegation within moments
  conflictWindowMs: 15_000,
};
export const emptyState = (): OfficeState => ({
  sessions: {}, agents: {}, queue: [], log: [], nextId: 1, pending: {},
  tasks: [], conflicts: [], nextTask: 1, track: { seen: [], starts: {}, touched: {} },
});

/** Ids become object keys and pending-key parts: conservative charset, no Object.prototype names, no `lead:` spoofing. */
export const safeId = (v: unknown): v is string =>
  typeof v === "string" && /^[\w.:-]{1,64}$/.test(v) && !(v in Object.prototype) && !v.startsWith("lead:");

export const leadId = (session: string) => `lead:${session}`;
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
  const firstEmpty = podUse.findIndex((n) => n === 0);
  for (let i = 0; i < MAX_DESKS; i++) {
    if (taken.has(i)) continue;
    if (firstEmpty >= 0 && Math.floor(i / 4) > firstEmpty && podUse[Math.floor(i / 4)] === 0) continue; // never an empty pod past the first
    const pod = Math.floor(i / 4), use = podUse[pod];
    // Tiers dominate every other term: own pod, then a fully empty pod, then someone else's.
    const tier = session !== undefined && owner.get(pod) === session ? 0 : use === 0 ? 1 : 2;
    const cost = tier * 1000 + (mates.length ? meanDist(i, mates) : use * 100) + (peers.length ? 0.4 * meanDist(i, peers) : 0) + (use >= 3 ? 0.5 : 0);
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

/** Remove a session and everything of its. Pass cfg to seat queued agents of other sessions. */
function endSession(cfg: OfficeConfig | undefined, s: OfficeState, session: string, t: number): OfficeState {
  const agents = Object.fromEntries(Object.entries(s.agents).filter(([, a]) => a.session !== session));
  const { [session]: _, ...sessions } = s.sessions;
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
 * End sessions (and their agents) with no event for `ttlMs`. Pure. Pass cfg to promote queued agents of surviving sessions.
 * shortcut: only whole sessions are reaped, an agent silent inside a live session stays, add per-agent TTL if SubagentStop loss shows up.
 */
export function sweep(state: OfficeState, now: number, ttlMs: number, cfg?: OfficeConfig) {
  let s = state;
  if (!Number.isFinite(now)) return { state: s, removed: { sessions: [] as string[], agents: [] as string[] } }; // a bad clock must not reap everything
  const removed = { sessions: [] as string[], agents: [] as string[] };
  for (const x of Object.values(state.sessions)) {
    if (now - (x.lastAt ?? x.startedAt) <= ttlMs) continue;
    removed.sessions.push(x.id);
    removed.agents.push(...Object.values(s.agents).filter((a) => a.session === x.id).map((a) => a.id));
    s = endSession(cfg, norm(s), x.id, now);
  }
  return { state: s, removed };
}

const norm = (s: OfficeState): OfficeState =>
  s.track && s.tasks && s.conflicts && s.nextTask ? s : { ...s, tasks: s.tasks ?? [], conflicts: s.conflicts ?? [], nextTask: s.nextTask ?? 1, track: s.track ?? { seen: [], starts: {}, touched: {} } };

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
    case "agent_start": {
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
        startedAt: e.t, toolCount: 0, confidence, ...(seat ? { seatedAt: e.t, queueWaitMs: 0 } : {}),
      };
      const pending = { ...s.pending, [key]: rest };
      if (!rest.length) delete pending[key];
      let n: OfficeState = { ...s, agents: { ...s.agents, [e.agentId]: agent }, queue: seat ? s.queue : [...s.queue, e.agentId], pending };
      n = patchTask(n, job?.task, { status: "running", agentId: e.agentId, owner: seat?.name ?? e.agentType, startedAt: e.t });
      return say(n, { t: e.t, kind: "delegate", session: e.session, from: parent, to: e.agentId, text: job?.text ?? "", confidence });
    }
    case "agent_stop": {
      const a = s.agents[e.agentId];
      const { [e.agentId]: _, ...agents } = s.agents;
      s = { ...s, track: { ...s.track!, seen: [...s.track!.seen, `${e.session}|stopped|${e.agentId}`].slice(-LIMITS.track) } };
      let n = promote(cfg, { ...s, agents, queue: s.queue.filter((id) => id !== e.agentId) }, e.t);
      if (a) {
        const outcome = outcomeOf(e.message);
        const task = n.tasks!.find((x) => x.agentId === a.id)?.id;
        n = patchTask(n, task, { status: outcome === "blocked" ? "blocked" : "done", endedAt: e.t });
        n = say(n, {
          t: e.t, kind: "report", session: e.session, from: a.id, to: a.parent, text: e.message ?? "",
          outcome, stoppedAt: e.t, durationMs: a.startedAt === undefined ? undefined : Math.max(0, e.t - a.startedAt),
          toolCount: a.toolCount, queueWaitMs: a.queueWaitMs, usage: e.usage,
        });
      }
      return n;
    }
    case "tool": {
      const a = e.agentId ? s.agents[e.agentId] : undefined;
      const sess = s.sessions[e.session];
      const agents = a ? { ...s.agents, [a.id]: { ...a, doing: e.tool, detail: e.detail, why: e.why, busyAt: e.t, toolCount: (a.toolCount ?? 0) + 1 } } : s.agents;
      // No agent id means the lead itself is working.
      const sessions = { ...s.sessions, [sess.id]: {
        ...sess, waiting: false, toolCounts: bump(sess.toolCounts, e.tool.slice(0, KEY_MAX), TOOLS_MAX),
        ...(e.detail && WRITE_TOOLS.has(e.tool) ? { files: bump(sess.files, e.detail.slice(0, KEY_MAX), FILES_MAX) } : {}),
        ...(a ? {} : { doing: e.tool, detail: e.detail, why: e.why, busyAt: e.t }),
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
      let n: OfficeState = a ? { ...s, agents: { ...s.agents, [a.id]: { ...a, ...patch(a) } } } : patchSession(s, e.session, patch(sess));
      if (k) { const { [k]: _, ...starts } = n.track!.starts; n = { ...n, track: { ...n.track!, starts } }; }
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
        const n = patchSession(s, e.session, { waiting: false });
        return sum ? say(n, { t: e.t, kind: "message", session: e.session, from: leadId(e.session), to: "user", text: sum.slice(0, 140) }) : n;
      }
      return say(patchSession(s, e.session, { prompt: text, waiting: false }), { t: e.t, kind: "prompt", session: e.session, from: "user", to: leadId(e.session), text });
    }
    case "turn_end":
      return say(patchSession(s, e.session, { doing: undefined, detail: undefined, why: undefined, prompt: undefined, ...(e.usage ? { usage: e.usage } : {}) }), { t: e.t, kind: "done", session: e.session, from: leadId(e.session), to: "user", text: "" });
    case "waiting":
      // idle_prompt: Claude is at the prompt, so a tool or turn that never reported its end (interrupt) is over
      if (e.idle) { // the session's agents too: a tool whose end never arrived (interrupt, lost hook) would otherwise show 'running' for the 5 min cap; a live tool re-sets it on its next event
        const agents = Object.fromEntries(Object.entries(s.agents).map(([id, ag]) => [id, ag.session === e.session && ag.doing ? { ...ag, doing: undefined, detail: undefined, why: undefined } : ag]));
        s = { ...s, agents };
      }
      return patchSession(s, e.session, { waiting: true, waitingText: e.text, ...(e.idle ? { doing: undefined, detail: undefined, why: undefined, prompt: undefined } : {}) });
  }
}
