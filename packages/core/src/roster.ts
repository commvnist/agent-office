import type { OfficeConfig, OfficeState } from "./types.ts";

/** Context for the session lead: who works here and how many can run in parallel. */
export function leadRoster(cfg: OfficeConfig): string {
  const lines = Object.entries(cfg.roles).map(([, r]) => {
    const core = r.names?.length ? r.names.slice(0, r.count).join(", ") : `${r.count}`;
    const temps = r.overflow?.max ? `; up to ${r.overflow.max} temps may join when busy` : "";
    return `- ${r.agent}: ${r.count} on the core team (${core})${temps}`;
  });
  const mode = cfg.parallelism ?? "auto";
  // Neutral by default: the office describes who is available, it never asks for more delegation (V2).
  const head = "An office view is watching this session; subagents you start appear in it. Delegating is optional.";
  const nudge = {
    off: [],
    auto: [
      "Parallelism: your call. Doing the work yourself is fine; if you do start independent subagents, starting them in one message lets them run in parallel.",
    ],
    aggressive: [
      "Parallelism: aggressive. Split work into independent pieces and launch all independent subagents in ONE message so they run in parallel; spread same-role work across the seats below instead of one big task. Give each a self-contained brief with the files it owns.",
    ],
  }[mode] ?? [];
  return [
    head,
    ...nudge,
    "Coworkers (type: core team, parallel capacity):",
    ...lines,
    "See the office-delegation skill for the full playbook.",
  ].join("\n");
}

/** Context for a freshly started subagent: who it is and who it works with. */
export function introFor(cfg: OfficeConfig, state: OfficeState, agentId: string): string | null {
  const a = state.agents[agentId];
  if (!a) return null;
  const me = a.seat ? `${a.seat.name} (${a.seat.kind === "permanent" ? "core team" : "temp"})` : "a temp waiting for a seat";
  const peers = Object.values(state.agents)
    .filter((o) => o.id !== a.id && o.seat)
    .map((o) => `${o.seat!.name} (${o.role})${o.task ? `: ${clip(o.task)}` : ""}`);
  const team = Object.values(cfg.roles).map((r) => r.agent).join(", ");
  return [
    `You are ${me}, role: ${a.role}. Office roles: ${team}.`,
    a.task ? `Your task: ${clip(a.task, 300)}` : "",
    peers.length ? `Working in parallel: ${peers.join("; ")}.` : "",
    "Report: your final message starts with one line `DONE: ...`, `BLOCKED: ...` or `PARTIAL: ...` (max 90 chars, plain text).",
  ].filter(Boolean).join("\n");
}

// Task text is untrusted and shown to other agents: flatten whitespace and cap length.
function clip(t: string, n = 80): string {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
