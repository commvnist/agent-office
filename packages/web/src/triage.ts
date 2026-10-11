// Pure helpers for the experience layer (no DOM): one status vocabulary for every DOM surface, the triage card's
// next step and delegation tree, word-boundary clipping, the "Recently done" rows.
import type { Session } from "@agent-office/core";
import { STATUS, STATUS_ORDER, type StatusKey } from "./theme.ts";

type Sess = { waiting?: boolean; waitKind?: string; waitingText?: string; prompt?: string };
type Act = { id: string; label: string; role: string; lead: boolean; status: string; chain: string[]; children: string[] };

/** The daemon's waitKind as a STATUS key (a question is your turn); older daemons send only the text, so a mention of permission decides. */
export const waitKindOf = (s?: Sess): "permission" | "turn" => s?.waitKind ? (s.waitKind === "permission" ? "permission" : "turn") : /permission/i.test(s?.waitingText ?? "") && !isQuestion(s) ? "permission" : "turn";
/** S8: an open AskUserQuestion: waitKind "question", or (older daemons) a turn wait while the prompt is still running, or its tool named. */
export const isQuestion = (s?: Sess) => !!s?.waiting && (s.waitKind === "question" || /\bAskUserQuestion\b/.test(s.waitingText ?? "") || (s.waitKind === "turn" && !!s.prompt));

/** Actor status (+ its session, for a waiting lead) -> the shared STATUS key. queued counts as idle: it is not doing anything yet. */
export function statusKey(status: string, sess?: Sess): StatusKey {
  if (status === "blocked") return "blocked";
  if (status === "waiting") return waitKindOf(sess);
  return status === "working" || status === "thinking" ? "working" : "idle";
}

/** G1: one session's aggregate from its agents' status keys; worst follows STATUS_ORDER (the radar's ranking). */
export function sessionAgg(keys: StatusKey[]) {
  const n = (f: (k: StatusKey) => boolean) => keys.filter(f).length;
  return { agents: keys.length, working: n((k) => k === "working"), waiting: n((k) => k === "permission" || k === "turn"), blocked: n((k) => k === "blocked"),
    worst: STATUS_ORDER.find((k) => keys.includes(k)) ?? "idle" };
}
/** "2 working · 1 waiting": the non-zero counts only, "" when everyone is idle. */
export const aggLine = (a: ReturnType<typeof sessionAgg>) =>
  [a.working && `${a.working} working`, a.waiting && `${a.waiting} waiting`, a.blocked && `${a.blocked} gave up`].filter(Boolean).join(" · ");

/** A NEEDS YOU row that is not a STATUS (a session silent mid-turn). */
export const STUCK = { color: STATUS.idle.color, glyph: "…", label: "no activity" } as const;
export type Look = { color: string; glyph: string; label: string };
export const look = (k: StatusKey | "stuck"): Look => (k === "stuck" ? STUCK : STATUS[k]);
/** "! needs permission": the glyph and the word, never colour alone. */
export const statusWord = (k: StatusKey | "stuck") => { const l = look(k); return l.glyph ? `${l.glyph} ${l.label}` : l.label; };

/** Cut at a word boundary (never mid-word unless one word is longer than most of the budget). Full text belongs in a title. */
export function clipWords(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1), sp = cut.lastIndexOf(" ");
  return (sp > n * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,.;:-]+$/, "") + "…";
}
/** A report's own DONE:/BLOCKED:/PARTIAL: prefix: the status word already says it. */
export const dropOutcome = (s: string) => s.replace(/^\s*(?:DONE|BLOCKED|PARTIAL)\b:?\s*/i, "");

/** What the human does next, in plain words. */
export function nextStep(k: StatusKey | "stuck" | "question", project: string, lead?: string): string {
  if (k === "question") return `Answer it in the ${project} terminal.`;
  if (k === "permission") return `Approve or deny it in the ${project} terminal.`;
  if (k === "turn") return `Claude finished its turn: reply in the ${project} terminal.`;
  if (k === "blocked") return `${lead ?? "Its lead"} has the report and may handle it; if not, answer in the ${project} terminal.`;
  if (k === "stuck") return `No events for a while: check the ${project} terminal.`;
  return k === "working" ? "Nothing to do: it is working." : "Nothing to do.";
}

/** Delegation tree around `id`: ancestors from the lead down, then its helpers (only those still on the floor). */
export function tree<A extends Act>(actors: readonly A[], id: string): { up: A[]; self?: A; down: A[] } {
  const by = new Map(actors.map((a) => [a.id, a]));
  const self = by.get(id);
  if (!self) return { up: [], down: [] };
  const got = (ids: string[]) => ids.map((x) => by.get(x)).filter((a): a is A => !!a);
  return { up: got(self.chain).reverse(), self, down: got(self.children) };
}

export type DoneRow = { key: string; agentId: string; session: string; name: string; project: string; outcome: string; text: string; task: string; t: number };
type Outcome = { session: string; project?: string; agentId: string; lead?: boolean; name?: string; role?: string; outcome?: string; text: string; task?: string; t: number };
type Report = { kind: string; fromId?: string; from: string; text: string; t: number; outcome?: string; session?: string };
/** state.outcomes when the daemon sends them (newest first), else the report items still in the feed. */
export function doneRows(outcomes: readonly Outcome[] | undefined, feed: readonly Report[], projectOf: (sid: string) => string, max = 8): DoneRow[] {
  // a lead's own turn (C4) is named by its project
  if (outcomes) return outcomes.slice(0, max).map((o) => ({ key: `${o.agentId}@${o.t}`, agentId: o.agentId, session: o.session, name: (o.lead ? o.project : o.name ?? o.role) ?? o.agentId, project: o.project ?? projectOf(o.session), outcome: o.outcome ?? "", text: dropOutcome(o.text ?? ""), task: o.task ?? "", t: o.t }));
  return feed.filter((f) => f.kind === "report").slice(0, max).map((f) => ({ key: `${f.fromId}@${f.t}`, agentId: f.fromId ?? "", session: f.session ?? "", name: f.from, project: projectOf(f.session ?? ""), outcome: f.outcome ?? "", text: dropOutcome(f.text), task: "", t: f.t }));
}
/** Outcome glyph and word: done is quiet (working green), gave up uses the blocked status, partial stays neutral; C3: an
 * empty or unprefixed report is never "done": a neutral "reported". */
export const outcomeLook = (o: string | undefined): Look =>
  o === "blocked" ? STATUS.blocked : o === "done" ? { color: STATUS.working.color, glyph: "✓", label: "done" } : o === "partial" ? { color: STATUS.idle.color, glyph: "~", label: "partly done" } : { color: STATUS.idle.color, glyph: "·", label: "reported" };

// ---- derived signals (contract 1); absent from older daemons ----
type PermWait = NonNullable<Session["permWait"]>;
type ToolStat = NonNullable<Session["toolStats"]>[string];
/** "2 permission waits · avg 14s · waiting 40s now"; "" when there were none and none is open. */
export function permLine(p: PermWait | undefined, now: number, fmt: (ms: number) => string): string {
  if (!p || (!p.n && !p.since)) return "";
  const parts = p.n ? [`${p.n} permission wait${p.n === 1 ? "" : "s"}`] : [];
  if (p.n) parts.push(`avg ${fmt(p.totalMs / p.n)}`);
  // whole minutes only: the text (and so the card that shows it) changes at most once a minute, not every render
  const age = p.since ? Math.floor(Math.max(0, now - p.since) / 60_000) * 60_000 : 0;
  if (p.since) parts.push(`${p.n ? "" : "permission: "}${age ? `waiting ${fmt(age)}` : "waiting now"}`);
  return parts.join(" · ");
}
/** The busiest tools first (by calls, then name), at most `max`. */
export const topTools = (stats: Record<string, ToolStat> | undefined, max = 5) =>
  Object.entries(stats ?? {}).sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, max).map(([tool, s]) => ({ tool, ...s }));
