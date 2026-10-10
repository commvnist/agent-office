---
name: office-delegation
description: Use when a task has multiple independent parts, spans frontend/backend/tests, or the user asks for parallel, team or multi-agent work. Teaches the lead to split work into disjoint packages and fan out to office subagents concurrently.
---
# Office delegation

You are the lead. Subagents do the work; you decompose, dispatch, and synthesize. Brief format: BRIEF_TEMPLATE.md. Details (worktrees, custom roles, models): REFERENCE.md.

Roster (use names exactly): architect (plans, read-only), researcher (lookups, read-only), frontend-dev, backend-dev, devops (CI/build/config), docs-writer (docs only), qa-engineer (tests), reviewer (read-only), security-auditor (read-only). The injected session line lists seats and the active mode.

## 1. Parallelism mode and size gate

The injected roster line says `Parallelism: off|auto|aggressive`.
- off: never fan out on your own; delegate only when the user asks.
- auto (default): fan out only for 2+ independent parts. Size gate: a task of <= 2 files or one concern is done by you or one agent; skip the architect and review waves.
- aggressive: split as finely as ownership allows and run every wave.

Never parallelize tightly coupled edits (same function/file) or unclear requirements; run architect/researcher first.

## 2. Decompose

1. List packages: role, owned paths, definition of done. Ownership must be disjoint (merge, sequence, or worktree-isolate overlaps).
2. Fix shared interfaces up front and put them in every affected brief.
3. Create shared notes: `node plugin/scripts/notes.mjs init "<contracts>"` makes `.office/notes.md` (self-ignoring). Agents read it first and append dated lines under Findings.
4. Waves: (1) architect/researcher if needed; (2) developers, devops, docs-writer in parallel; (3) qa-engineer, reviewer, security-auditor in parallel.
5. Plans and findings go to `.office/handoff/<role>-<short-task>.md`; agents cite the path in their DONE line; give the next wave those paths.

## 3. Fan out

- Launch every independent subagent of a wave in ONE message with multiple Agent calls; start a later wave only after the earlier one reported.
- Do not run more concurrent subagents than free seats; run the surplus in a following wave.
- Do not edit files agents own while they run.
- Briefs are self-contained (goal, owned paths, contract, constraints, done, report format); use BRIEF_TEMPLATE.md.

## 4. After each wave

1. Read every first line: DONE:, BLOCKED:, PARTIAL:.
2. Verify ownership: `node plugin/scripts/verify-ownership.mjs '{"backend-dev":["server/**"],...}'`. Fix unowned/overlap files before the next wave.
3. BLOCKED: answer the blocker and re-dispatch ONCE with a corrected brief. If it blocks again, stop and escalate to the user with a one-line summary. Max 1 retry per package.
4. PARTIAL: treat as unfinished. Re-dispatch the remainder as a smaller package (counts as the one retry) or finish it yourself.
5. Review loop: max 2 review rounds. Only blocking findings get fixed; report the remaining ones to the user instead of another round.
6. Run tests/typecheck yourself or via qa-engineer. Do not report success on agent claims alone.
7. Reply to the user concisely: what changed, what was verified, what remains.

## 5. Models

Cheap-first: researcher and docs-writer pin haiku; reviewer and security-auditor pin sonnet; the rest inherit your model.
Rationale: lookups and prose are cheap, review needs judgment but not the top tier, and writing code stays on the session model.

## 6. Example

"Add favorites (API + UI + tests)": wave 1 architect + researcher; fix the contract in notes; wave 2 backend-dev + frontend-dev; verify ownership; wave 3 qa-engineer + reviewer; fix blocking findings once; summarize.
