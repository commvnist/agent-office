import type { OfficeState } from "@agent-office/core";

/** Client view of the state: internal `track` removed; with `priv`, free text blanked (structure and tool names stay). */
export function publicState(state: OfficeState, priv: boolean): Omit<OfficeState, "track"> {
  const { track: _, ...rest } = state;
  if (!priv) return rest;
  const sessions = Object.fromEntries(Object.entries(rest.sessions).map(([k, x]) => [k,
    { ...x, prompt: undefined, why: undefined, detail: undefined, waitingText: undefined, lastError: undefined, cwd: undefined, branch: undefined, files: undefined, loopKey: undefined }]));
  const agents = Object.fromEntries(Object.entries(rest.agents).map(([k, a]) => [k,
    { ...a, task: undefined, why: undefined, detail: undefined, lastError: undefined, loopKey: undefined }]));
  return {
    ...rest, sessions, agents,
    log: rest.log.map((i) => ({ ...i, text: "" })),
    tasks: rest.tasks?.map((t) => ({ ...t, text: "" })),
    conflicts: rest.conflicts?.map((c) => ({ ...c, file: "" })),
    pending: Object.fromEntries(Object.entries(rest.pending).map(([k, l]) => [k, l.map((j) => ({ ...j, text: "" }))])),
  };
}
