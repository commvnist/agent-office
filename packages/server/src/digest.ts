import { outcomeOf, type OfficeEvent } from "@agent-office/core";

export type DaySummary = {
  day: string; sessions: number; agents: Record<string, number>;
  outcomes: Record<"done" | "blocked" | "partial" | "empty" | "other", number>;
  tokens: number; errors: number; hours: number;
};

const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * Stored events -> one summary per local day (oldest first): sessions seen, agents started by type, report outcomes,
 * tokens (turn_end + agent_stop usage), failed tools, and distinct hours with activity. Counts only, no free text.
 * shortcut: tokens sum every usage record, which counts a lead's cumulative transcript total once per turn; switch to deltas if totals look inflated.
 */
export function summarize(events: OfficeEvent[]): DaySummary[] {
  const days = new Map<string, DaySummary & { s: Set<string>; h: Set<number> }>();
  for (const e of events) {
    const k = day(e.t);
    let d = days.get(k);
    if (!d) days.set(k, d = { day: k, sessions: 0, agents: {}, outcomes: { done: 0, blocked: 0, partial: 0, empty: 0, other: 0 }, tokens: 0, errors: 0, hours: 0, s: new Set(), h: new Set() });
    d.s.add(e.session); d.h.add(new Date(e.t).getHours());
    if (e.type === "agent_start") { const r = e.agentType.split(":").pop()!; d.agents[r] = (d.agents[r] ?? 0) + 1; }
    else if (e.type === "agent_stop") d.outcomes[outcomeOf(e.message) ?? "other"]++;
    else if (e.type === "tool_end" && !e.ok) d.errors++;
    if ((e.type === "turn_end" || e.type === "agent_stop") && e.usage) d.tokens += e.usage.input + e.usage.output + e.usage.cacheCreate;
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map(({ s, h, ...d }) => ({ ...d, sessions: s.size, hours: h.size }));
}

export function toMarkdown(rows: DaySummary[]): string {
  const head = "| day | sessions | agents | done | blocked | partial | tokens | errors | active hours |\n|---|---|---|---|---|---|---|---|---|";
  const line = (r: DaySummary) => `| ${r.day} | ${r.sessions} | ${Object.values(r.agents).reduce((a, b) => a + b, 0)} | ${r.outcomes.done} | ${r.outcomes.blocked} | ${r.outcomes.partial} | ${r.tokens} | ${r.errors} | ${r.hours} |`;
  const roles = rows.flatMap((r) => Object.entries(r.agents)).reduce((m, [k, n]) => m.set(k, (m.get(k) ?? 0) + n), new Map<string, number>());
  return `# Agent Office digest\n\n${head}\n${rows.map(line).join("\n")}\n\nAgents by type: ${[...roles].map(([k, n]) => `${k} ${n}`).join(", ") || "none"}\n`;
}

const WRITES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const top = (m: Map<string, number>, n: number) =>
  [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([name, count]) => ({ name, count }));
const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/** Whole-window totals from the same events: most used tools, most edited file labels, failed tools per agent type. Tool names and paths only. */
export function totals(events: OfficeEvent[], n = 8) {
  const tools = new Map<string, number>(), files = new Map<string, number>(), errors = new Map<string, number>(), types = new Map<string, string>();
  for (const e of events) {
    if (e.type === "agent_start") types.set(e.agentId, e.agentType.split(":").pop()!);
    else if (e.type === "tool") { inc(tools, e.tool); if (e.detail && WRITES.has(e.tool)) inc(files, e.detail); }
    else if (e.type === "tool_end" && !e.ok) inc(errors, e.agentId ? (types.get(e.agentId) ?? e.agentId) : "lead");
  }
  return { topTools: top(tools, n), topFiles: top(files, n), errorsByAgent: top(errors, n) };
}

export function totalsMarkdown(t: ReturnType<typeof totals>): string {
  const sec = (h: string, l: { name: string; count: number }[]) => `\n## ${h}\n\n${l.map((x) => `- ${x.name}: ${x.count}`).join("\n") || "none"}\n`;
  return sec("Top tools", t.topTools) + sec("Top files", t.topFiles) + sec("Errors by agent", t.errorsByAgent);
}
