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
  /** How hard the lead is nudged to fan out: "off" = no nudge, "auto" = only when worthwhile (default). */
  parallelism?: "off" | "auto" | "aggressive";
  /** Deny Agent-tool spawns when no desk is free (office at MAX_DESKS) instead of queueing visually. */
  enforceSeats?: boolean;
  /** Hide prompt/tool text in the stream (tool names and structure only). */
  privacy?: boolean;
  /** Ignored: there is one built-in look. Still parsed so old config files keep working. */
  theme?: string;
  /** Minutes of silence (1-1440, default 45) before an idle session is swept. */
  idleTtlMinutes?: number;
  /** Lead-session token total (see usageTotalOf) at which the client raises a spend alarm; 0 or absent = off. Validated 0..1e9. */
  spendAlarmTokens?: number;
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
type Base = { seq?: number };

/** Normalized events. The server adapter is the only place that knows Claude Code's hook shape. */
export type OfficeEvent = Base &
  (
    | { type: "session_start"; session: string; project: string; cwd?: string; branch?: string; source?: "startup" | "resume" | "compact" | "clear"; t: number }
    | { type: "session_end"; session: string; t: number }
    | { type: "agent_start"; session: string; agentId: string; agentType: string; t: number }
    | { type: "agent_stop"; session: string; agentId: string; message?: string; usage?: Usage; t: number }
    /** `id` = tool_use_id; `why` = plain-English reason. */
    | { type: "tool"; session: string; agentId?: string; tool: string; detail?: string; why?: string; id?: string; t: number }
    /** PostToolUse / PostToolUseFailure. */
    | { type: "tool_end"; session: string; agentId?: string; tool: string; ok: boolean; error?: string; id?: string; t: number }
    /** The lead (or an agent) is about to spawn `agentType` with this task text. */
    | { type: "delegate"; session: string; from?: string; agentType: string; text: string; id?: string; t: number }
    /** One agent talking to another (e.g. SendMessage). `to` is an agent id or a name hint. */
    | { type: "message"; session: string; from?: string; to: string; text: string; id?: string; t: number }
    | { type: "prompt"; session: string; text: string; t: number }
    | { type: "turn_end"; session: string; usage?: Usage; t: number }
    | { type: "waiting"; session: string; text?: string; t: number }
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
};

export type Session = {
  id: string;
  project: string;
  waiting: boolean;
  waitingText?: string;
  startedAt: number;
  doing?: string;
  detail?: string;
  busyAt?: number;
  prompt?: string;
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
  /** Token usage of the lead's transcript as of the last turn end. */
  usage?: Usage;
  files?: Record<string, number>;
  toolCounts?: Record<string, number>;
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

export type Conflict = { file: string; a: string; b: string; t: number; kind: "possible" };

export type OfficeState = {
  sessions: Record<string, Session>;
  agents: Record<string, Agent>;
  queue: string[]; // agent ids waiting for a seat, FIFO
  log: Interaction[]; // last LOG_MAX interactions, ids ascending
  nextId: number;
  /** delegations announced via the Agent tool, waiting for their SubagentStart (key: session|bare type). */
  pending: Record<string, { from?: string; text: string; t?: number; id?: string; task?: string }[]>;
  // Added later; optional so older literals (the web client's initial state) still type-check. reduce() fills them in.
  tasks?: Task[]; // last LIMITS.tasks
  conflicts?: Conflict[];
  nextTask?: number;
  /** Reducer bookkeeping (dedupe ring, tool start times, last write per file); not for display. */
  track?: { seen: string[]; starts: Record<string, number>; touched: Record<string, { by: string; t: number }> };
};
