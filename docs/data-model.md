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
| agent_stop | agentId, message?, usage? (that subagent's transcript total), outcome? (stamped by the daemon on the stored line from the report; the reducer prefers it, so a replay without text keeps outcomes) |
| tool | agentId? (absent = lead), tool, detail?, why?, id? (tool_use_id) |
| tool_end | agentId?, tool, ok, error?, id? |
| delegate | from?, agentType, text, id? |
| message | from?, to, text, id? |
| prompt | text |
| turn_end | usage? (session running total: lead + subagents), message? (first line of Stop's `last_assistant_message`, clipped 220, redacted; dropped in privacy), outcome? (stamped by the daemon from the message, so a replay without text keeps it) |
| usage | usage (session running total, emitted during the turn) |
| waiting | agentId? (the helper whose Notification it was), text?, idle? (idle_prompt only: the turn is over), kind? ("permission" from notification_type permission_prompt, "turn" from idle_prompt or an AskUserQuestion prompt, which does not end the turn; absent otherwise) |

## State

`OfficeState`: `sessions`, `agents`, `queue`, `log`, `nextId`, `pending` (unchanged), plus optional `tasks`, `conflicts`, `outcomes`, `summaries`, `nextTask`, `track` (internal bookkeeping: dedupe ring, tool start times, last write per file, and `runs`: per live session the agent tree, error and outcome counts and the last 64 durations per tool). `reduce` fills the optional ones when absent. `track` is never sent to clients.

- **Session** adds: `waitKind` ("permission" | "turn", set with `waiting`; without an event kind, idle or text not naming a permission is "turn"; cleared with `waiting` by turn_end or prompt, and by the next tool, tool_end or agent_stop of whoever raised it: `waitBy` (the helper's agent id from the Notification, absent for the lead) when set, else the lead), `waitBy`, `lastPrompt` (latest real prompt, kept after its turn, replaced by the next), `result` (first line of the last finished turn, cleared by the next prompt), `promptAt` (time of the latest real prompt), `turnAt` (time of the latest turn_end), `usage` (running total, see `usage`/`turn_end`), `cwd`, `branch`, `source`, `recovered` (created from a mid-stream event, not SessionStart), `lastAt` (last event), `seq` (events received), `lastSeq`, `gaps` (payload seq not following the previous), `errors`, `lastError`, `lastDurationMs`, `why`, `permWait` (`{n, totalMs, lastMs?, since?}`: a `waiting` event of kind "permission" sets `since` once; the same events that clear the wait (see `waitBy`), or a "turn" wait, complete it into `n`/`totalMs`/`lastMs`; "turn" waits are not counted), `toolStats` (`{<tool>: {n, fail, p50, p95}}`: nearest-rank percentiles in ms and failures over the last `LIMITS.toolSamples` (64) tool_ends of that tool in the session with a known duration, lead and agents together; at most `LIMITS.toolStats` (32) tools, the least sampled is evicted). `project` is the folder name, or `parent/folder` while another live session shares it.
- **Agent** adds: `lastAt` (time of its last event: start, tool, tool_end), `startedAt`, `seatedAt`, `queueWaitMs`, `toolCount`, `confidence` ("exact" = matched exactly one outstanding delegation, "guess" = several or none), `why`, `errors`, `lastError`, `lastDurationMs`. `doing`/`why` clear on `tool_end`; `detail` and `busyAt` stay (so `doing` unset + recent `busyAt` = between tools / thinking).
- **Interaction** adds: `confidence` (delegate), and on `report`: `outcome` ("done"/"blocked" from a DONE:/BLOCKED: prefix, "empty" for no message, absent if unrecognized), `stoppedAt`, `durationMs`, `toolCount`, `queueWaitMs`. `text` is untouched.
- **Task**: `{id, session, agentId?, role, text, status: pending|running|done|blocked, owner?, startedAt?, endedAt?}`. delegate creates `pending`; the matching agent_start makes it `running` (owner = seat name); agent_stop makes it `done`/`blocked`. Unmatched delegations that expire or fail are removed. Last 30.
- **Outcome**: `{session, project?, agentId, name?, role?, lead?, outcome?, text, task?, t, durationMs?}` from each agent_stop: `text` = first line of the report (max 160), `task` = the delegated task, `outcome` as on the report interaction. A turn_end with a prompt or a message files a lead outcome: `agentId: "lead:<session>"`, `lead: true`, `task` = the turn's prompt, `text` = the message's first line, `outcome` = its DONE/BLOCKED/PARTIAL prefix (usually absent: neutral), `durationMs` from `promptAt`. Newest first, last `LIMITS.outcomes` (30); kept after the session ends.
- **Summary** (`state.summaries`, newest first, last `LIMITS.summaries` (20)): written by `endSession` (session_end and the idle sweep) for a session that existed: `{session, project, startedAt, endedAt (session_end time; for the idle sweep the session's last event), durationMs, prompt? (lastPrompt), result?, agents (started in the session), tree: [{id, name?, role, parent}] (first 64), errors (failed tool calls, lead and agents), permission: {n, totalMs}, outcomes: {done, blocked, partial, empty}, usage?}`. Free text only in `prompt`/`result` (blanked in privacy). Rebuilt by replay.
- **Conflict**: `{file, a, b, t, kind: "possible"}`: two different writers (Edit/Write/MultiEdit/NotebookEdit) of the same basename in one session within 15 s. Last 20.
- **pending** entries: `{from?, text, t?, id?, task?}`.

## Semantics

- Unknown agent: a `tool` or `agent_stop` from an agent id with no agent_start creates it (`recovered: true`, role and task from the session's oldest pending delegation, else type "unknown") unless that id already filed an outcome; a helper's tool never writes the session's `doing`. A `tool_end` from an unknown agent is ignored.
- Ghost helpers: `sweep` also removes a helper silent for ttl/3 when its session had a turn_end after the helper's `lastAt` (no outcome filed).
- Privacy: `project` is stored (session_start lines) and served (`/state`, `/stream`, `/status`, outcomes, summaries) as `pseudonym(session)` = `session-<4 hex>`.
- Unknown session: any non-session_end event creates it with `recovered: true` (up to `LIMITS.sessions`); a later session_start merges (keeps startedAt unless recovered, prompt, agents) and records `source`.
- Dedupe: events with an `id` repeating the same (session, type, id) are ignored (ring of `LIMITS.track`); they still count in `seq`.
- Delegations expire after `LIMITS.pendingTtlMs`; a failed tool_end (`ok: false`) with the delegate's `id` drops it. Delegations/agents beyond `LIMITS.pending`/`agents` are ignored.
- Log: global `LOG_MAX` (40), `LIMITS.logPerSession` (30); a session's entries are pruned on session_end.

## Exports (core)

`SCHEMA_VERSION`, `LIMITS`, `LOG_MAX`, `emptyState`, `reduce`, `safeId`, `sweep(state, now, ttlMs, cfg?)` -> `{state, removed: {sessions, agents}}` (ends sessions with no event for ttlMs; pass `cfg` to seat queued agents), `capacityFor(cfg, state, role)` -> `{free, total, canSpawn}` (one global pool of `MAX_DESKS` = 64 desks; `role` is ignored; queued agents hold no seat), `allocate(cfg, state, role, session?)` (cheapest free desk id `d<N>`; unmapped agent types keep their bare type as role), layout: `deskPos(i)`, `buildLayout(cfg, {demand?})`, `childrenOf(state, id)`, `parentChain(state, id)` (ancestors, nearest first, ends at `lead:<session>`), types `SourceAdapter`, `Task`, `Conflict`.
Server adapter: `adapt`, `clip`, `redact`.
