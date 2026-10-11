// Shift board model: pure (no pixi/DOM) so the kanban grouping and run-summary rules are testable under node.
import type { Outcome, Task } from "@agent-office/core";

export type Col = Task["status"];
export const COLS: Col[] = ["pending", "running", "done", "blocked"];
export const SUMMARY_MS = 120_000;
export type Memo = { counts: Record<Col, number> | null; at: number };
export type Board = { cols: Record<Col, Task[]>; counts: Record<Col, number>; summary: string };

/** Group tasks by status. When the list empties after a run, keep "N done, M blocked" for SUMMARY_MS (memo carries the last counts). */
export function boardModel(tasks: readonly Task[], memo: Memo, now: number): Board {
  const cols: Record<Col, Task[]> = { pending: [], running: [], done: [], blocked: [] };
  for (const t of tasks) cols[t.status]?.push(t);
  const counts = { pending: cols.pending.length, running: cols.running.length, done: cols.done.length, blocked: cols.blocked.length };
  if (tasks.length) { memo.counts = counts; memo.at = now; return { cols, counts, summary: "" }; }
  const m = memo.counts;
  if (!m || now - memo.at >= SUMMARY_MS) return { cols, counts, summary: "" };
  const parts = [m.done && `${m.done} done`, m.blocked && `${m.blocked} blocked`, m.pending + m.running && `${m.pending + m.running} dropped`].filter(Boolean);
  return { cols, counts, summary: parts.join(", ") };
}

/** Outcome marks and words on the wall ledger: shape, not colour, carries the result. C3: only DONE earns ✓; empty or unknown is "reported". */
export const LEDGER_MARK: Record<string, string> = { done: "✓", partial: "~", blocked: "x" };
const WORD: Record<string, string> = { done: "done", partial: "partly done", blocked: "gave up" };
/**
 * The wall board as an outcomes ledger (critique V1/J3): newest finished delegations first, one line each,
 * "✓ project: result" clipped to `chars`. Falls back to the task text, then to the bare outcome, so a blanked
 * (privacy) result still shows that something finished.
 */
export function ledgerLines(outs: readonly Outcome[] | undefined, max: number, chars: number): string[] {
  return (outs ?? []).slice(0, Math.max(0, max)).map((o) => {
    const what = (o.text || o.task || "").replace(/^\s*(DONE|BLOCKED|PARTIAL)\s*:\s*/i, "").replace(/\s+/g, " ").trim() || (WORD[o.outcome ?? ""] ?? "reported"); // the mark already says the outcome
    const line = `${LEDGER_MARK[o.outcome ?? ""] ?? "·"} ${o.project || o.session.slice(0, 8)}: ${what}`;
    return line.length > chars ? `${line.slice(0, Math.max(1, chars - 1))}…` : line;
  });
}
