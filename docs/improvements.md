# Agent Office: 100 improvements

Source: 9 simulated focus groups (4 participants each) plus an earlier 6-persona round, merged and deduplicated.
These are model-simulated personas, so treat them as hypotheses. Verified by me: #1 (daemon crash on malformed input).
Dropped as false: "plugin manifest missing" (it exists).

**Status (all 100 implemented; 15 are PARTIAL with the reason in the column).** Nothing here was verified against a live Claude Code session or on Windows/macOS; the web client was exercised in headless Chromium against the demo scenario and a fake `claude` in tmux.

Impact / effort: H M L = high medium low, S M L = small medium large.

## A. Trust, security and compliance

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 1 | Daemon crashes on malformed input | `adapt(null)` and `decodeURIComponent("/%")` throw uncaught; one bad POST kills the daemon and its state. Guard handlers and process | H | S | fix | DONE |
| 2 | Authenticate and origin-check the daemon | Host/Origin validation plus per-install token on /event, /state, /stream; stops DNS rebinding and forged events | H | M | risk | DONE |
| 3 | Hook accepts only schema-checked replies | Handshake with the daemon; discard non-JSON/oversized stdout so a port squatter cannot inject model context | H | M | risk | DONE |
| 4 | Minimal hook payload allowlist | Hooks send full tool_input (file contents); adapter only needs clipped fields | M | S | fix | DONE |
| 5 | Cap bodies, state size, log permissions | Request body limit, bounded agents/pending/guests, events.log 0600 with timestamps and rotation | H | S | fix | DONE |
| 6 | Validate ids; null-prototype maps | Ids like `constructor` or `a\|b` corrupt state and pending keys; enforce `^[\w-]{1,64}$` | M | S | fix | DONE |
| 7 | Gate events on a known session | Ignore delegate/agent events for unseen sessions (capped lazy-create for restart recovery) | M | M | risk | DONE |
| 8 | Strip control and bidi characters | U+202E, zero-width and ANSI can spoof bubbles/board text | M | S | fix | DONE |
| 9 | Redact secrets in prompts, commands, URLs | Redaction pass in the adapter before SSE and logs | M | S | risk | DONE |
| 10 | Privacy / screenshot mode | Blur or hide text, fake project names; default on for capture | H | S | risk | DONE |
| 11 | Validate office.json as model-context input | Names are interpolated into injected context; schema-check, strip control chars, cap lengths | H | M | risk | DONE |
| 12 | Subscription-compliance guard | CI check failing on spawning `claude -p`, reading ~/.claude credentials or calling the API; document observe-only | M | S | feature | DONE |
| 13 | Enterprise managed-policy fit | Behavior under allowManagedHooksOnly, an off switch, native http-hook alternative | M | M | feature | DONE |

## B. Setup, install and lifecycle

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 14 | Auto-start the daemon from the plugin | SessionStart launches or reuses the daemon; no manual `npm run server` | H | M | feature | DONE |
| 15 | Plugin install path and marketplace | `/plugin install` then open localhost; first run says what to do | H | M | feature | PARTIAL: marketplace.json written; `/plugin marketplace add` not run |
| 16 | Prebuilt web dist or "not built" page | Users must npm install and build before seeing anything | H | M | fix | DONE |
| 17 | README, LICENSE, quickstart, CONTRIBUTING | 5-minute quickstart, platform matrix, config reference, troubleshooting, demo GIF, MIT | H | S | fix | DONE |
| 18 | Hook port follows AGENT_OFFICE_PORT | hooks.json hardcodes 4747 in 8 places; changing the port silently severs events | H | S | fix | DONE |
| 19 | Node hook forwarder instead of curl | Removes the Windows/curl dependency; handles port, timeout, errors | H | M | fix | DONE |
| 20 | Node version gate with a clear error | Native TS stripping needs a recent Node; older versions die obscurely | M | S | fix | PARTIAL: gate lives in CLI + forwarder; Node <22.6 cannot parse main.ts at all |
| 21 | Port-in-use / duplicate daemon handling | /health ping, "already running", exit 0 so auto-start is idempotent | H | S | fix | DONE |
| 22 | Remote/container bind option | AGENT_OFFICE_HOST and hook target override; SSH/devcontainer tunnel recipes | H | M | feature | DONE |
| 23 | Version handshake, upgrade, uninstall | Schema-version events, mismatch warning, stop/doctor/uninstall commands | M | M | risk | DONE |
| 24 | Low-overhead async hook forwarding | PreToolUse spawns a process per tool call; fire-and-forget with short timeout | M | M | polish | DONE |
| 25 | Surface config errors in the UI | Keep last-good config; show validation errors instead of failing silently | M | M | feature | DONE |
| 26 | CI: typecheck and cross-OS tests | `tsc --noEmit`, node --test on ubuntu/macos/windows, Node 22/24 | H | S | risk | PARTIAL: CI workflow written; never ran on GitHub |

## C. Data accuracy and observability

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 27 | Reap zombie sessions and agents | Crashed sessions never send SessionEnd; ghosts hold seats forever. TTL on last activity | H | S | fix | PARTIAL: reaps whole sessions only; idle agents inside a live session stay |
| 28 | Orphaned delegations poison matching | A denied/failed Agent call leaves a pending entry; the next same-type start inherits the wrong task | H | S | fix | DONE |
| 29 | Mark low-confidence attributions | Show when parallel same-type matches are ambiguous instead of silently mislabeling | M | S | feature | DONE |
| 30 | Recover unknown sessions after restart | Auto-create a session on first sighting, flagged "recovered" | H | S | fix | DONE |
| 31 | Resume/compact must merge, not clobber | session_start replaces state; capture `source`, keep startedAt and prompt | M | S | fix | DONE |
| 32 | Persist events; restore on boot | Append-only versioned log replayed at startup; no empty office while sessions live | H | M | risk | DONE |
| 33 | Timeline replay of past runs | Scrub stored events for post-mortems of long runs | H | L | feature | DONE |
| 34 | PostToolUse/Failure: durations, errors, true idle | Tell a 5-minute build from a hang; failures stop looking like silence | H | M | feature | DONE |
| 35 | Per-agent lifetime, queue wait, tool counts | startedAt/stoppedAt on agents; utilization and slowest-agent metrics | M | S | feature | DONE |
| 36 | Cost, token and time per agent/session | Derive from transcript usage data (feasibility unverified) | H | L | feature | PARTIAL: sums transcript usage (fixture-tested); not verified against real transcripts |
| 37 | Event gap detection and sequencing | Per-session sequence/heartbeat, "possible gaps" indicator, causal ordering | H | M | feature | PARTIAL: false gaps possible from parallel hooks (append-and-stat counter) |
| 38 | Idempotent event handling | Dedupe repeated hooks by (session, hook, tool_use_id) | M | S | fix | DONE |
| 39 | Disambiguate project labels | basename(cwd) collides across worktrees; add parent dir or branch | L | S | polish | DONE |
| 40 | Bound and prune every map and log | Global 40-entry log lets one chatty session evict others; meta/lastBusy/visitors never pruned | M | S | fix | DONE |

## D. Reliability and engineering

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 41 | Client `seen` breaks after daemon restart | Log ids restart at 1 while the browser keeps a high cursor; new interactions silently skipped | H | S | fix | DONE |
| 42 | Relayout wipes in-flight choreography | A session joining resets every actor's steps; re-route instead | M | M | fix | PARTIAL: relayout keeps speech/exits but drops queued walk steps |
| 43 | Config edit must not replay history | `seen = -1` on config change; dedupe by log id only | M | S | fix | DONE |
| 44 | Resize hysteresis and debounce | Layout thrash near band-count ties re-seats everyone repeatedly | M | S | polish | DONE |
| 45 | Hidden-tab fast-forward | rAF pauses while SSE delivers; choreography replays in a burst on return | M | M | risk | PARTIAL: implemented; not exercised in a browser |
| 46 | SSE heartbeat, backpressure, resume cursor | No keepalive, ignores drain, no Last-Event-ID, no client cap | M | S | risk | DONE |
| 47 | Diff snapshots; cut per-frame allocations | Whole-state JSON per event per client; ticker rebuilds maps and sorts every frame | M | M | polish | PARTIAL: snapshots skip stale revs; scene.tick still joins board text each frame |
| 48 | Extract a pure choreography planner and test it | The riskiest logic lives untested in main.ts | H | M | risk | DONE |
| 49 | SourceAdapter and ThemePack interfaces | New event sources or themes without editing core | M | L | feature | DONE |

## E. Agent workflow and orchestration

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 50 | Parallelism mode plus size/cost gate | off / auto / aggressive; skip the architect wave for small tasks; stop silent quota burn | H | S | fix | DONE |
| 51 | Retry and escalation policy | Cap retries on BLOCKED; escalate to the user instead of looping | H | S | fix | DONE |
| 52 | Bound the review-fix loop | Max iterations and a severity threshold so agents cannot ping-pong | H | S | risk | DONE |
| 53 | Enforce seat caps on spawns | PreToolUse hook on the Agent tool denies or queues beyond capacity (toggle) | H | M | feature | DONE |
| 54 | Add devops, docs and security-audit roles | Today the lead stuffs these into backend-dev/reviewer, blurring ownership | M | M | feature | DONE |
| 55 | Shared run notes / contract file | Lead seeds a notes file all agents append to; agents currently see only names | H | M | feature | DONE |
| 56 | Structured hand-off artifacts | plan.md / findings.json paths the next wave reads, instead of 150-word prose | M | M | feature | DONE |
| 57 | Verify file ownership after each wave | Compare git status with declared ownership to catch conflicts before QA | H | M | feature | DONE |
| 58 | Automate worktree isolation and merge guidance | Skill mentions it but merging is manual, so users avoid it | M | L | feature | DONE |
| 59 | Richer subagent intro context | Add a brief summary, peers' ownership and the report contract to the injected text | M | S | polish | DONE |
| 60 | Per-role model tiering | Only researcher pins a cheaper model; add cheap-first defaults | H | S | fix | DONE |
| 61 | Partial-progress report before maxTurns | "Report at turn N-5" so capped agents do not die silent | M | S | risk | DONE |
| 62 | Custom role definition path | Template, validation and name-collision rules for user-defined roles | M | L | feature | DONE |

## F. Visual and motion

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 63 | Role identity beyond hue | Hat/collar/badge shape cues plus a fixed CVD-safe palette; hash(role)%360 can collide | H | M | fix | DONE |
| 64 | State not carried by hue alone | Waiting gets a pulsing ring/outline; feed borders get icons or text prefixes | H | S | fix | DONE |
| 65 | Distinct thinking vs working | Different posture, screen color and idle slump so they differ at fit zoom | M | M | polish | DONE |
| 66 | Walk easing and arrival settle | Constant-speed linear walking; add acceleration, settle, chair pull-out | M | M | polish | DONE |
| 67 | Text legibility floor and scale setting | 10-12px bubbles shrink with the office; enforce a minimum, add a text-scale option | H | M | risk | DONE |
| 68 | Collision-aware bubble stacking | Only desk neighbours stagger; add stacking, fade-by-age and per-zone budget | H | M | fix | DONE |
| 69 | Honor prefers-reduced-motion | Monitor flicker, confetti, bobbing and feed slide-in ignore it; add a low-motion toggle | M | S | risk | DONE |
| 70 | Night tint must not hide alert cues | Exempt status glyphs and bubbles, or cap darkness, so waiting is visible at 3am | M | S | fix | DONE |
| 71 | Theme and palette packs | High-contrast, light and CVD-safe themes from one palette table; ~/.agent-office/themes | M | M | feature | DONE |
| 72 | Manual zoom/pan and focus-follow camera | Auto-fit alone makes sprites tiny with many zones or agents | H | M | feature | DONE |
| 73 | Hover outline, selection ring, Esc to close | Fixed small hit box, no hover state, card vanishes without a close affordance | M | S | polish | DONE |

## G. UX and accessibility

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 74 | Collapsible, resizable side panel | Fixed 340px, hidden entirely under 800px; add toggle and overlay drawer | H | S | fix | DONE |
| 75 | Keyboard-reachable roster | Actors are canvas-only; add DOM buttons mirroring them (Tab, Enter to inspect) | H | M | fix | DONE |
| 76 | Screen-reader live region and canvas label | Feed rows have no aria-live; the canvas has no text alternative | H | S | fix | DONE |
| 77 | Feed filters and per-session grouping | One flat 60-row feed interleaves concurrent sessions | M | M | feature | DONE |
| 78 | Feed click selects and pulses the actor | Link the log to the spatial view | M | S | feature | DONE |
| 79 | Pin and expand bubble text | Bubbles expire in seconds; pin on hover/select and keep "last said" in the card | M | S | feature | DONE |

## H. Simulation realism (honest to real events)

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 80 | Visualize BLOCKED vs DONE | Parse the outcome, store it on the interaction, show a red flag and keep the agent at its desk | H | S | feature | DONE |
| 81 | Whiteboard task lifecycle | pending / in-progress / done / blocked with owner; click to expand the full list | H | M | feature | DONE |
| 82 | Fan-out huddle at the whiteboard | Two or more delegates within seconds form a standup, derived from timestamps only | M | M | feature | PARTIAL: implemented; not exercised in a browser |
| 83 | Labeled idle ambient behavior | Idle agents visit coffee/couch, no speech, tagged "idle" so it is not read as work | M | S | polish | DONE |
| 84 | Real vs decorative styling | Hook-derived bubbles solid with an event badge; decoration never carries text | H | S | risk | PARTIAL: badges done; 'decorative never carries text' is a documented rule only |
| 85 | Lead "waiting on <names>" with tethers | Use the pending/parent graph instead of generic thinking dots | M | S | feature | DONE |
| 86 | Parent/task tree on click | `parent` exists but is unused in the UI; expose the real hierarchy | M | M | feature | DONE |
| 87 | Same-file conflict spark | Two agents' tool details naming one path flag a "possible" collision | H | M | feature | DONE |

## I. Onboarding, sharing and growth

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 88 | Alerts: OS notification, sound, tab badge | A "waiting for you" bubble in a hidden tab is worthless; title/favicon counts too | H | M | feature | PARTIAL: permission flow + badge done; desktop notification/beep paths unexercised |
| 89 | Legend, first-run explainer, connection status | Nobody can read dots or `?`; empty office gives no hint why | H | S | feature | DONE |
| 90 | Auto-demo on empty state | Idle office plays a sample run with a "sample data" badge | H | S | feature | DONE |
| 91 | Session identity and click-to-focus | Show project/cwd/branch per lead; focus the matching terminal | H | M | feature | PARTIAL: project/cwd/branch/cd-copy done; cannot focus an external terminal (console switches sessions instead) |
| 92 | Plain-English "why" on actions | Use Bash `description` and similar fields already in tool_input | M | S | feature | DONE |
| 93 | Stuck/blocked radar as the wedge | Position and design around "which agent is waiting on me" | H | M | feature | DONE |
| 94 | Presenter mode | Big captions, focus on the active agent, hide the side panel | M | M | feature | PARTIAL: works; text scale + camera follow unverified |
| 95 | Transparent streamer overlay URL | OBS browser source with no chrome and large text | M | S | polish | DONE |
| 96 | Recording / GIF / clip export | Shareable moments and post-stream highlights | M | M | feature | PARTIAL: MediaRecorder wired; not exercised headless |
| 97 | Shareable end-of-session card | PNG/SVG poster with agents, tasks, duration and no text content | M | M | feature | DONE |
| 98 | Documented public event API | Publish the SSE schema plus a 30-line consumer; invites status bars and bots | H | S | feature | DONE |
| 99 | Plain-text status endpoint | `/status` for tmux, shell prompts and menu bars | M | S | feature | DONE |
| 100 | Importable role packs | Roles, seats and agent files as one shareable JSON pack | M | M | feature | DONE |

## Cut or merged during dedupe

Fan-out sprite-swarm variation, finish-confetti scaling, deterministic role quirks, turn-end ritual, meeting room for SendMessage, review-gate baton pass, definition-of-done checklist, seeded sprite names, HiDPI integer snapping (conflicts with the fine-scale fit chosen for window usage), sound/ambience (opt-in, low value until alerts exist), per-session log cap (merged into #40), arrival-order sequencing (merged into #37), uninstall (merged into #23).

## Tensions to resolve

- **Persistence vs ephemeral:** staff engineer wants an event-sourced resumable daemon; perf engineer says a 40-entry log makes ephemeral fine. (#32)
- **Zombie reaping vs invented state:** a TTL guesses "dead" from silence; without PostToolUse a long tool call looks like a hang. Do #34 before aggressive #27.
- **Aggressive vs economical parallelism:** power users want auto fan-out; the solo dev's uninstall trigger is silent quota burn. (#50)
- **Delight vs utility:** DevRel wants the wow; PM says the wedge is the stuck-agent radar or it stays a toy. (#93)
- **Privacy vs demo:** hiding text protects secrets but makes demos less compelling. (#10)
- **Zoom snapping:** fine-grained fit uses the window; integer scales keep pixel art crisp. (#72)

## Removed: Claude interactivity (control)

A browser console that typed into the user's own interactive `claude` through tmux was built after the 100 items, then removed at the owner's request (a backup of the pre-removal tree exists). None of the 100 items depended on it, so their status above is unaffected; the product is observer-only.
