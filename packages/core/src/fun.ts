/*
 * Fun engine: derives glanceable delight from reducer state. Pure, deterministic, no I/O, no clock reads
 * (the hour is injectable). Nothing punishes, nothing is tied to viewer behaviour, combos reset quietly,
 * delights are seeded by ids so replays match. No progress, no scores, no history.
 *
 * CONTRACT: the web client calls `stepFun(mem, prev, next, now)` on every applied envelope with its
 * in-process `FunMemory` (prev = state before the envelope, null on first load: baseline, emits nothing),
 * dispatches the returned `out` events (deduped, <= 6), and keeps the new `mem`.
 * FunMemory is ephemeral: never persisted, discarded on reload.
 */
import type { Agent, OfficeState } from "./types.ts";

export type FunEvent = {
  id: string;
  kind: "commentary" | "highlight" | "delight" | "combo";
  text: string;
  t: number;
  actorId?: string;
  session?: string;
  rare?: boolean;
  tier?: 1 | 2 | 3;
};

/** Ephemeral: never persisted. */
export type FunMemory = {
  /** Per agent (or `lead:<session>`): c combo, t tool total seen, e errors seen, ed edits in window, edT window start. <= MAX_AGENTS. */
  agents: Record<string, { c: number; t: number; e: number; ed: number; edT: number }>;
  /** Per live session, dropped when it finishes. */
  sessions: Record<string, { peak: number; tools: number }>;
  /** Last interaction-log id consumed. */
  cursor: number;
  /** Recent event ids (ring, <= MAX_SEEN). */
  seen: string[];
  cmtAt: number | null;
  cmt: Record<string, number>;
};

export const MAX_AGENTS = 64;
export const MAX_SEEN = 200;
const MAX_OUT = 6;
const COMBOS = [5, 10, 20] as const;
const WRITE = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export const emptyFun = (): FunMemory => ({ agents: {}, sessions: {}, cursor: 0, seen: [], cmtAt: null, cmt: {} });

const PRIORITY: FunEvent["kind"][] = ["highlight", "combo", "delight", "commentary"];

/** Deterministic 0..1 from a string (FNV-1a). */
export function rarity(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
const DELIGHTS: [string, string][] = [["confetti-gold", "Golden confetti!"], ["cat-on-couch", "A cat wandered onto the couch."], ["rainbow", "A rainbow appears."], ["disco-mini", "Mini disco break!"]];
export const DELIGHT_RARITY = 0.04;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const dur = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`);
const nameOf = (a: Agent) => a.seat?.name ?? a.agentType ?? a.id;
const sum = (r?: Record<string, number>) => Object.values(r ?? {}).reduce((x, y) => x + y, 0);
const seatedIn = (s: OfficeState) => Object.values(s.agents).filter((a) => a.seat).length;
const lastId = (s: OfficeState) => s.log.length ? s.log[s.log.length - 1].id : 0;

export function stepFun(mem: FunMemory, prev: OfficeState | null, next: OfficeState, now: number): { mem: FunMemory; out: FunEvent[] } {
  const m: FunMemory = structuredClone(mem);
  const ents = (s: OfficeState) => [
    ...Object.values(s.agents).map((a) => ({ key: a.id, session: a.session, name: nameOf(a), tools: a.toolCount ?? 0, errs: a.errors ?? 0, doing: a.doing })),
    ...Object.values(s.sessions).map((x) => ({ key: `lead:${x.id}`, session: x.id, name: "Lead", tools: sum(x.toolCounts), errs: x.errors ?? 0, doing: x.doing })),
  ];
  const cur = ents(next);
  const newSess = (): FunMemory["sessions"][string] => ({ peak: 0, tools: 0 });

  if (!prev) { // baseline: adopt what is already there without celebrating it
    for (const e of cur) m.agents[e.key] = { c: 0, t: e.tools, e: e.errs, ed: 0, edT: now };
    for (const id of Object.keys(next.sessions)) m.sessions[id] ??= newSess();
    m.cursor = lastId(next);
    return { mem: m, out: [] };
  }

  const out: FunEvent[] = [];
  const push = (kind: FunEvent["kind"], key: string, text: string, x: Partial<FunEvent> = {}): boolean => {
    const id = `${kind}:${key}`;
    if (m.seen.includes(id)) return false;
    m.seen = [...m.seen, id].slice(-MAX_SEEN);
    out.push({ id, kind, text, t: now, ...x });
    return true;
  };
  const cands: { tpl: string; actor: string; text: string; session?: string }[] = [];

  // Per-entity diff: combo, edits, errors.
  for (const e of cur) {
    const s = (m.agents[e.key] ??= { c: 0, t: 0, e: 0, ed: 0, edT: now });
    const d = e.tools - s.t, de = e.errs - s.e;
    s.t = e.tools; s.e = e.errs;
    const st = (m.sessions[e.session] ??= newSess());
    // A session's toolCounts include every agent's calls, so it alone feeds the session total, and the lead never
    // gets combos or "on a roll" lines for work its agents did.
    const isLead = e.key.startsWith("lead:");
    if (d > 0 && isLead) st.tools += d;
    if (isLead) continue;
    if (de > 0) s.c = 0; // silent reset, no event
    const before = s.c;
    s.c += Math.max(0, d - Math.max(de, 0));
    const crossed = COMBOS.filter((th) => before < th && s.c >= th);
    for (const th of crossed) push("combo", `${e.key}:${th}:${e.tools}`, `${e.name}: ${th} tool calls in a row, no errors`, { actorId: e.key, session: e.session, tier: (COMBOS.indexOf(th) + 1) as 1 | 2 | 3 });
    // shortcut: any tool burst while the current tool is a write counts as edits, so batched steps over-count; track per-call tool names if that matters.
    if (d > 0 && e.doing && WRITE.has(e.doing)) {
      if (now - s.edT > 60_000 || s.ed === 0) { s.ed = 0; s.edT = now; }
      s.ed += d;
      if (s.ed >= 5) {
        cands.push({ tpl: "roll", actor: e.key, session: e.session, text: `${e.name} is on a roll: ${s.ed} edits in ${Math.max(1, Math.round((now - s.edT) / 1000))}s` });
        s.ed = 0;
      }
    }
  }

  // Sessions: peak agents (for the "shipped" line).
  for (const x of Object.values(next.sessions)) {
    const st = (m.sessions[x.id] ??= newSess());
    st.peak = Math.max(st.peak, Object.values(next.agents).filter((a) => a.session === x.id).length);
  }
  const seated = seatedIn(next);
  const ps = seatedIn(prev);
  for (const th of [4, 8]) if (ps < th && seated >= th) cands.push({ tpl: `hands${th}`, actor: "office", text: `All hands: ${seated} agents working` });

  // New interactions: reports (outcomes) and finished turns.
  if (lastId(next) < m.cursor) m.cursor = lastId(next);
  const fresh = next.log.filter((i) => i.id > m.cursor);
  m.cursor = lastId(next);
  const finishing = new Set(Object.keys(prev.sessions).filter((id) => !next.sessions[id]));
  for (const i of fresh) {
    if (i.kind === "done") finishing.add(i.session);
    if (i.kind !== "report" || (i.outcome !== "done" && i.outcome !== "blocked" && i.outcome !== "partial")) continue;
    const a = prev.agents[i.from];
    const who = a ? nameOf(a) : i.from;
    const task = clip((a?.task ?? i.text ?? "").trim() || "a task", 80);
    push("highlight", `${i.session}:${i.id}`, `${who} ${i.outcome}: ${task}${i.durationMs !== undefined ? ` (${dur(i.durationMs)})` : ""}`, { actorId: i.from, session: i.session });
    if (i.outcome !== "done") continue;
    const seed = `${i.session}|${i.from}|${i.stoppedAt ?? i.t}`;
    const r = rarity(seed);
    if (r < DELIGHT_RARITY) {
      const [id, text] = DELIGHTS[Math.floor((r / DELIGHT_RARITY) * DELIGHTS.length) % DELIGHTS.length];
      push("delight", `${id}:${seed}`, text, { actorId: i.from, session: i.session, rare: true });
    }
  }
  for (const id of finishing) {
    const st = m.sessions[id];
    if (!st) continue;
    if (st.peak > 0 && st.tools > 0) cands.push({ tpl: "shipped", actor: id, session: id, text: `${(next.sessions[id] ?? prev.sessions[id])?.project ?? id} shipped: ${st.peak} agents, ${st.tools} tool calls` });
    delete m.sessions[id];
  }

  // Commentary: one per 6 s, no template+actor repeat within 60 s.
  if ((m.cmtAt === null || now - m.cmtAt >= 6000)) {
    for (const c of cands) {
      const k = `${c.tpl}|${c.actor}`;
      if (m.cmt[k] !== undefined && now - m.cmt[k] < 60_000) continue;
      if (!push("commentary", `${k}:${now}`, c.text, { actorId: c.actor === "office" ? undefined : c.actor, session: c.session })) continue;
      m.cmtAt = now;
      m.cmt[k] = now;
      break;
    }
  }
  m.cmt = Object.fromEntries(Object.entries(m.cmt).filter(([, t]) => now - t < 60_000).slice(-50));

  // Bound memory: drop vanished entities, cap sessions.
  const live = new Set(cur.map((e) => e.key));
  m.agents = Object.fromEntries(Object.entries(m.agents).filter(([k]) => live.has(k)).slice(-MAX_AGENTS));
  m.sessions = Object.fromEntries(Object.entries(m.sessions).slice(-16));
  out.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  return { mem: m, out: out.slice(0, MAX_OUT) };
}
