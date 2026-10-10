# Enterprise and managed environments

## What leaves the process

Nothing leaves the machine. The daemon binds `127.0.0.1` only and makes no outbound requests; the plugin never reads `~/.claude` credentials, runs `claude` itself, or calls the Anthropic API (`npm run check:compliance`).

## What the hooks send

Each registered hook (SessionStart, SessionEnd, SubagentStart, SubagentStop, Notification, PreToolUse, UserPromptSubmit, Stop) posts the hook payload JSON to `http://127.0.0.1:4747/event`. Payloads contain tool inputs and prompt text as Claude Code provides them. The daemon keeps only short clipped excerpts in memory and writes a raw log to `$AGENT_OFFICE_HOME/events.log` only when `AGENT_OFFICE_LOG` is set. A `privacy` option to hide text in the stream is planned/partial (see `docs/improvements.md`). The daemon's response to SessionStart and SubagentStart carries roster/identity context back to the model.

## Managed settings

- **allowManagedHooksOnly**: when an admin sets it, Claude Code ignores plugin hooks that are not managed, so this plugin's hooks will not fire and the office stays empty. The plugin does nothing to circumvent that. Admins who want the office can deliver the same hook entries (`plugin/hooks/hooks.json`) through managed settings. Native http-type hooks as an alternative to curl are planned.
- **Pin or disable**: admins can restrict which marketplaces are allowed or force-enable/disable `agent-office@agent-office` through Claude Code's managed settings (`enabledPlugins`, marketplace restrictions); consult the Claude Code settings documentation for the current keys. Users can also just not pass `--plugin-dir`.

## Environment variables

| Variable | Status | Effect |
|---|---|---|
| `AGENT_OFFICE_PORT` | implemented | Daemon port (default 4747). The hook URL is fixed to 4747 today. |
| `AGENT_OFFICE_HOME` | implemented | Config and log directory (default `~/.agent-office`). |
| `AGENT_OFFICE_LOG` | implemented | Any value: append raw events to `events.log`. |
| `AGENT_OFFICE_HOST` | planned | Bind address; the daemon is loopback-only today. |
| `AGENT_OFFICE_DISABLED=1` | planned | Off switch the Node hook forwarder will honor. |

## curl

Today the hooks use `curl`. A Node hook forwarder that removes the curl requirement is planned (#19).
