# Event and stream API

The daemon (`packages/server/src/main.ts`) speaks HTTP on `AGENT_OFFICE_HOST:AGENT_OFFICE_PORT` (default `127.0.0.1:4747`). Event and state shapes are defined in `docs/data-model.md`.

## Auth

- A random token lives in `$AGENT_OFFICE_HOME/token` (mode 0600, created on first start).
- Every request's `Host` must be `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>` (or the configured `AGENT_OFFICE_HOST`), else 403 (DNS rebinding).
- `POST /event` and `POST /shutdown` need header `x-agent-office-token: <token>` and must not carry an `Origin` header (403).
- Reads (`/state`, `/stream`, `/history`, `/status`, `/themes`) need the token header **or** the `ao_token` cookie. The cookie is `HttpOnly; SameSite=Strict`, issued when `/` is loaded from an allowed Host, so the web page works without custom headers.
- No CORS headers are sent. `/health` and static files need only the Host check.

## Endpoints

| Method path | Notes |
|---|---|
| `POST /event` | Hook payload JSON (max 256 KB, else 413; bad JSON 400). Reply is empty, or `{hookSpecificOutput:{hookEventName, additionalContext?<=2000, permissionDecision?:"deny", permissionDecisionReason?}}`. Payload fields: `docs/data-model.md` adapter notes; `ao_seq` per-session counter, `ao_proto` forwarder protocol. |
| `GET /stream` | Server-sent events; one envelope per change. Heartbeat comment every 15 s. `id:` is `<epoch>-<rev>`; send `Last-Event-ID` on reconnect to skip an unchanged snapshot. Max 20 clients (503); slow clients are dropped. |
| `GET /state` | Current envelope as JSON. |
| `GET /history?since=<ms>&limit=<n>` | `{schema, epoch, events}` stored events, oldest first (limit default 500, max 2000). Backed by `events.jsonl` (last 24 h on boot, 5 MB rotation, one backup). |
| `GET /status[?format=json]` | `3 working, 1 waiting, 2 queued`, or `{working, waiting, queued, sessions, agents}`. |
| `GET /themes`, `GET /themes/<name>.json` | Theme packs from `$AGENT_OFFICE_HOME/themes/*.json` (objects, max 64 KB). |
| `GET /health` | `{ok, version, pid, schema, warning?}`; `warning` when a forwarder speaks another protocol. |
| `POST /shutdown` | Token required; stops the daemon. |

`?private=1` on `/state`, `/stream`, `/history` (or `"privacy": true` in office.json) blanks free text: prompts, tool detail/why, task text, final messages, waiting text, errors, cwd/branch. Structure and tool names remain.

## Envelope

```json
{ "schema": 1, "version": "0.0.0", "epoch": "a1b2c3d4e5f6", "rev": 42, "theme": "default",
  "privacy": false, "configError": { "message": "...", "t": 0 },
  "state": { "sessions": {}, "agents": {}, "queue": [], "log": [], "...": "OfficeState without track" },
  "config": { "roles": {} } }
```

`epoch` changes on every daemon start: reset cursors and caches when it differs. `rev` increases on every change (including dropped events), so equal `rev` within an epoch means nothing changed. `configError` is present while office.json is invalid (the last good config stays active).

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

`plugin/hooks/forward.mjs` sends only allowlisted payload fields, stamps `ao_seq`/`ao_proto`, honors `AGENT_OFFICE_DISABLED=1`, and prints only a reply that matches the schema above. On SessionStart with an unreachable daemon it starts one detached (`AGENT_OFFICE_DAEMON` or `packages/server/src/main.ts` next to the plugin) and retries once. `node scripts/office.mjs status|stop|doctor|uninstall` manages the daemon.
