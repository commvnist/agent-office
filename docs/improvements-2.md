# Agent Office: 100 more improvements (round 2)

Source: 5 Sonnet 5.5 agents, one per area, each given the round-1 backlog (`docs/improvements.md`, all implemented) and the visual focus-group findings to avoid repeats. Model-generated hypotheses read from the code; nothing was run or rendered, so verify before building. Numbering continues from round 1.

Impact / effort: H M L = high medium low, S M L = small medium large. Status: DONE unless noted; REMOVED = built, then cut by an owner decision. Implemented and verified by typecheck, tests and build; nothing was checked in a browser.

Near-duplicates to merge when building: #126 with #193 (stuck threshold), #131 with #181 (per-project scope), #133 with #121/#123 (attention ordering).

## A. Canvas (101-120)

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 101 | Stale-agent dimming | Agent with no event for N min looks live. Desaturate sprite, dim monitor from `busyAt` (actor.ts). | H | S | feature | DONE |
| 102 | Tool-specific monitor cues | Screens are generic. Vary glyph (terminal, diff, text, globe) by tool kind so Bash vs Edit reads without a bubble. | M | M | feature | DONE |
| 103 | Typing speed follows event rate | Frame period is fixed 150ms. Scale by recent tool events/min. | M | S | improve | DONE |
| 104 | Offscreen alert edge arrows | Waiting/blocked agent outside viewport is invisible when zoomed. Edge arrow in glyph colour (camera.ts, UI layer). | H | M | feature | DONE |
| 105 | Sky uses replay time | `Scene.tick` uses wall clock; replay and sample show the viewer's hour. | L | S | fix | DONE |
| 106 | Smooth sky and dusk transitions | `drawSky` pops between three colour sets; interpolate with `mix`. | L | S | polish | DONE |
| 107 | Lamps punch through night | Flat night overlay dims occupied desks too; add warm additive glow at occupied desks. | M | M | improve | DONE |
| 108 | Clamp bubbles inside viewport | `headY` can leave the canvas near walls or when zoomed; clamp in `layoutBubbles`. | M | S | fix | DONE |
| 109 | Bubble pop-in and fade-out | Bubbles appear and vanish instantly; 120ms ease, respect reducedMotion. | L | S | polish | DONE |
| 110 | Door open/close and entry fade | Arrivals and exits have no door feedback (scene.ts `buildFloor`). | M | S | polish | DONE |
| 111 | Overflow desk pop-in | Overflow seats toggle `visible` silently; scale or fade in. | L | S | polish | DONE |
| 112 | Queue position badge | Queued agents show only a "?" emote; add ordinal chip 1,2,3 from queue order. | M | S | feature | DONE |
| 113 | Empty-zone dimming and occupancy pips | Empty zones render as lively as busy ones; lower tint or add seats-used pips. | M | M | improve | PARTIAL: empty zones dimmed; no occupancy pips |
| 114 | Progress ring for long tool calls | Nothing shows a 5-minute Bash is busy not hung; slow filling arc using PostToolUse durations. | H | M | feature | PARTIAL: uses elapsed time, not PostToolUse durations |
| 115 | Seated agents glance sideways | `sit` forces `dir="down"`; brief side/up pose at delegation and report moments. | L | M | polish | SKIPPED: no side-facing seated sprites exist |
| 116 | Walker collision avoidance | BFS paths ignore other agents so walkers stack in corridors and lobby. | M | M | fix | DONE |
| 117 | Hit area scales with zoom | Fixed 24x34 art-px hit box is tiny at fit; pad about 8 screen px, prefer nearest actor. | M | S | fix | PARTIAL: hit box padded; nearest-actor preference not done |
| 118 | Ambient prop animation | Coffee, cooler, plants, couch are static; two-frame steam, bubbles, sway, gated by reducedMotion. | L | S | polish | PARTIAL: cooler bubbles only; plant sway not done |
| 119 | Desk clutter reflects work done | Desks look identical after 40 tool calls; growing paper/mug stack from tool counts. | M | M | feature | DONE |
| 120 | Whiteboard text masked to board | `boardText` is screen-space and can spill outside the frame when zoomed; mask to board rect. | M | S | fix | DONE |

## B. Side panel and navigation (121-140)

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 121 | Snooze or acknowledge radar items | Stuck or long-waiting rows nag forever; per-row dismiss/snooze 30m (ui.ts renderRadar). | H | S | feature | DONE |
| 122 | Reason inside radar rows | Rows say only "waiting for you · 3m"; append clipped waitingText or blocked report. | H | S | improve | DONE |
| 123 | Sticky NEEDS YOU strip | Radar scrolls away under roster and feed; pin a compact "2 need you" strip (index.html). | H | S | improve | DONE |
| 124 | Collapsible sections with counts | Only LEGEND folds; make SESSIONS/AGENTS/ACTIVITY foldable with counts, persisted. | M | S | improve | DONE |
| 125 | Global keyboard shortcuts | Only P exists. Add n/N cycle needs-you, [ ] cycle agents, / filter, ? legend (panel.ts). | H | M | feature | DONE |
| 126 | Stuck threshold ignores in-flight tools | `radar()` flags any session silent over 120s even mid-build; soften when a tool is running (logic.ts). | H | S | fix | DONE |
| 127 | Copy handoff summary from card | Card copies single texts only; add "Copy summary" markdown (session, cwd, task, status, report). | M | S | feature | DONE |
| 128 | Collapse card texts behind disclosures | Up to five 9em blocks stack; show the most relevant, fold the rest. | M | S | improve | DONE |
| 129 | Session rows show current prompt | Same-project sessions are indistinguishable; add one-line clipped `s.prompt`. | H | S | improve | DONE |
| 130 | Sort sessions by urgency, fold idle | Arrival order; waiting/blocked first, fold ended/idle under "N inactive". | M | S | improve | DONE |
| 131 | Session click scopes panel and canvas | Name only selects the lead; make it a scope: filter feed/roster, dim other sessions, "scoped" chip. | H | M | feature | PARTIAL: scopes roster and feed; no canvas dimming |
| 132 | Group roster under session headers | Flat roster mixes sessions; add per-session subheads like the grouped feed. | M | S | improve | DONE |
| 133 | Roster ordered by attention | Blocked/waiting can sit at the bottom; stable sort by urgency then label. | M | S | improve | DONE |
| 134 | Two-way hover link | Hover roster/feed row outlines the actor, and canvas hover highlights rows. | M | M | feature | DONE |
| 135 | Feed re-render drops focus and scroll | `renderIf` rebuilds all rows per event; diff by key like the roster. | H | M | fix | DONE |
| 136 | Auto-pause feed on hover, "N new" pill | New rows shift content under the pointer; freeze on hover or scrolled-down. | M | S | improve | DONE |
| 137 | Clamp long feed text | Full delegation prompts fill the panel; clamp to 3 lines with "more". | M | S | improve | DONE |
| 138 | Persist filters, show "12 of 60" | Filters reset on reload and are easy to forget; persist, show count, Clear all. | M | S | improve | DONE |
| 139 | Relative times and gap markers | Rows show HH:MM:SS only; "2m ago" on hover and a divider after quiet gaps. | L | S | improve | DONE |
| 140 | Deep-link selection and filters | Reload loses selected agent and filters; encode in `location.hash`. | M | M | feature | DONE |

## C. Onboarding, setup and usage (141-160)

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 141 | Warn on unknown office.json keys | `validateConfig` silently drops typos like "paralelism"; surface a non-fatal configWarning (config.ts). | M | S | improve | DONE |
| 142 | Document idleTtlMinutes | Validated in config.ts but absent from the README config table. | L | S | fix | DONE |
| 143 | `office.mjs init` | Write a commented starter office.json instead of hand-writing JSON from the README. | M | S | feature | DONE |
| 144 | apply-pack defaults and `--list` | Requires `--agents-dir`; resolve a default and list bundled packs (scripts/apply-pack.mjs). | M | S | improve | DONE |
| 145 | Pack apply not reversible | Overwrites office.json and agents with no backup; write `.bak` and add `--undo`. | M | S | fix | DONE |
| 146 | Packs selectable from the UI | Switching needs a CLI plus hand-copied agent files; roster/pack picker via daemon endpoint. | M | L | feature | SKIPPED: needs the UI picker; CLI apply-pack/--list exist |
| 147 | `office.mjs config --validate` | doctor needs a running daemon for validation; expose `validateConfig` offline with line messages. | M | S | feature | DONE |
| 148 | Config error shows fix hint | Panel shows only `configError.message`; add file path, "last good config active", offending role. | M | S | improve | DONE |
| 149 | Stale daemon path after moving checkout | `~/.agent-office/daemon` stores an absolute path; hook should log a one-line reason to last-hook.json. | M | S | fix | DONE |
| 150 | `status` shows sessions and event age | Prints `/status` body only; add "last event 12s ago" and hook count to tell quiet from dead. | M | S | improve | DONE |
| 151 | `start` and `restart` commands | Only `stop` exists; add detached start/restart reusing setup's spawn. | M | S | feature | DONE |
| 152 | Upgrade and version drift check | No upgrade path; doctor should compare daemon, plugin.json and checkout versions. | H | M | feature | DONE |
| 153 | Setup refreshes plugin cache | Setup says "updating" but a cached plugin copy can stay old; verify installed version. | M | M | fix | DONE |
| 154 | Setup prints the real port | Uses env or 4747 and ignores the `port` file a custom-port daemon wrote (setup.mjs). | M | S | fix | DONE |
| 155 | Demo targets a throwaway daemon | `demo --isolated` with temp HOME and free port so `npm run demo` never pollutes live sessions. | H | M | improve | DONE |
| 156 | Demo token-missing error | Raw ENOENT stack when daemon never ran; say "start the daemon first (npm run setup)". | M | S | fix | DONE |
| 157 | Point README at Sample button | Browser Sample needs no CLI or daemon events; README lists only `npm run demo`. | L | S | improve | DONE |
| 158 | Better old-Node and install-state errors | Setup says only "needs Node 22.6"; add nvm/fnm pointers, distinguish missing `npm install` from build failure. | L | S | improve | DONE |
| 159 | Uninstall leaves auto-start pointer | `setup --uninstall` leaves `~/.agent-office/daemon`, so a loaded plugin relaunches it; remove it. | M | S | fix | DONE |
| 160 | In-app Help panel | Show office.json path, active pack, port, daemon version, doc links in one place. | M | M | feature | DONE |

## D. Accessibility, responsive, performance, themes (161-180)

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 161 | Text scale reaches the DOM panel | `textScale` only affects canvas; drive a root `--fs` (rem) and honour browser font size. | H | S | fix | DONE |
| 162 | Settings dialog focus management | Never moves focus in, traps Tab or closes on outside click. | M | S | fix | DONE |
| 163 | Keyboard zoom and pan | camera.ts has wheel, pinch, drag, "0"; add +/-, arrows, F (focus selected). | H | S | feature | DONE |
| 164 | Camera "0" hijacks form controls | Guard covers only input/textarea; skip selects, sliders, contenteditable, modifiers. | L | S | fix | DONE |
| 165 | Cap devicePixelRatio | Raw DPR 3 on 4K allocates huge buffers for nearest-neighbour art; clamp to 2, quality setting. | M | S | improve | DONE |
| 166 | Handle DPR change on monitor move | Resolution read once; matchMedia listener and `renderer.resize`. | M | S | fix | DONE |
| 167 | Throttle ticker when idle or hidden | Full-rate ticker and 500ms refresh run with nothing moving or in hidden tabs; maxFPS 15, skip when hidden. | H | M | improve | DONE |
| 168 | Incremental DOM updates | `refresh()` rebuilds stats, radar, card, sessions, feed every 500ms; dirty-flag on events. | M | M | improve | PARTIAL: keyed diffs and hidden-tab skip; no dirty flag |
| 169 | Virtualize roster and feed | One DOM node per entry; window the list or collapse finished agents at 100+. | M | L | improve | PARTIAL: idle helpers fold past 12 agents; no virtualization |
| 170 | Live region urgency | Keeps last 3 per 1.5s, all polite; assertive region for blocked/waiting, "and N more". | H | S | fix | DONE |
| 171 | Chrome follows the chosen theme | Theme packs recolour only the canvas; let a pack set `--bg/--panel/--fg`. | M | M | improve | REMOVED (Oct 2026): one built-in look, no theme packs |
| 172 | Theme from OS preferences | No prefers-color-scheme/contrast hookup; pick light/high-contrast when no stored choice. | M | S | feature | DONE |
| 173 | Hard-coded hex colours bypass tokens | Feed borders, hover, `.tx`, buttons use literals; replace with vars. | L | S | fix | DONE |
| 174 | Localization string table and plurals | Inline English and manual "s" plurals; extract a messages map, `Intl.PluralRules`. | M | M | feature | PARTIAL: i18n.ts and plurals, English only, own files only |
| 175 | Locale-aware time and numbers | `fmtAge`/`fmtTokens` are English abbreviations; use `Intl.RelativeTimeFormat`/`NumberFormat`. | L | S | improve | PARTIAL: Intl compact numbers; fmtAge still English |
| 176 | Logical CSS for RTL | Physical left/right and `translateX(100%)` break under `dir=rtl`; use inset-inline. | L | M | improve | DONE |
| 177 | Swipe and safe-area on mobile | Drawer closes only by button; swipe-to-dismiss, `env(safe-area-inset-*)`, `100dvh`. | M | S | improve | DONE |
| 178 | Touch gestures vs page scroll | `touch-action:none` blocks scrolling past the canvas; add two-finger-only pan option. | M | M | fix | PARTIAL: two-finger pan; no UI toggle (localStorage ao.twoFingerPan) |
| 179 | Announce selection | Selecting an actor updates `#card` with `aria-live=off`; announce name, status, task. | M | S | fix | DONE |
| 180 | Font and spacing option | Font hard-wired to a monospace stack; font-family, line-height, letter-spacing settings. | L | S | feature | DONE |

## E. Monitoring workflows (181-200)

| # | Item | What and why | Impact | Effort | Type | Status |
|---|---|---|---|---|---|---|
| 181 | Per-project filter and colour | Feed and radar mix projects; chip filter plus a stable accent per project. | H | M | improve | PARTIAL: project accent and session select; no chip row |
| 182 | Replay time-range picker | `/history?since&limit=2000` truncates long runs silently; add from/to and a truncated notice (modes.ts). | H | S | fix | DONE |
| 183 | Replay jump-to-moment markers | Scrubber has no landmarks; mark BLOCKED, waiting, error, session_start. | M | M | improve | DONE |
| 184 | Export history JSONL/CSV | `/history` is UI-only; download the privacy-stripped slice (main.ts). | M | S | feature | DONE |
| 185 | Session cost/token rollup | Usage is per session and never summed; daily totals strip. | H | S | feature | DONE |
| 186 | Burn-rate indicator | Tokens/min from successive `turn_end` deltas flags runaway loops. | M | M | feature | DONE |
| 187 | Alert on repeated errors | `errors`/`lastError` exist but never notify; fire once after N consecutive failures. | H | S | feature | DONE |
| 188 | Per-session mute and snooze | Notification prefs are global; mute/snooze by session, stored in browser. | H | S | feature | DONE |
| 189 | Waiting-time escalation tiers | 30s and 40min waits look the same; escalate colour/title and re-alert at 5/15 min. | H | S | improve | DONE |
| 190 | Alert when a session finishes | `turnDone` is per-turn and noisy; one alert at "all idle and quiet N s". | M | S | feature | DONE |
| 191 | Reconnect and daemon-down alert | Dropped SSE leaves a frozen-looking tab; loud "stale since HH:MM" banner and title prefix. | H | S | fix | DONE |
| 192 | Last-event age per session | No "quiet for 3m"; surface `lastAt` age on session cards. | M | S | improve | DONE |
| 193 | Configurable stuck threshold | `stuckMs` hard-coded 120s; per-project setting or scale by last tool duration. | M | S | improve | DONE |
| 194 | Daily activity timeline | Gantt of sessions/agents from stored events shows parallelism and idle gaps. | H | L | feature | PARTIAL: basic 24h Gantt, no zoom or filter |
| 195 | Tab title names the project | Title shows only counts; include first waiting project name. | M | S | improve | DONE |
| 196 | Persist outcome history | `tasks` is capped and drops on restart; compact outcome list to a daily summary endpoint. | M | M | feature | DONE |
| 197 | `/status` per-session detail | Aggregate only; `?session=` or per-project lines for tmux/menu-bar scripts. | M | S | improve | DONE |
| 198 | Compact wall mode | Dense grid of session tiles (name, state, age, tokens, errors) with no canvas, for a spare monitor. | M | M | feature | DONE |
| 199 | Poster adds outcomes and cost | `posterModel` counts done/blocked but record.ts draws only done; add blocked, tokens, longest agent, errors. | M | S | improve | REMOVED (Pass 5): the poster was cut |
| 200 | Daily/weekly digest export | One markdown/JSON report from stored events: sessions, roles, outcomes, tokens, errors, hours. | M | M | feature | DONE |

## Not checked

Nothing here was run, rendered or profiled; agents read code only. Several items assume state fields exist (in-flight tool flag, `s.prompt`, per-agent tool counts) that were not verified. Observer-only guardrail holds: every item is read-side.

## Round 3: audits, focus groups and the dynamic office (built)

Sources: six audit passes (visual bugs, visual design, UX, bug hunt, feature gaps, code quality) and an 11-expert visual focus group. Nothing here was verified on a real GPU or a phone; screenshots came from headless Chromium.

**Built**
- No "guest" workers: every agent type is a role and sits at a desk. One global desk pool (`d<N>`, pods of 4, 6 pods per row, append-only positions, 64-desk cap then queue). Placement is a deterministic cost (session pod ownership first, then role pull, then crowding). Layout takes live demand and grows in whole pods.
- Engine: baked floor and walls, pooled glows and particles, LRU person-texture cache, 60fps active cap, density-based status pips (leads, selected and alerting agents keep tags), tag and bubble clamping to the floor.
- Office look: project pods tinted per session with plaques, minimap and `g` jump, contact shadows, hidden empty chairs, hue-shifted shading, dual monitors, lamps, role desk tops, light shafts and dust, screen spill by tool kind, kanban shift board with a lingering run summary, server rack, sticky-note wall.
- Characters: expressions, builds, hair styles, pictogram role badges, lead marker, thought cloud with tool icons, idle quirks, distance-locked walk, breathing, sit-down, hop squash, pop-ins.
- Story and juice: paper-ticket courier (delegate, done, blocked, partial), tether declutter, arrival/departure/error/waiting cues, ship-it wave, block shake, huddle half-circle, travelling spark.
- Chrome: flat header with one neon detail and a cyan accent, wordmark and live pill, presenter HUD, empty-state card, poster with the office image, burn-rate and long-tool alerts, shared live-region queue, many bug and a11y fixes.

**Deliberately not built**
- Outbound webhook/ntfy alerts (leave the machine; needs an explicit decision).
- A pack picker UI (#146) and full localization (#174); seated side-glance poses (#115); couch sitting.
- Interactive control of Claude from the UI (guardrail).

**Known limits**
- The bottom white strip seen in headless runs is worked around with a 99%-alpha header; the root cause inside Chromium was not isolated.
- Seat assignments in replays can differ from the previous build for interleaved multi-session arrivals (events themselves are unchanged).
- Light/high-contrast chrome, reduced-motion and real-device behaviour were not visually verified.
