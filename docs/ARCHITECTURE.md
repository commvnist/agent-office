# Architecture

## Data flow

```
Claude Code hooks -> forwarder (curl today) -> daemon POST /event
  -> adapter (hook payload -> OfficeEvent) -> reducer (core) -> OfficeState
  -> SSE GET /stream -> web client (PixiJS)
```

1. `plugin/hooks/hooks.json` registers SessionStart/End, SubagentStart/Stop, PreToolUse, UserPromptSubmit, Stop, Notification. Each posts the raw hook JSON to `http://127.0.0.1:4747/event` with `curl`. A Node forwarder replacing curl is in progress (#19).
2. `packages/server/src/main.ts` parses the body, runs `adapt()`, folds each event into state with `reduce()`, and pushes a `{state, config}` snapshot to every SSE client. It also serves `GET /state` and the built web client.
3. Hook stdout is parsed by Claude Code: on `session_start` the daemon replies with the lead roster, on `agent_start` with a short identity intro (`additionalContext`). This is the only data returned to Claude.
4. The client renders from snapshots and choreographs new `Interaction` log entries (walk over, talk, report back).

## Packages

| Package | Responsibility |
|---|---|
| `packages/core` | Types (`OfficeConfig`, `OfficeEvent`, `OfficeState`), reducer (`state.ts`), seat allocation, layout and pathfinding (`layout.ts`), roster/intro text (`roster.ts`). Pure: no I/O, no DOM. |
| `packages/server` | `adapter.ts` (the only code that knows the hook shape), `main.ts` (loopback daemon, office.json hot reload, SSE, static serving). |
| `packages/web` | PixiJS client: scene, actors, procedural sprites. Built with Vite to `dist/`. |
| `plugin/` | Claude Code plugin: hooks, subagent definitions, the `office-delegation` skill, role packs. |
| `scripts/` | `demo.mjs`, `check-compliance.mjs`, `apply-pack.mjs`. |

## Event and state flow

`OfficeEvent` types: `session_start/end`, `agent_start/stop`, `tool`, `delegate`, `message`, `prompt`, `turn_end`, `waiting`. A `delegate` (from the Agent tool's PreToolUse) is parked in `state.pending` until the matching SubagentStart, so the agent knows its task and parent. `agent_start` allocates a permanent seat, then an overflow seat, otherwise the agent queues FIFO. `state.log` keeps the recent `Interaction`s the renderer animates.

## Extension points

- **Event sources**: a `SourceAdapter` interface is in progress (#49); today `adapt()` in `adapter.ts` is the single seam.
- **Themes**: removed. One built-in look; config key `theme` is parsed and ignored.
- **Role packs**: JSON `{name, description, roles, agents}` applied by `scripts/apply-pack.mjs`; examples in `plugin/packs`.
