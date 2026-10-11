# QA report: craft rubric scoring

> Historical. Since this report, fun levels (Calm/Lively/Showtime), themes (neon, terminal, light, high-contrast), the director camera, CRT scanlines and auto-focus alerts were removed: one experience remains. Scores that name them below describe the old build; the "dark" results apply to the single remaining look.

Method: real app (Chromium headless, software GL, deviceScaleFactor 2) against throwaway daemons (16 agents, live tool churn);
screenshots, frame series, `scripts/ui-audit.mjs` (dark, light, 390 px, neon, terminal, high-contrast; those themes are removed), sprite sheet of `person()`
at 8x, plus code review for timings. Headless software GL: visuals judged, not fps. Scores are After the fix pass; "was" marks a changed score.

## A. UI and UX

| # | Result | Evidence |
|---|---|---|
| A1 | PASS | ui-audit off-scale spacing 0 (1 at 390 px, report only) |
| A2 | PASS | toolbar groups (VIEW/DATA/OUTPUT/SETUP) 8 px inside, 16 px between; a-dark |
| A3 | PASS | panel column left edge shared; a-dark |
| A4 | PASS | ui-audit: 1 family, 4 sizes (13/12/11/15 px) |
| A5 | PASS | monospace UI font; counts and times align in panel |
| A6 | PASS | ui-audit contrast failures 0 in dark (other themes removed) |
| A7 | PASS | ui-audit colour-only 0; ring + "!" glyph + text in NEEDS YOU |
| A8 | PASS | tokens/events use sparkline and bars, no pie/radial (session ring is a meter, small, labelled) |
| A9 | PASS | one cyan accent plus status colours |
| A10 | PASS | one filled (pressed) button per region |
| A11 | UNVERIFIED | no input-latency timestamps taken; hover and click feel immediate in headless |
| A12 | PASS | Tab through panel, Ctrl+K palette, Esc closes top layer and returns focus (s10) |
| A13 | PASS | Esc exits, snooze has duration, Float/Freeze toggles |
| A14 | PASS | fundom.ts: 5 s, max 3, pause on hover/focus; errors are the persistent banner |
| A15 | PASS | CSS entrances .25-.3 s, exits .3-.4 s, nothing over 500 ms (ui-audit) |
| A16 | PASS | CSS transitions opacity/transform only; reduced motion keeps a .15 s fade |
| A17 | PASS | "Nothing needs you", "No tasks yet", empty card, offline banner |
| A18 | PASS | banner and doctor messages state cause and next step |
| A19 | PASS | focus outline 2 px solid on every stop; colonist buttons 24x24 (s4) |
| A20 | PASS | bg #14121f, text #e8e6f5, desaturated accents |
| A21 | PASS | one glowing element (wordmark bar); no blur on text |

## B. Game feel

| # | Result | Evidence |
|---|---|---|
| B1 | UNVERIFIED | not timed per frame |
| B2 | PASS (was FAIL) | ticket flight was 700 ms, now 500 ms (choreo.ts); others <= 400 ms |
| B3 | PASS | hop/pop use easeOutBack once; exits fade |
| B4 | PASS | squash 180 ms with one overshoot (juice.test.ts) |
| B5 | N/A | no hit-stop implemented |
| B6 | UNVERIFIED | offsets not logged; h-ticket frames show pulse then particles then label |
| B7 | PASS (was FAIL) | name tags, bubbles and plaques now ride the un-shaken view (main.ts `camera.still`); tag x/y constant while shaking (s11); light shake 3 px |
| B8 | PASS | bursts 3-30 particles, pooled sprites, cap MAX_FLOATERS 6 / pooled movers |
| B9 | PASS | floaters 0.9 s, rise above the actor |
| B10 | N/A | xp bar removed by design |
| B11 | PASS | FxBudget routine + milestone gap + 50 % decay after 10 repeats (fx.test.ts) |
| B12 | PASS (was FAIL) | routine budget was 3 per 500 ms (= "3 or more"); now 2 (fx.ts); a milestone may add one |
| B13 | PASS (was UNVERIFIED) | lightning limited to one flash per ~400 ms (scene.ts); disco 2.5 Hz, bounded; reduced motion drops motion |
| B14 | PASS | #toasts aria-live polite, #alert-region assertive |

## C. Pixel art

| # | Result | Evidence |
|---|---|---|
| C1 | PASS | 48 unique colours across every style/skin/hair variant at once; spr-sheet.png |
| C2 | PASS | hair, skin, shirt ramps shift hue (sheet) |
| C3 | PASS | no pure black fills; outline #171421 |
| C4 | UNVERIFIED | no luma conversion run |
| C5 | PASS | top-left light on desks and sprites |
| C6 | PASS | large clusters, no single stray shade pixels on the sheet |
| C7 | PASS | dither only on the floor material |
| C8 | PASS | dark hair #2a1c14 is lifted to mid grey, distinct from the outline, at 2x/3x/8x (spr-sheet.png) |
| C9 | PASS | desk vs chair vs floor separated by outline |
| C10 | PASS | silhouettes differ by hair, cap, headphones, bun |
| C11 | PASS | no stray pixels on the sheet |
| C12 | UNVERIFIED | alpha scan not run |
| C13 | PASS | roundPixels, nearest, integer art scale |
| C14 | PASS | 6 walk poses, distance-locked ~93 ms each (sprites.ts WALK_FRAMES, actor.ts WALK_STEP) |
| C15 | PASS | idle breathing 1 px |
| C16 | PASS | squash on landing, hop on speak; sparse |

## Top issues (all fixed unless noted)

1. HIGH: stream-safe left canvas bubble text visible in presenter/wall/kiosk without a Private reload. Fixed: bubbles show an ellipsis immediately (actor.ts `setBubbleBlank`, main.ts).
2. MEDIUM: name tags and pod plaques shook with the world (B7). Fixed (main.ts).
3. MEDIUM: Shift+F off left the camera locked on an agent. Fixed (actions.ts).
4. MEDIUM: phone (390 px) piled 20 name tags and plaques over each other. Fixed: pips take over below 0.94 scale on narrow viewports (main.ts).
5. MEDIUM: GIF recorder held ~40 MB while armed. Fixed: 320 px wide frames and a 16 MB cap that drops the oldest (gifrec.ts).
6. LOW: routine budget 3 per 500 ms; ticket flight 700 ms; lightning could flash 4/s. Fixed (fx.ts, choreo.ts, scene.ts).
7. OPEN, LOW: on the phone, the wordmark and stats truncate ("AGENT", "16 WORKING · 0 ..."), and the floor leaves large empty bands above/below.
8. CLOSED: the lead's gold crown was removed by design.
9. OPEN, LOW: crew-board text reads "Queued 0W 1" (labels run together).

## Known-item checks

(1) fixed. (2) fixed. (3) fixed. (4) Shift+F toggles follow, plain f unchanged (s6). (5) seen: follow, attention rings, rainbow, cat, disco, confetti, rain, sunny, lightning, tier-3 combo; glitch jitter not distinguishable in stills (UNVERIFIED). (6) done above. (7) done: C8. (8) neon theme: removed. (9) fixed except 7. (10) tab order and focus return verified for palette, Settings, Help; toast focus pause by code only.

## Pass 2: six Haiku QA agents, every finding verified by the orchestrator

Areas: core, daemon/CLI, canvas, panel UI, views and tools, accessibility/responsive/long-run. A finding counts only after it was reproduced or proven from the code; each result below is the orchestrator's verdict, not the agent's claim.

| ID | Finding | Verdict |
|---|---|---|
| Q5-1 | OBS overlay page opaque (`body.overlay html` can never match) | Fixed: `html:has(body.overlay)` |
| Q1-1 | Allocator skipped a session's own pod when an earlier pod emptied | Reproduced, fixed, test |
| Q1-2 | Retried event (same forwarder seq) reported as a gap | Fixed, test |
| Q1-3 | Lead combos and "on a roll" counted its agents' calls; session totals double counted | Fixed, test |
| Q1-5/6 | NaN clock reaped every session; negative durations | Fixed |
| Q2-1 | office.json edit not pushed when a request noticed it first | Fixed (`refreshConfig`) |
| Q2-2 | Boot replay kept only 5,000 events | Raised to 50,000 |
| Q2-4 | apply-pack wrote unvalidated roles | Fixed (validates the merged config) |
| Q2-5 | cwd `/` made any `.jsonl` readable | Fixed (roots must be 2+ segments, not home) |
| Q2-6 | plugin-version matched another plugin's Version line | Fixed, test |
| Q2-7 | `/status?session=<missing>` returned 200 empty | Now 404 |
| Q4-1 | Esc closed Help and the palette together | Fixed (dialog stack) |
| Q4-2 | Dialog rows squashed when content exceeded 80vh | Fixed (`flex-shrink:0`) |
| Q4-3 | Activity feed empty after reload | Fixed (hydrates from the daemon's log) |
| Q5-2 | Timeline double-click ignored the selection | Fixed |
| Q5-4 | Failed Replay load left the old replay running | Fixed |
| Q6-1/2 | Phone drawer covered by header/colony; toggle over status | Fixed |
| Q6-3 | Status counts truncated on phones | Fixed (wordmark collapses to its tick) |
| Q6-4/5 | Repeated button names; no main landmark; stats label hid the need-you count | Fixed |
| Q3-1/2 | Plaques overprint each other at 16/60 agents | Fixed by hover-only plaques |
| Q5-3 | Starting Replay or Sample ends Freeze | By design (held frames would make a replay look frozen); now stated in the Help row for Freeze |
| Q1-4 | Stop before Start (or a replayed start after a stop) left a ghost agent holding a desk | Fixed: stopped ids are remembered (bounded) and a later start for them is ignored; test added |
| Q2-3 | CLI falls back to port 4747 when `AGENT_OFFICE_PORT=0` | Not fixed: a test-only configuration, the default fallback is by design |
| Q4-4 | White strip under dialogs | Headless-Chromium compositing artifact (see the header workaround) |
| Q6-6 | GPU texture count grew in a 5 minute soak | Not a leak: in a 12 minute soak the live texture count was flat at 527 from minute 2 to 12 (0 deletions needed), heap 13-23 MB sawtooth, 0 page errors. The DOM node count rose only while the activity feed filled to its cap (807 after the first burst, then 807-815 through 840 more events). Headless software GL; GPU memory itself was not measured. |
