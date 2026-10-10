# Subagent brief template

Copy, fill every field, delete none. The subagent has no conversation context.

```
GOAL
<one or two sentences: the outcome, and why it matters to the larger task>

OWNED FILES (edit only these)
- <path or glob>
- <path or glob>

READ-ONLY CONTEXT (may read, must not edit)
- <path>: <why relevant>

CONTRACT / INTERFACES
<exact signatures, endpoint shapes, types the work must conform to, inline>

SHARED NOTES
- Read .office/notes.md before starting; append short dated lines under "Findings".
- Write plans/findings to .office/handoff/<role>-<short-task>.md and cite the path in the DONE line.

CONSTRAINTS
- Do not touch files outside OWNED FILES; other agents are editing them in parallel.
- No broad destructive commands (rm -r, git reset --hard, git clean, force push).
- <project-specific: style, no new dependencies, etc.>

DEFINITION OF DONE
- <observable condition, e.g. "GET /api/x returns the shape above">
- <check to run and expected result, e.g. "npm test -- favorites passes">

REPORT FORMAT
Final message starts with one plain-text line: "DONE: <what you did, max 90 chars>" or
"BLOCKED: <why, max 90 chars>"; "PARTIAL: <done / remaining>" when ~5 turns from maxTurns. Then at most ~150 words: files touched, checks run,
follow-ups needed from other roles.
```

## Example 1

Bad:

```
Add the favorites thing to the backend like we discussed. Make sure it works with the UI.
```

Why bad: no context ("discussed"), no owned files, no contract, no done criteria, no report format.

Good:

```
GOAL
Add favorites endpoints so the UI can star items per user.

OWNED FILES (edit only these)
- server/routes/favorites.ts (new)
- server/db/favorites.ts (new)
- server/routes/index.ts (register the route only)

READ-ONLY CONTEXT
- server/routes/items.ts: pattern for auth and validation to copy

CONTRACT / INTERFACES
POST /api/favorites body {itemId: string} -> 200 {ok: true}; 404 if item missing
GET /api/favorites -> 200 {items: string[]} (item ids for the current user)

CONSTRAINTS
- Do not touch client/ or tests/; other agents own them.
- No new dependencies.

DEFINITION OF DONE
- Both endpoints behave as specified for an authenticated user.
- npm run typecheck passes.

REPORT FORMAT
First line "DONE: ..." or "BLOCKED: ..." (max 90 chars, plain text), then <=150 words.
```

## Example 2

Bad:

```
Review everything and fix whatever is wrong.
```

Why bad: unbounded scope, reviewer is read-only so "fix" conflicts with its role, no target.

Good:

```
GOAL
Review the uncommitted changes for correctness and security before we report to the user.

OWNED FILES
- none (read-only; do not edit)

READ-ONLY CONTEXT
- git diff HEAD: the changes under review
- server/routes/favorites.ts and client/api/favorites.ts must agree on the contract below

CONTRACT / INTERFACES
POST /api/favorites {itemId} -> {ok: true}; GET /api/favorites -> {items: string[]}

CONSTRAINTS
- Report findings as path:line, reason, suggested fix. Blocking issues first.

DEFINITION OF DONE
- Every changed file read; verdict stated in the DONE line.

REPORT FORMAT
First line "DONE: ..." or "BLOCKED: ..." (max 90 chars, plain text), then <=150 words.
```
