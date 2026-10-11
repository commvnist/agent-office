# Agent Office

Watch your Claude Code agents work in a virtual office: each subagent gets a desk in a shared pool (pods of four, grown with the workload, sessions kept together), a name and a speech bubble; delegations and reports walk across the floor.

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
| Try without Claude Code | The page's **Sample** button (no daemon needed), or `npm run demo` (plays fake sessions into a throwaway daemon and prints its URL; `-- --live` posts to your real one) |
| Start, restart or inspect the daemon | `node scripts/office.mjs start\|restart\|status` (`status` shows event age and per-session lines) |
| Write a starter config, check it offline | `node scripts/office.mjs init`, `node scripts/office.mjs config --validate` |
| Daily digest from stored events | `node scripts/digest.mjs --days 7 [--json]` |
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
  "privacy": false
}
```

| Key | Meaning |
|---|---|
| `roles.<key>.agent` | Subagent type (`plugin/agents/*.md` name) mapped to this role |
| `roles.<key>.count` | Core-team slots (named); more workers of this role are temps. Does not reserve or limit desks |
| `roles.<key>.names` | Display names for the core-team slots |
| `roles.<key>.overflow` | `{ max, names }`: temp naming ("Temp 1") and a hint for the initial office size |
| `parallelism` | `off`, `auto` (default), `aggressive`: how hard the lead is nudged to fan out |
| `enforceSeats` | Deny spawns when every desk is taken (the office holds up to 64) instead of queueing visually |
| `privacy` | Hide prompt/tool text; show tool names and structure only |
| `idleTtlMinutes` | Minutes of silence (1-1440, default 45) before an idle session is swept; unknown keys are ignored with a warning |
| `spendAlarmTokens` | Integer 0-1000000000 (0 or absent = off): the client warns when a session's token total (input + output + cache creation) crosses it |
| `theme` | Ignored: there is one built-in look. Still accepted so old files keep loading |

Loop flag and hot files (observer-only, derived from hook tool events): an agent or lead repeating the same tool with the same target 4+ times in a row gets a `loop` flag until something else happens; `Edit`/`Write`/`MultiEdit`/`NotebookEdit` calls are counted per file path per session (top 50) as "hot files". Paths are hidden in privacy mode.

Some of these options are defined in the types before every consumer ships; see `docs/improvements.md` for status. Ready-made rosters live in `plugin/packs` (`node scripts/apply-pack.mjs --list`, then `node scripts/apply-pack.mjs heist --dry-run`; agents go to `./.claude/agents` unless `--agents-dir` is given, `*.bak` backups are kept and `--undo` restores them).

Environment: `AGENT_OFFICE_PORT` (default 4747), `AGENT_OFFICE_HOME` (default `~/.agent-office`), `AGENT_OFFICE_LOG=1` (append raw events to `events.log`), `AGENT_OFFICE_HOST` (bind address, default 127.0.0.1), `AGENT_OFFICE_DISABLED=1` (hooks do nothing). API: `docs/event-api.md`; CLI: `node scripts/office.mjs status|start|restart|stop|doctor|init|config --validate`. More in `docs/ENTERPRISE.md`.

## Desks and pods

There are no guests: every agent is a worker at a desk in one shared pool of at most 64 desks (pods of four, six pods per wing). Pods stay cohesive: a session claims a fully empty pod, fills it, then spills to the nearest pod; another session only enters a pod owned by someone else once no empty pod remains. Same-role pull is only a tie-break. Beyond 64 agents the rest queue (no desk) and are seated oldest-first as desks free up. `/status?format=json` reports `desks: {used, total, cap}`.

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

## Fun engine (`packages/core/src/fun.ts`)

Pure, observer-only delight derived live from the current events: combos (5/10/20 clean tool calls), highlights for done/blocked, seeded rare delights and commentary. No punishment, nothing tied to viewer actions. The client calls `stepFun(mem, prev, next, now)` per applied envelope, dispatches `out` (max 6) and keeps `mem` in memory only: it is discarded on reload.

## One experience

There are no fun levels and no themes: one look, one set of behaviours. Day and night, weather, window light and dust follow the clock and the work. Combos, highlight cards, rare delights, the attention pulse (ring plus edge vignette) and the slim commentary strip (shown for about 6 s when something new happens, then hidden) are always on. The camera never cuts on its own.

What you can set (Settings dialog): Reduce motion, Pause ambient motion, Sound (chimes, off by default, with volume and mute), text size, font, line height, letter spacing, alert sound and desktop notifications, stream-safe, spend alarm. Follow (Shift+F) is a manual toggle. The OS `prefers-reduced-motion`, `prefers-contrast: more` and forced-colors settings are honoured.

No accounts, no progress, no persisted history: the office is generated live from the current events.
