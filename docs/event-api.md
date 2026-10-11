# Event and stream API

The daemon (`packages/server/src/main.ts`) speaks HTTP on `AGENT_OFFICE_HOST:AGENT_OFFICE_PORT` (default `127.0.0.1:4747`). Event and state shapes are defined in `docs/data-model.md`.

## Auth

- A random token lives in `$AGENT_OFFICE_HOME/token` (mode 0600, created on first start).
- Every request's `Host` must be `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>` (or the configured `AGENT_OFFICE_HOST`), else 403 (DNS rebinding).
- `POST /event` and `POST /shutdown` need header `x-agent-office-token: <token>` and must not carry an `Origin` header (403).
- Reads (`/state`, `/stream`, `/history`, `/status`, `/outcomes`) need the token header **or** the `ao_token` cookie. The cookie is `HttpOnly; SameSite=Strict`, issued when `/` is loaded from an allowed Host, so the web page works without custom headers.
- No CORS headers are sent. `/health` and static files need only the Host check.

## Endpoints

| Method path | Notes |
|---|---|
| `POST /event` | Hook payload JSON (max 256 KB, else 413; bad JSON 400). Reply is empty, or `{hookSpecificOutput:{hookEventName, additionalContext?<=2000, permissionDecision?:"deny", permissionDecisionReason?}}`. Replies only under `protocol: "office"`: `additionalContext` on SessionStart (`leadRoster`) and SubagentStart (`introFor`), the deny on an Agent PreToolUse with `enforceSeats` and no free desk; under `"observe"` the reply is always empty (README "Office protocol" lists the exact text). Payload fields: `docs/data-model.md` adapter notes; `ao_seq` per-session counter, `ao_proto` forwarder protocol. |
| `GET /stream` | Server-sent events; one envelope per change. Heartbeat comment every 15 s. `id:` is `<epoch>-<rev>`; send `Last-Event-ID` on reconnect to skip an unchanged snapshot. Max 20 clients (503); slow clients are dropped. |
| `GET /state` | Current envelope as JSON. |
| `GET /history?since=<ms>&until=<ms>&limit=<n>` | `{schema, epoch, events}` stored events, oldest first, within [since, until] (both inclusive, ms epoch; until optional). `limit` (default 500, max 2000) keeps the newest matches. Backed by `events.jsonl` (kept `historyHours`, default 168 (7 days), pruned at boot and hourly; 5 MB rotation, one backup). In privacy mode free text is stripped before events are written. |
| `GET /status[?format=json][&session=<id prefix or project>]` | `3 working, 1 waiting, 2 queued`, or JSON `{working, waiting, queued, sessions, agents, events, lastEventAt, detail: [{session, project, state, agents, errors, lastAt, tokens}]}`. With `session=`, text gives one line per matching session and JSON `sessions` replaces `detail`. |
| `GET /outcomes[?days=7]` | `{schema, days: [{day, sessions, agents, outcomes: {done, blocked, partial, empty, other}, tokens, errors, hours}]}` per local day from `events.jsonl` (max 90 days, but only as far back as `historyHours` keeps). Counts only. `tokens` counts each session's highest running total of the day once. |
| `GET /health` | `{ok, version, pid, schema, warning?}`; `warning` when a forwarder speaks another protocol. |
| `POST /shutdown` | Token required; stops the daemon. |

**Spend.** On PostToolUse (at most every 5 s per session), SubagentStop and Stop the daemon adds the token `usage` fields of every transcript the session named (`transcript_path`, `agent_transcript_path`) to a per-session running ledger (only newly appended bytes, at most 8 MB per read, each message id once) and emits a `usage` event; `turn_end` carries the same total. Not in privacy mode.

**Prompts and narration.** `UserPromptSubmit` text is stripped of harness markup before it is clipped (`<task-notification>`, `<system-reminder>`, `[Subagent hand-back]` and friends); a pure machine message produces an empty `prompt` event, plus a `message` event with its one-line summary when it has one. For the session's lead the daemon also reads new assistant `text` blocks from `transcript_path` (and Stop's `last_assistant_message`) and emits them as `message` events to `user`, at most every 1.5 s per session, 3 per hook, de-duplicated; never in privacy mode. Config edits to `office.json` are pushed to clients on the next 2 s tick or request, whichever sees them first. `GET /status?session=<x>` returns 404 `{error:"no such session"}` for an unknown session. On boot the last 50,000 events of the retention window are replayed.

`?private=1` on `/state`, `/stream`, `/history` (or `"privacy": true` in office.json) blanks free text: prompts, tool detail/why, task text, final messages, outcome text and task, waiting text, errors, cwd/branch. Structure and tool names remain. `"privacy": true` additionally strips those fields before `events.jsonl` is written (`text` stays as `""`) and skips every transcript read.

## Envelope

```json
{ "schema": 1, "version": "0.0.0", "epoch": "a1b2c3d4e5f6", "rev": 42,
  "privacy": false, "protocol": "office", "configError": { "message": "...", "t": 0 },
  "degraded": true, "degradedReason": "state is 2100 KB, over the 2048 KB cap: ...",
  "state": { "sessions": {}, "agents": {}, "queue": [], "log": [], "...": "OfficeState without track" },
  "config": { "roles": {} } }
```

Derived fields (from tool events only; the daemon never prompts or controls Claude): `sessions[id].files` = edit counts per file path (Edit/Write/MultiEdit/NotebookEdit, top 50, absent in privacy mode); `sessions[id].toolCounts` = calls per tool name. Digest `--json` is `{ days, topTools, topFiles, errorsByAgent }`.

`protocol` is the active office protocol (`"office"` or `"observe"`). `degraded`/`degradedReason` appear only when the envelope would exceed 2 MB: the update is still sent, with `log`, `outcomes`, `tasks`, `conflicts` and per-session `files` trimmed (or emptied); nothing is dropped from the daemon's state.

Attention and results: `sessions[id].waiting` plus `sessions[id].waitKind` (`"permission"` = a permission prompt, needs you now; `"turn"` = Claude is at the prompt). Both clear on the lead's own tool, tool end, turn end or prompt, never on a subagent's event. `state.outcomes` = the last 30 finished delegations, newest first: `{session, project?, agentId, name?, role?, outcome?: "done"|"blocked"|"partial"|"empty", text, task?, t, durationMs?}` (`text` is the report's first line; text and task blanked in privacy). `agents[id].lastAt` = time of that agent's last event (start, tool, tool end), for spotting a silent helper. `sessions[id].usage` = running token total of lead + subagents.

`epoch` changes on every daemon start: reset cursors and caches when it differs. `rev` increases on every change, so equal `rev` within an epoch means nothing changed. `configError` is present while office.json is invalid (the last good config stays active).

## Consumer example

```js
// node >= 22: node consume.mjs
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { request } from "node:http";
const home = process.env.AGENT_OFFICE_HOME ?? `${homedir()}/.agent-office`;
const token = readFileSync(`${home}/token`, "utf8").trim();
const port = process.env.AGENT_OFFICE_PORT ?? readFileSync(`${home}/port`, "utf8").trim();
let epoch, rev = -1;
request({ host: "127.0.0.1", port, path: "/stream", headers: { "x-agent-office-token": token } }, (res) => {
  let buf = "";
  res.setEncoding("utf8").on("data", (chunk) => {
    buf += chunk;
    for (let i; (i = buf.indexOf("\n\n")) >= 0; buf = buf.slice(i + 2)) {
      const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
      if (!data) continue; // heartbeat
      const env = JSON.parse(data.slice(6));
      if (env.epoch !== epoch) { epoch = env.epoch; rev = -1; } // daemon restarted
      if (env.rev === rev) continue;
      rev = env.rev;
      const a = Object.values(env.state.agents);
      console.log(`${a.filter((x) => x.doing).length}/${a.length} agents busy, ${env.state.queue.length} queued`);
    }
  });
}).end();
```

## Forwarder

`plugin/hooks/forward.mjs` sends only allowlisted payload fields, stamps `ao_seq`/`ao_proto`, honors `AGENT_OFFICE_DISABLED=1`, and prints only a reply that matches the schema above. On SessionStart with an unreachable daemon it starts one detached (`AGENT_OFFICE_DAEMON` or `packages/server/src/main.ts` next to the plugin) and retries once. `node scripts/office.mjs status|start|restart|stop|doctor|init|config --validate|history [--purge]|uninstall` manages the daemon. `/state` also carries `configWarning` (unknown office.json keys) and `/health.warning` repeats it. `Interaction.outcome` may be `partial` (PARTIAL: report; the task still ends as done).
