# Enterprise and managed environments

## What leaves the process

Nothing leaves the machine. The daemon binds `127.0.0.1` by default and makes no outbound requests (the one opt-in exception is the read-only network viewer below, which only answers paired devices on a private network); the plugin never reads `~/.claude` credentials, never prompts or drives Claude (`claude -p`, keystrokes), and never calls the Anthropic API (`npm run check:compliance`). The only use of the `claude` binary is `claude plugin ...` in `scripts/setup.mjs` and `node scripts/office.mjs doctor`.

## What the hooks send

Each registered hook (SessionStart, SessionEnd, SubagentStart, SubagentStop, Notification, PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop) runs `node plugin/hooks/forward.mjs` (no curl). The forwarder posts an allowlisted, clipped subset of the payload (ids, event and tool names, a few tool-input fields, prompt and message text, transcript paths, notification type) to `http://<AGENT_OFFICE_HOST>:<port>/event` with the token from `$AGENT_OFFICE_HOME/token`. The port comes from `AGENT_OFFICE_PORT`, else the `port` file the daemon writes, else 4747.

The daemon clips and redacts text, keeps the office state in memory and appends normalized events to per-day files in `$AGENT_OFFICE_HOME/events/` (folder 0700, files 0600): `YYYY-MM-DD.jsonl` (structure: ids, tool names, outcomes, token totals, no free text), `YYYY-MM-DD.text.jsonl` (the free text, kept for `textHours`, default = `historyHours`) and `YYYY-MM-DD.idx` (seek index). Whole days are kept for `historyHours` (default 168, 7 days); `node scripts/office.mjs history --purge` deletes everything, `--purge-text` only the text (and the raw `events.log`). A legacy `events.jsonl` from older versions is read and pruned but never written. With `"privacy": true` no text file is written, the project (folder name) is stored and served as a pseudonym (`session-<4 hex>`), the lead's final answer is not kept, and transcripts are never read.

Cross-machine reporting: there is no inbound listener and no export service. `node scripts/digest.mjs --json --counts` prints a read-only digest (per-day sessions, agents by type, outcome counts, tokens, errors, active hours, top tool names; no free text, no file paths) that can be collected by whatever the organisation already uses. A raw payload log (`events.log`) is written only when `AGENT_OFFICE_LOG` is set, and never in privacy mode; it is pruned by `historyHours`.

Transcript reads (outside privacy mode) are limited to `.jsonl` files under `~/.claude/projects` or the session's cwd: assistant `text` blocks for the lead's narration (last 256 KB) and assistant `usage` numbers for token totals.

## Share on the local network

An opt-in, read-only viewer for phones and tablets on the same network (`node scripts/office.mjs share on`, Settings > Share on network, or `"share": {"enabled": true}`). Hooks and control stay on loopback; this is a second listener with its own route table.

- **Where**: HTTPS on `share.address:share.port` (default the first private IPv4, port 4748). Only 10/8, 172.16/12, 192.168/16, 169.254/16, fd00::/8 and fe80::/10 are accepted; anything else refuses to start. `Host` must equal that address and port.
- **TLS**: a self-signed EC P-256 certificate (SAN = the address, 2 years) generated with `node:crypto`, stored in `$AGENT_OFFICE_HOME/tls/` (folder 0700, files 0600), reused while the address matches. The SHA-256 fingerprint is shown on the host to compare.
- **Pairing**: the host shows a 6-digit code (random, single use, 2 minutes, one at a time). Five wrong codes from anywhere void it and lock pairing for 60 s. A paired device gets a 32-byte random token in an `HttpOnly; Secure; SameSite=Strict` cookie; only its SHA-256 is stored (`devices.json`, 0600) and compared in constant time. Unused for 30 days, it expires. Revoking deletes it and closes its open streams at once.
- **Routes**: `GET/POST /pair`, and with a device cookie `GET /state`, `/stream`, `/history` and the web build. No `/event`, `/shutdown`, `/share*`, `/status`, `/outcomes` or `/health`; the master token and the browser's UI token mean nothing there, and the device cookie means nothing on loopback.
- **Limits**: 2 streams per device, 10 in total; stops after `stopAfterHours` (default 8).
- **Audit**: `share.log` records on/off, pairings (device id, name, source address), failed attempts, lockouts and revokes; no codes or tokens.

Three credentials, kept apart: `token` (hooks and CLI: `POST /event`, `/shutdown`, every read; header only, never a cookie), `ui-token` (the loopback page's `ao_ui` cookie: reads and the share controls, never `/event` or `/shutdown`), and per-device tokens (the network viewer only).

### Threat model

- **A paired device** sees what the host's page shows: sessions, agents, the log, outcomes and history, including prompts, tool detail and the lead's narration, unless `privacy` is on (then the same structure without text, as on the host). The envelope's `config` is included (roles, settings). It cannot post events, stop the daemon, change settings, pair or revoke devices, or reach `/status` and `/outcomes`. Anyone holding the phone holds that view until it is revoked or 30 days pass unused.
- **An unpaired device on the network** sees a TLS listener on the share port while sharing is on, the certificate (names only "Agent Office" and the IP), and the pairing form. Every other request gets 302 to `/pair`, 401 or 404. Guessing the code: 5 tries per code, then the code is void and pairing locks for 60 s; the host must issue a new code, so a guess succeeds with about 5 in a million per code issued. It can spam wrong codes to keep pairing locked (denial of service, visible in `share.log`).
- **Someone in the path** (same Wi-Fi, ARP spoofing) could present their own certificate at first visit; comparing the fingerprint on the host defeats that. After pairing, the device cookie is `Secure` (never sent over plain HTTP) but, as with any cookie, not tied to one port: the phone also sends it to other HTTPS services on the host's address. It grants read access to this viewer only. The per-page Private toggle on the host does not hide text from phones; `privacy` in office.json does. Turning `share.enabled` on in office.json starts sharing at every daemon start, and the auto-stop timer counts from that start.
- **Not covered**: a compromised host or device; networks where "private" is not trusted (hotel, conference Wi-Fi): do not share there. Turn it off with `share off`; it also stops on its own.

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
