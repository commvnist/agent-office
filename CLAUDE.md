# Agent Office: working agreements

- **Use ponytail for all development in this repo** (enabled via `.claude/settings.json`, plugin `ponytail@ponytail`, DietrichGebert/ponytail). Smallest complete change; reuse before writing; no speculative options or abstractions; keep the existing structure.
- New non-trivial logic gets a small test (`node --test`, native TS). Known shortcuts get a `// shortcut: <limit>, <when to upgrade>` comment.
- Subagents working in this repo follow the same rules; end each report with what was skipped or not checked and any risk.

## Layout

- `packages/core`: types, reducer, seat allocator, layout. Pure, no I/O, no DOM. `npm test` covers it.
- `packages/server`: hook-payload adapter + localhost daemon.
- `packages/web`: PixiJS client (procedural sprites).
- `plugin/`: Claude Code plugin (hooks, agents, skills).
- `docs/improvements.md`: the 100-item backlog; keep its status column current.
- Visual consistency is enforced, not hoped for: every placed object and baked line comes from `placements()`/`lines()` in `packages/core/src/footprint.ts` (via `packages/web/src/geometry.ts`), and `checkLayout` must return `[]`. See `docs/visual-consistency.md` before adding any object, line or decor kind.

## Guardrails

- Never read `~/.claude` credentials/OAuth tokens or call the Anthropic API/Agent SDK from this project.
- Observer-only. The only sanctioned use of the binary is `claude plugin ...` (plugin management, in `scripts/setup.mjs` and `scripts/office.mjs doctor`). Never `claude -p`/`--print`, headless or programmatic prompting, wrapping the binary, or sending keystrokes into a Claude session; `npm run check:compliance` enforces it.
- Interactive control of Claude from the UI (tmux web terminal) was built and removed at the owner's request; a backup tarball sits next to the repo. Do not reintroduce it without being asked.
- Transcript reads are limited to narration and token totals (`packages/server/src/usage.ts`): only a `.jsonl` whose real path is under `~/.claude/projects` or the session's own cwd (never `/` or the home directory), only `assistant` `text` blocks for narration (never tool inputs, tool results or user messages), last 256 KB, redacted, clipped, blank in privacy mode. Do not widen it.
- Bind to loopback only. Displayed text is untrusted input.
