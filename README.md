# Agent Office

Watch your Claude Code agents work in a virtual office: each subagent gets a desk in a shared pool (pods of four, grown with the workload, sessions kept together), a name and a speech bubble; delegations and reports walk across the floor.

> Demo GIF: _placeholder, add `docs/demo.gif` here._

**It is** an observer: a Claude Code plugin forwards hook events to a local daemon (loopback only) that streams office state to a browser tab.
**It is not** a controller or a proxy: it never reads `~/.claude` credentials, calls the Anthropic API/SDK, or runs `claude -p` (`npm run check:compliance` enforces this). It never types into a session. By default it does add a little context to the model (the office protocol, below); `"protocol": "observe"` turns that off.

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
| Daily digest from stored events | `node scripts/digest.mjs --days 7 [--json] [--counts]` (only as far back as `historyHours` keeps; `--counts` leaves out file paths, for sharing) |
| See or delete the stored history | `node scripts/office.mjs history`, `node scripts/office.mjs history --purge` (everything), `node scripts/office.mjs history --purge-text` (free text only, the timeline stays) |
| Try without installing | `claude --plugin-dir ./plugin` |

The marketplace manifest is `.claude-plugin/marketplace.json` (plugin source `./plugin`).

## Configuration: `~/.agent-office/office.json`

Re-read on change, no restart needed. Without the file, the built-in roster (architect, 2 frontend, 2 backend, 2 QA, reviewer, researcher) is used.

```json
{
  "roles": {
    "frontend": { "agent": "frontend-dev", "count": 2, "names": ["Maya", "Leo"], "overflow": { "max": 1, "names": ["Temp"] } }
  },
  "protocol": "office",
  "parallelism": "auto",
  "enforceSeats": false,
  "privacy": false,
  "historyHours": 168
}
```

| Key | Meaning |
|---|---|
| `roles.<key>.agent` | Subagent type (`plugin/agents/*.md` name) mapped to this role |
| `roles.<key>.count` | Core-team slots (named); more workers of this role are temps. Does not reserve or limit desks |
| `roles.<key>.names` | Display names for the core-team slots |
| `roles.<key>.overflow` | `{ max, names }`: temp naming ("Temp 1") and a hint for the initial office size |
| `protocol` | `office` (default) or `observe`: whether the office adds context to the model and may deny spawns (see "Office protocol") |
| `parallelism` | `off`, `auto` (default, a neutral note: delegating is optional), `aggressive` (asks the lead to split work and fan out). Office protocol only |
| `enforceSeats` | Deny spawns when every desk is taken (the office holds up to 64) instead of queueing visually. Office protocol only |
| `privacy` | Hide prompt/tool text; show tool names and structure only. Also: free text is stripped before anything is written to disk, and transcripts are never opened (no narration, no token totals) |
| `historyHours` | Hours of event history kept on disk (1-2160, default 168 = 7 days, matching the 7-day digest); older events are deleted at start and hourly (whole UTC day files, so disk may hold up to a day more; reads never return older events) |
| `textHours` | Hours the free text of stored events is kept (1-2160, default = `historyHours`); older text files are deleted earlier and the timeline (structure, tool names, counts) stays |
| `idleTtlMinutes` | Minutes of silence (1-1440, default 45) before an idle session is swept; unknown keys are ignored with a warning |
| `spendAlarmTokens` | Integer 0-1000000000 (0 or absent = off): the client warns when a session's token total (input + output + cache creation) crosses it |
| `theme` | Ignored: there is one built-in look. Still accepted so old files keep loading |

Hot files (observer-only, derived from hook tool events): `Edit`/`Write`/`MultiEdit`/`NotebookEdit` calls are counted per file path per session (top 50) as "hot files". Paths are hidden in privacy mode.

Some of these options are defined in the types before every consumer ships; see `docs/improvements.md` for status. Ready-made rosters live in `plugin/packs` (`node scripts/apply-pack.mjs --list`, then `node scripts/apply-pack.mjs heist --dry-run`; agents go to `./.claude/agents` unless `--agents-dir` is given, `*.bak` backups are kept and `--undo` restores them).

Environment: `AGENT_OFFICE_PORT` (default 4747), `AGENT_OFFICE_HOME` (default `~/.agent-office`), `AGENT_OFFICE_LOG=1` (append raw hook payloads to `events.log`; ignored in privacy mode), `AGENT_OFFICE_HOST` (bind address, default 127.0.0.1; a non-loopback address is refused unless `AGENT_OFFICE_ALLOW_REMOTE=1` is also set), `AGENT_OFFICE_DISABLED=1` (hooks do nothing). API: `docs/event-api.md`; CLI: `node scripts/office.mjs status|start|restart|stop|doctor|init|config --validate|history [--purge|--purge-text]`. More in `docs/ENTERPRISE.md`.

### Office protocol: what the office tells the model

With `"protocol": "office"` (the default) the daemon's hook replies add text to the model's context. Exactly this:

- **SessionStart** (the lead): one line saying an office view is watching and delegating is optional; with `parallelism` `auto` a neutral note that independent subagents started in one message run in parallel (`aggressive` instead asks the lead to split work and fan out; `off` says nothing); the roster of subagent types with names and counts; a pointer to the `office-delegation` skill. Source: `leadRoster` in `packages/core/src/roster.ts`.
- **SubagentStart** (each helper): its name and role, its task, what its seated peers are doing, and the report format (first line `DONE:`, `BLOCKED:` or `PARTIAL:`). Source: `introFor` in the same file.
- **PreToolUse** of the Agent tool, only with `enforceSeats: true`: a deny when every desk is taken (at most 3 times in a row).

The plugin also ships agent definitions and the `office-delegation` skill; Claude loads those only when it chooses to. With `"protocol": "observe"` nothing is added and nothing is denied: the office only watches (subagents then report in their own words, so outcomes show as unrecognized more often).

### What is stored, where, for how long

- **Event log**: one set of files per UTC day in `~/.agent-office/events/` (folder mode 0700, files 0600). It powers restart recovery, History, Replay, Recap and the digest.
  - `YYYY-MM-DD.jsonl`: every normalized event without its free text: type, session and agent ids, tool names, project folder name, ok/failed, report outcome (done/blocked/partial), token totals, times.
  - `YYYY-MM-DD.text.jsonl`: the free text of those events (clipped and redacted prompts, tool detail and reasons, task and report text, errors, working folder and branch), keyed by the byte offset of its event line. Kept for `textHours` (default = `historyHours`); deleting it keeps the timeline. Never written in privacy mode.
  - `YYYY-MM-DD.idx`: `time offset textOffset` lines so history reads can seek.
  - Whole days are kept for `historyHours` (default 168 h, 7 days).
- **Legacy event log** `events.jsonl` (+ `events.jsonl.1`): written by versions before the per-day files, text inline. Still read for history from before the switch, pruned by `historyHours` as before, never written again.
- **Raw log** `events.log`: only when `AGENT_OFFICE_LOG` is set (never in privacy mode).
- **Also in that folder**: `office.json`, `token`, `port`/`pid`, `daemon` (path of the daemon), `last-hook.json` (last hook name and session id) and `seq/` (per-session counters, no text).
- **Delete**: `node scripts/office.mjs history --purge` (day files, legacy and raw logs), `node scripts/office.mjs history --purge-text` (only the `.text.jsonl` files), or `node scripts/office.mjs uninstall --purge` (the whole folder). Nothing is stored anywhere else and nothing leaves the machine.

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

## What it shows, and what it ignores

- **Your prompts, not the harness's.** Claude Code injects machine messages into a session as "user" turns (background-task notifications, system reminders, subagent hand-backs). They are not what you typed: they are never shown as "You →", never become the session prompt, and a hand-back's first report line appears as a quiet note from the lead. See `packages/core/src/clean.ts`.
- **The lead's own words.** What the lead says between tool calls is shown as a bubble at its desk and in the activity feed. It is read from the session's transcript file (only `assistant` `text` blocks; never tool inputs, tool results or your messages; only a `.jsonl` under `~/.claude/projects` or the session's cwd; history before the daemon first saw the session is skipped), redacted, clipped to 160 characters, and never read in privacy mode.
- **Spend.** Token totals per session add up the lead's transcript and its subagents' transcripts (`agent_transcript_path`), reading only the assistant `usage` numbers, only bytes appended since the last read (at most 8 MB at a time), refreshed every few seconds while tools run and at every stop. Each message id counts once, so totals never shrink when a transcript grows. Same path rules as above; never read in privacy mode. The turn's final message also comes from the Stop hook's `last_assistant_message`.
- **Leads** look like variations of one portrait: curly dark hair, aviators in a tint that varies per session, a light blazer, a beard, an open patterned collar and sometimes a gold chain. Crew members without a configured name get a person's name, seeded by project, role and slot, so the same project has the same people every run.
- **Pod labels on hover.** A claimed pod's project name and last prompt appear while the pointer is over it (on touch: for the selected agent's pod). A click on the empty floor clears the selection.

## Fun engine (`packages/core/src/fun.ts`)

Pure, observer-only delight derived live from the current events: combos (5/10/20 clean tool calls), highlights for done/blocked, seeded rare delights and commentary. No punishment, nothing tied to viewer actions. The client calls `stepFun(mem, prev, next, now)` per applied envelope, dispatches `out` (max 6) and keeps `mem` in memory only: it is discarded on reload.

## One experience

There are no fun levels and no themes: one look, one set of behaviours. Day and night, weather, window light and dust follow the clock and the work. Combos, highlight cards, rare delights, the attention pulse (ring plus edge vignette) and the slim commentary strip (shown for about 6 s when something new happens, then hidden) are always on. The camera never cuts on its own.

What you can set (Settings dialog): Reduce motion, Pause ambient motion, Sound (chimes, off by default, with volume and mute), text size, font, line height, letter spacing, alert sound and desktop notifications, stream-safe, spend alarm. Follow (Shift+F) is a manual toggle. The OS `prefers-reduced-motion`, `prefers-contrast: more` and forced-colors settings are honoured.

No accounts and no progress. The office is generated live from the current events; the only history is the local event log described under "What is stored", kept for `historyHours` and deleted with `node scripts/office.mjs history --purge`.
