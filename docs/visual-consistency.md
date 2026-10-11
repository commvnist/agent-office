# Visual consistency

Every position the renderer draws comes from one registry in `packages/core/src/footprint.ts`, and every pixel is placed by
one rule set in `packages/web/src/snap.ts`. The goal: nothing looks misaligned, and a misalignment fails a test.

## The grid

- One tile = `TILE_PX` = 16 art pixels (`actor.ts` `T` is the same constant). All layout data is in tiles.
- Art space = world coordinates in whole art pixels (y includes the wall rows). A sprite is 16 art px per tile.
- The room is `cols x rows` tiles; walkway columns 1 and `cols-2` are never blocked; the door aisle is the centre column.
- Pod stride is 4 x 5 tiles. The conduit run for a pod row sits on the aisle centre line (tile top + 8); each pod's junction is centred under it.

## The registry (single source of truth)

| API (core) | What | Consumers |
|---|---|---|
| `placements(layout)` | footprints in tiles: `desk:dN`, `chair:dN`, `link:p:r`, `lobby-desk:i`, `lobby-chair:i`, `queue:i`, `decor:<kind>:<i>` (racks, lamp, ...), `junction:p`, `rug:*`, `door`, `board`, `window:x`, `sconce:x`, `plate:ops|agent` (sign), `clock`, `gauge`. `solid` footprints == `layout.blocked` | `geometry.ts`, `checkLayout` |
| `lines(layout)` | baked lines in art px, only three kinds: `conduit:trunk:r` (bank bottom down column x=24), `conduit:row:r:c` (aisle centre line to each pod's junction), `spine`, plus `apron:p` anchors (core also emits `plate:p` anchors; the renderer does not use them). No lane seams, no threshold, no cable art | `geometry.ts`, `checkLayout` |
| `lights(layout)` | one pool anchor per sconce / floor lamp footprint (`light:<source>`), warm or cool; the only source of light pools | `geometry.ts`, `checkLayout` |
| `checkLayout(layout)` | violations, `[]` when consistent | `geometry.test.ts`, `selfCheck` |

`packages/web/src/geometry.ts` `sceneGeometry(layout)` is the only bridge: it returns the registry plus pieces derived from it
(aprons, standing mats, bot rails, charging dock, server racks, junction centres, sconces, signs, window columns, clock/gauge centres).
`scene.ts` draws only from that object (`this.geo`): furniture via `geo.rect(id)`, floor print via `geo.conduits`/`geo.rugs`/
`geo.mats`/`geo.junctions`, light pools only from `geo.lights`, the bot's path via `geo.rails` (the aisle's upper edge, never on the conduit centre line) and the dock via `geo.dock`. No tile math in `scene.ts`.

### Exceptions (drawn without a registry id), and why

- Zone floor tint regions and the zone dim overlay: tile-aligned from `layout.zones`, not objects.
- The door frame overhangs its one-tile footprint by 4 px each side (constant in `drawDoor`).
- No text is painted on the floor (no pod plates, lane letters or stencils); pod identity is `P<n> · <project>` in the hover plaque.
- Wall signage text: drawn inside the `plate:ops|agent` sign footprints (text width is not modelled).
- Clock / gauge centres: the footprint keeps only their bounding tiles; `wallDials()` holds the centre and
  `geometry.test.ts` asserts the 20 px extent sits inside the footprint.
- Light-only art (window shafts, desk glows, vignette, night/day overlays, weather) is not an object; it is anchored on windows/desks. Light pools proper come only from `lights()`.
- Junction LED and rack LEDs are child sprites of their box/cabinet, not separate footprints.

## Floors and session badges

- Floors: desks 64..127 and 128..191 repeat the first floor's plan three pod rows lower (`deskPos`, `floorTop`, `podRow` in `layout.ts`);
  the one room grows downward, so every id in the registry stays append-only (`footprint.test.ts` grows to 192 desks). Pod rows, not
  pod indices, drive conduit rows and wing tints. The minimap draws a rule and a number per floor; PageUp/PageDown move between floors.
- Session badges (`main.ts` `drawBadges`, collapse above 12 helpers): screen-space overlays through `dev()`, centred on the session's
  first pod (above it once opened), stacked with `stackLabels` inside the visible floor and fed to `obstacles` (`actor.ts`) so tags,
  bubbles and pod plaques keep clear of them. Text follows `fontPx` (scene-relative).

## Snapping rules (enforced in code)

1. Art space is integers. Sprites and graphics are positioned through `place()` / `art()` (`snap.ts`); animated offsets
   (chair scoot, build-in rise, bot, cat) are rounded at the assignment. `checkLayout` rejects non-integer footprints and lines.
2. Screen-space overlays (name tags, plates, bubbles, plaques, captions, rings, tether/door token endpoints, board text) go through
   `dev()`, which rounds to the actual device pixel (`setDpr` is set from `main.ts` and on every DPR change).
3. The camera offset (`ox`, `oy`) is rounded to a device pixel (`Camera.view(..., dpr)`), so art pixel edges never straddle a
   physical pixel.
4. Scale (`fitScale` in `main.ts`): the room fits width minus an 8 px margin each side. The scale is a whole number of device
   pixels per art pixel (`floor(sc*dpr)/dpr`) unless that costs more than 12% of the fitted size, then it stays fractional
   (steps of 1/16) with snapped offsets. Measured loss for the whole-pixel choice at dpr 1/2 across 8/32/64 desks and
   905..1900 px stages: 0..13%; fractional is chosen at e.g. 1580x780 (8 desks, 2.875) and phones (0.81).
   Manual zoom is not snapped (it would make wheel zoom jump).
5. Text never goes below its existing minimum (`fontPx`, board `fs >= 8`, plaque `pfs >= 9`).

## Invariants (`checkLayout`)

Solid footprints never overlap and equal `layout.blocked`; every seat is walkable, reachable from the door and has a desk
below; couches have a table in front, a flanking armchair and a mirror; the door aisle is clear; wall objects do not overlap;
lines have integer points and are axis-aligned; the spine sits on the tile grid; a conduit starts on the server bank's edge or another conduit
and ends on a conduit, a junction or the room edge (no dead stubs); every light pool hangs off a sconce/lamp/window footprint.
Growing the office only adds: ids not in `NOT_STABLE` never move (core test).

## Self-check

`Scene` calls `selfCheck(layout)` on every build: one `console.warn` per distinct violation set, never throws.

## Adding an object or a line safely

1. Core: add the footprint in `placements()` (and to `layout.blocked` in `layout.ts` if solid) or the line in `lines()`.
   `footprint.test.ts` and `geometry.test.ts` fail if blocked/footprints disagree, ids collide or a line is off-grid.
2. Web: read it from `this.geo` (add a derived field in `sceneGeometry` if needed, with an assertion in `geometry.test.ts`).
   Never compute tile positions in `scene.ts`.
3. Position through `place()`; overlays through `dev()`.
4. Run `npm test` (`geometry.test.ts` sweeps 8..64 desks x 1..8 lobby slots; `footprint.test.ts` adds 72..192 desks across floors).

## QA checklist (visual)

- Small / medium / large office, day and night: no console warning from `selfCheck`.
- Zoom a screenshot with nearest-neighbour: the trunk leaves the bank's bottom edge, every row run ends in a junction box centred
  under its pod, nothing dead-ends or floats; sconces hang on wall tiles, lamps stand on floor tiles; the bot dock is under the
  first apron's left edge and the bot never overlaps a conduit.
- Lead plaques (`name` / `> first +n`) do not overlap each other or their desk; phone 390x800 shows the toggle in the drawer's top row.
- Presenter: the room keeps an 8 px margin; noon floor is visibly lighter than midnight.

## Centring rule

A tile's centre is a pixel BOUNDARY (x*16+8), not a pixel. Anything centred on a tile centre (door, spine strip, chevrons, junction boxes, plates) must be EVEN-width and mirrored about that boundary (e.g. an 8px strip spanning x-4..x+3, a 2px apex at x-1 and x). An odd width lands half a pixel off and reads as 'not centred' next to the door frame. Check by zooming at 4x device scale.
