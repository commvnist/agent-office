# Enterprise and managed environments

## What leaves the process

Nothing leaves the machine. The daemon binds `127.0.0.1` by default and makes no outbound requests; the plugin never reads `~/.claude` credentials, never prompts or drives Claude (`claude -p`, keystrokes), and never calls the Anthropic API (`npm run check:compliance`). The only use of the `claude` binary is `claude plugin ...` in `scripts/setup.mjs` and `node scripts/office.mjs doctor`.

## What the hooks send

Each registered hook (SessionStart, SessionEnd, SubagentStart, SubagentStop, Notification, PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop) runs `node plugin/hooks/forward.mjs` (no curl). The forwarder posts an allowlisted, clipped subset of the payload (ids, event and tool names, a few tool-input fields, prompt and message text, transcript paths, notification type) to `http://<AGENT_OFFICE_HOST>:<port>/event` with the token from `$AGENT_OFFICE_HOME/token`. The port comes from `AGENT_OFFICE_PORT`, else the `port` file the daemon writes, else 4747.

The daemon clips and redacts text, keeps the office state in memory and appends normalized events to `$AGENT_OFFICE_HOME/events.jsonl` (mode 0600), kept for `historyHours` (default 168, 7 days) and deleted with `node scripts/office.mjs history --purge`. With `"privacy": true` free text is stripped before it is written and transcripts are never read. A raw payload log (`events.log`) is written only when `AGENT_OFFICE_LOG` is set, and never in privacy mode.

Transcript reads (outside privacy mode) are limited to `.jsonl` files under `~/.claude/projects` or the session's cwd: assistant `text` blocks for the lead's narration (last 256 KB) and assistant `usage` numbers for token totals.

## What the office tells the model

With `"protocol": "office"` (the default) the SessionStart and SubagentStart replies add context (roster, identity, report format, a neutral parallelism note) and `enforceSeats` may deny an Agent spawn. `"protocol": "observe"` turns all of that off. The exact text is listed in the README under "Office protocol".

## Managed settings

- **allowManagedHooksOnly**: when an admin sets it, Claude Code ignores plugin hooks that are not managed, so this plugin's hooks will not fire and the office stays empty. The plugin does nothing to circumvent that. Admins who want the office can deliver the same hook entries (`plugin/hooks/hooks.json`) through managed settings.
- **Pin or disable**: admins can restrict which marketplaces are allowed or force-enable/disable `agent-office@agent-office` through Claude Code's managed settings (`enabledPlugins`, marketplace restrictions); consult the Claude Code settings documentation for the current keys. Users can also just not pass `--plugin-dir`.

## Environment variables

| Variable | Effect |
|---|---|
| `AGENT_OFFICE_PORT` | Daemon port (default 4747). The daemon writes the port it bound to `$AGENT_OFFICE_HOME/port`; the forwarder reads it. |
| `AGENT_OFFICE_HOME` | Config, token and log directory (default `~/.agent-office`). |
| `AGENT_OFFICE_LOG` | Any value: append raw hook payloads to `events.log` (ignored in privacy mode). |
| `AGENT_OFFICE_HOST` | Bind address (default `127.0.0.1`). A non-loopback address is refused unless `AGENT_OFFICE_ALLOW_REMOTE=1` is also set; then the daemon logs a warning. Hooks and the browser must use the same host. |
| `AGENT_OFFICE_ALLOW_REMOTE=1` | Explicit opt-in for a non-loopback `AGENT_OFFICE_HOST`. Anyone who can reach it and holds the token can post events. |
| `AGENT_OFFICE_DISABLED=1` | The hook forwarder does nothing. |
| `AGENT_OFFICE_DAEMON` | Path of the daemon entry the forwarder starts when none is running. |
