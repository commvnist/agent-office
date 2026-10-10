# Agent Office

Watch your Claude Code agents work in a virtual office: each subagent gets a desk, a name and a speech bubble; delegations and reports walk across the floor.

> Demo GIF: _placeholder, add `docs/demo.gif` here._

**It is** an observer: a Claude Code plugin forwards hook events to a local daemon (loopback only) that streams office state to a browser tab.
**It is not** a controller or a proxy: it never reads `~/.claude` credentials, calls the Anthropic API/SDK, or runs `claude -p` (`npm run check:compliance` enforces this). It is observer-only: it watches, never types into a session.

## Quickstart (from Claude Code)

Once, from the Claude Code prompt (the `!` prefix runs a shell command):

```
! git clone <this repo> ~/agent-office && cd ~/agent-office && npm install && npm run setup
```

then `/reload-plugins` (or start a new session) and open http://localhost:4747. That is all: from then on the plugin's
hooks start the daemon by themselves whenever a session starts.

`npm run setup` is idempotent and does exactly this: builds the web client if needed, records where the daemon lives
(`~/.agent-office/daemon`) so installed hooks can auto-start it, adds this checkout as a user-scope marketplace and
installs the plugin using Claude Code's own `claude plugin marketplace add` / `claude plugin install`, and starts the
daemon. It never prompts Claude. If `claude` is not on PATH it prints the two `/plugin` commands instead.

| Want | Run |
|---|---|
| Check everything | `npm run doctor` |
| See what setup would do | `npm run setup -- --dry-run` |
| Remove the plugin and marketplace | `npm run setup -- --uninstall` |
| Try without Claude Code | `npm run demo` |
| Try without installing | `claude --plugin-dir ./plugin` |

The marketplace manifest is `.claude-plugin/marketplace.json` (plugin source `./plugin`).

## Configuration: `~/.agent-office/office.json`

Re-read on change, no restart needed. Without the file, the built-in roster (architect, 2 frontend, 2 backend, 2 QA, reviewer, researcher) is used.

```json
{
  "roles": {
    "frontend": { "agent": "frontend-dev", "count": 2, "names": ["Maya", "Leo"], "overflow": { "max": 1, "names": ["Temp"] } }
  },
  "parallelism": "auto",
  "enforceSeats": false,
  "privacy": false,
  "theme": "default"
}
```

| Key | Meaning |
|---|---|
| `roles.<key>.agent` | Subagent type (`plugin/agents/*.md` name) mapped to this role |
| `roles.<key>.count` | Permanent desks |
| `roles.<key>.names` | Display names for the desks |
| `roles.<key>.overflow` | `{ max, names }`: extra seats (laptop, folding table) when desks are full; beyond `max` agents queue |
| `parallelism` | `off`, `auto` (default), `aggressive`: how hard the lead is nudged to fan out |
| `enforceSeats` | Deny spawns when no seat is free instead of queueing visually |
| `privacy` | Hide prompt/tool text; show tool names and structure only |
| `theme` | Theme pack name (`~/.agent-office/themes/<name>.json`), default built-in |

Some of these options are defined in the types before every consumer ships; see `docs/improvements.md` for status. Ready-made rosters live in `plugin/packs` (`node scripts/apply-pack.mjs plugin/packs/heist --agents-dir ~/.claude/agents --dry-run`).

Environment: `AGENT_OFFICE_PORT` (default 4747), `AGENT_OFFICE_HOME` (default `~/.agent-office`), `AGENT_OFFICE_LOG=1` (append raw events to `events.log`), `AGENT_OFFICE_HOST` (bind address, default 127.0.0.1), `AGENT_OFFICE_DISABLED=1` (hooks do nothing). API: `docs/event-api.md`; CLI: `node scripts/office.mjs status|stop|doctor`. More in `docs/ENTERPRISE.md`.

## Platforms

| Platform | Status | Notes |
|---|---|---|
| Linux | supported | Node 22.6+; hooks use a Node forwarder |
| macOS | supported | Node 22.6+ |
| Windows | CI-tested for Node code | Hooks are a Node forwarder (no curl); WSL is the smoother path |
| WSL | supported | Run daemon and Claude Code both inside WSL; the browser on Windows reaches `localhost:4747` via WSL2 localhost forwarding |

## Troubleshooting

- **Empty office**: the hooks start the daemon when they can find it (or run `npm run server`), and Claude Code must be launched with `--plugin-dir ./plugin` (check `/plugin`). Run `npm run demo` to confirm the page works.
- **Port in use**: `AGENT_OFFICE_PORT=4800 npm run server`. The daemon writes its port to `$AGENT_OFFICE_HOME/port`, which the hooks read, so no other edits are needed. If it is already running, the second start says so and exits.
- **WSL localhost**: if the Windows browser cannot reach `localhost:4747`, set `localhostForwarding=true` in `%UserProfile%\.wslconfig` and run `wsl --shutdown`, or open the WSL IP directly (the daemon binds loopback only, so use the forwarding option).
- **Blank page**: run `npm run build:web` first; the daemon serves `packages/web/dist`.

## Develop

See `CONTRIBUTING.md` and `docs/ARCHITECTURE.md`. License: MIT.
