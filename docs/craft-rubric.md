# Craft rubric: UI/UX, game feel, pixel art

Used by the polish wave: builders build to it, a QA pass scores real screenshots and frame series against it.
Source quality: **V** = the page was read, **H** = hearsay/search snippet or common practice, **J** = judgement (no source).
Checks are measurable where possible. Anything marked H or J is a default we chose, not a standard.

## A. UI and UX

| # | Rule | Check | Src |
|---|---|---|---|
| A1 | Spacing on a 4/8 px scale | all padding/gap values in {4,8,12,16,24,32} | H |
| A2 | Proximity: gap inside a group at most half the gap between groups | measure both | V (Laws of UX) |
| A3 | One consistent left edge per column | 2-3 edges per view | V (NN/g #4) |
| A4 | At most 2 font families and 6 sizes | count computed styles | H |
| A5 | Tabular/monospace numerals for ids, times, counts | columns align | H |
| A6 | Body text >= 4.5:1, large text >= 3:1 | contrast tool on screenshot samples | V (WCAG 1.4.3) |
| A7 | Colour is never the only carrier of status | each status also has text, icon or shape | V (WCAG 1.4.1) |
| A8 | Quantities use length/position, not colour; no pie, donut or radial gauges | review charts | V (NN/g dashboards) |
| A9 | At most ~3 hues plus semantic status colours | palette count | H |
| A10 | One primary action per region; glanceable summary first, detail on demand | one filled button per panel | V/H |
| A11 | Feedback under 400 ms or show progress | timestamp input vs first change | V (Doherty) |
| A12 | Keyboard path to every action; Esc closes the top layer; palette shows shortcuts | keyboard-only walkthrough | H |
| A13 | Destructive actions have undo or a clear exit | review | V (NN/g #3) |
| A14 | Toasts: success ~5 s, errors persist, timer pauses on hover/focus, max 3 visible | observe | H |
| A15 | UI entrances 150-300 ms ease-out, exits ~70% of that, never above 500 ms | grep durations | H |
| A16 | Animate only transform and opacity; reduced motion removes movement, keeps a fade | CSS/JS review | H |
| A17 | Loading, empty and error states exist for every region; empty says why and how to fill | empty/offline/error runs | V (NN/g) |
| A18 | Errors say what happened and the next step in plain language | read messages | V (NN/g #9) |
| A19 | Visible focus ring; targets >= 24x24 CSS px | tab through, measure | V (WCAG 2.5.8) |
| A20 | Dark UI: background dark grey (not #000), text off-white, desaturated accents, no saturated complementary pairs on black | sample colours | H |
| A21 | Glow budget: at most one glowing focal element per view; glow never lowers text contrast | screenshot review | J |

## B. Game feel and feedback

| # | Rule | Check | Src |
|---|---|---|---|
| B1 | Input to first visible change under 100 ms | frame timestamps | V |
| B2 | Durations: micro 100-150 ms, small 200-300 ms, large 300-500 ms, ceiling 500 ms | grep tween durations | V |
| B3 | Entrances ease-out, exits ease-in; bounce only on small reward elements, at most 400-500 ms | review | J |
| B4 | Anticipation 2-5 frames before a reward pop; press squash ~0.9 over 80-120 ms; one small overshoot, then rest | frame series | V/H |
| B5 | Hit-stop 10-20 ms light, 50-100 ms heavy; reserve for the biggest events, never UI | review | V |
| B6 | Sequence offsets: flash +20 ms, particles +50 ms, floating text +100 ms | log timestamps | V |
| B7 | Shake amplitude scales with importance (2-3 px light, 8-10 px heavy), 50-100 ms, returns to zero; moves the camera, never HUD or text | recording | V |
| B8 | Particle burst 20-30, lifetime 0.5-1 s, fade over last 30%, 1-2 palette hues; total live cap | count | V/J |
| B9 | Floating text 1-2 s near the event, not over the subject | recording | V |
| B10 | Counters count up 300-600 ms; meters fill ease-out | review | J |
| B11 | Routine events get at most 3-5 feedback events per second; milestones a separate budget; repeated identical flair decays (~50% after 10 repeats) | recording | V |
| B12 | Never block input during flair; never 3 or more effects in one 500 ms window | recording | V |
| B13 | No flashing above 3/s; looping pulses stop after the event; reduced motion keeps information, drops motion | WCAG 2.3.1/2.3.3 | V |
| B14 | Toast text announced to screen readers | aria-live | H |

## C. Pixel art and animation

| # | Rule | Check | Src |
|---|---|---|---|
| C1 | 8-32 colours per scene; shared 3-4 value ramps per hue | unique colour count | V |
| C2 | Ramps shift hue (~20 degrees per step): shadows cooler, highlights warmer; never just darken RGB | ramp table | V |
| C3 | Saturation peaks mid-ramp; brightness does not start at black | curve | V |
| C4 | Readable in grayscale: key shapes differ in value | luma-convert sprite sheet | V |
| C5 | One light direction (top-left) for every sprite and prop | review | V/J |
| C6 | Shade in large clusters; no isolated single shade pixels; no pillow shading | review | V/H |
| C7 | Dither only deliberately (per-material flag), never a default fill | review | V |
| C8 | 1 px outline darker than fill and background; selective outline (darker on shadow side); internal lines one step darker | boundary luma | V |
| C9 | Adjacent colours distinguishable at 1x; add a darker separator when they blend | luma delta | V |
| C10 | Recognisable silhouette at tiny size (fill solid and check) | silhouette render | J |
| C11 | Minimise jaggies; stair runs change consistently; no stray single pixels | review | V |
| C12 | Anti-alias only inside the silhouette; no semi-transparent pixels outside it | alpha scan | V |
| C13 | Integer scale, nearest-neighbour, positions snapped to whole art pixels | review | H |
| C14 | Walk: 6-8 frames; ~80 ms per pose in an 8-frame cycle, ~160 ms in a 4-frame cycle; keyframes are the dramatic poses | frame counts | V |
| C15 | Idle: 2-4 frames, consistent; breathing ~1 px | review | H |
| C16 | Secondary motion, squash/stretch, smear: used sparingly and consistently | review | J (no source read) |

## D. Failure modes to look for

1. Colour-only status dots. 2. Glow on everything with no focal point. 3. Panels with no empty/error state. 4. Many accents and sizes with no primary action. 5. Row buttons under 24 px or no focus ring. 6. RGB-only darkening (straight ramps). 7. Dark outline equal to dark fill (heads vanish). 8. Three or more effects in one half second. 9. Shake or particles on a routine event. 10. Toasts that vanish before an error is read.

## E. Known gaps in the research

Not verified: Material motion values, WCAG 1.4.11/2.5.3, Apple HIG, Refactoring UI, Swink's book numbers, Nijman's slides, Pixel Joint/MortMort/AdamCYounis/saint11, squash and stretch and procedural-sprite technique sources.
