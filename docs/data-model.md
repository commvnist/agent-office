# Data model

Source of truth: `packages/core/src/types.ts` and `state.ts`. All additions are optional fields; older readers keep working. `SCHEMA_VERSION = 1` (the daemon stamps it).

## Pipeline

hook payload -> `adapt(payload, now?)` (`packages/server/src/adapter.ts`, a `SourceAdapter`, never throws, returns `[]` for unusable input) -> `OfficeEvent[]` -> `reduce(cfg, state, event)` (pure) -> `OfficeState`.

Adapter text rules: ANSI, control, bidi-override and zero-width characters stripped; obvious secrets redacted (`Bearer`/`Authorization`, `sk-...`, `ghp_...`, AWS keys, `password=`/`--token x`, `scheme://user:pw@`); whitespace collapsed; clipped. Ids must match `[\w.:-]{1,64}`, not be an `Object.prototype` name, and (for session/agent ids) not start with `lead:`. Reducer enforces the same via `safeId`. A payload `ao_seq` integer becomes `event.seq`.

## Events

All events have `session`, `t`, optional `seq`.

| type | extra fields |
|---|---|
| session_start | project, cwd?, branch?, source? (startup/resume/compact/clear) |
| session_end | |
| agent_start | agentId, agentType |
| agent_stop | agentId, message?, usage? (that subagent's transcript total) |
| tool | agentId? (absent = lead), tool, detail?, why?, id? (tool_use_id) |
| tool_end | agentId?, tool, ok, error?, id? |
| delegate | from?, agentType, text, id? |
| message | from?, to, text, id? |
| prompt | text |
| turn_end | usage? (session running total: lead + subagents) |
| usage | usage (session running total, emitted during the turn) |
| waiting | text?, idle?, kind? ("permission" from notification_type permission_prompt, "turn" from idle_prompt; absent otherwise) |

## State

`OfficeState`: `sessions`, `agents`, `queue`, `log`, `nextId`, `pending` (unchanged), plus optional `tasks`, `conflicts`, `outcomes`, `nextTask`, `track` (internal bookkeeping: dedupe ring, tool start times, last write per file). `reduce` fills the optional ones when absent.

- **Session** adds: `waitKind` ("permission" | "turn", set with `waiting`; without an event kind, idle or text not naming a permission is "turn"; cleared with `waiting` by the lead's tool, tool_end, turn_end or prompt, never by a subagent's event), `usage` (running total, see `usage`/`turn_end`), `cwd`, `branch`, `source`, `recovered` (created from a mid-stream event, not SessionStart), `lastAt` (last event), `seq` (events received), `lastSeq`, `gaps` (payload seq not following the previous), `errors`, `lastError`, `lastDurationMs`, `why`. `project` is the folder name, or `parent/folder` while another live session shares it.
- **Agent** adds: `lastAt` (time of its last event: start, tool, tool_end), `startedAt`, `seatedAt`, `queueWaitMs`, `toolCount`, `confidence` ("exact" = matched exactly one outstanding delegation, "guess" = several or none), `why`, `errors`, `lastError`, `lastDurationMs`. `doing`/`why` clear on `tool_end`; `detail` and `busyAt` stay (so `doing` unset + recent `busyAt` = between tools / thinking).
- **Interaction** adds: `confidence` (delegate), and on `report`: `outcome` ("done"/"blocked" from a DONE:/BLOCKED: prefix, "empty" for no message, absent if unrecognized), `stoppedAt`, `durationMs`, `toolCount`, `queueWaitMs`. `text` is untouched.
- **Task**: `{id, session, agentId?, role, text, status: pending|running|done|blocked, owner?, startedAt?, endedAt?}`. delegate creates `pending`; the matching agent_start makes it `running` (owner = seat name); agent_stop makes it `done`/`blocked`. Unmatched delegations that expire or fail are removed. Last 30.
- **Outcome**: `{session, project?, agentId, name?, role?, outcome?, text, task?, t, durationMs?}` from each agent_stop: `text` = first line of the report (max 160), `task` = the delegated task, `outcome` as on the report interaction. Newest first, last `LIMITS.outcomes` (30); kept after the session ends.
- **Conflict**: `{file, a, b, t, kind: "possible"}`: two different writers (Edit/Write/MultiEdit/NotebookEdit) of the same basename in one session within 15 s. Last 20.
- **pending** entries: `{from?, text, t?, id?, task?}`.

## Semantics

- Unknown session: any non-session_end event creates it with `recovered: true` (up to `LIMITS.sessions`); a later session_start merges (keeps startedAt unless recovered, prompt, agents) and records `source`.
- Dedupe: events with an `id` repeating the same (session, type, id) are ignored (ring of `LIMITS.track`); they still count in `seq`.
- Delegations expire after `LIMITS.pendingTtlMs`; a failed tool_end (`ok: false`) with the delegate's `id` drops it. Delegations/agents beyond `LIMITS.pending`/`agents` are ignored.
- Log: global `LOG_MAX` (40), `LIMITS.logPerSession` (30); a session's entries are pruned on session_end.

## Exports (core)

`SCHEMA_VERSION`, `LIMITS`, `LOG_MAX`, `emptyState`, `reduce`, `safeId`, `sweep(state, now, ttlMs, cfg?)` -> `{state, removed: {sessions, agents}}` (ends sessions with no event for ttlMs; pass `cfg` to seat queued agents), `capacityFor(cfg, state, role)` -> `{free, total, canSpawn}` (one global pool of `MAX_DESKS` = 64 desks; `role` is ignored; queued agents hold no seat), `allocate(cfg, state, role, session?)` (cheapest free desk id `d<N>`; unmapped agent types keep their bare type as role), layout: `deskPos(i)`, `buildLayout(cfg, {demand?})`, `childrenOf(state, id)`, `parentChain(state, id)` (ancestors, nearest first, ends at `lead:<session>`), types `SourceAdapter`, `Task`, `Conflict`.
Server adapter: `adapt`, `clip`, `redact`.
