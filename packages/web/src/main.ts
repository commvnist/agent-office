import { Application, Container, Graphics, Sprite, Text, UPDATE_PRIORITY, type ContainerChild } from "pixi.js";
import { buildLayout, deskCount, emptyFun, findPath, seatTile, standNear, stepFun, leadId, parentChain, type FunEvent, type FunMemory, type Layout, type OfficeConfig, type OfficeState, type Tile } from "@agent-office/core";
import { Actor, T, feet, outline, layoutBubbles, layoutTags, obstacles, pipScale, setPip, setBubbleBlank, setBubbleLayer, setFloorBounds } from "./actor.ts";
import { hideText } from "./stream.ts";
import { dropOutcome } from "./triage.ts";
import { Scene, type SeatState } from "./scene.ts";
import { lookFor, PIP, pulseTex, whiteTex } from "./sprites.ts";
import { KEY, setRoles, STATUS } from "./theme.ts";
import { isDelight, pickWeather, planDelight, pushSignal, type Delight, type Weather } from "./flair.ts";
import { Floaters } from "./flairfx.ts";
import { bindMinimap } from "./minimap.ts";
import { ambientOn, burstAllowed, fontPx, frozen, setSceneScale, setTextScale, settings } from "./settings.ts";
import { FxBudget, scaled, type FxClass } from "./fx.ts";
import { followDue, pickBusiest } from "./follow.ts";
import { projectHue, sessionColor, sessionTone } from "./logic.ts";
import { bake } from "./pixel.ts";
import { dev, setDpr } from "./snap.ts";
import { clip, store } from "./dom.ts";
import { ticketTex } from "./ticket.ts";
import { hash } from "./color.ts";
import { clampBox, collapseLatch, FIGURE_ART, tetherDots, waitsFor, stackLabels, worstState, type Box, alertsFor, boardLines, crowdLod, doorHold, holds, loadLevel, newAlerts, feedItem, isWorking, longToolMs, pickStroller, planInteraction, shrinkFloor, pushCapped, statusOf, stepHold, couchSeats, tetherAlpha, ticketEnd, ticketFor, ticketT, yieldsTo, TICKET_MS, uniqueNames, type Action, type PlanCtx, type Shrink, type StrollCand, type Ticket } from "./choreo.ts";
import { advance, connect, newCursor, type Envelope } from "./net.ts";
import { camera, bindPointer, isNarrow, phoneScale, pickAuto, type View } from "./camera.ts";
import { hooks, liveIn, office, publish, pushFeed, setConnection, isPresenter, type ActorInfo, type SessionInfo } from "./api.ts";
import { bindUi } from "./ui.ts";

let TOP = 40; // header height, kept in sync below
const RESIZE_DEBOUNCE_MS = 150;
const BLOCK_HOLD_MS = 45_000; // shortcut: a blocked agent is gone from state, so hold its desk this long; upgrade when the daemon keeps stopped agents
const HUDDLE_HOLD_MS = 6000;
const STALE_MS = 5 * 60_000; // no tool activity for this long: desaturate the agent and dim its monitor
const IDLE_FPS = 15;
const ACTIVE_HOLD_MS = 1000; // a frame with motion or a bubble keeps the full frame rate this long
const HUDDLE_RADIUS = 10; // tiles: seated burst members this close to the board join the huddle
const TICKET_HOLD_MS = 600, DOT_HOLD_MS = 1000; // a landed ticket rests on the desk; reduced motion shows a still dot instead of the flight
const MAX_MOVERS = 3, MAX_RINGS = 6; // overlays: <=3 tickets in flight, <=6 rings
const GATHER_MS = 400; // arrival / leaving beat at the door
const DOOR_R = T * 1.5, LINE_SHOWN = 6;
const FRESH_QUIET_MS = 1500; // after a first snapshot the existing crowd is history, not news: no juice

// raw DPR 3 on 4K allocates huge buffers for nearest-neighbour art: cap at 2 (#165)
function dpr() { return Math.min(2, window.devicePixelRatio || 1); }
setDpr(dpr()); // overlays snap to whole device pixels (snap.ts)
const host = document.getElementById("stage")!;
const app = new Application();
// canvas background: the room's own value ramp (R3)
await app.init({ resizeTo: host, background: Number.parseInt(KEY.env[1].slice(1), 16), backgroundAlpha: 1, antialias: false, resolution: dpr(), autoDensity: true, roundPixels: true });
host.appendChild(app.canvas);
bindPointer(app.canvas);
// A plain click on the floor (not an actor, not the end of a drag) clears the selection. The actor's own tap handler
// stamps `actorTapAt` first (Pixi's pointertap fires on pointerup, before the DOM click), so a click on an actor is left alone.
let actorTapAt = 0;
let pointerAt: { x: number; y: number } | null = null; // canvas-local CSS px; null when the pointer is outside the stage
app.canvas.addEventListener("pointermove", (e) => { pointerAt = { x: e.offsetX, y: e.offsetY }; });
app.canvas.addEventListener("pointerleave", () => { pointerAt = null; });
app.canvas.addEventListener("click", () => {
  if (!camera.dragged && Date.now() - actorTapAt > 60 && office.selected) office.select(null);
});
const minimap = bindMinimap(host);
const topEl = document.getElementById("top")!;
// the stage starts below the header AND the chip strip (shown from 7 agents): the camera fits below both, so at scale the wall
// (windows, signs, ledger) stays in frame instead of sitting under the strip (R7)
const colonyEl = document.getElementById("colony")!;
const syncTop = () => { TOP = topEl.offsetHeight + (colonyEl.hidden ? 0 : colonyEl.offsetHeight); };
new ResizeObserver(syncTop).observe(topEl);
new ResizeObserver(syncTop).observe(colonyEl);
new MutationObserver(syncTop).observe(colonyEl, { attributes: true, attributeFilter: ["hidden"] });
// Phones: the open panel is a bottom sheet over the stage; the camera fits/centres in what is left above it.
let SHEET = 0;
const sideEl = document.getElementById("side")!;
new ResizeObserver(() => { SHEET = sideEl.offsetHeight; }).observe(sideEl);
// Read per frame, so cached from observers: offsetHeight/matchMedia in the ticker forced a layout every frame (perf profile).
const narrowMq = matchMedia("(max-width:800px)");
let narrow = narrowMq.matches;
narrowMq.addEventListener("change", (e) => { narrow = e.matches; });
const sheetPx = () => (narrow && !document.body.classList.contains("collapsed") ? SHEET : 0);
// The meter strip and the phone's Fit button sit over the bottom of the stage: the camera fits above them, so neither covers a desk (H5).
let SPARK = 0, FIT = 0;
new ResizeObserver(() => { SPARK = document.getElementById("spark")!.offsetHeight; }).observe(document.getElementById("spark")!);
new ResizeObserver(() => { FIT = document.getElementById("fit")!.offsetHeight; }).observe(document.getElementById("fit")!);
const bottomPx = () => Math.max(sheetPx(), SPARK) + (FIT ? FIT + 12 : 0);
camera.focusSelected = () => { if (office.selected) camera.focus(office.selected); };
// moving the window to another monitor changes the DPR: follow it (#166)
function watchDpr() {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => {
    setDpr(dpr());
    app.renderer.resize(host.clientWidth, host.clientHeight, dpr());
    watchDpr();
  }, { once: true });
}
watchDpr();

const world = new Container();
const uiLayer = new Container();
const bubbleLayer = new Container();
app.stage.addChild(world, uiLayer, bubbleLayer);
setBubbleLayer(bubbleLayer);
// "+N" for arrivals waiting at the door beyond the six drawn in the line; a count of real agents, not text from any event
const doorTok = new Text({ text: "", style: { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 11, fill: KEY.cyan, stroke: outline(3) } }); // a machine count, not the your-turn cyan (R1)
doorTok.anchor.set(0.5, 1);
doorTok.visible = false;
uiLayer.addChild(doorTok);
// "+N waiting for a desk" over the last waiting spot once the queue outgrows the drawn row (every desk on every floor taken): never an invisible queue
const queueTok = new Text({ text: "", style: { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 11, fill: KEY.text.fg, stroke: outline(3) } });
queueTok.anchor.set(0.5, 1);
queueTok.visible = false;
uiLayer.addChild(queueTok);
let queueOver = 0;

let layout: Layout;
let scene: Scene;
let ysort: Container;
let fx: Container;
let tether: Graphics;
let cfgKey = "";
let lastCfg: OfficeConfig | null = null;
let layoutKey = "";
let state: OfficeState = { sessions: {}, agents: {}, queue: [], log: [], nextId: 1, pending: {} };
let hoverId: string | null = null;
let liveIds = new Set<string>();
let boardText: string[] = [];
let skyT = 0; // replay: recorded time for the window sky and clock, 0 = wall clock
let cooler: { x: number; y: number } | null = null;
// the signal fields are filled here (scene.ts renders them); working/stale/load/idleMs are refreshed per frame, no allocation
type Seat = SeatState & { load?: 0 | 1 | 2 | 3; queueDepth?: number; idleMs?: number; hue?: number; tone?: number };
let seatStates = new Map<string, Seat>();
let idleTagMs = 120_000; // the "Stuck after" panel setting (ui.ts keeps it in the store); refreshed at 1 Hz
const shrink: Shrink = { floor: 0, since: 0 };
let shrinking = false; // built desks still above demand: the 1 Hz tick re-checks the ratchet
const bindings: { key: string; id: string }[] = [];
const running = new Set<string>(); // ids with a tool in flight (state.doing)
const cursor = newCursor();
const actors = new Map<string, Actor>();
const meta = new Map<string, { role: string; type: string; name: string; session: string }>();
const lastBusy = new Map<string, number>();
const lastErr = new Map<string, number>(); // errors seen per actor; juice fires on an increase
const tray = new Map<string, number>(); // reports received per lead/agent: grows the in-tray
const flashes = new Map<string, number>(); // seat id -> ship-it flash start, re-applied on every seat rebuild
const seenLeads = new Set<string>();
const waitRung = new Set<string>(); // leads whose waiting ring already played
const arrived = new Set<string>(); // agents that already sat down once
let freshUntil = 0;
let crowd = false, displaced = 0; // LOD: crowd latch + tags displaced by stacking in the last layout
const visitors = new Map<string, number>(); // target id -> visits so far, rotates where visitors stand
const blocked = new Map<string, { until: number; session: string }>();
const huddling = new Map<string, number>();
const strolled = new Map<string, number>();
const couchHolds = new Map<string, string>(); // actor id -> "x,y" couch seat reserved from stroll start until the sit ends
const seenConflicts = new Set<string>();
const MAX_PARTICLES = 200;
const particles: { s: Sprite; vx: number; vy: number; life: number; max: number; g: number }[] = [];
const spritePool: Sprite[] = []; // dead particle sprites, kept in fx (hidden) for reuse
/** Things that travel between two points: paper tickets and conflict sparks. Sprites pooled, <= MAX_MOVERS live. */
type Mover = { s: Sprite; kind: Ticket["kind"] | "spark"; a: Actor; b: Actor; life: number; landed: boolean };
const movers: Mover[] = [];
const moverPool: Sprite[] = [];
type Ring = { g: Sprite; x: number; y: number; life: number; delay: number; ms: number };
const rings: Ring[] = [];
const ringPool: Sprite[] = [];
const GOLD = 0xffe08a;
// effects share the scene's colours (R4): status hues only for status, celebration in gold and paper
const hexN = (h: string) => Number.parseInt(h.slice(1), 16);
const ST = (k: keyof typeof STATUS) => hexN(STATUS[k].color);
const PAPER = hexN(KEY.paper), WARM = hexN(KEY.warm);
const VIGNETTE_MS = 900;
const seenAlerts = new Map<string, "waiting" | "blocked">(); // alert per actor after the last snapshot, for transition detection
let held: Envelope | null = null, wasFrozen = false, lastFollow = 0;
let lastTap = { id: "", t: 0 };
/** Pre-baked screen-edge vignette (white radial gradient, tinted red/gold): one sprite, alpha decays. */
const vignette = new Sprite(bake(64, 64, (c) => {
  const g = c.createRadialGradient(32, 32, 14, 32, 32, 46);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(255,255,255,0.7)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
}));
vignette.texture.source.scaleMode = "linear";
vignette.eventMode = "none";
vignette.visible = false;
app.stage.addChild(vignette);
let vignetteT = 0;

// ---- fun layer (state machine in core stepFun; pure rules in flair.ts; sprites in flairfx.ts / scene.ts) ---------
try { localStorage.removeItem("ao.fun"); } catch { /* retired key from the removed progress layer; blocked storage is fine */ }
let funMem = emptyFun(), volatileMem: FunMemory | null = null; // in-process only; demo/replay keep their own
let funPrev: OfficeState | null = null, funMode = "", quietFun = false;
const doneAt: number[] = [], errAt: number[] = []; // weather inputs: finished-ok and error times
let weather: Weather = "cloudy";
let delights: Delight[] = [];
let floaters: Floaters;
const TRAY_STEP = 8; // shortcut: lead desk clutter has no report counter, so one returned report = one clutter level step (8 "tool calls"); upgrade with a real in-tray prop

const route = (a: Tile, b: Tile) => findPath(layout, a, b);
/** Team colour bucket (0..11) from the session's project: the same hue the pod floor patch carries, so a team reads as a team. */
const teamOf = (sid: string | undefined) => { const p = sid ? state.sessions[sid]?.project : undefined; return p ? Math.floor(projectHue(p) / 30) % 12 : undefined; };
/** Feedback budget (fx.ts): every canvas flourish asks for an intensity first; 0 = over budget, drop it. */
const fxb = new FxBudget();
const fxk = (cls: FxClass, key: string) => fxb.take(cls, key, Date.now());
const nextSlot = (id: string) => { const n = visitors.get(id) ?? 0; visitors.set(id, n + 1); return n; };
// a departed helper keeps the name filed with its outcome, never its raw id (X5)
const nameOf = (id: string) => meta.get(id)?.name ?? actors.get(id)?.label ?? state.outcomes?.find((o) => o.agentId === id)?.name ?? id.replace(/^lead:/, "");
/** Session identity tone for seat states (pod pad and trim): the same hue as sessionColor everywhere else (R4). */
const toneOf = (sid: string) => { const t = sessionTone(sid); return { hue: t.h, tone: t.dl }; };
const lastSeat = new Map<string, string>(); // agent id -> its last desk; dropped once its outcome is filed
let outT = 0; // newest outcome already filed
/** New outcomes since the last snapshot leave a filed card on the reporting helper's desk (history on load is not news). */
function fileOutcomes(outs: readonly { agentId: string; outcome?: string; t: number }[], fresh: boolean) {
  if (!fresh) for (const o of outs) {
    if (o.t <= outT) break; // newest first
    const seat = lastSeat.get(o.agentId);
    if (seat) { scene.fileOutcome(seat, o.outcome ?? "empty"); lastSeat.delete(o.agentId); } // unknown outcome: the neutral grey card, never green (S3)
  }
  if (outs[0]) outT = Math.max(outT, outs[0].t);
  if (lastSeat.size > 512) lastSeat.clear(); // shortcut: bounded by wiping; agents re-register on the next snapshot
}
const gold = (a: Actor) => { if (a.lead && !a.alert) a.tag.style.fill = GOLD; }; // a lead in an alert keeps its status colour (theme.STATUS)
const nearOf = (t: Actor) => standNear(layout, t.home ?? t.tile(), nextSlot(t.id));

const LEGIBLE = 2; // screen px per art px kept while the office grows; below that the world overflows and is panned instead
const LOD_ON = 0.75, LOD_OFF = 0.9; // below this on-screen scale tags give way to status pips (hysteresis)
let autoId: string | null = null; // phone auto-follow target (camera.ts pickAuto)
const fitBtn = document.getElementById("fit") as HTMLButtonElement;
fitBtn.addEventListener("click", () => camera.toggleFitAll());
let lod = false; // tags give way to status pips while the office is drawn small
const fitScale = (l: Layout, W: number, H: number) => {
  const wFit = Math.max(1, W - 2 * Math.min(8, W * 0.02)) / (l.cols * T); // a margin each side so the side walls never touch the viewport edge
  const sc = camera.phone && !camera.fitAll ? phoneScale(W, H, l.rows * T + 12, T)
    : Math.max(Math.min(wFit, H / (l.rows * T + 12)), Math.min(LEGIBLE, wFit)); // 12 art px spare so the bottom row's tags are not cut off
  const frac = Math.floor(sc * 16) / 16; // fine steps: use the window, art stays nearest-filtered
  const d = dpr(), whole = Math.floor(sc * d) / d; // whole device pixels per art pixel: crisp, no shimmer
  // shortcut: whole device pixels per art pixel win unless that wastes >12% of the window (then fractional, offsets still snapped); see docs/visual-consistency.md
  return Math.max(1 / d, whole >= 1 / d && whole >= frac * 0.88 ? whole : frac); // never below one device pixel per art pixel
};

/** Desk pool follows live demand (deskPos is stable, so growing the office never moves anyone); relayout only when the desk count or lobby changes. */
function chooseLayout(force = false) {
  if (!lastCfg) return;
  const lobbySlots = Math.max(4, Object.keys(state.sessions).length);
  const agents = Object.keys(state.agents).length;
  let top = -1; // highest desk index in use: it must stay built even after demand shrinks
  for (const a of Object.values(state.agents)) if (a.seat) top = Math.max(top, Number(a.seat.id.slice(1)) || 0);
  const demand = deskCount(lastCfg, agents);
  const floorDesks = shrinkFloor(shrink, demand, top + 1, Date.now()); // grows at once, a trailing empty row decays after 90 s
  shrinking = floorDesks > Math.max(demand, top + 1);
  const l = buildLayout(lastCfg, { lobbySlots, demand: { agents }, minDesks: floorDesks });
  const key = `${cfgKey}|${lobbySlots}|${l.props.length}`;
  if (key === layoutKey && !force) return;
  layoutKey = key;
  relayout(l);
}

/** Swap the floor plan but keep the people and their scripts: only stale walk targets are dropped and re-routed home (#42). */
function relayout(l: Layout) {
  for (const a of actors.values()) a.c.parent?.removeChild(a.c);
  scene?.destroy();
  world.removeChildren().forEach((c) => c.destroy({ children: true }));
  particles.length = 0;
  spritePool.length = 0; // the sprites went with the old world
  movers.length = rings.length = moverPool.length = ringPool.length = 0; // their sprites went with the old world
  const grew = layout && layout.cols === l.cols ? layout.props.length : 0; // new desks build in; a rebuild does not
  layout = l;
  ysort = new Container();
  ysort.sortableChildren = true;
  fx = new Container();
  scene = new Scene(layout, world, ysort, uiLayer, grew);
  setFloorBounds(scene.floorRect());
  tether = new Graphics();
  world.addChildAt(tether, world.getChildIndex(ysort)); // on the floor, under every figure and desk (R6)
  const cd = layout.decor.find((d) => d.kind === "cooler");
  cooler = cd ? { x: cd.x * T + 8, y: cd.y * T } : null;
  world.addChild(fx);
  for (const [id, a] of actors) {
    ysort.addChild(a.c);
    a.door = layout.door;
    a.path = [];
    const m = meta.get(id);
    if (m) a.look = lookFor(m.role, id, a.lead, teamOf(m.session)); // role set may have changed (#63/#71)
    // tile targets belong to the old plan: drop walks, keep speech/waits/exit; the actor re-routes from where it stands
    if (a.cur?.k === "walk") a.cur = null;
    if (a.cur?.k === "exit") { a.cur = null; a.steps.unshift({ k: "exit" }); }
    a.steps = a.steps.filter((s) => s.k !== "walk");
  }
  floaters = new Floaters(fx);
  scene.setWeather(weather);
  for (const d of delights) showDelight(d, Date.now());
  scene.setSeats(seatStates);
  minimap.set(layout, scene.podOwners());
}

// ---- particles ----------------------------------------------------------------------------------

/** Reuse a pooled sprite; at the cap the oldest live particle is recycled so live sprites stay bounded. */
function spawn(x: number, y: number, tint: number, scale: number, alpha: number, vx: number, vy: number, max: number, g: number) {
  let s = particles.length >= MAX_PARTICLES ? particles.shift()!.s : spritePool.pop();
  if (!s) { s = new Sprite(whiteTex()); fx.addChild(s); }
  s.visible = true;
  s.tint = tint;
  s.alpha = alpha;
  s.scale.set(scale);
  s.position.set(x, y);
  particles.push({ s, vx, vy, life: 0, max, g });
}
function burst(x: number, y: number, n: number, colors: number[], spread = 30, up = 40) {
  if (!burstAllowed()) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    spawn(x, y, colors[i % colors.length], 1 + (i % 2), 1, Math.cos(a) * spread * Math.random(), -up * (0.5 + Math.random()), 0.8 + Math.random() * 0.6, 110);
  }
}
const puff = (x: number, y: number, tint = 0xe8ecff) => {
  if (!burstAllowed()) return;
  spawn(x + (Math.random() - 0.5) * 3, y, tint, 2, 0.7, (Math.random() - 0.5) * 3, -9, 1.4, 0);
};

/** One-shot expanding pixel ring (three frames over `ms`), pooled; `delay` staggers a double pulse. */
function pulse(x: number, y: number, tint: number, delay = 0, ms = 450) {
  if (burstAllowed()) addRing(x, y, tint, delay, ms);
}
/** Desk ripple on a real tool start: one per desk per 3 s, <= 4 live; reduced motion shows a single static half-strength frame. */
// no per-tool ripples: 'working' is shown by the lit screen at the desk, not by a mark on the floor (critique A4/T7)
function addRing(x: number, y: number, tint: number, delay: number, ms: number) {
  if (rings.length >= MAX_RINGS) return;
  let g = ringPool.pop();
  if (!g) { g = new Sprite(pulseTex(0)); g.anchor.set(0.5); fx.addChild(g); }
  g.tint = tint;
  g.visible = delay === 0;
  g.position.set(x, y);
  rings.push({ g, x, y, life: 0, delay, ms });
}

/** Send a paper ticket (or conflict spark) from a's current spot to b; reduced motion lands at once and shows a still dot. */
const pending: { kind: Mover["kind"]; a: Actor; b: Actor }[] = []; // overflow beyond MAX_MOVERS: FIFO, bounded, drained in the frame loop
const recvBadges = new Map<string, Text>(), recvCount = new Map<string, number>();
function launch(kind: Mover["kind"], a: Actor, b: Actor) {
  if (movers.length >= MAX_MOVERS) { pushCapped(pending, { kind, a, b }); return; }
  let s = moverPool.pop();
  if (!s) { s = new Sprite(); s.anchor.set(0.5); fx.addChild(s); }
  const still = !burstAllowed();
  s.visible = true;
  s.tint = kind === "partial" ? ST("idle") : kind === "blocked" ? ST("blocked") : kind === "spark" ? WARM : 0xffffff;
  if (still || kind === "spark") { s.texture = whiteTex(); s.scale.set(3); } else { s.texture = ticketTex(kind === "done" || kind === "partial"); s.scale.set(1); }
  if (kind !== "spark") a.glance(b.pos.x); // seated sender looks toward the recipient
  movers.push({ s, kind, a, b, life: still ? TICKET_MS : 0, landed: false });
}
const deskAt = (t: Tile) => layout.props.some((p) => p.x === t.x && p.y === t.y + 1) || layout.lobby.some((l) => l.x === t.x && l.y === t.y);
const moverEnd = (m: Mover) => ticketEnd(m.kind, m.b, deskAt, feet);
function land(m: Mover) {
  if (m.kind !== "spark") m.b.glance(m.a.pos.x); // seated recipient looks toward the sender
  if (m.kind === "blocked") {
    const e = moverEnd(m), k = fxk("routine", "blocked-land");
    m.b.jitter();
    if (k) { pulse(e.x, e.y, ST("blocked")); burst(e.x, e.y - 6, scaled(8, k), [ST("blocked"), PAPER], 14, 30); }
    return;
  }
  if (m.kind === "send") m.b.hopNow();
  else if (m.kind === "spark") { const e = moverEnd(m), k = fxk("routine", "spark"); if (k) burst(e.x, e.y, scaled(6, k), [WARM, PAPER], 20, 20); }
  else {
    m.b.hopNow();
    const n = (tray.get(m.b.id) ?? 0) + 1;
    tray.set(m.b.id, n);
    for (const bd of bindings) if (bd.id === m.b.id) { const st = seatStates.get(bd.key); if (st) st.count = n * TRAY_STEP; }
  }
}

/** Ship-it wave: the session's last working agent reported DONE and nothing is blocked. */
function shipIt(sid: string) {
  for (const [id, a] of actors) if (!a.lead && !a.leaving && a.working && meta.get(id)?.session === sid) return;
  for (const h of blocked.values()) if (h.session === sid) return;
  const lead = actors.get(leadId(sid));
  if (!lead) return;
  lead.hopNow();
  const k = fxk("milestone", "shipit");
  if (k) burst(lead.pos.x, lead.pos.y - 14, scaled(12, k), [GOLD, PAPER], 14, 70);
  if (k) bindings.filter((b) => b.key !== "" && !b.key.startsWith("lobby") && meta.get(b.id)?.session === sid)
    .sort((x, y) => Number(x.key.slice(1)) - Number(y.key.slice(1)))
    .forEach((b, i) => setTimeout(() => { const t = Date.now(); flashes.set(b.key, t); const st = seatStates.get(b.key); if (st) st.flash = t; }, i * 60));
}

// ---- actors ---------------------------------------------------------------------------------------

const canvasHover = (id: string | null) => document.dispatchEvent(new CustomEvent("ao:canvas-hover", { detail: id }));
// roster/feed rows drive the same outline (#134)
document.addEventListener("ao:hover", (e) => {
  const id = ((e as CustomEvent).detail as string | null) ?? null;
  if (hoverId && hoverId !== id) actors.get(hoverId)?.setHover(false);
  hoverId = id;
  if (id) actors.get(id)?.setHover(true);
});

function ensure(id: string, label: string, role: string, lead: boolean, home: Tile, seated: boolean): Actor {
  let a = actors.get(id);
  if (!a) {
    a = new Actor(id, label, lookFor(role, id, lead, teamOf(meta.get(id)?.session)), lead, layout.door, home, route, layout.door, ysort, uiLayer);
    const act = a;
    gold(act);
    act.c.on("pointertap", () => {
      actorTapAt = Date.now();
      if (camera.dragged) return;
      const t = Date.now();
      if (lastTap.id === id && t - lastTap.t < 350) { // double-click: focus the desk (the canvas dblclick must not reset the view)
        lastTap.id = "";
        camera.actorDbl = camera.touched = t;
        camera.focus(id);
        office.select(id);
        return;
      }
      lastTap = { id, t };
      office.select(office.selected === id ? null : id);
    });
    act.c.on("pointerover", () => { activeUntil = Date.now() + ACTIVE_HOLD_MS; hoverId = id; act.setHover(true); canvasHover(id); });
    act.c.on("pointerout", () => { if (hoverId === id) hoverId = null; act.setHover(false); canvasHover(null); });
    act.setSelected(office.selected === id);
    if (!settings.reducedMotion) act.queue({ k: "wait", ms: GATHER_MS }); // arrival beat at the door before walking in
    actors.set(id, a);
  }
  a.leaving = false;
  a.setLabel(label);
  a.setHome(home, seated);
  return a;
}

/** Zones share one waiting row, so rank is global: queued agents spread over its tiles. */
function queueTileFor(rank: number): Tile {
  const q = layout.zones[0].queue;
  return q[Math.min(rank, q.length - 1)];
}

function syncActors() {
  bindings.length = 0;
  running.clear();
  seatStates = new Map();
  const live = new Set<string>();
  const kids = new Map<string, string[]>();
  const sessions = Object.values(state.sessions).sort((a, b) => a.startedAt - b.startedAt);
  for (const s of sessions) sessionTone(s.id); // identity hues in start order, before any surface asks (R4)
  const waits = waitsFor(state, leadId);
  const baseName = (ag: (typeof state.agents)[string]) => (ag.seat?.name ?? `${ag.role} (queued)`);
  // identical names get "name 1", "name 2" so canvas tags and the roster stay distinguishable (#F2); queued agents carry their ordinal chip instead
  const uniq = uniqueNames([
    ...sessions.map((s) => ({ id: leadId(s.id), name: s.project, t: s.startedAt })),
    ...Object.values(state.agents).filter((ag) => ag.seat).map((ag) => ({ id: ag.id, name: baseName(ag), t: ag.startedAt ?? 0 })),
  ]);

  sessions.forEach((s, i) => {
    const idx = Math.min(i, layout.lobby.length - 1);
    const id = leadId(s.id);
    live.add(id);
    blocked.delete(id);
    const pname = uniq.get(id) ?? s.project;
    meta.set(id, { role: "lead", type: "lead", name: pname, session: s.id });
    const a = ensure(id, pname, "lead", true, layout.lobby[idx], true);
    const quiet = Date.now() < freshUntil;
    if (!seenLeads.has(id)) {
      seenLeads.add(id);
      if (!quiet) { a.hopNow(); if (fxk("routine", "arrive")) pulse(a.pos.x, a.pos.y - 12, 0x9ad7f5); }
    }
    errored(id, s.errors, a, quiet);
    const lw = waits.get(id); // the lead's own wait, never a helper's (R2)
    if (!lw) waitRung.delete(id);
    else if (!waitRung.has(id)) {
      waitRung.add(id);
      if (!quiet && lw.kind !== "turn" && fxk("routine", "wait")) { pulse(a.pos.x, a.pos.y - 12, ST("permission")); pulse(a.pos.x, a.pos.y - 12, ST("permission"), 200); } // your turn is calm: no pulse
    }
    if (s.busyAt) a.busyAt = Math.max(a.busyAt, s.busyAt);
    const key = `lobby#${idx}`;
    seatStates.set(key, { used: true, working: false, tool: s.doing, count: (tray.get(id) ?? 0) * TRAY_STEP, waiting: !!lw, waitKind: lw?.kind, role: "lead", flash: flashes.get(key), ...toneOf(s.id) });
    bindings.push({ key, id });
    if (s.doing) running.add(id);
    if (s.busyAt && lastBusy.get(id) !== s.busyAt) {
      lastBusy.set(id, s.busyAt);
      a.hit(s.busyAt);
      if (s.doing) a.tool(clip(`${s.doing}${s.detail ? " " + s.detail : ""}`, 44));
    }
    const le = lw && !lw.soft ? (lw.kind === "turn" ? "question" : "exclaim") : null; // a finished turn is calm: no emote (R2)
    if (le && a.emote?.e !== le) a.showEmote(le, 3000);
    // no "Claude needs your permission" bubble: NEEDS YOU says it, and the bubble covered the waiting lead's face and lamp
  });

  let qseen = -1;
  for (const ag of Object.values(state.agents)) {
    live.add(ag.id);
    blocked.delete(ag.id);
    if (ag.seat) lastSeat.set(ag.id, ag.seat.id); // remembered past the agent's stop, so its result can be filed on that desk
    const name = uniq.get(ag.id) ?? baseName(ag);
    setRoles([ag.role]); // first-seen order keeps role colours and badges palette-stable
    meta.set(ag.id, { role: ag.role, type: ag.agentType, name, session: ag.session });
    let home: Tile, seated = true;
    if (ag.seat) home = seatTile(layout, ag.seat.id);
    else { home = queueTileFor(++qseen); seated = false; }
    const a = ensure(ag.id, name, ag.role, false, home, seated);
    a.queued = !ag.seat;
    a.setQueuePos(ag.seat ? 0 : qseen + 1);
    if (ag.busyAt) a.busyAt = Math.max(a.busyAt, ag.busyAt);
    a.tagAbove = ag.seat ? Number(ag.seat.id.slice(1)) % 4 < 2 : false; // pod rows: seats 0,1 are the upper row
    if (ag.seat) { const sess = state.sessions[ag.session];
      seatStates.set(ag.seat.id, { used: true, working: false, tool: ag.doing, count: ag.toolCount, project: sess?.project ?? ag.session, role: ag.role, flash: flashes.get(ag.seat.id), prompt: sess?.prompt,
        waiting: waits.has(ag.id), waitKind: waits.get(ag.id)?.kind, // the helper that raised the prompt gets the lamp (C1)
        ...toneOf(ag.session), queueDepth: state.pending[`${ag.session}|${ag.agentType.slice(ag.agentType.lastIndexOf(":") + 1).toLowerCase()}`]?.length ?? 0 }); bindings.push({ key: ag.seat.id, id: ag.id }); }
    if (ag.doing) running.add(ag.id);
    errored(ag.id, ag.errors, a, Date.now() < freshUntil);
    if (!a.queued) {
      (kids.get(ag.parent) ?? kids.set(ag.parent, []).get(ag.parent)!).push(name);
    }
    if (ag.busyAt && lastBusy.get(ag.id) !== ag.busyAt) {
      lastBusy.set(ag.id, ag.busyAt);
      a.hit(ag.busyAt);
      if (ag.doing) a.tool(clip(`${ag.doing}${ag.detail ? " " + ag.detail : ""}`, 44));
    }
  }
  // lead "waiting on <names>" (#85)
  for (const s of sessions) {
    const id = leadId(s.id), n = kids.get(id), a = actors.get(id)!;
    // lead desks are two tiles apart: with several leads the second line would collide, so it shows for a lone lead only (the detail lives in NEEDS YOU and on selection)
    const nm = hideText() ? `session ${sessions.indexOf(s) + 1}` : meta.get(id)?.name ?? s.project; // text hidden (stream-safe, private): no project names on screen (critique I2)
    // the project is what a lead tag is for: its own line at the tag's normal width, never cut to fit the delegation line (O2)
    const want = n && sessions.length < 2 ? `${nm}\n> ${clip(n[0], 10)}${n.length > 1 ? ` +${n.length - 1}` : ""}` : nm;
    if (a.label !== want) { a.setLabel(want); gold(a); }
  }
  liveIds = live;
  queueOver = Math.max(0, qseen + 1 - layout.zones[0].queue.length);
  sessIdx.clear();
  sessions.forEach((s, i) => sessIdx.set(s.id, i + 1));
  scene.setSeats(seatStates);
  minimap.set(layout, scene.podOwners());
}

/** Error juice once per increment of `errors` (first sight only records the count). */
function errored(id: string, n: number | undefined, a: Actor, quiet: boolean) {
  const prev = lastErr.get(id), cur = n ?? 0;
  lastErr.set(id, cur);
  if (prev === undefined || cur <= prev || quiet) return;
  pushSignal(errAt, Date.now());
  a.jitter();
  const k = fxk("routine", "error");
  if (k) burst(a.pos.x, a.pos.y - 14, scaled(3, k), [ST("blocked")], 12, 25);
}

function departing() {
  for (const [id, a] of actors) {
    if (liveIds.has(id) || a.leaving || blocked.has(id)) continue;
    a.leaving = true;
    a.seated = false;
    a.path = [];
    a.cur = null;
    a.steps = settings.reducedMotion ? [{ k: "exit" }] : [{ k: "wait", ms: GATHER_MS }, { k: "exit" }]; // the stop already happened: gather, then go
  }
}

/** Blocked agents are already gone from state: hold the desk until the session ends, the seat is reused, or the hold lapses. */
function releaseBlocked(now: number) {
  let any = false;
  for (const [id, h] of blocked) {
    const a = actors.get(id);
    const taken = !!a?.home && Object.values(state.agents).some((ag) => {
      if (!ag.seat) return false;
      const t = seatTile(layout, ag.seat.id);
      return t.x === a.home!.x && t.y === a.home!.y;
    });
    if (a && now <= h.until && state.sessions[h.session] && !taken) continue;
    blocked.delete(id);
    a?.setAlert(null);
    any = true;
  }
  if (any) departing();
}

// ---- choreography: execute planner actions ----------------------------------------------------------------

function exec(a: Action, now: number) {
  switch (a.k) {
    case "user": {
      const t = actors.get(a.id);
      t?.speak(`You: ${a.text}`, "user", 5000, "prompt"); // your words, not the agent talking to itself
      t?.showEmote("message", 1500); // something arrived; amber "!" is only for "needs you" (R1)
      break;
    }
    case "say": {
      actors.get(a.id)?.speak(a.text, "say", 6000, "message");
      break;
    }
    case "notice": {
      const t = actors.get(a.id);
      t?.showEmote(a.emote, a.ms);
      if (a.hop) t?.hopNow();
      break;
    }
    case "visit": {
      const f = actors.get(a.from), t = actors.get(a.to);
      if (!f || !t || f === t) break;
      f.trim(3);
      f.squash(); // a small nod, then turn toward the recipient before setting off
      f.queue({ k: "face", toward: t.pos }, { k: "walk", to: nearOf(t) }, { k: "face", toward: t.pos }, { k: "say", text: a.text, kind: "say", badge: a.badge });
      break;
    }
    case "huddle": {
      const f = actors.get(a.id);
      if (!f) break;
      if (!((huddling.get(a.id) ?? 0) > now)) {
        const b = layout.board;
        f.steps = [];
        f.queue({ k: "walk", to: standNear(layout, { x: b.x + Math.floor(b.w / 2), y: layout.wallRows }, 0) });
      }
      huddling.set(a.id, now + HUDDLE_HOLD_MS);
      f.queue({ k: "say", text: a.text, kind: "say", badge: a.badge, ms: 1800 });
      // seated burst members near the board step up to a half-circle around it, then drift home
      const bc = { x: layout.board.x + Math.floor(layout.board.w / 2), y: layout.wallRows };
      a.members.forEach((mid, i) => {
        const m = actors.get(mid);
        if (!m || m === f || !m.home || !m.sitting || m.leaving || (huddling.get(mid) ?? 0) > now || Math.hypot(m.home.x - bc.x, m.home.y - bc.y) > HUDDLE_RADIUS) return;
        huddling.set(mid, now + HUDDLE_HOLD_MS);
        m.queue({ k: "walk", to: standNear(layout, bc, i + 1) }, { k: "face", toward: { x: bc.x * T + T / 2, y: bc.y * T } }, { k: "wait", ms: 2500 });
      });
      break;
    }
    case "report": {
      const f = actors.get(a.from);
      if (!f) break;
      const t = a.to ? actors.get(a.to) : undefined;
      f.leaving = true;
      f.seated = false;
      f.path = [];
      f.cur = null;
      f.steps = [];
      if (t) {
        t.glance(f.pos.x); // the lead looks up as the report comes in
        const near = nearOf(t);
        f.queue({ k: "walk", to: near }, { k: "face", toward: t.pos });
        // ✓ and a burst only for an explicit DONE; partial asks, an unknown outcome stays plain (S3)
        f.queue({ k: "say", text: dropOutcome(a.text), kind: "report", badge: a.done ? "report" : undefined, emote: a.done ? "check" : undefined, ms: Math.min(4500, 1400 + a.text.length * 35) });
        if (a.done || a.partial) t.showEmote(a.partial ? "message" : "check", 2500); // a partial report arrives; it does not ask for you (R1)
        const k = a.done ? fxk("routine", "report") : 0;
        if (k) burst(feet(near).x, feet(near).y - 14, scaled(10, k), [GOLD, PAPER]);
      }
      if (a.done) shipIt(meta.get(a.from)?.session ?? "");
      if (!settings.reducedMotion) f.queue({ k: "wait", ms: GATHER_MS }); // gather beat after the report, then out
      f.queue({ k: "exit" });
      break;
    }
    case "block": {
      const f = actors.get(a.id);
      if (!f) break;
      blocked.set(a.id, { until: now + BLOCK_HOLD_MS, session: meta.get(a.id)?.session ?? "" });
      f.leaving = false;
      const wasBlocked = f.alert === "blocked";
      f.setAlert("blocked");
      if (!wasBlocked) f.glitch(); // here, not in the snapshot loop: this handler sets the alert first, so that loop never sees the change; no-op under reduced motion
      if (fxk("routine", "block")) { camera.shake(); scene.lightning(now); }
      f.speak(a.text, "blocked", 6000); // no ✓ chip: it gave up
      const lead = a.by ? actors.get(a.by) : undefined;
      // a lead that waits on you is at its terminal (its desk): it does not walk over and stack its ring on the helper's
      if (lead && lead !== f && lead.alert !== "waiting") { lead.trim(3); lead.queue({ k: "walk", to: nearOf(f) }, { k: "face", toward: f.pos }); }
      break;
    }
    case "spark": {
      const p = actors.get(a.a), q = actors.get(a.b);
      if (p && q) launch("spark", p, q); // the dot travels p -> q and bursts on arrival
      break;
    }
    case "stroll": {
      const f = actors.get(a.id);
      const d = layout.decor.find((x) => x.kind === a.where) ?? layout.decor.find((x) => x.kind === "coffee");
      if (!f || !d) break;
      strolled.set(a.id, now);
      const taken = new Set(couchHolds.values());
      const ck = catSeat(now);
      if (ck) taken.add(ck); // the cat has the seat
      const seats = d.kind === "couch" ? couchSeats(d, T) : [];
      const si = seats.findIndex((p) => !taken.has(`${p.x},${p.y}`));
      const front = { x: d.x + Math.max(0, si), y: d.y + 1 };
      if (si >= 0 && !layout.blocked.has(`${front.x},${front.y}`)) {
        couchHolds.set(a.id, `${seats[si].x},${seats[si].y}`);
        f.idleStroll(front, 12_000 + (hash(a.id) % 8) * 1000, undefined, seats[si]);
      } else f.idleStroll(standNear(layout, d, nextSlot(d.kind)), 5000, { x: d.x * T + T / 2, y: d.y * T + T / 2 });
      break;
    }
  }
}

const ctx: PlanCtx = {
  has: (id) => actors.has(id),
  resolve(hint) {
    if (!hint) return undefined;
    if (actors.has(hint)) return hint;
    const h = hint.toLowerCase();
    for (const [id, a] of actors) {
      const m = meta.get(id);
      if (a.label.toLowerCase() === h || m?.type.toLowerCase().endsWith(h) || m?.role === h) return id;
    }
    return undefined;
  },
  get log() { return state.log; },
};


/** Labeled idle ambient: one idle lead at a time (turn over), never during alerts or reduced motion (#83). */
function maybeStroll(now: number) {
  if (document.hidden || !layout || office.getEnvelope() === null || actors.size === 0) return;
  for (const a of actors.values()) if (a.alert) return;
  if (!ambientOn()) return;
  for (const [id] of couchHolds) if (!actors.get(id)?.perching) couchHolds.delete(id);
  const cands: StrollCand[] = [];
  // only a lead whose turn is over may wander: a helper between tool calls is still generating, so it stays at its desk (critique V5)
  for (const sess of Object.values(state.sessions)) {
    const id = leadId(sess.id), a = actors.get(id);
    if (!a || sess.prompt || sess.waiting || sess.doing || a.leaving || !a.sitting || a.steps.length || running.has(id)) continue;
    cands.push({ id, lastActive: Math.max(a.busyAt, sess.lastAt ?? 0), strolledAt: strolled.get(id) ?? 0, session: sess.id });
  }
  const p = pickStroller(cands, now);
  if (p) exec({ k: "stroll", ...p }, now);
}

// ---- fast-forward after a hidden tab (#45) ---------------------------------------------------------------------

/** rAF paused while snapshots kept arriving: snap everyone to where they belong instead of replaying a burst. */
function fastForward() {
  for (const [id, a] of actors) {
    if (a.leaving && !blocked.has(id)) { a.destroy(); actors.delete(id); if (office.selected === id) office.select(null); continue; }
    a.steps = a.idle ? [{ k: "idle", on: false }] : [];
    a.path = [];
    a.cur = null;
    a.emote = null;
    a.speech?.node.destroy({ children: true });
    a.speech = null;
    a.toolBubble?.node.destroy({ children: true });
    a.toolBubble = null;
    if (a.home) a.pos = feet(a.home);
  }
  for (const p of particles) { p.s.visible = false; spritePool.push(p.s); }
  particles.length = 0;
  for (const m of movers) { m.s.visible = false; moverPool.push(m.s); }
  movers.length = 0;
  pending.length = 0;
  for (const r of rings) { r.g.visible = false; ringPool.push(r.g); }
  rings.length = 0;
  huddling.clear();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && layout) fastForward(); });

// ---- snapshot ------------------------------------------------------------------------------------------------

function onEnvelope(env: Envelope) {
  if (frozen.on) { held = env; return; } // applied once, latest only, when the freeze lifts
  const r = advance(cursor, env);
  if (!r) return; // not newer than what we have
  if (r.fresh) {
    // first snapshot or daemon restart: per-epoch caches must not outlive the epoch
    meta.clear(); lastBusy.clear(); lastErr.clear(); visitors.clear(); huddling.clear(); strolled.clear(); seenConflicts.clear();
    seenLeads.clear(); waitRung.clear(); arrived.clear(); tray.clear(); flashes.clear();
    freshUntil = Date.now() + FRESH_QUIET_MS;
  }
  const k = JSON.stringify(env.config);
  if (k !== cfgKey) { cfgKey = k; lastCfg = env.config; } // a config change re-lays out; it never touches the log cursor
  const prevState = state;
  state = env.state;
  skyT = office.source.mode === "replay" ? state.log[state.log.length - 1]?.t ?? 0 : 0;
  chooseLayout();
  syncActors();
  if (r.fresh) fastForward(); // the crowd already at work is at its desks, not parading in through the door (a 45-agent page took ~15 s)
  const now = Date.now(), hidden = document.hidden;
  if (r.fresh) for (const it of env.state.log) if (it.kind === "report" && it.outcome === "done" && now - it.t < 600_000) pushSignal(doneAt, it.t);
  stepFunLayer(env, prevState, r.fresh, now, hidden);
  // On first load the feed starts from the daemon's recent log (no effects: history is not news), so a refresh keeps context.
  if (r.fresh) for (const it of env.state.log.slice(-30)) if (it.kind !== "done" || it.text) pushFeed(feedItem(it, nameOf));

  for (const it of r.items) {
    if (it.kind === "report" && it.outcome === "done") pushSignal(doneAt, it.t);
    if (!hidden) {
      for (const a of planInteraction(it, ctx)) exec(a, now);
      const tk = ticketFor(it, ctx), from = tk && actors.get(tk.from), to = tk && actors.get(tk.to);
      if (tk && from && to && !r.fresh) launch(tk.kind, from, to);
    }
    pushFeed(feedItem(it, nameOf));
  }
  const keys = new Set<string>();
  for (const c of state.conflicts ?? []) {
    const key = `${c.file}|${c.a}|${c.b}|${c.t}`;
    keys.add(key);
    if (seenConflicts.has(key)) continue;
    seenConflicts.add(key);
    if (r.fresh) continue; // history on first load is not news
    if (!hidden) exec({ k: "spark", a: c.a, b: c.b, file: c.file }, now);
    pushFeed({ kind: "conflict", from: nameOf(c.a), to: nameOf(c.b), text: c.file, t: c.t, possible: true });
  }
  for (const key of seenConflicts) if (!keys.has(key)) seenConflicts.delete(key);

  departing();
  releaseBlocked(now);
  fileOutcomes(state.outcomes ?? [], r.fresh);
  const al = alertsFor(state, blocked.keys(), leadId), wt = waitsFor(state, leadId);
  for (const a of actors.values()) {
    const before = a.alert, w = wt.get(a.id); // each actor's own wait (kind from the daemon's notification_type)
    a.setAlert(al.get(a.id) ?? null, w?.kind ?? "permission", w?.soft);
    if (a.alert !== before) {
      if (a.lead && a.alert === "waiting" && !r.fresh) { a.steps = []; a.path = []; a.cur = null; } // back to its desk: the one place it waits for you
      gold(a);
      if (a.alert === "blocked" && !r.fresh && !settings.reducedMotion) a.glitch();
    }
  }
  const edges = newAlerts(seenAlerts, al);
  if (!r.fresh) for (const id of edges) if (actors.has(id)) alertFocus(id, al.get(id)!);
  const lines = boardLines(state.tasks);
  if (lines.join("\n") !== boardText.join("\n")) boardText = lines;
  // prune per-actor maps of everything that left (#40)
  for (const m of [meta, lastBusy, lastErr, visitors, huddling, strolled, tray] as Map<string, unknown>[])
    for (const id of m.keys()) if (!actors.has(id) && !liveIds.has(id)) m.delete(id);
  publish(env);
}

/** Attention pulse (ring + edge vignette) for a newly blocked/waiting actor; the single alert cue, no camera move. */
function alertFocus(id: string, kind: "waiting" | "blocked") {
  const a = actors.get(id)!;
  if (fxk("routine", "alert")) {
    if (kind === "waiting" && a.waitKind === "turn") return; // your turn is calm: no pulse, no vignette
    const c = kind === "blocked" ? ST("blocked") : ST("permission");
    pulse(a.pos.x, a.pos.y - 12, c);
    if (!settings.reducedMotion) { vignette.tint = c; vignetteT = VIGNETTE_MS; }
  }
}

// ---- fun layer ---------------------------------------------------------------------------------------------------

/** One envelope through the core fun engine; effects for each event on the canvas, then the same events to the DOM (`ao:fun`). */
function stepFunLayer(env: Envelope, before: OfficeState, fresh: boolean, now: number, hidden: boolean) {
  const mode = office.source.mode;
  if (mode !== funMode) { funMode = mode; funPrev = null; }
  const mem = mode === "live" ? funMem : (volatileMem ??= emptyFun());
  // first snapshot, daemon restart, replay and a freeze thaw adopt state silently: no backfill burst
  const quiet = fresh || quietFun || mode === "replay" || !funPrev;
  const res = stepFun(mem, quiet ? null : before, env.state, now);
  funPrev = env.state;
  if (mode === "live") funMem = res.mem; else volatileMem = res.mem;
  for (const ev of res.out) {
    if (!hidden && !quiet) applyFun(ev, now);
    document.dispatchEvent(new CustomEvent("ao:fun", { detail: ev }));
  }
}
function applyFun(ev: FunEvent, now: number) {
  const a = ev.actorId ? actors.get(ev.actorId) : undefined;
  if (ev.kind === "delight" && burstAllowed() && ![...actors.values()].some((x) => x.alert)) { // combos are gone (they rewarded tool volume, P6); a delight never plays while something needs you
    const k = ev.id.split(":")[1];
    if (!isDelight(k)) return;
    const taken = new Set(couchHolds.values()), ck = catSeat(now);
    if (ck) taken.add(ck);
    const d = planDelight(k, now, delights, scene.couchSpots().findIndex((p) => !taken.has(`${p.x},${p.y}`)));
    if (!d) return;
    delights.push(d);
    showDelight(d, now, a);
  }
}

function showDelight(d: Delight, now: number, a?: Actor) {
  if (d.until <= now) return;
  if (d.kind === "confetti-gold") {
    const p = a?.pos ?? { x: (layout.cols * T) / 2, y: layout.rows * T * 0.55 };
    const k = fxk("milestone", "confetti");
    if (k) burst(p.x, p.y - 16, scaled(30, k), [GOLD, WARM, PAPER], 55, 70);
  } else if (d.kind === "cat-on-couch") scene.setCat(scene.couchSpots()[d.seat] ?? null, d.until);
}
/** "x,y" of the couch seat the cat occupies, or "" . */
function catSeat(now: number) {
  const d = delights.find((x) => x.kind === "cat-on-couch" && x.until > now), p = d && scene.couchSpots()[d.seat];
  return p ? `${p.x},${p.y}` : "";
}

// ---- session collapse (V4/G6) -------------------------------------------------------------------------------
// When a figure would be under ~20 screen px (R5: legibility, not head count) each crew folds into one small plate above its first pod:
// helpers hide (their desks keep working), except alerts, the selected agent and sessions the user opened. Default, not an option.
// Seats stay where they are.
let collapsed = false;
const expanded = new Set<string>(); // sessions opened from a badge, an agent or the panel; Escape closes them all
const sessIdx = new Map<string, number>(); // session id -> 1-based start order ("session N" when text is hidden)
type SBadge = { c: Container; bg: Graphics; pips: Container; name: Text; info: Text; warn: Text; more: Text; key: string; w: number; h: number };
const badges = new Map<string, SBadge>();
const crews = new Map<string, { pod: number; list: Actor[] }>(); // per-frame scratch
const badgeBoxes: Box[] = [], badgeOf: SBadge[] = [], badgeHide: boolean[] = [];
const sessOf = (id: string) => meta.get(id)?.session ?? "";
const PIPS_SHOWN = 8;

function foldCrews() {
  for (const [id, a] of actors) a.setHidden(collapsed && !a.lead && !a.queued && !a.alert && id !== office.selected && !expanded.has(sessOf(id)));
}
function newBadge(sid: string): SBadge {
  const st = (fill: number | string) => ({ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 10, fill, stroke: outline(2) });
  const bd: SBadge = { c: new Container(), bg: new Graphics(), pips: new Container(), name: new Text({ text: "", style: st(KEY.text.fg) }), info: new Text({ text: "", style: st(KEY.text.soft) }), warn: new Text({ text: "", style: st(KEY.text.fg) }), more: new Text({ text: "", style: st(KEY.text.soft) }), key: "", w: 0, h: 0 };
  bd.c.addChild(bd.bg, bd.pips, bd.name, bd.info, bd.warn, bd.more);
  bd.c.eventMode = "static";
  bd.c.cursor = "pointer";
  bd.c.on("pointertap", () => {
    actorTapAt = Date.now(); // not a floor click: keep the selection
    if (camera.dragged) return;
    if (!expanded.delete(sid)) expanded.add(sid);
  });
  uiLayer.addChild(bd.c);
  badges.set(sid, bd);
  return bd;
}
/** Plate per collapsed session above its first pod: name in the session hue and counts on one row, a pip per helper, worst state (glyph + word) unless working/idle. */
function drawBadges(ui: View, W: number, H: number) {
  obstacles.length = 0;
  crews.clear();
  if (collapsed) for (const b of bindings) {
    const a = actors.get(b.id), pod = b.key.startsWith("lobby") ? -1 : scene.podOfSeat(b.key);
    if (!a || a.leaving || pod < 0) continue;
    const sid = sessOf(b.id), c = crews.get(sid) ?? crews.set(sid, { pod, list: [] }).get(sid)!;
    c.pod = Math.min(c.pod, pod);
    c.list.push(a);
  }
  for (const [sid, bd] of badges) if (!crews.has(sid)) { bd.c.destroy({ children: true }); badges.delete(sid); }
  if (!crews.size) return;
  const fs = fontPx(10), r = Math.max(3, Math.round(fs * 0.3)), pad = 4;
  const chars = Math.max(6, Math.floor((Math.max(80, 4 * T * ui.sc - 6) - 2 * pad) / (fs * 0.62)) - 2); // name fits one pod pitch, so neighbouring badges sit side by side
  badgeBoxes.length = badgeOf.length = 0;
  for (const [sid, crew] of crews) {
    const bd = badges.get(sid) ?? newBadge(sid), pr = scene.podRect(crew.pod);
    if (!pr) { bd.c.visible = false; continue; }
    const lead = actors.get(leadId(sid)), sts = crew.list.map((a) => ({ s: a.status, wait: a.waitKind }));
    const worst = worstState(lead?.alert ? [...sts, { s: lead.status, wait: lead.waitKind }] : sts);
    const working = crew.list.reduce((n, a) => n + (a.working ? 1 : 0), 0), open = expanded.has(sid);
    const name = hideText() ? `session ${sessIdx.get(sid) ?? 0}` : clip(state.sessions[sid]?.project ?? sid, chars);
    const key = `${name}|${working}|${worst}|${sts.map((x) => x.s + x.wait).join(",")}|${fs}|${+open}`;
    if (key !== bd.key) {
      bd.key = key;
      for (const t of [bd.name, bd.info, bd.warn, bd.more]) { t.style.fontSize = fs; t.style.stroke = outline(2); }
      bd.name.text = `${open ? "\u25be" : "\u25b8"} ${name}`;
      bd.name.style.fill = sessionColor(sid);
      bd.info.text = working ? `${working}/${crew.list.length} working` : `${crew.list.length} idle`; // "0/12 working" read as broken
      const more = sts.length - PIPS_SHOWN, bad = worst !== "working" && worst !== "idle";
      // rows: name and counts / a pip per helper (+N) / worst state when it needs you: a small plate, narrow enough for one pod pitch
      // pips are the 9x9 pixel pips at a whole-number scale, top-left corners on whole pixels
      const row = Math.ceil(bd.name.height), shown = Math.min(PIPS_SHOWN, sts.length), P = PIP * pipScale(r), pt = pad + row + 1;
      bd.name.position.set(pad, pad - 1);
      bd.info.position.set(pad + Math.ceil(bd.name.width) + 4, pad - 1);
      for (const c of bd.pips.removeChildren()) c.destroy();
      for (let i = 0; i < shown; i++) bd.pips.addChild(setPip(new Sprite(), sts[i].s, sts[i].wait, r)).position.set(pad + i * (P + 3) + P / 2, pt + P / 2);
      bd.warn.text = bad ? `${STATUS[worst].glyph} ${STATUS[worst].label}` : "";
      bd.warn.style.fill = bad ? STATUS[worst].color : KEY.text.soft;
      bd.warn.position.set(pad, pt + P + 2);
      // overflow on the pip row itself ("+4 more"), never on the state line, where it read as "4 more need permission"
      bd.more.text = more > 0 ? `+${more} more` : ""; bd.more.position.set(pad + shown * (P + 3) + 2, Math.round(pt + P / 2 - bd.more.height / 2));
      bd.w = Math.ceil(Math.max(bd.name.width + 4 + bd.info.width, shown * (P + 3) + (bd.more.text ? bd.more.width + 2 : 0), bd.warn.text ? bd.warn.width : 0)) + 2 * pad;
      bd.h = Math.ceil(Math.max(pt + P + 1, bd.warn.text ? bd.warn.y + bd.warn.height : 0)) + pad;
      // the border is the loud part only when the crew needs you (state colour); otherwise a quiet session-hue edge; drawn inside the plate
      bd.bg.clear().rect(0, 0, bd.w, bd.h).fill({ color: KEY.env[0], alpha: 0.84 }).stroke(bad ? { width: 2, color: STATUS[worst].color, alpha: 1, alignment: 1 } : { width: 1, color: sessionColor(sid, 0.65, 0.6), alpha: open ? 0.3 : 0.5, alignment: 1 });
    }
    const cx = ui.ox + (pr.x + pr.w / 2) * ui.sc, bot = ui.oy + (pr.y - 1) * ui.sc; // above the pod: the plate never covers the desks it stands for
    bd.c.visible = cx >= 0 && cx <= W && bot >= TOP && bot - bd.h <= TOP + H; // off-screen pods keep their badge off-screen too
    if (!bd.c.visible) continue;
    badgeBoxes.push({ x: cx, y: bot - bd.h, w: bd.w, h: bd.h, pri: 3, own: bd });
    badgeOf.push(bd);
  }
  // inside the visible floor, stacked clear of each other; then they are fixed obstacles for tags and bubbles (actor.ts)
  const fx0 = Math.max(0, ui.ox), fy0 = Math.max(TOP, ui.oy + layout.wallRows * T * ui.sc);
  const fr = { x: fx0, y: fy0, w: Math.max(0, Math.min(W, ui.ox + layout.cols * T * ui.sc) - fx0), h: Math.max(0, Math.min(TOP + H, ui.oy + layout.rows * T * ui.sc) - fy0) };
  // an agent that needs you is never under a badge: its flag and ring are placed first (they never move)
  const nb = badgeBoxes.length;
  for (const a of actors.values()) if (a.alert && !a.hidden) a.alertBoxes(badgeBoxes);
  for (let i = nb; i < badgeBoxes.length; i++) badgeBoxes[i].pri = 4;
  badgeHide.length = 0; badgeHide.length = badgeBoxes.length; badgeHide.fill(false);
  const dy = stackLabels(badgeBoxes, fr, badgeHide);
  badgeBoxes.forEach((b, i) => {
    if (i >= nb) return;
    const bd = badgeOf[i];
    if (badgeHide[i]) { bd.c.visible = false; return; }
    const x = clampBox(b, fr).x, y = b.y + dy[i];
    bd.c.position.set(dev(x - bd.w / 2), dev(y));
    obstacles.push({ x, y, w: bd.w, h: bd.h, pri: 3 });
  });
}

// ---- frame loop --------------------------------------------------------------------------------------------

const walkers: Actor[] = []; // per-frame scratch
let vw = -1, vh = -1, viewAt = 0, viewDirty = false, activeUntil = 0;
let lastV = { sc: 0, ox: 0, oy: 0 };
let coolerT = 0;
/** Dotted pixel tether on the floor between two actors' feet; the dots drift toward b (still under reduced motion). */
const dot = (x: number, y: number) => { tether.rect(x, y, 1, 1); };
const dots = (a: Actor, b: Actor, t: number) => tetherDots(a.pos.x, a.pos.y - 1, b.pos.x, b.pos.y - 1, settings.reducedMotion ? 0 : t / 80, dot);
// Performance probe for the CI gate (scripts/perf.mjs): main-thread ms per frame (update + render submit) and live display objects.
const perf = { ms: new Float32Array(600), up: new Float32Array(600), n: 0, start: 0, upEnd: 0 };
app.ticker.add(() => { perf.start = performance.now(); }, undefined, UPDATE_PRIORITY.INTERACTION);
app.ticker.add(() => { perf.upEnd = performance.now(); }, undefined, UPDATE_PRIORITY.LOW + 1); // after every update, before the render
app.ticker.add(() => { const i = perf.n++ % 600; perf.ms[i] = performance.now() - perf.start; perf.up[i] = perf.upEnd - perf.start; }, undefined, UPDATE_PRIORITY.UTILITY);
const countObjects = (c: ContainerChild): number => 1 + (c.children?.reduce((n, k) => n + countObjects(k), 0) ?? 0);
(globalThis as { __aoPerf?: unknown }).__aoPerf = { frames: () => Array.from(perf.ms.subarray(0, Math.min(perf.n, 600))), updates: () => Array.from(perf.up.subarray(0, Math.min(perf.n, 600))), reset: () => { perf.n = 0; }, objects: () => countObjects(app.stage), actors: () => actors.size };
app.ticker.add((tk) => {
  if (!layout) return;
  const dt = Math.min(0.1, tk.deltaMS / 1000), now = Date.now();
  if (wasFrozen && !frozen.on) { // thaw: apply the newest held snapshot once and snap everyone to where they belong
    const e = held;
    held = null;
    if (e) { onEnvelope(e); fastForward(); }
  }
  wasFrozen = frozen.on;
  const W = app.screen.width, H = app.screen.height - TOP - bottomPx();
  if (W !== vw || H !== vh) { vw = W; vh = H; viewAt = now; viewDirty = true; }
  if (viewDirty && now - viewAt >= RESIZE_DEBOUNCE_MS) {
    viewDirty = false;
    chooseLayout();
    if (lastCfg) syncActors();
  }
  camera.minScale = 1 / dpr();
  camera.phone = isNarrow(W, app.screen.height - TOP); // judged on the full stage, so opening the sheet never flips the mode
  if (camera.phone && !camera.fitAll && camera.autoFollow) { // default phone focus: an alert, else a working agent, else the door aisle
    const cand = [];
    for (const a of actors.values()) if (!a.leaving && !a.queued && !a.gone && !a.hidden) cand.push({ id: a.id, x: a.pos.x, y: a.pos.y, alert: !!a.alert, working: a.working });
    const dp = feet(layout.door), pk = pickAuto(cand, autoId, { x: dp.x, y: dp.y + T * 2 });
    autoId = pk.id;
    camera.autoPos = pk;
  }
  fitBtn.hidden = !camera.phone;
  fitBtn.textContent = camera.fitAll ? "Follow" : "Fit all"; // shortcut: English only, not in the i18n table
  const target = camera.follow ? actors.get(camera.follow)?.pos : null;
  if (camera.follow && !target) camera.setFollow(null);
  const v = camera.view(fitScale(layout, W, H), W, H, TOP, layout.cols * T, layout.rows * T, target, dt, dpr());
  world.scale.set(v.sc);
  world.position.set(v.ox, v.oy);
  collapsed = collapseLatch(collapsed, FIGURE_ART * v.sc); // fold crews by legibility, not by head count (R5)
  if (!collapsed) expanded.clear();
  const ui = camera.still; // text and plaques ride the un-shaken view: a shake moves the world only (rubric B7)
  { // pod plaques show only for a claimed pod the pointer is over (or the hovered agent's); touch has no hover, so the selected agent's pod
    let pod = -1;
    const who = hoverId ?? (matchMedia("(hover: none)").matches ? office.selected : null);
    if (who) { const bd = bindings.find((b) => b.id === who); if (bd) pod = scene.podOfSeat(bd.key); }
    if (pod < 0 && pointerAt) pod = scene.podAt((pointerAt.x - ui.ox) / ui.sc, (pointerAt.y - ui.oy) / ui.sc);
    scene.setHoverPod(pod);
  }
  const narrow = W < 520 ? 1.25 : 1; // a phone fits the whole floor at ~0.8: tags would pile up, so pips take over sooner
  lod = v.sc < (lod ? LOD_OFF : LOD_ON) * narrow;
  // pips when zoomed out, or in a crowd for everyone but leads, the selected/hovered actor and alerts
  crowd = crowdLod(crowd, Object.keys(state.agents).length, displaced);
  // G3: collapsed, only leads, alerts, the selected/hovered agent and opened crews keep a name
  for (const a of actors.values()) a.setLod(lod || ((crowd || collapsed) && !a.lead && !a.alert && a.id !== office.selected && a.id !== hoverId && !(collapsed && expanded.has(sessOf(a.id)))));
  const hud = { w: app.screen.width, h: app.screen.height - bottomPx(), top: TOP };
  if (setBubbleBlank(hideText())) for (const a of actors.values()) a.refreshText(); // stream-safe blanks live canvas bubbles at once
  if (setSceneScale(ui.sc)) {
    for (const a of actors.values()) a.refreshText();
    doorTok.style.fontSize = fontPx(11);
    for (const t of [doorTok, queueTok, ...recvBadges.values()]) t.style.stroke = outline(3); // strokes scale like the font (R3)
  } // in-scene text keeps its size relative to the world
  if (frozen.on) { // paused: nothing advances, but pan/zoom/selection stay live (overlays re-follow the camera)
    minimap.draw(camera.still, W, TOP, H, frozen.since, isPresenter());
    foldCrews();
    for (const a of actors.values()) a.syncUi(ui.ox, ui.oy, ui.sc, hud);
    drawBadges(ui, W, H);
    displaced = layoutTags(actors.values());
    layoutBubbles(actors.values(), hud);
    scene.tick(frozen.since, ui.ox, ui.oy, ui.sc, boardText, skyT || frozen.since);
    if (viewDirty || v.sc !== lastV.sc || v.ox !== lastV.ox || v.oy !== lastV.oy) activeUntil = now + ACTIVE_HOLD_MS;
    lastV = v;
    app.ticker.maxFPS = document.hidden || document.querySelector(".view:not([hidden])") ? 4 : now < activeUntil ? 60 : IDLE_FPS;
    return;
  }
  minimap.draw(camera.still, W, TOP, H, now, isPresenter());

  // walkers give way to a lower-id walker just ahead; the lowest id never yields, so no gridlock (#116)
  // shortcut: O(w^2) over walking actors only; use a grid if walkers reach hundreds
  walkers.length = 0;
  for (const a of actors.values()) { a.lineX = 0; if (a.path.length && !a.gone) walkers.push(a); }
  const doorPos = feet(layout.door);
  let line = 0, lineMax = 0;
  for (const a of walkers) {
    const n = feet(a.path[0]);
    const atDoor = !a.leaving && walkers.some((o) => doorHold(a, o, doorPos, DOOR_R)); // one in at a time, leavers first
    const want = atDoor || walkers.some((o) => yieldsTo(a, n, o));
    a.held = stepHold(a.held, want, dt * 1000);
    a.yielding = holds(a.held, want); // at most 1.5 s, then it slips past
    if (a.yielding && atDoor) { a.lineX = (line % LINE_SHOWN) * 5; if (++line > LINE_SHOWN) lineMax = line; }
  }
  doorTok.visible = lineMax > 0;
  if (lineMax > 0) { doorTok.text = `+${lineMax - LINE_SHOWN}`; doorTok.position.set(dev(ui.ox + doorPos.x * ui.sc), dev(ui.oy + (doorPos.y - 14) * ui.sc)); }
  let active = viewDirty || !!camera.follow || v.sc !== lastV.sc || v.ox !== lastV.ox || v.oy !== lastV.oy;
  lastV = v;
  let doorNear = false;
  const door = feet(layout.door);
  foldCrews();
  queueTok.visible = queueOver > 0;
  if (queueOver) { const q = feet(layout.zones[0].queue[layout.zones[0].queue.length - 1]); queueTok.text = `+${queueOver} waiting for a desk`; queueTok.style.fontSize = fontPx(11); queueTok.position.set(dev(ui.ox + q.x * ui.sc), dev(ui.oy + (q.y - 30) * ui.sc)); }
  for (const [id, a] of actors) {
    const isRun = running.has(id);
    a.working = !a.queued && isWorking(isRun, a.busyAt, now);
    a.stale = !isRun && a.busyAt > 0 && now - a.busyAt > STALE_MS && !a.leaving;
    const quietMs = a.busyAt > 0 && !isRun && !a.leaving ? now - a.busyAt : 0;
    a.setStaleMin(quietMs >= idleTagMs ? Math.floor(quietMs / 60_000) : 0); // "idle 7m" in the tag, at the Stuck threshold
    a.thinking = !a.lead || !!state.sessions[meta.get(id)?.session ?? ""]?.prompt;
    a.setQuiet(a.lead && !a.thinking && !a.working && !a.alert);
    a.toolSince = isRun && now - a.busyAt < STALE_MS ? a.busyAt : 0; // past 5 min a missing tool_end is likelier than a real call
    if (a.toolSince) { const sess = state.sessions[meta.get(id)?.session ?? ""], tool = a.lead ? sess?.doing : state.agents[id]?.doing; a.longAfter = longToolMs(tool ? sess?.toolStats?.[tool] : undefined); }
    a.update(dt, now);
    a.syncUi(ui.ox, ui.oy, ui.sc, hud);
    if (a.path.length || a.speech || a.toolBubble || a.emote || a.hop > 0) active = true;
    if (!a.sitting && Math.hypot(a.pos.x - door.x, a.pos.y - door.y) < T * 1.5) doorNear = true;
    if (!a.lead && a.sitting && !arrived.has(id)) {
      arrived.add(id);
      if (now > freshUntil) { a.squash(); for (let i = 0; i < 6; i++) puff(a.pos.x + (i - 2.5) * 2, a.pos.y - 1, 0xcfc8b8); }
    }
    if (a.gone) {
      if (!a.lead && burstAllowed()) for (let i = 0; i < 6; i++) puff(door.x + (i - 2.5) * 2, door.y - 4);
      a.destroy();
      actors.delete(id);
      blocked.delete(id);
      arrived.delete(id);
      if (office.selected === id) office.select(null);
    }
  }
  drawBadges(ui, W, H);
  displaced = layoutTags(actors.values()); // tags first: bubbles then avoid them
  layoutBubbles(actors.values(), hud);
  for (const b of bindings) {
    const st = seatStates.get(b.key), a = actors.get(b.id);
    if (st) {
      st.working = !!a?.working; st.stale = !!a?.stale;
      let n = 0;
      if (a) for (const h of a.recentHits) if (now - h < 30_000) n++;
      st.load = loadLevel(n);
      st.idleMs = a?.working || !a?.busyAt ? 0 : now - a.busyAt;
      st.mug = a?.sip === "desk";
      st.think = !!a && a.sitting && !a.working && a.thinking && !a.alert; // dots on the monitor, in place of a thought cloud
      st.folded = !!a?.hidden;
    }
  }
  scene.setDoor(doorNear);
  scene.tick(now, ui.ox, ui.oy, ui.sc, boardText, skyT || now);
  // idle or hidden: drop the frame rate (#167); anything moving gets a second of full rate
  if (active) activeUntil = now + ACTIVE_HOLD_MS;
  app.ticker.maxFPS = document.hidden || document.querySelector(".view:not([hidden])") ? 4 : now < activeUntil ? 60 : IDLE_FPS; // a list view covering the canvas: no need to draw the hidden scene at full rate (critique P3)

  // tethers exist only while a real delegation/report ticket is in flight (+600 ms fade); a hover/select chain is a faint static line
  tether.clear();
  for (const m of movers) {
    if (m.kind === "spark") continue;
    dots(m.a, m.b, now); // both ends follow the actors, not where the sender stood at launch
    tether.fill({ color: KEY.cyan, alpha: 0.55 * tetherAlpha(m.life) });
  }
  const fid = office.selected ?? hoverId;
  if (fid) {
    const chain = [fid, ...parentChain(state, fid)];
    for (let i = 0; i + 1 < chain.length; i++) {
      const p = actors.get(chain[i]), q = actors.get(chain[i + 1]);
      if (p && q) dots(q, p, 0);
    }
    tether.fill({ color: KEY.cyan, alpha: 0.3 });
  }

  // coffee steam is the machine's own two-frame wisp (scene.ts), not particles
  coolerT += dt;
  if (coolerT > 1.1 && cooler && ambientOn()) { coolerT = 0; puff(cooler.x, cooler.y, 0xbfe9ff); } // cooler bubble (#118)
  floaters.update(dt);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    p.vy += p.g * dt;
    p.s.x += p.vx * dt;
    p.s.y += p.vy * dt;
    p.s.alpha = Math.max(0, 1 - p.life / p.max);
    if (p.life >= p.max) { p.s.visible = false; spritePool.push(p.s); particles.splice(i, 1); }
  }
  while (pending.length && movers.length < MAX_MOVERS) {
    const p = pending.shift()!;
    if (actors.get(p.a.id) === p.a && actors.get(p.b.id) === p.b && !p.b.leaving) launch(p.kind, p.a, p.b);
  }
  recvCount.clear();
  for (const p of pending) recvCount.set(p.b.id, (recvCount.get(p.b.id) ?? 0) + 1);
  for (const [id, t] of recvBadges) t.visible = recvCount.has(id);
  for (const [id, n] of recvCount) { // "+N" on the receiver while tickets for it wait for a free flight slot
    const b = actors.get(id);
    if (!b) continue;
    let t = recvBadges.get(id);
    if (!t) { t = new Text({ text: "", style: { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: fontPx(10), fill: KEY.cyan, stroke: outline(3) } }); t.anchor.set(0, 1); t.eventMode = "none"; uiLayer.addChild(t); recvBadges.set(id, t); }
    t.visible = true;
    t.text = `+${n}`;
    if (t.style.fontSize !== fontPx(10)) t.style.fontSize = fontPx(10); // world-relative like every in-scene text (O3)
    t.position.set(dev(ui.ox + (b.pos.x + 7) * ui.sc), dev(ui.oy + (b.pos.y - 22) * ui.sc));
  }
  for (let i = movers.length - 1; i >= 0; i--) {
    const m = movers[i], still = !burstAllowed(), blockedKind = m.kind === "blocked";
    // an end actor that left or was destroyed retires the ticket at once: nothing is ever left on the floor
    const gone = actors.get(m.a.id) !== m.a || actors.get(m.b.id) !== m.b || m.b.leaving;
    m.life += dt * 1000;
    const t = ticketT(m.life), e = moverEnd(m);
    const ox = m.a.pos.x, oy = m.a.pos.y - 8; // live sender position
    m.s.position.set(ox + (e.x - ox) * t, oy + (e.y - oy) * t - (still ? 0 : Math.sin(Math.PI * t) * 6));
    if (blockedKind && m.landed && !still) m.s.x += Math.floor(m.life / 60) % 2 ? 2 : -2; // shake at the lead
    if (!m.landed && m.life >= TICKET_MS) { m.landed = true; land(m); }
    const hold = still ? DOT_HOLD_MS : blockedKind ? 900 : m.kind === "spark" ? 0 : TICKET_HOLD_MS;
    if (gone || m.life >= TICKET_MS + hold) { m.s.visible = false; moverPool.push(m.s); movers.splice(i, 1); }
  }
  if (vignetteT > 0) {
    vignetteT -= dt * 1000;
    vignette.visible = vignetteT > 0;
    vignette.alpha = Math.max(0, vignetteT / VIGNETTE_MS);
    vignette.width = app.screen.width;
    vignette.height = app.screen.height;
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.life += dt * 1000;
    const u = (r.life - r.delay) / r.ms;
    if (u >= 1) { r.g.visible = false; ringPool.push(r.g); rings.splice(i, 1); continue; }
    r.g.visible = u >= 0;
    if (u >= 0) {
      const f = Math.min(2, Math.floor(u * 3)); // stepped frames, whole art pixels
      r.g.texture = pulseTex(f); r.g.alpha = f === 2 ? 0.5 : 1;
    }
  }
});

// 1 Hz housekeeping: nothing here needs a snapshot to arrive
setInterval(() => {
  const now = Date.now();
  if (!layout || frozen.on) return;
  releaseBlocked(now);
  const sm = Number(store.get("stuck"));
  idleTagMs = ([1, 2, 5, 10].includes(sm) ? sm : 2) * 60_000;
  if (shrinking) chooseLayout(); // the ratchet decays on a clock, not on snapshots
  maybeStroll(now);
  const w = pickWeather(doneAt, errAt, now);
  if (w !== weather) { weather = w; scene.setWeather(w); }
  delights = delights.filter((d) => d.until > now);
  if (followDue({ mode: settings.follow, frozen: frozen.on, presenter: isPresenter(), reduced: settings.reducedMotion, now, touched: camera.touched })) {
    const id = pickBusiest(Array.from(actors.values(), (a) => (a.leaving || a.queued || a.hidden ? { id: a.id, hits: [] } : { id: a.id, hits: a.recentHits })), now);
    // retarget at most every 5 s so the camera never ping-pongs
    if (id && camera.follow !== id && now - lastFollow >= 5000) { lastFollow = now; camera.easeFocus(id); }
  }
  if (isPresenter()) {
    let best: Actor | undefined;
    for (const a of actors.values()) if (!a.leaving && a.busyAt && (!best || a.busyAt > best.busyAt)) best = a;
    if (best && camera.follow !== best.id) camera.focus(best.id);
  }
}, 1000);

// ---- API wiring -----------------------------------------------------------------------------------------------

let prevSel: string | null = null;
office.onSelect((id) => {
  if (prevSel) actors.get(prevSel)?.setSelected(false);
  if (id) actors.get(id)?.setSelected(true);
  if (id && collapsed && sessOf(id)) expanded.add(sessOf(id)); // picking an agent (canvas, panel, keyboard) opens its crew
  prevSel = id;
});
// Escape first closes a dialog/view/settings or leaves presenter mode (those run first or mark the event); only a bare Escape deselects.
addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || document.body.classList.contains("presenter")) return;
  if (document.querySelector(".dlg:not([hidden]),.view:not([hidden]),#settings:not([hidden])")) return;
  expanded.clear(); // opened crews fold back
  office.select(null);
});

hooks.canvas = () => app.canvas;
hooks.pulse = (id) => actors.get(id)?.hopNow();
hooks.ingest = onEnvelope;
hooks.applyTextScale = (n) => { setTextScale(n); for (const a of actors.values()) a.refreshText(); };
hooks.sessions = (): SessionInfo[] =>
  Object.values(state.sessions).map((s) => ({
    id: s.id, lead: leadId(s.id), project: s.project, cwd: s.cwd, branch: s.branch, gaps: s.gaps ?? 0, recovered: !!s.recovered,
    usage: s.usage, waiting: s.waiting, startedAt: s.startedAt, agents: Object.values(state.agents).filter((a) => a.session === s.id).length,
  }));
// Called many times per UI refresh: build once per state and reuse for 200 ms (statuses lag at most that), children in one pass (was O(n^2)).
let actorsMemo: { st: OfficeState | null; t: number; out: ActorInfo[] } = { st: null, t: 0, out: [] };
hooks.actors = (): ActorInfo[] => {
  const now = performance.now();
  if (actorsMemo.st === state && now - actorsMemo.t < 200) return actorsMemo.out;
  const kids = new Map<string, string[]>();
  for (const ag of Object.values(state.agents)) { const l = kids.get(ag.parent); if (l) l.push(ag.id); else kids.set(ag.parent, [ag.id]); }
  const out: ActorInfo[] = [];
  actorsMemo = { st: state, t: now, out };
  for (const [id, a] of actors) {
    const held = blocked.has(id);
    if (a.leaving && !held) continue;
    const m = meta.get(id), ag = state.agents[id];
    const sess = state.sessions[ag?.session ?? m?.session ?? ""];
    const src = ag ?? (a.lead ? sess : undefined);
    out.push({
      id, label: m?.name ?? a.label, role: m?.role ?? "?", session: sess?.id ?? m?.session ?? "", project: sess?.project ?? "",
      status: statusOf({ blocked: held, waiting: a.lead && !!sess?.waiting, queued: a.queued, working: a.working, active: !a.lead || !!sess?.prompt }),
      lead: a.lead,
      task: ag?.task ?? (a.lead ? sess?.prompt : state.tasks?.find((t) => t.agentId === id)?.text),
      why: src?.why, confidence: ag?.confidence, doing: src?.doing, detail: src?.detail, cwd: sess?.cwd, branch: sess?.branch,
      parent: ag?.parent, children: kids.get(id) ?? [], chain: parentChain(state, id),
      ...(held ? { outcome: "blocked" as const } : {}),
    });
  }
  return out;
};

bindUi();
connect(liveIn, setConnection, office.source.private);
