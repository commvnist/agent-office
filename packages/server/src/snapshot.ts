import type { OfficeState } from "@agent-office/core";

/** Client view of the state: internal `track` removed; with `priv`, free text blanked (structure and tool names stay). */
type Public = Omit<OfficeState, "track">;
export function publicState(state: OfficeState, priv: boolean): Public {
  const { track: _, ...rest } = state;
  if (!priv) return rest;
  const sessions = Object.fromEntries(Object.entries(rest.sessions).map(([k, x]) => [k,
    { ...x, prompt: undefined, why: undefined, detail: undefined, waitingText: undefined, lastError: undefined, cwd: undefined, branch: undefined, files: undefined }]));
  const agents = Object.fromEntries(Object.entries(rest.agents).map(([k, a]) => [k,
    { ...a, task: undefined, report: undefined, why: undefined, detail: undefined, lastError: undefined }]));
  return {
    ...rest, sessions, agents,
    log: rest.log.map((i) => ({ ...i, text: "" })),
    tasks: rest.tasks?.map((t) => ({ ...t, text: "" })),
    outcomes: rest.outcomes?.map((o) => ({ ...o, text: "", task: undefined })),
    conflicts: rest.conflicts?.map((c) => ({ ...c, file: "" })),
    pending: Object.fromEntries(Object.entries(rest.pending).map(([k, l]) => [k, l.map((j) => ({ ...j, text: "" }))])),
  };
}

/**
 * Envelope JSON of at most `max` characters. Too big: trim the least important lists (log, outcomes, tasks, conflicts,
 * per-session file counts), then empty them, and mark the envelope `degraded` with a reason. The update is never dropped.
 */
export function fitEnvelope(head: Record<string, unknown>, st: Public, max: number): string {
  const full = JSON.stringify({ ...head, state: st });
  if (full.length <= max) return full;
  const reason = `state is ${Math.round(full.length / 1024)} KB, over the ${Math.round(max / 1024)} KB cap: activity log, outcomes, tasks and file counts are trimmed`;
  const sessions = Object.fromEntries(Object.entries(st.sessions).map(([k, x]) => [k, { ...x, files: undefined }]));
  const lite = { ...st, sessions, log: st.log.slice(-10), outcomes: st.outcomes?.slice(0, 5), tasks: st.tasks?.slice(-10), conflicts: [] };
  const a = JSON.stringify({ ...head, degraded: true, degradedReason: reason, state: lite });
  if (a.length <= max) return a;
  return JSON.stringify({ ...head, degraded: true, degradedReason: reason, state: { ...lite, log: [], outcomes: [], tasks: [], pending: {} } });
}
