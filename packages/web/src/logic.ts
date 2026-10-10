// Pure helpers for the DOM chrome (no pixi, no DOM): radar, feed filters, formatting, share-poster model.
import type { OfficeState, Usage } from "@agent-office/core";
import type { ActorInfo, FeedItem, SessionInfo } from "./api.ts";

export const fmtAge = (ms: number) => {
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));
export const fmtTokens = (u?: Usage) => (u ? `in ${k(u.input + u.cacheRead + u.cacheCreate)} · out ${k(u.output)}` : "");

/** Shell-safe `cd` line (single quotes; embedded quotes escaped). */
export const cdCommand = (cwd: string) => `cd '${cwd.replace(/'/g, `'\\''`)}'`;

export type RadarItem = { key: string; kind: "blocked" | "waiting" | "stuck"; id: string; label: string; project: string; since: number };
/**
 * Things that need a human: blocked agents, waiting sessions, sessions mid-turn with no event for `stuckMs`.
 * `since(key, fallback)` returns when the condition was first seen (caller keeps the map).
 */
export function radar(actors: ActorInfo[], state: OfficeState, now: number, since: (key: string, fallback: number) => number, stuckMs = 120_000): RadarItem[] {
  const out: RadarItem[] = [];
  for (const a of actors) {
    if (!a.lead && a.status === "blocked") out.push({ key: `blocked:${a.id}`, kind: "blocked", id: a.id, label: a.label, project: a.project, since: since(`blocked:${a.id}`, now) });
  }
  for (const s of Object.values(state.sessions)) {
    const id = `lead:${s.id}`;
    if (s.waiting) out.push({ key: `waiting:${s.id}`, kind: "waiting", id, label: s.project, project: s.project, since: since(`waiting:${s.id}`, s.lastAt ?? now) });
    else if (s.prompt && s.lastAt && now - s.lastAt > stuckMs) out.push({ key: `stuck:${s.id}`, kind: "stuck", id, label: s.project, project: s.project, since: s.lastAt });
  }
  const rank = { blocked: 0, waiting: 1, stuck: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.since - b.since);
}

/** Tab title: `(2) waiting - Agent Office`; unchanged when nothing needs you. */
export const titleFor = (items: RadarItem[], base = "Agent Office") =>
  items.length ? `(${items.length}) ${items.every((i) => i.kind === "waiting") ? "waiting" : "needs you"} - ${base}` : base;

export type FeedFilter = { session: string; kind: string; agent: string; muted: Set<string> };
export const filterFeed = (items: FeedItem[], f: FeedFilter) =>
  items.filter((i) =>
    (!f.session || i.session === f.session) && (!f.kind || i.kind === f.kind) &&
    (!f.agent || i.from === f.agent || i.to === f.agent) && !f.muted.has(i.from));

export const WHO: Record<string, (f: FeedItem) => string> = {
  prompt: (f) => `You → ${f.to}`,
  done: (f) => `${f.from} finished`,
  report: (f) => `${f.from}${f.outcome === "blocked" ? " BLOCKED" : ""} → ${f.to}`,
  delegate: (f) => `${f.from} → ${f.to}${f.confidence === "guess" ? " (?)" : ""}`,
  conflict: (f) => `${f.from} ↔ ${f.to} (possible conflict)`,
};
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
  const sessions = Object.values(state.sessions);
  const started = sessions.reduce((m, s) => Math.min(m, s.startedAt), now);
  const tasks = state.tasks ?? [];
  return {
    sessions: sessions.length,
    agents: Object.values(state.agents).map((a) => ({ name: a.role === "guest" ? a.agentType.replace(/^.*:/, "") : a.seat?.name ?? a.role, role: a.role })),
    done: tasks.filter((t) => t.status === "done").length,
    blocked: tasks.filter((t) => t.status === "blocked").length,
    minutes: sessions.length ? Math.max(0, Math.round((now - started) / 60_000)) : 0,
  };
}
