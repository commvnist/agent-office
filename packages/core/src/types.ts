export type RoleConfig = {
  /** Subagent type (agents/*.md name) that maps to this role. */
  agent: string;
  /** Core-team slots (named seats); further workers of this role are temps. Does not limit where or how many may sit. */
  count: number;
  names?: string[];
  /** Temp naming ("Temp 1", ...) once the core team is full; `max` is also a hint for the initial office size. */
  overflow?: { max: number; names?: string[] };
};

export type OfficeConfig = {
  roles: Record<string, RoleConfig>;
  /** "office" (default): SessionStart/SubagentStart inject the roster, identity and report format, and enforceSeats may deny spawns. "observe": nothing is injected and nothing is denied. */
  protocol?: "office" | "observe";
  /** Parallelism wording in the lead's roster (office protocol only): "off" = none, "auto" = neutral note (default), "aggressive" = pushes fan-out. */
  parallelism?: "off" | "auto" | "aggressive";
  /** Deny Agent-tool spawns when no desk is free (office at MAX_DESKS) instead of queueing visually. */
  enforceSeats?: boolean;
  /** Hide prompt/tool text in the stream (tool names and structure only); also strips it before events.jsonl and skips transcript reads. */
  privacy?: boolean;
  /** Hours of stored events kept on disk (1-2160, default 168); older day files (and legacy events.jsonl lines) are deleted at boot and hourly. */
  historyHours?: number;
  /** Hours of stored free text kept (1-2160, default = historyHours); older `.text.jsonl` day files are deleted earlier, the timeline stays. */
  textHours?: number;
  /** Ignored: there is one built-in look. Still parsed so old config files keep working. */
  theme?: string;
  /** Minutes of silence (1-1440, default 45) before an idle session is swept. */
  idleTtlMinutes?: number;
  /** Lead-session token total (see usageTotalOf) at which the client raises a spend alarm; 0 or absent = off. Validated 0..1e9. */
  spendAlarmTokens?: number;
  /** Read-only viewer on the local network (HTTPS, paired devices). `enabled` starts it with the daemon; `port` default 4748 (0 = any);
   *  `address` must be private (default: the first private IPv4 of this machine); `stopAfterHours` 1-168, default 8. */
  share?: { enabled?: boolean; port?: number; address?: string; stopAfterHours?: number };
};

/*
 * Web contract (derived from hook tool events only; observer-only, read-side):
 * - Session.files: edit counts per file path (Edit/Write/MultiEdit/NotebookEdit), <= 50 paths. Blanked (undefined) in privacy mode.
 * - Session.toolCounts: calls per tool name, <= 24 names.
 * - Helpers from core: hotFiles(state, session?, limit=8) -> {path,count,session}[]; topTools(state, n=5) -> {tool,count}[]; usageTotalOf(session) -> number.
 * - OfficeConfig.spendAlarmTokens: compare usageTotalOf(session) against it; 0/absent = off.
 */

/** Summed assistant token usage from a transcript (local telemetry only). */
export type Usage = { input: number; output: number; cacheRead: number; cacheCreate: number };

/** Fields every event may carry; `seq` is the forwarder-stamped per-session sequence number (payload `ao_seq`). */
/** `cwd`: the session's folder, on every hook event (the daemon keeps it only while the session has none, so a recovered session gets its name). */
type Base = { seq?: number; cwd?: string };

/** Normalized events. The server adapter is the only place that knows Claude Code's hook shape. */
export type OfficeEvent = Base &
  (
    | { type: "session_start"; session: string; project: string; cwd?: string; branch?: string; source?: "startup" | "resume" | "compact" | "clear"; t: number }
    | { type: "session_end"; session: string; t: number }
    | { type: "agent_start"; session: string; agentId: string; agentType: string; t: number }
    /** `outcome` is stamped by the daemon on the stored line (from the report) so a replay without text keeps it. */
    | { type: "agent_stop"; session: string; agentId: string; message?: string; usage?: Usage; outcome?: Interaction["outcome"]; t: number }
    /** `id` = tool_use_id; `why` = plain-English reason. */
    | { type: "tool"; session: string; agentId?: string; tool: string; detail?: string; why?: string; id?: string; t: number; /** a subagent's hand-back report (SubagentHandback input) */ message?: string }
    /** PostToolUse / PostToolUseFailure. */
    | { type: "tool_end"; session: string; agentId?: string; tool: string; ok: boolean; error?: string; id?: string; t: number }
    /** The lead (or an agent) is about to spawn `agentType` with this task text. */
    | { type: "delegate"; session: string; from?: string; agentType: string; text: string; id?: string; t: number }
    /** One agent talking to another (e.g. SendMessage). `to` is an agent id or a name hint. */
    | { type: "message"; session: string; from?: string; to: string; text: string; id?: string; t: number }
    | { type: "prompt"; session: string; text: string; t: number }
    /** `message`: first line of the lead's last message (Stop `last_assistant_message`; absent in privacy). `outcome` is stamped by the daemon on the stored line, as for agent_stop. */
    | { type: "turn_end"; session: string; usage?: Usage; message?: string; outcome?: Interaction["outcome"]; t: number }
    /** Running token total of the session (lead + subagent transcripts), refreshed during the turn. */
    | { type: "usage"; session: string; usage: Usage; t: number }
    /** kind: "permission" = a permission prompt (needs you now), "turn" = Claude is at the prompt (your turn). `idle`: the turn is over. `agentId`: the helper that raised it (absent for the lead). */
    | { type: "waiting"; session: string; agentId?: string; text?: string; idle?: boolean; kind?: "permission" | "question" | "turn"; t: number }
    /** PreCompact: the conversation is being compacted (no other event until it is done). */
    | { type: "compact"; session: string; t: number }
  );

/** A source of events (Claude Code hooks today); must never throw, returns [] for input it cannot use. */
export type SourceAdapter = (payload: unknown, now?: number) => OfficeEvent[];

/** Transient moments the renderer choreographs (walk over, talk, report back). */
export type Interaction = {
  id: number;
  t: number;
  kind: "prompt" | "delegate" | "report" | "message" | "done";
  session: string;
  from: string; // agent id or `lead:<session>`
  to: string;
  text: string;
  /** delegate: was the spawned agent matched to exactly one outstanding delegation. */
  confidence?: "exact" | "guess";
  /** report: parsed from a DONE:/BLOCKED:/PARTIAL: prefix, "empty" for no message; absent when unrecognized. A partial report ends its task as "done" (task status has no partial); read the outcome here. */
  outcome?: "done" | "blocked" | "partial" | "empty";
  /** report only. */
  stoppedAt?: number;
  durationMs?: number;
  toolCount?: number;
  queueWaitMs?: number;
  usage?: Usage;
};

export type Seat = {
  id: string; // global desk id "d<N>" (see deskPos)
  role: string;
  kind: "permanent" | "overflow";
  index: number; // overflow index doubles as the visual tier (0 laptop, 1 folding table, ...)
  name: string;
};

export type Agent = {
  id: string;
  session: string;
  agentType: string;
  role: string;
  seat: Seat | null; // null = queued
  doing?: string; // last tool name
  detail?: string; // what that tool is acting on (file, command, pattern)
  busyAt?: number; // time of last tool call; recent = typing, stale = thinking
  task?: string; // text of the delegation that spawned it
  parent: string; // who delegated: another agent id or `lead:<session>`
  startedAt?: number;
  seatedAt?: number;
  queueWaitMs?: number;
  toolCount?: number;
  confidence?: "exact" | "guess";
  why?: string; // plain-English reason for the current tool
  errors?: number;
  lastError?: string;
  lastDurationMs?: number; // duration of the last finished tool
  report?: string; // its hand-back report, held until agent_stop
  lastAt?: number; // time of this agent's last event (start, tool, tool_end); compare against siblings to spot a silent helper
  /** Created from a tool or stop whose SubagentStart never arrived (role and task from the oldest pending delegation, if any). */
  recovered?: boolean;
};

/** One open wait of one agent (`agent` = a helper id or `lead:<session>`); that agent's own next event closes it. */
export type Wait = { agent: string; kind: "permission" | "question" | "turn"; since: number; text?: string; soft?: boolean };

export type Session = {
  id: string;
  project: string;
  /** Every open wait, at most one per agent. `soft`: a turn that simply finished (Stop): your turn, calm (no chime). */
  waits?: Wait[];
  /** waiting, waitKind, waitingText, waitBy and waitSoft are derived from the most urgent open wait (permission > question > turn > soft turn, then oldest). */
  waiting: boolean;
  /** "permission" = a permission prompt, "turn" = your turn (a question also reads "turn" here; waits[].kind tells them apart). */
  waitKind?: "permission" | "turn";
  waitingText?: string;
  /** The helper (agent id) that raised the most urgent wait; absent when the lead did. */
  waitBy?: string;
  /** The most urgent open wait is a soft turn (a finished turn). */
  waitSoft?: boolean;
  startedAt: number;
  doing?: string;
  detail?: string;
  busyAt?: number;
  prompt?: string; // the prompt of the turn in progress (cleared at turn_end)
  /** The latest real prompt, kept after its turn ends (replaced by the next one). */
  lastPrompt?: string;
  /** First line of the lead's last finished turn (cleared by the next prompt). */
  result?: string;
  /** Time of the latest real prompt. */
  promptAt?: number;
  /** Time of the latest turn_end. */
  turnAt?: number;
  why?: string;
  cwd?: string;
  branch?: string;
  source?: "startup" | "resume" | "compact" | "clear";
  /** Created from a mid-stream event (daemon restart), not from SessionStart. */
  recovered?: boolean;
  lastAt?: number; // time of the last event for this session
  seq?: number; // events received
  lastSeq?: number;
  gaps?: number; // payload sequence numbers that did not follow the previous one
  errors?: number;
  lastError?: string;
  lastDurationMs?: number;
  /** Token usage of the session: lead + subagent transcripts, a running total (refreshed during the turn and at its end). */
  usage?: Usage;
  files?: Record<string, number>;
  toolCounts?: Record<string, number>;
  /** Completed permission waits (waitKind "permission" until the lead's next event); `since` = start of the wait in progress. */
  permWait?: { n: number; totalMs: number; lastMs?: number; since?: number };
  /** Per tool name (at most 32): calls among the last 64 finished ones with a known duration, failures among them, p50/p95 ms. */
  toolStats?: Record<string, { n: number; fail: number; p50: number; p95: number }>;
};

/** After-action summary of an ended session (session_end or idle sweep). Counts and structure, plus the last prompt and result (blanked in privacy). */
export type Summary = {
  /** endedAt: the session_end time, or its last event when the idle sweep ended it. */
  session: string; project: string; startedAt: number; endedAt: number; durationMs: number;
  prompt?: string; result?: string;
  /** Agents started in the session; `tree` holds the first 64. */
  agents: number;
  tree: { id: string; name?: string; role: string; parent: string }[];
  /** Failed tool calls (lead and agents). */
  errors: number;
  permission: { n: number; totalMs: number };
  outcomes: { done: number; blocked: number; partial: number; empty: number };
  usage?: Usage;
};

/** Per-session reducer bookkeeping behind toolStats and Summary (in track, so never sent to clients). */
export type Run = {
  agents: number; tree: Summary["tree"]; errors: number; outcomes: Summary["outcomes"];
  /** Last 64 durations (ms) and ok flags per tool name. */
  tools: Record<string, { ms: number[]; ok: boolean[] }>;
};

export type Task = {
  id: string;
  session: string;
  agentId?: string;
  role: string;
  text: string;
  status: "pending" | "running" | "done" | "blocked";
  owner?: string;
  startedAt?: number;
  endedAt?: number;
};

/** A finished delegation (or a lead's finished turn, `lead: true`, agentId `lead:<session>`, task = its prompt): one-line result and the task it answered. */
export type Outcome = {
  session: string; project?: string; agentId: string; name?: string; role?: string; lead?: true;
  /** Same values as Interaction.outcome; absent when the report had no DONE:/BLOCKED:/PARTIAL: prefix. */
  outcome?: "done" | "blocked" | "partial" | "empty";
  text: string; task?: string; t: number; durationMs?: number;
};

export type Conflict = { file: string; a: string; b: string; t: number; kind: "possible" };

export type OfficeState = {
  sessions: Record<string, Session>;
  agents: Record<string, Agent>;
  queue: string[]; // agent ids waiting for a seat, FIFO
  log: Interaction[]; // last LOG_MAX interactions, ids ascending
  nextId: number;
  /** delegations announced via the Agent tool, waiting for their SubagentStart (key: session|bare type). */
  pending: Record<string, { from?: string; text: string; t?: number; id?: string; task?: string; /** another same-type delegation was pending with it: its match is a guess */ shared?: boolean }[]>;
  // Added later; optional so older literals (the web client's initial state) still type-check. reduce() fills them in.
  tasks?: Task[]; // last LIMITS.tasks
  conflicts?: Conflict[];
  /** Last LIMITS.outcomes finished delegations, newest first. Kept after their session ends. */
  outcomes?: Outcome[];
  nextTask?: number;
  /** Last LIMITS.summaries ended sessions, newest first. */
  summaries?: Summary[];
  /** Reducer bookkeeping (dedupe ring, tool start times, last write per file, per-session runs); not for display. */
  track?: { seen: string[]; starts: Record<string, number>; touched: Record<string, { by: string; t: number }>; runs?: Record<string, Run>; /** sessions evicted or refused at LIMITS.sessions */ dropped?: number };
};
