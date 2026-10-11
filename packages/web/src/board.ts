// Shift board model: pure (no pixi/DOM) so the kanban grouping and run-summary rules are testable under node.
import type { Task } from "@agent-office/core";

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
