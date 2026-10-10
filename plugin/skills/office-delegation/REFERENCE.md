# Office delegation reference

## Worktree isolation (overlapping writers)

Prefer disjoint ownership; use worktrees only when two writers must touch the same files.
1. Launch each overlapping writer with `isolation: "worktree"` (Agent tool). Each gets its own branch.
2. After the wave, merge in dependency order (contract owner first, then consumers): `git merge --no-ff <branch>`.
3. On conflict, do not auto-resolve silently. Report: `CONFLICT: <file> | <branchA> vs <branchB> | <one-line what each changed>`, resolve, then run tests.
4. Cleanup: `git worktree remove <path>` and `git branch -d <branch>` for each merged one; unchanged worktrees are removed automatically.

## Custom roles

1. Copy `plugin/templates/custom-agent.md` to `plugin/agents/<name>.md` (agent files load only from `agents/`; the template does not).
2. Set `name:` equal to the file name without `.md`.
3. Add a role entry in office.json: `"roles": {"<key>": {"agent": "<name>", "count": 1, "names": [...]}}`. `agent` must match the agent file name exactly.
4. Collisions: do not reuse a built-in name (architect, researcher, frontend-dev, backend-dev, devops, docs-writer, qa-engineer, reviewer, security-auditor); the built-in wins or the role is ambiguous. Each role key and `agent` must be unique within office.json.
5. Keep the DONE:/BLOCKED:/PARTIAL: reporting contract so the office shows the result.

## Retry and escalation

Max 1 retry per BLOCKED or PARTIAL package. Second failure: stop, tell the user in one line (package, blocker, what you tried).

## Shared files

- `.office/notes.md`: Contracts (written by lead) and Findings (dated lines appended by agents). Helper: `plugin/scripts/notes.mjs init|append|read`.
- `.office/handoff/<role>-<short-task>.md`: plan or findings for the next wave. `.office/` ignores itself.
