# Event and stream API

The daemon (`packages/server/src/main.ts`) speaks HTTP on `AGENT_OFFICE_HOST:AGENT_OFFICE_PORT` (default `127.0.0.1:4747`). Event and state shapes are defined in `docs/data-model.md`.

## Auth

- A random token lives in `$AGENT_OFFICE_HOME/token` (mode 0600, created on first start).
- Every request's `Host` must be `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>` (or the configured `AGENT_OFFICE_HOST`), else 403 (DNS rebinding).
- `POST /event` and `POST /shutdown` need header `x-agent-office-token: <token>` and must not carry an `Origin` header (403).
- Reads (`/state`, `/stream`, `/history`, `/status`, `/outcomes`) need the token header **or** the `ao_ui` cookie. The cookie carries a separate UI token (`$AGENT_OFFICE_HOME/ui-token`, 0600), is `HttpOnly; SameSite=Strict`, and is issued when `/` is loaded from an allowed Host, so the web page works without custom headers. The UI token never authorizes `POST /event` or `/shutdown`, and the master token is never set as a cookie.
- The share controls (`/share*`, below) take the `ao_ui` cookie or the token header, and refuse an `Origin` other than `http://<the request's Host>` (403).
- No CORS headers are sent. `/health` and static files need only the Host check.

## Endpoints

| Method path | Notes |
|---|---|
| `POST /event` | Hook payload JSON (max 256 KB, else 413; bad JSON 400). Reply is empty, or `{hookSpecificOutput:{hookEventName, additionalContext?<=2000, permissionDecision?:"deny", permissionDecisionReason?}}`. Replies only under `protocol: "office"`: `additionalContext` on SessionStart (`leadRoster`) and SubagentStart (`introFor`), the deny on an Agent PreToolUse with `enforceSeats` and no free desk; under `"observe"` the reply is always empty (README "Office protocol" lists the exact text). Payload fields: `docs/data-model.md` adapter notes; `ao_seq` per-session counter, `ao_proto` forwarder protocol. |
| `GET /stream[?lod=summary][&session=<id>]` | Server-sent events. On connect: the full envelope as a plain `data:` message. Then one `event: patch` frame per change (see "Patches"); an envelope that had to be trimmed (`degraded`) is always sent in full, and so is the one after it. Heartbeat comment every 15 s. `id:` is `<epoch>-<rev>`; send `Last-Event-ID` on reconnect to skip an unchanged snapshot. Max 20 clients (503); slow clients are dropped. |
| `GET /state[?lod=summary][&session=<id>]` | Current envelope as JSON (the same view the stream sends). |
| `GET /history?since=<ms>&until=<ms>&limit=<n>` | `{schema, epoch, events, more}`: stored events within [since, until] (both inclusive, ms epoch; until optional), oldest first, the newest `limit` of them (default 500, max 20000). `more: true` = older events exist in the range: page back with `until = events[0].t - 1`. Never older than `historyHours`. Read asynchronously from the per-day files (seeking with their `.idx`) plus the legacy `events.jsonl(.1)`; the daemon stays responsive. Text is rejoined from the `.text.jsonl` files; where a text file is gone (`textHours`, `--purge-text`) the event comes back with `text: ""` and no other text fields. |
| `GET /status[?format=json][&session=<id prefix or project>]` | `3 working, 1 waiting, 2 queued`, or JSON `{working, waiting, queued, sessions, agents, events, lastEventAt, detail: [{session, project, state, agents, errors, lastAt, tokens}]}`. With `session=`, text gives one line per matching session and JSON `sessions` replaces `detail`. |
| `GET /outcomes[?days=7]` | `{schema, days: [{day, sessions, agents, outcomes: {done, blocked, partial, empty, other}, tokens, errors, hours}]}` per local day from the stored events (structure only, no text read; max 90 days, but only as far back as `historyHours` keeps). Counts only. `tokens` counts each session's highest running total of the day once. |
| `GET /health` | `{ok, version, pid, schema, warning?}`; `warning` when a forwarder speaks another protocol. |
| `POST /shutdown` | Token required; stops the daemon. |
| `GET /share` | `{enabled, url?, fingerprint?, until?, devices: [{id, name, createdAt, lastSeen}], code?: {expiresAt}}` (the code itself is never repeated). |
| `POST /share` | Body `{"on": true\|false}`. Starting re-reads office.json `share`; a refused start (no or non-private address, port in use) is 409 with `error`. |
| `POST /share/code` | `{code, expiresAt}`: 6 digits, single use, 2 minutes, replaces any earlier code. 409 `{error}` while sharing is off or pairing is locked. |
| `DELETE /share/devices/<id>` | Revoke one device (8 hex id): its record goes and its open streams close at once. 404 for an unknown id. |
| `DELETE /share/devices` | Revoke every device. |

## Share on the local network (read-only listener)

Off by default. When on, a second listener speaks HTTPS on `share.address:share.port` (default: the first private IPv4 of the machine, port 4748). The address must be private (10/8, 172.16/12, 192.168/16, 169.254/16, fd00::/8, fe80::/10) or the start is refused. It has exactly these routes (`LAN_ROUTES` in `packages/server/src/share.ts`), everything else is 404 whatever the credentials:

| Method path | Notes |
|---|---|
| `GET /pair` | A small HTML form (no scripts) for the 6-digit code. |
| `POST /pair` | Form body `code=NNNNNN`. Right: 303 to `/` with cookie `ao_dev=<32 random bytes, base64url>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=30 days`. Wrong or expired: 401. Five wrong codes from any source invalidate the code and lock pairing for 60 s (429). A foreign `Origin` is 403. |
| `GET /state`, `/stream`, `/history` | With a device cookie: the same handlers and views as on loopback (`?private=1`, `?lod=summary`, the host's `privacy` setting applies); the envelope gains `remote: true`. At most 2 streams per device and 10 in total (503). |
| `GET <file>` | With a device cookie: the web build. Without one, `GET /` redirects to `/pair` and anything else is 401. |

`Host` must equal the bound `address:port` (403). Responses carry `Content-Security-Policy` (`default-src 'self'`, plus `'unsafe-eval'` scripts for PixiJS and inline styles; no inline scripts), `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `nosniff`, `no-store`; no CORS and no HSTS (the certificate is self-signed). Devices are stored hashed (SHA-256, compared with `timingSafeEqual`) in `devices.json` (0600) and expire after 30 days unused; loading the page slides the cookie. The listener stops after `share.stopAfterHours` (default 8). Pairings, revokes, failed attempts and lockouts are appended to `share.log` (no codes or tokens).

**Spend.** On PostToolUse (at most every 5 s per session), SubagentStop and Stop the daemon adds the token `usage` fields of every transcript the session named (`transcript_path`, `agent_transcript_path`) to a per-session running ledger (only newly appended bytes, at most 8 MB per read, each message id once) and emits a `usage` event; `turn_end` carries the same total. Not in privacy mode.

**Prompts and narration.** `UserPromptSubmit` text is stripped of harness markup before it is clipped (`<task-notification>`, `<system-reminder>`, `[Subagent hand-back]` and friends); a pure machine message produces an empty `prompt` event, plus a `message` event with its one-line summary when it has one. For the session's lead the daemon also reads new assistant `text` blocks from `transcript_path` (and Stop's `last_assistant_message`) and emits them as `message` events to `user`, at most every 1.5 s per session, 3 per hook, de-duplicated; never in privacy mode. Config edits to `office.json` are pushed to clients on the next 2 s tick or request, whichever sees them first. `GET /status?session=<x>` returns 404 `{error:"no such session"}` for an unknown session. On boot the last 50,000 events of the retention window are replayed, preceded by every older non-tool event of the window (session and agent starts and stops, delegations, prompts, turn ends, waits), so a restart keeps the office.

**Results.** Stop's `last_assistant_message` (first line, clipped to 220, redacted) travels on `turn_end` as `message`; the reducer files it as a lead outcome. In privacy mode it is dropped before state and disk (only the stamped `outcome` stays). A `Notification` carrying `agent_id` (a helper's permission prompt) becomes a `waiting` event with `agentId`; the session's `waitBy` then names that helper and only its next event ends the wait. An AskUserQuestion prompt is `kind: "turn"` without `idle` (the turn goes on).

`?private=1` on `/state`, `/stream`, `/history` (or `"privacy": true` in office.json) blanks free text: prompts (`prompt`, `lastPrompt`), results (`result`, summary `prompt`/`result`), tool detail/why, task text, final messages, outcome text and task, waiting text, errors, cwd/branch, and replaces every `project` with `session-<4 hex>`. Structure and tool names remain. `"privacy": true` additionally writes no `.text.jsonl` file at all (only structure lines, `text` kept as `""`, `project` as the pseudonym), pseudonymises `/status`, and skips every transcript read.

## Storage

Each event is written to `$AGENT_OFFICE_HOME/events/<UTC day>.jsonl` as a structure line: `{v, ...event}` without `text`, `detail`, `why`, `message`, `error`, `cwd`, `branch` (`text` kept as `""` so it replays); `agent_stop` lines also carry `outcome` (from the report) so outcomes survive without text. The removed fields go to `<day>.text.jsonl` as `{o, ...fields}`, `o` = byte offset of the structure line. `<day>.idx` holds `t offset textOffset` lines (one when a daemon first writes to the day, then one per 64 KB). Retention deletes whole days older than `historyHours` and text files older than `textHours` (default = `historyHours`), at boot and hourly. Boot replays the last 50,000 events of the window through the same reader.

## Patches

After the full envelope, each change is one frame:

```
id: <epoch>-<rev>
event: patch
data: {"epoch":"…","rev":43,"base":42,"head":{…},"maps":{"sessions":{"s1":{…},"s2":null}},"keys":{"outcomes":[…]},"log":{"drop":1,"add":[…]}}
```

Apply it only if `epoch` and `base` equal the envelope you hold (else fetch `/state` and start over). `head`: changed envelope fields (`null` = removed). `maps`: changed entries of `state.sessions`, `state.agents`, `state.pending` (`null` = removed). `keys`: other top-level state keys that changed, whole (`queue`, `tasks`, `outcomes`, `summaries`, `crew`, …; `log` here when it could not be expressed as `drop`/`add`). `log`: drop `drop` entries from the front, then append `add`. Then set `rev`. Reference: `applyPatch` in `packages/web/src/net.ts`.

## Level of detail

`?lod=summary` (on `/stream` and `/state`) sends `agents: {}`, `log: []`, `tasks: []`, `pending: {}` and adds `state.crew: {<session>: {agents, working, waiting, blocked, queued}}`: agents of that session = working (in a tool) + waiting (seated, between tools) + queued (no desk); blocked = BLOCKED reports among `state.outcomes`. Sessions, outcomes, summaries and the rest are unchanged. `?session=<id>` implies the summary level but keeps that session's agents, log, tasks and pending in full. The web canvas uses the full stream.

## Envelope

```json
{ "schema": 1, "version": "0.0.0", "epoch": "a1b2c3d4e5f6", "rev": 42,
  "privacy": false, "protocol": "office", "configError": { "message": "...", "t": 0 },
  "degraded": true, "degradedReason": "state is 2100 KB, over the 2048 KB cap: ...",
  "state": { "sessions": {}, "agents": {}, "queue": [], "log": [], "...": "OfficeState without track" },
  "config": { "roles": {} } }
```

Derived fields (from hook events only; the daemon never prompts or controls Claude): `sessions[id].files` = edit counts per file path (Edit/Write/MultiEdit/NotebookEdit, top 50, absent in privacy mode); `sessions[id].toolCounts` = calls per tool name; `sessions[id].permWait` = `{n, totalMs, lastMs?, since?}` completed permission waits (a `"permission"` wait until the lead's next event; `since` = start of the one in progress; `"turn"` waits are not counted); `sessions[id].toolStats` = `{<tool>: {n, fail, p50, p95}}` over the last 64 finished calls of each tool with a known duration (ms, at most 32 tools). `state.summaries` = the last 20 ended sessions, newest first (see `docs/data-model.md`, no free text). Digest `--json` is `{ days, topTools, topFiles, errorsByAgent }` (`--counts`: `topFiles` empty).

`protocol` is the active office protocol (`"office"` or `"observe"`). `degraded`/`degradedReason` appear only when the envelope would exceed 2 MB: the update is still sent, with `log`, `outcomes`, `tasks`, `conflicts` and per-session `files` trimmed (or emptied); nothing is dropped from the daemon's state.

Attention and results: `sessions[id].waiting` plus `sessions[id].waitKind` (`"permission"` = a permission prompt, needs you now; `"turn"` = Claude is at the prompt). Both clear on turn end or prompt, and on the next tool, tool end or stop of whoever raised the wait: `sessions[id].waitBy` (a helper's agent id) when set, else the lead. `sessions[id].lastPrompt`, `result`, `promptAt`, `turnAt`: the latest prompt (kept after its turn), the first line of the last finished turn, and their times. `state.outcomes` = the last 30 finished delegations and lead turns, newest first: `{session, project?, agentId, name?, role?, lead?: true, outcome?: "done"|"blocked"|"partial"|"empty", text, task?, t, durationMs?}` (a lead turn: `agentId` `lead:<session>`, `task` = its prompt; only `"done"` means done, `"empty"` and absent are a neutral "reported") (`text` is the report's first line; text and task blanked in privacy). `agents[id].lastAt` = time of that agent's last event (start, tool, tool end), for spotting a silent helper. `sessions[id].usage` = running token total of lead + subagents.

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
// Summary level of detail: per-session counts, small patches.
request({ host: "127.0.0.1", port, path: "/stream?lod=summary", headers: { "x-agent-office-token": token } }, (res) => {
  let buf = "", env;
  res.setEncoding("utf8").on("data", (chunk) => {
    buf += chunk;
    for (let i; (i = buf.indexOf("\n\n")) >= 0; buf = buf.slice(i + 2)) {
      const lines = buf.slice(0, i).split("\n"), data = lines.find((l) => l.startsWith("data: "));
      if (!data) continue; // heartbeat
      const msg = JSON.parse(data.slice(6));
      if (!lines.includes("event: patch")) env = msg; // full envelope
      else if (env && msg.epoch === env.epoch && msg.base === env.rev) { // patch (else: re-fetch /state?lod=summary)
        const st = { ...env.state, ...msg.keys };
        for (const [k, m] of Object.entries(msg.maps ?? {})) { st[k] = { ...st[k] }; for (const [id, v] of Object.entries(m)) v === null ? delete st[k][id] : (st[k][id] = v); }
        if (msg.log) st.log = [...env.state.log.slice(msg.log.drop), ...msg.log.add];
        env = { ...env, ...msg.head, rev: msg.rev, state: st };
      } else continue;
      for (const [id, c] of Object.entries(env.state.crew)) console.log(`${env.state.sessions[id]?.project}: ${c.working}/${c.agents} agents busy, ${c.queued} queued`);
    }
  });
}).end();
```

## Forwarder

`plugin/hooks/forward.mjs` sends only allowlisted payload fields, stamps `ao_seq`/`ao_proto`, honors `AGENT_OFFICE_DISABLED=1`, and prints only a reply that matches the schema above. On SessionStart with an unreachable daemon it starts one detached (`AGENT_OFFICE_DAEMON` or `packages/server/src/main.ts` next to the plugin) and retries once. `node scripts/office.mjs status|start|restart|stop|doctor|init|config --validate|history [--purge|--purge-text]|uninstall` manages the daemon. `/state` also carries `configWarning` (unknown office.json keys) and `/health.warning` repeats it. `Interaction.outcome` may be `partial` (PARTIAL: report; the task still ends as done).
