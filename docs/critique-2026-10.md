# Visual critique and focus group findings (October 2026)

Two review passes on the build at commit `1fc5b73` (plus the header-underline removal):

- **Pass 1:** 10 visual critics (composition, back wall, floor and lighting, pods and furniture, sprites, in-scene text, status signals, side panel, header and chrome, phone and overlay).
- **Pass 2:** 10 visual critics (colour, typography, spacing, icons, empty states, dialogs, large offices, alert flow, accessibility, identity) and 10 focus-group personas (solo dev, engineering manager, streamer, colour-blind dev, non-technical founder, SRE, junior dev, pixel artist, phone user, privacy-conscious enterprise dev).

- **Pass 3:** 5 Claude Opus agents at medium effort, each with a long-term lens: product vision, experience and information architecture, art direction, simulation honesty and data, and platform and scale. They read the code and docs as well as the screenshots, and some ran throwaway instances. Their findings are in the [Pass 3](#pass-3-long-term-vision-opus) section at the end. Where they conflict with passes 1 and 2, pass 3 is the better-evidenced view.

The 30 pass-1 and pass-2 reviewers were Claude Haiku agents reading 2x screenshots of a throwaway daemon (`AGENT_OFFICE_PORT=0`, synthetic sessions). They never ran the app live, so motion, hover and focus states were not judged, and pixel values and contrast ratios are estimates.

**Columns.**
- **Sources** counts the reviewers who raised an item: `C1` is pass-1 critics, `C2` is pass-2 critics, `P` is personas.
- **Check** marks claims to confirm against the running app before building on them.
- **Status** is `open` for everything here: nothing in this document has been fixed yet.

## Focus group scorecard

| Persona | Usefulness | Delight | Keep open? | In their words |
|---|---|---|---|---|
| Solo indie dev | 6 | 7 | Yes, as a corner window | "Cute office, but I just want to know whether my build's blocked, and right now I have to hunt for it." |
| Engineering manager | 6 | 5 | Yes, for NEEDS YOU | "It tells me who is on fire, but not what the fire costs." |
| Streamer | 5 | 7 | Yes, as background | "My chat is going to ask which repo is mobile-app." |
| Colour-blind dev | 6 | 5 | Yes | "A red-vs-gold ring is just brown to me." |
| Non-technical founder | 6 | 5 | Yes, second monitor | "Tell me in English whether my app is broken and whether I have to click something." |
| SRE | 5 | 6 | Yes, as a sidecar | "Give me a table with a sort key and I'll forgive the pixels." |
| Junior dev | 6 | 7 | Yes, if links are shown | "I still couldn't tell who asked whom to do what." |
| Pixel artist | 6 | 7 | Yes | "The pods are charming; the lounge is a dimmer switch I keep reaching for." |
| Phone user | 6 | 5 | Yes | "Where's the 'finished' number, and why am I scrolling past Float and Kiosk?" |
| Privacy-conscious dev | 6 | 7 | **No**, until text is hidden by default | "Lovely office, shame it narrates my rm -rf to the whole floor." |
| **Average** | **5.8** | **6.1** | 9 of 10 | |

**What they agree on.** The app answers "does anything need me?" well and "what is it doing, and is it done?" poorly. The office metaphor is liked, but the chrome around it reads as a generic dashboard.

## Highest-consensus items

These were raised independently by many reviewers across both passes and personas.

| ID | Item | Sources |
|---|---|---|
| T1 | The side panel shows ~18 equal-weight buttons above NEEDS YOU and SELECTED. | C1 3, C2 2, P 6 |
| T2 | Status colours contradict each other (ring, banner, list dot, legend), and states rely on colour. | C1 3, C2 4, P 3 |
| T3 | The "needs you" signal appears three or four times in different hues. | C1 3, C2 2, P 2 |
| T4 | There is no plain-language status ("what is it doing, is it done, why is it stuck"). | C2 2, P 5 |
| T5 | The events/min and tokens/min meters read as broken or as "no spend". | C1 2, C2 2, P 5 |
| T6 | The scene is letterboxed in dead bands. | C1 3, C2 1, P 1 |
| T7 | Green halos and dots on every busy worker drown out the rare states. | C1 3, C2 3 |
| T8 | Project names and command text show by default (screen-share and stream leak). | P 2, C2 1 |

## A. Status, alerts and the blocked flow

| ID | Sev | Finding | Suggested fix | Sources | Check |
|---|---|---|---|---|---|
| A1 | High | Status colours disagree. NEEDS YOU dots: blocked is tan, waiting is red in one capture and green in another, and the row accent is salmon. The banner is orange, the ring gold, and the legend says gold means waiting and red means blocked. | Use one state-to-colour map shared by ring, dot, row accent, banner and legend: blocked red, waiting amber, working green, used for presence only. | C1, C2 x4, P x3 | Yes (dot colours) |
| A2 | High | States are encoded by colour alone, and red, gold and orange collapse to brown for protan and deutan viewers. | Give each state a shape and glyph: a ring style (solid, dashed, hollow square) plus a glyph (`!` for blocked, `?` or a clock for waiting), and put a word in banners ("BLOCKED", "WAITING"). | C1, C2 x2, P x2 | |
| A3 | High | The attention signal is repeated in the header text, the full-width banner, the NEEDS YOU header and the card, each styled differently. The banner can also cover scrolled panel content. | Keep one header pill that jumps to NEEDS YOU, drop the full-width banner or show it only when NEEDS YOU is off-screen, and use the gold token. | C1 x3, C2, P | |
| A4 | High | Green halo and dot on every working worker. The common state is the loudest mark, and the halos overlap into a texture. | Show "working" quietly (screen glow or a small desk light) and reserve rings for waiting, blocked and stuck. | C1 x3, C2 x2 | Yes: partly the activity ripples caught in a launch burst |
| A5 | High | A blocked agent's sprite still looks like a working one. The only cues are a thin ring, a small flag and a small tag. | Change the pose (stand or raise a hand), add a head badge about the size of the name tag, and pulse only for the first few seconds. | C2 | |
| A6 | High | A blocked bubble can sit under a different lead's label, so it reads as that lead's message. | Anchor each bubble to its own agent's head and never share a tail or stack with a neighbour's label. | C2 | Yes |
| A7 | Med | Selecting a lead washes out other agents' blocked bubbles and hides the lead's own permission bubble. | Never dim blocked or waiting bubbles on selection. | C2 | Yes |
| A8 | Med | The session (project) label can overprint a blocked agent's "! Dev" tag and flag. | Keep session labels above the lead, outside child desk space, or yield to alert tags. | C2 | Yes |
| A9 | Med | The blocked reason is repeated four times (toast, bubble, row, status bar). The status bar stutters "blocked: BLOCKED:", and rows truncate mid-word ("permissio…"). | Drop the "BLOCKED:" prefix, wrap a short reason instead of truncating it, and add a title tooltip with the full text. | C2 x2 | |
| A10 | Med | NEEDS YOU rows have no primary action: Snooze appears only on waiting rows, and blocked rows have nothing. | Add one action per row ("Open Dev" focuses the agent). | C2 | |
| A11 | Med | "Stuck" has a control but no visible scene state and no header count. | Show a stuck glyph or dashed ring in the scene and a count in the header. | C1 | |
| A12 | Med | Alert sound and desktop notifications are off by default, so a blocked agent can sit unnoticed. | Offer a one-time prompt on the first block, or make blocked notifications opt-out. | C2 | |
| A13 | Med | Alert glyphs conflict: the yellow `!`, the red pennant, the `!` prefix and a tick (which reads as "done") on an alert bubble. | One glyph per state; remove the tick from alert bubbles; drop the pennant or make it the blocked glyph. | C2 | Yes |
| A14 | Low | The waiting `!` overlaps the ring and hair and sits off-centre. | Place it at a fixed offset above the ring, or drop it since the ring carries the state. | C1 x2, C2 | |

## B. Side panel and chrome

| ID | Sev | Finding | Suggested fix | Sources | Check |
|---|---|---|---|---|---|
| B1 | High | The VIEW, DATA, OUTPUT and SETUP button wall (about 18 buttons) sits above NEEDS YOU and SELECTED, which fall below the fold. | Put NEEDS YOU, SELECTED and SESSIONS first. Make VIEW a segmented control and fold OUTPUT and SETUP into a "More" menu. | C1 x3, C2, P x6 | |
| B2 | Med | Buttons have no hierarchy or pressed state, so mutually exclusive modes (Follow, Freeze, Float, Private) look like one-shot actions. | Set `aria-pressed`, use a filled active style plus a non-colour mark, a ghost style for actions, and separate destructive actions (Clear). | C1, C2 x2 | |
| B3 | Med | The help paragraph is a permanent wall of mono text inside NEEDS YOU, and "Got it" sits inline in the last line. | Move it to Help or Intro and keep a one-line legend. Make "Got it" its own row. | C1 x2, C2 x2, P x3 | Yes: does "Got it" persist? |
| B4 | Med | Section heading styles are inconsistent: VIEW and DATA are small caps with rules, NEEDS YOU is bold amber, SESSIONS has a caret. | Use one heading token and one label token. | C1 x2, C2 | |
| B5 | Med | The SELECTED key/value readout doesn't align, so wrapped values fall under the key. | Use a two-column grid with a fixed key column of about 90px. | C1 | |
| B6 | Med | The header's "1 NEED YOU" is the quietest text in the bar. | Render the needs-you count as an amber pill that toggles the panel. | C1 | |
| B7 | Med | The avatar chip row has no identity (faces only), no key for ring colours, sorts by state rather than session, and shows a plain "+N" overflow. | Sort by session then state, add a project initial or tint, make "+N · 2 need you" clickable, and add a tooltip with name and state. | C1, C2, P | |
| B8 | Med | The panel toggle changes name and style between states ("Hide panel" and "Panel (1 need you)"). | Use one control named "Panel" with a chevron, `aria-expanded`, and the count as a badge. | C1 | |
| B9 | Low | The green dot beside the wordmark is unlabelled. | Label it ("live") or remove it. | C1 | |
| B10 | Low | Header bands don't share a baseline (header, chip strip, panel banner). | Use one full-width top bar with panel content beneath it. | C1 | |

## C. Dialogs (Settings, Help)

| ID | Sev | Finding | Suggested fix | Sources | Check |
|---|---|---|---|---|---|
| C1 | High | In Help, the labels "Config", "Motion" and "Docs" overprint their values, and value indents are ragged. | Use a two-column grid with a fixed label column (about 96px, nowrap) and values at `min-width:0`. | C2 x2, P x2 | |
| C2 | High | Dialogs float over the live scene and cover the blocked toast and the blocked sprite. | Add a scrim and keep alerts visible, or dock dialogs in the side panel. | C2 | |
| C3 | High | The Help content is cut at the bottom with no scroll cue, and a black band appears under it. | Set `max-height` with `overflow:auto`, add a fade or scrollbar, and find the black strip. | C2 | Yes: may be a capture artifact |
| C4 | Med | Native-looking controls (white checkboxes, browser-blue sliders, native select chevron) introduce a second accent. | Set `accent-color` to the cyan token and use styled checkboxes and selects. | C2 x2 | |
| C5 | Med | Settings has no title or close button, no scrim, and its 16 rows have no groups. "Sound" and "Mute chimes" form a double negative. | Add a title and close X, and group rows as Display, Motion, Sound, Notifications and Privacy. Rename "Mute chimes". | C2 | |
| C6 | Med | Labels and buttons wrap ("Snooze 30m", "billing-/service", the stream-safe label over three lines), the control columns are ragged, and the key chips in Help overflow ("?streamsafe=0\|1"). | Use a fixed label column and control column, `white-space:nowrap` on buttons, and key chips sized to their content. | C2 x3 | |

## D. In-scene text and labels

| ID | Sev | Finding | Suggested fix | Sources | Check |
|---|---|---|---|---|---|
| D1 | High | Speech and tool bubbles have no dark plate, so light text sits on the grid. The blocked bubble's plate is translucent (about 3:1). | Give bubbles an opaque plate in the same family as the plaques, with the state colour only on the border and tail. | C1, C2 | |
| D2 | High | Subagents carry no labels at rest. Only leads are named, so pods can't be matched to sessions. | Label each pod cluster with its project, show names on hover or zoom, and keep names for agents that need you. | C1, C2, P x3 | |
| D3 | Med | Lead plaques sit on different baselines ("api-gateway" about 28px lower), which reads as a bug. | Align plaques to one baseline above the leads' heads. | C1 x2 | |
| D4 | Med | The selected worker's tag sits below the desk, about 100px from the sprite. | Put the selected tag above the head, or draw a leader line to the reticle. | C1 | |
| D5 | Med | In-scene text uses three styles (pixel signs, mono plaques, bare bubbles), and the board uses UI mono. | Define one in-scene text token set: font, size step, plate and border. | C1, C2 x2 | |
| D6 | Med | The OPS and AGENT OFFICE signs are low contrast, and OPS is small. | Lighten the sign text, add a 1px outline or backing panel, and size OPS to the same type scale. | C1 x2 | |
| D7 | Low | Canvas text sits around 8 to 10 CSS px at the default fit. | Floor it at 11 CSS px and make the Text size setting scale canvas labels. | C2 | Yes: scene-relative text landed after these captures |

## E. Environment: wall, floor, lighting, lounge

| ID | Sev | Finding | Suggested fix | Sources | Check |
|---|---|---|---|---|---|
| E1 | High | Window light shafts are flat translucent panels at the same angle that don't change between day and night. | Use one soft gradient per window, clipped to its x-range, fading to faint moonlight at night. | C1 x2 | |
| E2 | High | Night reads as dimmed day, and desk screens don't light the floor. | Add an additive pool under each monitor (40 to 60px, cyan, 12 to 15%) and darken the night ambient toward `#0a0f1f`. | C1, C2, P | |
| E3 | Med | The lounge looks unfinished: flat slate boxes with no rim light or highlights. The rug edge cuts through the tables, and the group sits off-centre on the rug. | Add a highlight and shadow pass, size the rug to the furniture group, and centre the group. | C1, C2, P | |
| E4 | Med | The door spine stops short of the door, its chevrons look like unexplained arrows, and it crosses the rug. | End the spine at the door header and stop it at the rug edge, or simplify the chevrons. | C1 | Yes: centring was fixed after these captures |
| E5 | Med | Pod floor tints (mauve, teal, green) read as light leaks or status colours. | Use one neutral fill and carry the project colour only in a thin border or label. | C1 x2, C2 | |
| E6 | Med | Tick marks along the bottom rail of the pod rows don't align to anything and look like debris. | Remove them or align one to each pod centre. | C1 x3 | Yes: likely the conduit junction boxes |
| E7 | Med | The task board's thick cyan frame is the loudest thing on the wall; the icon beside it reads as a second button; the clock is a flat pale disc with no bezel. | Use a slate frame with a 1px cyan accent, a neutral glyph or none, and a clock with a bezel and outline. | C1 | |
| E8 | Med | The pantry is crammed on the right and the wall weight is unbalanced. The AGENT OFFICE sign is wedged 3 to 5px from a window, while OPS has a bevelled plate and AGENT OFFICE has none. | Keep 8 to 10px gaps, one top baseline and one sign plate style, and place wall items on a fixed slot pitch. | C1, C2 | |
| E9 | Low | Sconces read as hooks, lamps read as bar stools, the fridge has no seam or handle, and the steam looks like dust. | Add shades and a small halo, a lamp shade cap, a fridge seam and handle, and a two-frame steam wisp. | C1 x2 | |
| E10 | Low | Window skies are identical, and clouds touch the frame. | Use two or three sky variants and keep clouds inset 2px. | C1 | |
| E11 | Low | Glow leaks past the floor boundary at night, and the vignette is uneven. | Clip glow to the floor rectangle and use one radial vignette. | C1 | |
| E12 | Low | The server bank is flush with the room edge with no base shadow. | Inset it about 8px and add a 1 to 2px base shadow. | C1 | |

## F. Pods, furniture, characters

| ID | Sev | Finding | Suggested fix | Sources | Check |
|---|---|---|---|---|---|
| F1 | High | Workers share one body template (same collar, tie and torso), so variety is only palette. | Add two or three silhouette variants (ponytail, bun, hood) and vary the shirt cut and sleeves. | C1, C2 | |
| F2 | High | Working, idle and waiting poses look the same at pod scale. | Give working a visible hands-on-keyboard frame and idle a leaned-back pose. | C1 | |
| F3 | High | Dark hair merges into the navy background and chairs. | Lift dark hair values or add a rim light on one edge. | C1 | |
| F4 | Med | Chairs are barely visible behind desk fronts, so second-row figures seem to float. | Draw a visible chair back or seat edge behind each figure. | C1 x2 | Yes: chairs exist but are occluded |
| F5 | Med | The furniture styles don't read: the huddle table looks like a pouf or bin, and standing desks and carrels are hard to tell apart. | Give the huddle table a visible elliptical top with stools, make standing desks taller with raised monitors, and give carrels partitions. | C1 | |
| F6 | Med | Empty seats look busy, with the monitor, clutter and lights still on. | Turn monitors off on empty seats and push the chair out. | C1 | |
| F7 | Med | The round grey desk objects repeat everywhere and read as clutter. | Remove them or tie them to state. | C2 | Yes |
| F8 | Med | At pod scale a lead looks like a worker. | Give leads a distinct accessory that reads at small size. | C1 | |
| F9 | Low | Hair outlines are heavier than body outlines, and marker stroke weights differ (1px vs 2px). | Use one outline weight per sprite and snap markers to one pixel grid. | C1, C2 | |
| F10 | Low | Some hair and shirt colours fall near the red and green status hues. | Keep character palettes at least 30 degrees from the status hues. | C2 | |

## G. Scale and sessions

| ID | Sev | Finding | Suggested fix | Sources | Check |
|---|---|---|---|---|---|
| G1 | High | There is no per-session aggregate (agents, working, waiting, worst state). | Show a compact session table by default, and/or a small plaque per session cluster. | C2, P x3 | |
| G2 | High | Lower pods carry no project label at high occupancy, so mapping them is guesswork. | Label each pod cluster in its session colour. | C2 | |
| G3 | Med | Individuals are unreadable at 45 agents. | Show names on hover or zoom, and keep names only for agents that need you. | C2 | |
| G4 | Med | Pips don't map one to one to agents at high occupancy, and pips are colour-only. | Use one pip per agent with a shape cue, or a per-pod count badge. | C2 | Yes |
| G5 | Med | A small office looks abandoned: about 30 empty desks for 3 agents. | Size or crop the room to occupancy, or zoom the camera to the occupied bay when counts are low. | C2 | |
| G6 | Low | Above a threshold, each session could collapse into a summary card (level of detail). | Make a summary card per session the default at high counts. | C2 | |
| G7 | Low | Rows fill unevenly, packed at the top and empty below. | Fill rows in a predictable order, or wrap the grid. | C2 | Yes: may be intended |

## H. Phone and overlay

| ID | Sev | Finding | Suggested fix | Sources | Check |
|---|---|---|---|---|---|
| H1 | High | The phone shows a large empty band above the scene. | Clamp the follow camera to the scene bounds. | C1 | Yes: conflicts with emulation results |
| H2 | High | On the phone, "who needs me and why" is not glanceable, and there's no "done" count. | Put the name and reason in the header chip (tap to focus) and show done, working and waiting as three numbers. | C1, P | |
| H3 | High | The phone sheet is controls-first. | Order the sheet as NEEDS YOU, then the agent list, then a "More" disclosure. | C1, P | |
| H4 | Med | Phone header crowding: the toggle overlaps the chip row, and targets are under 44px. | Give the toggle its own slot and use 40px chips and a tappable "+N". | C1 | |
| H5 | Med | Follow framing clips labels at the edge ("efront"), and "Fit all" sits over a desk. | Clamp labels to the viewport and move "Fit all" clear of the floor. | C1 | |
| H6 | High | Overlay is a fully opaque dark rectangle over the stream, with hard-cut edges. | Add a background opacity option (about 0.6), or an agents-only overlay. Fill the window edge to edge. | C1, P | |
| H7 | Med | The overlay caption uses raw ids ("a1_2") while the scene shows names, and there are no counts. | Use display names and add "N working / M need you". | C1, P | |

## I. Privacy

| ID | Sev | Finding | Suggested fix | Sources | Check |
|---|---|---|---|---|---|
| I1 | High | Project names, commands (`rm -rf build`) and error text show by default, and stream-safe is off and buried in Settings. | Add a visible privacy indicator in the header and one key that hides all text, including toasts and the status bar. Consider defaulting stream-safe on for overlay, presenter, wall and kiosk. | P x2, C2 | |
| I2 | Med | Overlay mode shows project names. | Hide project names in overlay by default. | P | |
| I3 | Med | It's unclear what "Private" does compared with stream-safe, and which views show text. | Explain it in one line, or merge the two into one setting. | P | |

## J. Data honesty and metrics

| ID | Sev | Finding | Suggested fix | Sources | Check |
|---|---|---|---|---|---|
| J1 | High | `tokens/min ~0/min` and "new in 0 · cached 0 · out 0" with 49 agents working read as "no spend". | Show real values when available, an explicit "no token data" state otherwise, and per-session cost. | P x2, C1 | Yes: synthetic events carry no usage |
| J2 | Med | The rate meters have no scale or fill and look broken when idle. | Use a sparkline with the current value first, or "idle, last event 40s ago". | C1, C2, P x3 | |
| J3 | Med | "No tasks yet" on the board contradicts "20 WORKING". | Explain where tasks come from ("tasks appear when a lead plans work"), or shrink the board when empty. | C2, P x2 | |
| J4 | Med | "attribution: guess (several or no matching delegations)" is jargon to newcomers. | Say it in plain language and link to the delegation. | P | |

## K. Accessibility

| ID | Sev | Finding | Suggested fix | Sources | Check |
|---|---|---|---|---|---|
| K1 | High | Tertiary text (group labels, status bar, helper copy) is around 2.5 to 3:1. | Raise the tertiary token to about `#7d8497` to `#9aa0b8` (at least 4.5:1) and use 11px minimum. | C2 x2, C1 | Yes: measure |
| K2 | Med | Settings controls are under 24px (checkboxes about 11px, Mute buttons 16px tall). | Use 24px minimum targets and make whole label rows clickable. | C2 | |
| K3 | Med | The working dot is about 4 CSS px. | Draw it at 8px or more with an outline. | C2 | |
| K4 | Med | Reduce motion isn't defaulted from `prefers-reduced-motion`, and there are pulsing rings. | Default it from `matchMedia` and keep rings static when reduced. | C2 | Yes: code may already honour the OS setting |
| K5 | Med | Focus rings are visible only on some controls. | Check every interactive element. | C2 | Yes |

## L. Identity and cohesion

| ID | Sev | Finding | Suggested fix | Sources | Check |
|---|---|---|---|---|---|
| L1 | High | Scene and chrome read as two products: a generic dashboard bolted onto a pixel scene. | Restyle the panel chips with the scene's bracket and pixel language, and cut the visible actions to about 8. | C2, P x2 | |
| L2 | High | The wordmark appears in two typefaces (UI mono header, pixel wall sign). | Use the pixel sign as the header logotype. | C2 x2 | |
| L3 | Med | The wall board is the one diegetic text surface but is empty, while alerts use web patterns. | Write blocked and waiting items onto the board ("mobile-app: permission?"). | C2 | |
| L4 | Med | Window views show a generic daytime sky. | Draw a dim skyline with neon bleed. | C2 | |
| L5 | Low | Props are generic office furniture. | Add two or three signature props (a hanging neon sign, a holo-map table on the empty floor). | C2 | |
| L6 | Note | The best thing it does: the lead-at-door hierarchy with labelled leads and bracketed pods. | Keep it. | C2 | |

## M. Spacing and alignment (pixel-level)

| ID | Sev | Finding | Suggested fix | Sources |
|---|---|---|---|---|
| M1 | Med | The panel's left edge is inconsistent: NEEDS YOU, the help text and SESSIONS are inset about 3px more than the buttons. | Use one panel padding token. | C2 |
| M2 | Med | The top-stack gutters differ: status dot about 26px, chip strip 20px, floor 33px, header right inset about 15px. | Use one gutter (16px) for the header, chip strip and canvas. | C2 |
| M3 | Med | Settings control columns are ragged (sliders, input, select and checkboxes start at different x). | Use one fixed control column. | C2 |
| M4 | Low | Wall slot gaps are uneven (list icon touches the window frame, clock off-centre in its gap). | Use a fixed slot pitch. | C2 |
| M5 | Low | In the big office, the lower desk pairs are inset about 12px from the pod brackets above. | Snap them to the same columns. | C2 |

## Reliability notes

These reviewer claims are likely wrong or need re-measuring before anyone acts on them:

- **"Chairs missing" (F4):** chairs exist but are occluded by the desk front, so this is a readability issue, not an absence.
- **"Blocked agent not visible" (pass 1):** blocked agents leave their seat and are held briefly, so captures taken a few seconds later miss them. Pass 2 captured one.
- **"Pod tints are inconsistent" (E5):** the per-project tint is the intended session identity. The critique is that it reads as status, which is a fair point.
- **Phone empty band (H1):** this contradicts the touch-emulation check after the phone-layout change. Re-capture before fixing.
- **Contrast and sizes (K1, D7):** all are estimates. Measure with a colour sampler or Lighthouse before setting thresholds.

## Suggested build order

1. **A1 + A2 + A13 + K3:** one status colour map with shapes and glyphs. This is the cheapest, widest fix.
2. **B1 + B3 + H3:** panel and phone-sheet reorder.
3. **C1 to C6:** dialog layout fixes.
4. **I1 to I3:** privacy defaults and indicator.
5. **J1 to J3:** honest meters and board empty state.
6. **G1 + G2 + B7:** per-session summary, pod labels and chip grouping.
7. **E1, E2, E3, F1 to F3:** lighting and character passes.

---

## Pass 3: long-term vision (Opus)

Five Claude Opus agents at medium effort, each with one lens. They read the code and docs as well as the screenshots, and the experience and simulation agents ran a throwaway daemon or the reducer to verify claims. **Verified** below means confirmed in code or by a run, either by the agent or by the lead session. Everything else is the reviewer's judgement.

### Vision (product agent)

> Agent Office is the window you keep open while Claude works. Glance at it from across the room and in two seconds you know whether anything needs you, what each session is trying to get done, and whether it got there. The office metaphor is how it shows this, not why it exists. The job no other tool does is a calm, glanceable account of delegation: who handed what to whom, and what came back. That account updates live, stays on your machine, and is safe to put on screen. In two years it should be the place where a person running 3 to 10 parallel sessions sees **outcomes** (done, blocked, partial), not **activity** (typing animations).

**Art direction (art agent).** A lived-in night shift on an orbital ops deck. The room is dark and cool, and every bit of light comes from something real: screens, lamps, the city outside. References: Eastward and Hyper Light Drifter for value and light, VA-11 Hall-A for warm against cold, Stardew and RimWorld for small figures that carry state through pose. The rule: *if a fact can be shown by a prop, a pose or a light, don't draw a UI mark for it.* It would reverse the recent direction. Freeze new overlay marks and push state into pose, screen colour and the desk lamp, with at most one pixel badge per agent for the rare states.

### Verified defects (fix before anything else)

| ID | Sev | Finding | Fix | Verified |
|---|---|---|---|---|
| Z1 | High | Text reaches disk even in privacy mode. Every event is appended to `~/.agent-office/events.jsonl` (`server/src/main.ts:201`), including prompts, commands, error text and narration. Privacy only blanks text when it's read back. | Strip text before writing when privacy is on, add a retention setting, and ship a one-time purge, since existing logs already hold unredacted text. | Lead session (code) |
| Z2 | High | The transcript is read in privacy mode. `narrationEvents` (`main.ts:132`) has no privacy check, which contradicts the `CLAUDE.md` guardrail that narration is blank in privacy mode. | Don't read the transcript at all in privacy mode. | Lead session (code) |
| Z3 | High | The README says "no persisted history" (line 114), but the daemon keeps a 24h event log, and Replay, Recap and the digest read it. | Correct the README: "Today is live. History is opt-in, local, and has a delete button." Make the UI match. | Lead session (code) |
| Z4 | High | The waiting ring stays on after the prompt is answered: `tool_end` and `turn_end` never clear `waiting`. | Clear `waiting` on the lead's `tool_end` (no agent id) and on `turn_end`, with a test. | Simulation agent (reducer probe) |
| Z5 | High | A subagent's tool event clears the lead's permission prompt while it is still on screen. | Only a lead tool event (no agent id) clears it. | Simulation agent (reducer probe) |
| Z6 | High | Replay and Sample hide live attention. During Replay, a live permission prompt didn't reach the title, header or chime, while NEEDS YOU showed a replayed block as current. | Keep the title, header and alerts on the live envelope, and pin a "LIVE: 1 needs you, back to live" chip during Replay and Sample. | Experience agent (headless run) |
| Z7 | Med | The state envelope is dropped silently above 2 MB ("state too large, event dropped"), so large offices lose data without a signal. | Send deltas plus a snapshot on connect, and show a visible "degraded" marker instead of dropping. | Platform agent (code) |
| Z8 | Med | `docs/ENTERPRISE.md` is out of date: it calls `AGENT_OFFICE_HOST` and `AGENT_OFFICE_DISABLED` "planned", but `AGENT_OFFICE_HOST` exists and binds any address with only a log warning, against "loopback only". | Remove it, or require an explicit opt-in flag and document it; update ENTERPRISE.md. | Platform agent (code) |

### Strategy and honesty

| ID | Sev | Finding | Recommendation | Source |
|---|---|---|---|---|
| V1 | High | The product shows activity, not outcomes. The core already parses DONE, BLOCKED and PARTIAL, but finished work leaves no trace. | Make the outcome the first-class unit: a finished task leaves a filed card with its one-line result on the desk until you look, and the wall board becomes the outcomes ledger ("storefront: checkout flow ✓ 4m"). The art agent independently proposed a "world memory" (residue, pinned tickets, a shipped tally by the door). | Vision, Art |
| V2 | High | "Observer-only" isn't quite true. SessionStart and SubagentStart inject a roster, a report format and a parallelism nudge ("fan out"), and `enforceSeats` can deny spawns. The visualization shapes the work it shows, and the docs don't say so. | Disclose it as the "office protocol" in the README and Settings, make it switchable with a "pure observe" preset, show a "nudged" badge per session, and never nudge fan-out by default. **Owner decision.** | Vision, Simulation |
| V3 | High | "Blocked" is a post-mortem shown with the most urgency. The agent has already stopped, and the lead often handles it. The real "needs you now" is a permission prompt, which is currently merged with "your turn" (idle). | Split waiting into *permission* (loudest), *your turn* and *agent gave up*. This challenges A1, which assumed blocked should be the loudest state. | Simulation |
| V4 | High | Desks are the wrong main axis at scale: 49 identical sprites tell you less than four session rows would. | Make the session the visible unit: above about 12 agents, each crew collapses to its lead plus a pod badge (counts, worst state), click to expand. Make this the default, not an option. | Vision, Platform |
| V5 | High | Agents stroll to the coffee machine while generating: a subagent between tools is still producing tokens. | Only leads that are idle after Stop may stroll; a subagent between tools shows "thinking" only. | Simulation |
| V6 | High | Spend is undercounted by design. Usage comes from the lead's transcript only, is read only at Stop, and is summed over the last 8 MB. This explains J1. | Add subagent usage from `agent_transcript_path`, refresh on PostToolUse with throttling, and keep a running total keyed by message id. | Simulation |
| V7 | Med | Agents that go silent inside a live session are never caught (stuck detection is lead-only). | Flag an agent with no events for N minutes while its siblings are active. | Simulation |
| V8 | Med | The mode count is a scope problem, not a layout problem. | Cut to three surfaces: Office (glance), Session (drill-in) and Overlay (stream), with the rest behind "More". | Vision, Experience, Platform |

### Experience and information architecture

Core loops, with how often users stall: glance (low), triage a blocked agent (**high**), who delegated what (**high**), review time away (**severe**), learn the app (medium).

| ID | Sev | Finding | Recommendation |
|---|---|---|---|
| X1 | High | Triage: `n` focuses the agent, but what it blocks (the lead's task) and what to do (go to that terminal) appear nowhere. | Put the reason, who delegated it and the next step on one card, with nothing above it. |
| X2 | High | Delegation is shown one level up only ("reports to"). | Show a delegation tree on the card, and draw lines from the selected agent up to its lead and down to its helpers. |
| X3 | High | Timeline and Replay are two dead ends for one job: Timeline clicks do nothing, a range can't be replayed, Recap is a PNG, the digest is CLI-only, and the feed is lost on reload. | One History view: Timeline + Replay + Recap, with "since you were last here" as the default range, row click selects, and range offers "Replay this range". |
| X4 | High | There are three "freeze" concepts (global Freeze, the feed's Pause, the feed's hover hold). | Keep only Freeze with its chip; the hover hold stays implicit. |
| X5 | Med | Identity breaks between surfaces (Timeline "backend-dev A_1" vs "Priya" elsewhere). | Use display names everywhere, and the same pseudonyms everywhere in privacy mode. |
| X6 | Med | One click does several things: it scopes and selects at once, and Esc clears the selection but not the scope. | Show a scope breadcrumb in the header ("All ▸ billing-service ▸ Priya"), with Esc walking up one level. |
| X7 | Med | The keyboard model is shallow (no keys for open-session, views or replay markers; j/k don't work in presenter). | Group keys by loop (Triage n / Enter / Esc, Navigate, Views 1 / 2 / 3) and send the long tail to the palette. |
| X8 | Low | Kiosk spends a third of each cycle on Timeline, which is history. | Rotate live surfaces only, and let an alert break the rotation. |

**Target information architecture:**
- **Scene:** live state and spatial identity only, with alerts drawn on the agent.
- **Header:** a NEEDS YOU pill (cycled with `n`), a scope breadcrumb, an **Office | Sessions | History** switch, and chips only while a mode is active (FROZEN, REPLAY, PRIVATE, SAMPLE).
- **Panel:** a context inspector. NEEDS YOU, then the selection card (reason, tree, next step, tools), then Activity, with Lists folded.
- **Menus:** Display (Presenter, Wallboard, Stream), Export (Record, GIF, Share, Recap, Copy link), one Privacy toggle, and a Help tab that absorbs Intro and the legend. Sample appears only in the empty state.
- **Net effect:** about 18 visible buttons become 3 plus the palette.

### Art direction

| ID | Sev | Finding | Recommendation | Cost |
|---|---|---|---|---|
| R1 | High | Mixed pixel scales: rings, dots, `!`, arcs and brackets are vector strokes at device resolution (0.8 to 1.5 widths) next to 16px art. This is the biggest single "cheap" tell. | Build markers as pixel `Grid` sprites at art scale. | S to M |
| R2 | High | There is no value key: the canvas sits in a narrow 15–40% band of navy, so neon can't glow. | Set a value ramp first (floor around 8%, furniture tops around 30%, emitters 85%+) and grade every sprite to it, behind one palette token. | M |
| R3 | Med | The white chest role glyphs are the brightest thing on each worker, so 20 workers read as 20 icons. | Tint the glyph from the shirt ramp and keep pure white for glare and eyes. | S |
| R4 | Med | The visible 16px grid makes the floor read as an editor tilemap. | Draw material instead: plate seams every 2 tiles at about 4%, a scuffed aisle lane, wear under chairs. | S |
| R5 | Med | Every pod wears the selection reticle's bracket language. | Brackets for selection only; pods get a physical partition or kick-plate. | S |
| R6 | Med | The thinking emote reads as a chef's hat (flush on the head at hair value). | Lift it 2px, add a tail, use a lighter value. | S |
| R7 | Med | The world has no memory: at the end of the day it looks the same as at boot. | Finished work leaves residue (paper stacks, pinned tickets, a shipped tally light). See V1. | M |

**Style guide skeleton:**
- **Palette roles:**
  - environment: one 6-step blue-violet ramp
  - machine and working: cyan, emitters only
  - attention: amber; blocked: red-orange
  - decorative neon: magenta, signage and skyline only, never status
  - characters: muted, at least 30° from status hues
  - at most 3 saturated hues outside alerts; team hues as thin trim only
- **Light:** overhead key light slightly to the left, with the top-left highlight on every sprite. Pools come only from registry emitters, including screens. Night is the hero state.
- **Characters:** about 60% head and shoulders. Silhouette carries role (hair, accessory). The brightest pixel is the face. Use selective outlining instead of one uniform outline, and give leads a silhouette cue.
- **Motion:** 2- or 4-frame cadence at 8–12 fps, no tweened alpha pulses on art, alerts move only for their first seconds, and ambient motion is slower than agent motion.
- **Chrome:** the environment ramp plus the sign font for headings, mono for data. The panel is the "back office" of the same building, and no colour appears in the chrome that's missing from the scene.

### Platform, scale and inclusion

| ID | Sev | Finding | Recommendation |
|---|---|---|---|
| P1 | High | Every event pushes the whole state (up to 2 MB) to up to 20 clients. | Delta streaming; clients subscribe to a level of detail (counts per session vs one session in full). |
| P2 | High | Multi-day history isn't possible: two 5 MB files, `/history` capped at 2000 events (about an hour at 30 events/min, estimated), synchronous whole-file reads that block the daemon. | Per-day event files with a time/offset index, async streamed `/history`, and text stored separately from structure so retention and privacy can drop text and keep the timeline. |
| P3 | Med | Wall and Timeline keep the Pixi ticker running underneath, so a kiosk mini-PC burns GPU drawing a hidden scene. | Stop the ticker while the canvas is covered (about 3 lines). |
| P4 | Med | i18n plurals only know one/other, and canvas text has no locale path. | Key plural forms by `Intl.PluralRules` before the first translation. |
| P5 | Med | 64 desks is a hard cap. | Floors: one floor per group of sessions, with the camera and minimap moving between floors. Beyond the visible budget, agents fold into a pod badge, never into an invisible queue. |
| P6 | Med | There's no performance budget. | A CI gate: for example 16 ms per frame at 100 agents with 4x CPU throttling, plus an object budget. |
| P7 | Low | Many machines. | Keep each daemon loopback-only and offer an opt-in, read-only exported digest (counts and states, no text). No inbound listener. |

**Surfaces verdict (platform agent):**
- **Keep:** Office.
- **Promote:** Wall to a "List" view, which is the phone default and the screen-reader path.
- **Merge:**
  - Present, Kiosk and Overlay into one Display mode.
  - Timeline and Replay into History.
  - Record, GIF, Share, Copy link and Recap into Export.
- **Keep Float,** showing the summary rather than a shrunken scene.
- **Cut:** Sample from the main chrome.

### Derived signals worth building (simulation agent)

1. **Permission latency per session:** the time from a permission prompt to the next event. This is the one cost the human controls. Uses hooks only.
2. **Tool-time profile:** p50 and p95 duration and failure rate per tool per session. Flag a tool running more than 3x its own p95 (smarter than the fixed long-tool threshold).
3. **Real spend:** subagent usage included and refreshed during the turn (see V6).
4. **Session after-action summary at SessionEnd:** agents, delegation tree, errors, permission waits and duration. This data is currently discarded by `endSession`. Local only; must honour privacy mode.
5. **Exact delegation matching (unverified):** if the Agent tool's response carries the spawned agent id, allowlist that one field.

### Things to protect (all five agents agree on these)

- **The lead-at-the-door hierarchy and the delegation walks:** the one thing a table can't do.
- **The trust posture:** loopback only, no API or credential access, redacted narration, the compliance check. That makes Z1, Z2 and V2 urgent rather than cosmetic.
- **The calm:** no auto camera cuts, sound off by default, nothing punishing, no gamification beyond needs-you.

## Revised build order (after pass 3)

1. **Z1–Z6:** verified privacy, state and attention bugs. These are correctness and trust, so they come first.
2. **V2:** office-protocol disclosure and a pure-observe preset (owner decision).
3. **V3 + A1 + A2:** split permission / your turn / gave up, with one colour map plus shapes and pixel-sprite markers (R1).
4. **X1 + X2 + B1:** triage card with delegation tree; panel becomes an inspector; the button wall becomes Display / Export / Settings.
5. **V1 + R7 + J3:** outcome cards and the wall board as an outcomes ledger.
6. **V4 + G1:** session-collapsed level of detail by default at scale.
7. **X3 + P2:** History view on per-day storage.
8. **R2–R6 + E1–E3:** the value key regrade, then the lighting and material passes.
9. **P1, P5, P6:** delta streaming, floors, performance gate.

---

## Implementation status (vision build, October 2026)

Built by the lead session and two Opus agents in parallel: A on core, server and docs; B on the DOM experience; the lead on the canvas. Each item was judged before building, and anything that didn't hold up was skipped with a reason.

**Checks at hand-off.** Typecheck, 278 tests, the compliance check and the web build all pass. Committed as 5523c35.

### Done

| Area | Items | What changed |
|---|---|---|
| Truth and privacy | Z1, Z2, Z3, Z7, Z8 | Text is stripped before writing in privacy mode, and privacy mode never reads transcripts. Retention is `historyHours`, defaulting to 168 h (7 days, matching the digest); the lead raised it from the 24 h Agent A first chose, so a restart wouldn't delete history users rely on. `office.mjs history --purge` deletes the log. The README states what is stored. An oversized envelope is trimmed and flagged `degraded` instead of dropped. A non-loopback host needs `AGENT_OFFICE_ALLOW_REMOTE=1`, and ENTERPRISE.md is rewritten to match. |
| Status model | Z4, Z5, V3, A1, A2, A13 | The lead clearing rules are fixed and tested. Waiting has a kind: permission (loudest, amber `!`, 4 solid arcs) or your turn (calm, cyan `?`, dotted, never pulses). A helper that gave up is red `x` with 6 arcs. One `STATUS` map with colour, glyph and word drives the ring, tag, pip, list dot, row accent, pill, favicon and legend. |
| Calm and markers | A4/T7, R1, R5, A14 | Per-tool ripples are gone. The long-tool arc appears only after 30 s, with no track circle. Alert rings are pixel sprites at art scale and pulse only for their first 4 s. Pod corner brackets are removed, since brackets mean "selected". |
| Outcomes | V1, R7, J3, A9 | `state.outcomes` holds results. The wall board is the outcomes ledger (`✓ project: result`). A helper that finishes leaves a filed card on its desk until someone sits there or 30 min pass. The panel has a Recently done section. The `BLOCKED:`/`PARTIAL:` prefixes are gone from rows, cards, highlights, bubbles and the status line. |
| Honesty | V2, V5, V6, V7 | The office protocol is disclosed: README, Settings, a "nudged" chip, and an `observe` preset that injects nothing. The default wording no longer pushes fan-out. Only leads whose turn is over stroll, while helpers stay at their desks. Spend includes subagents and refreshes mid-turn. Agents carry `lastAt`. |
| Information architecture | B1, V8, X1–X8, A3, A10, B2–B9, H2–H4 | One amber header pill. An Office / Sessions / History switch, Display and Export menus, ⚙ and ?. The panel is an inspector: NEEDS YOU (glyph, word, reason, Open, Snooze), then a triage card with a scope breadcrumb, next step and delegation tree, then Recently done, Activity and folded Lists. Timeline rows select; a range offers Replay. One Freeze. Display names everywhere. Keys are grouped by loop (1/2/3 for views). Kiosk rotates live surfaces only, and an alert holds it. The phone shows NEEDS YOU first and puts the toolbar under More. |
| Live attention | Z6 | During Replay and Sample, the pill, title, favicon and chime read the live envelope, with a "LIVE: N need you · back to live" chip. |
| Dialogs | C1, C3–C6, M3 | Grid layouts with no overprint, scroll fades, a title and close button, grouped Settings, `accent-color`, and no wrapping buttons. |
| Privacy UI | I1, I2, I3 | A "text shown / hidden" header chip. With text hidden, canvas lead labels become "session N" and pod plaques drop the project name. Private and stream-safe are kept, each explained in one line. |
| Floor and figures | R3, R4, R6 | Deck-plate seams every 2 tiles replace the cyan grid. Chest glyphs are soft grey, so the face is the brightest part. The thought cloud sits 2 px clear of the hair. |
| Meters, accessibility, performance | J2, K2, K3, P3 | "idle, last event 3m ago" and "no token data yet" replace empty bars. 24 px controls (44 px on touch), 18 px checkboxes, and an 8 px outlined roster dot. The canvas drops to 4 fps while a list view covers it. |

### Verified, no change needed

| Item | Why |
|---|---|
| K1 | The muted text token is already 7.2:1. |
| K4 | Reduce motion already defaults from `prefers-reduced-motion`. |
| K5 | A global `:focus-visible` ring covers the controls. |
| A7 | No selection-dimming code exists; the critic saw a bubble ending its normal life. |
| D1 | Bubbles do have plates. |
| F4 | Chairs exist but are occluded by the desk front. |
| G7 | The row fill order is intended (centre-out mirror pairs). |
| H1 | The phone empty band contradicts the emulation check after the phone-layout change. |

### Skipped this pass (deferred, with reasons)

| Item | Reason |
|---|---|
| C2 scrim | A scrim would hide the alerts the critique wants visible. Dialogs instead stay above the toast area. |
| D2 persistent pod labels | The owner asked for plaques on hover only. Pod identity is in the hover plaque and the triage card. |
| R2 value-key regrade, F1–F3 character silhouettes and poses, E1/E3/E7–E12 environment polish, L2/L4/L5 identity props | One coordinated art pass behind a palette token, not piecemeal; the art agent warns a partial regrade leaves two styles. |

## Finishing pass (October 2026)

Every open item, in phase order. Each phase ends with typecheck, tests, compliance, the web build and a screenshot pass (desktop and 390x800; 3, 12 and 45 agents; day and night; a blocked helper, a permission prompt and a your-turn lead).

### Phase 0: the vision build on real data

Watched the owner's real Claude Code 2.1.296 sessions through the running daemon. Three things were wrong on real data and are fixed:

| Check | Found on real data | Fix |
|---|---|---|
| Outcomes, wall ledger, desk cards | 140 of 155 real subagent stops carried no `last_assistant_message`, so nearly every outcome was `empty`. A real subagent hands its report back as the `SubagentHandback` tool's `message` input. | The adapter keeps that input (already allowlisted by the forwarder) on the tool event; the reducer holds it as the agent's `report` and uses it when the stop has no message. No transcript read was widened. Verified live: a probe subagent's report reached the ledger as `done`. |
| Permission vs your-turn | The only real permission notifications were "needs your permission to use AskUserQuestion", which is Claude asking a question. | A question prompt is now your turn (cyan `?`), in the adapter and in the replay fallback for stored events. |
| Mid-turn spend | After a daemon restart the ledger read only the last 8 MB of a transcript; the owner's 48 MB lead transcript showed about 155k output tokens instead of 918k. | A fresh ledger catches up from the start, still at most 8 MB per read (0.2 s for 48 MB). |
| Junction LEDs | The pod of a working real helper shows its lit tick. | No change. |

Not observable from here: a real tool-permission prompt (this session runs without them), and `idle_prompt` (it fires after a minute at the prompt, and none was stored). Both paths are covered by adapter and reducer tests with the documented payloads.

### Phase 1: honesty and layout correctness

| Item | Verdict | What changed |
|---|---|---|
| V2 follow-up: delegation skill | Done | `office-delegation` no longer pushes fan-out: its description says it applies once you have decided to delegate, "auto" means your judgement with no push either way (matching the injected "your call" line), and only "aggressive" asks for fan-out. Plugin 0.0.3, updated through `claude plugin marketplace update` + `plugin update`. |
| A6 | Done | Bubbles live on one layer above every actor's overlay, so a neighbour's pip, ring or tag never covers them. The stacker knows the floor/HUD top edge: a bubble starts where the clamp would put it, and one that cannot rise clear is hidden instead of being clamped back onto another. An alert's own words outrank a neighbour's speech. |
| A8 | Done | An alert's flag and ring are fixed obstacles for other agents' tags (never its own), so a walking lead's label yields around a blocked helper. A status pip never sits on someone else's tag. |
| B10 | Done | The panel's NEEDS YOU band is exactly the header's height, so both end on one line (measured: 40 px and 40 px, was 40 and 43). |
| H5 | Done | Labels clamp to the visible part of the floor, so a followed or zoomed camera never cuts one at the canvas edge; off-screen agents are not stacked. The camera fits above the meter strip and the phone's Fit button, so neither covers a desk. On phones one highlight card shows at a time and a "gave up" card times out (NEEDS YOU and the pill keep it), so it no longer covers the stage where the camera frames the alert. |

### Phase 2: data architecture

| Item | Verdict | What changed |
|---|---|---|
| P1 delta streaming | Done | After a full snapshot on connect, each commit sends an `event: patch` (changed head fields, changed session/agent/pending entries, other changed keys, log drop/add), diffed by reference with privacy blanking cached per object. A client that misses a base resyncs from `/state`. Measured: 605-byte patches against an 18 KB snapshot. `?lod=summary` and `?session=<id>` give a per-client level of detail (sessions plus per-session crew counts); the canvas keeps the full stream. A degraded (trimmed) envelope is always sent in full. Known cost: the full envelope is still serialized per commit to detect a degraded one (shortcut comment; measured in the Phase 3 performance gate). |
| P2 per-day history | Done | New events go to `events/YYYY-MM-DD.jsonl` with free text in a sibling `.text.jsonl` and a time index (`.idx`). Deleting text keeps a replayable timeline; privacy mode writes no text file. `/history` reads asynchronously and streams its response in slices with backpressure, pages older with `more`, caps a page at 20,000 events and clamps to retention. The legacy `events.jsonl` is still read, never rewritten (verified byte-identical across the switch on the owner's machine). `textHours` (default = `historyHours`) and `office.mjs history --purge-text`. |
| After-action summary | Done | `state.summaries` (20, no free text): duration, agents, delegation tree, errors, permission waits, outcome counts, tokens; written at SessionEnd and by the idle sweep. Sessions view lists them under ENDED. |
| Permission latency | Done | `session.permWait` (count, total, last, open since), shown on session tiles, panel rows and the lead's card. An open wait's age moves in whole minutes, so the card is not rebuilt every second. |
| Tool p50/p95 + long-tool flag | Done | `session.toolStats` per tool (last 64 calls; p50, p95, failures), listed in the card. The canvas long-call arc now waits for 3x that tool's own p95 (at least 10 s) once 5 calls are known, else 30 s. |
| X3 History on the new storage | Done | Default range "since your last visit" (else 24 h), Today, 7 days, custom From/To, Load older; row click selects and Replay this range stay. |
| P4 plurals | Done | i18n messages are keyed by every `Intl.PluralRules` category (tested with Polish one/few/many/other). |
| P7 many machines | Done | `scripts/digest.mjs --counts` exports counts and states only (no paths or text); read-only, no listener. Daemons stay loopback-only. |
| Derived signal 5: exact delegation matching | Skipped | The Agent tool's result shape could not be verified from here, and `SubagentStart` already carries `agent_id`; matching by delegation order stays, with "(?)" marking a guess. |
| Found in the screenshot pass | Fixed | Opening the page on a busy office paraded every agent in through the door (about 15 s at 45 agents); a fresh snapshot now places the crowd at its desks at once. "1 errors" is now "1 error". |

### Phase 3: scale as one system

| Item | Verdict | What changed |
|---|---|---|
| V4, G6 session collapse | Done (default) | Above 12 live helpers (off again at 10) each crew folds: its helpers hide while their desks keep showing real activity. An agent with an alert, the selected agent, queued agents and opened sessions stay visible. |
| G1 per-session aggregate | Done | Each collapsed crew has a badge on its first pod (counts, worst state with glyph and word). Sessions view tiles and panel rows read "N agents · k working · w waiting · b blocked" with the worst state's glyph and word. |
| G2 project labels | Done | The badge names the project in the session hue ("session N" when text is hidden). |
| G3 names at scale | Done | While collapsed, only leads, alerts, the selected or hovered agent and opened crews carry names; everyone else is a pip. |
| G4 pips | Done | The badge shows one shape-coded pip per helper (8, then +N). |
| G5 small office | Skipped | The room is sized to the configured team on purpose and empty pods are dimmed; auto-zooming would override Fit all and the user's own camera. |
| Expand and collapse | Done | Click a badge to open its session (the badge moves above the pod), click again or Escape to close; selecting an agent anywhere opens its session. A badge never covers an agent that needs you, and tags, flags and bubbles treat badges as obstacles. |
| P5 floors | Done | Up to 3 floors (192 desks, under the reducer's 200-agent limit) stacked in one world; a session stays on one floor; the minimap marks each floor and PageUp/PageDown move between them. Beyond that, a "+N waiting for a desk" label shows; never an invisible queue. `enforceSeats` denies at the new total. |
| Seats never move | Done | Tests: desk positions are append-only across floors and no seated agent moves when a floor opens. |
| P6 performance gate | Done | `npm run perf` (CI job `perf`): 100 agents over 8 sessions with live tool traffic, headless Chrome over the DevTools protocol (no new dependency), 4x CPU throttling, gate at 16 ms frame p95 (main thread) and 3500 display objects; `PERF_PROFILE=<file>` writes a CPU profile. The first profile found two real costs, both fixed: a per-frame forced layout (from the Phase 1 bottom-inset fix) and an O(n^2) actor list for the panel. Now p95 13.3-14.5 ms, about 2640 objects. Daemon: about 0.7-1.1 ms per event at 100 agents (~940 events/s), so the full-envelope serialization per commit is not a real cost. |
| Found in the screenshot pass | Fixed | An off-screen lead's tag peeked in at the canvas edge and collided with others; it is now hidden until the lead is on screen. |
