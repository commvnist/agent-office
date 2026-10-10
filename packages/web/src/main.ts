import { Application, Container, Graphics, Sprite } from "pixi.js";
import { buildLayout, findPath, seatTile, standNear, leadId, childrenOf, parentChain, type Layout, type OfficeConfig, type OfficeState, type Tile } from "@agent-office/core";
import { Actor, T, feet, layoutBubbles } from "./actor.ts";
import { Scene, type SeatState } from "./scene.ts";
import { lookFor, whiteTex } from "./sprites.ts";
import { applyTheme, DEFAULT_THEME, parseTheme, THEMES, type Theme } from "./theme.ts";
import { burstAllowed, setTextScale } from "./settings.ts";
import { alertsFor, boardLines, feedItem, isWorking, pickBands, pickStroller, planInteraction, statusOf, type Action, type PlanCtx } from "./choreo.ts";
import { advance, connect, newCursor, type Envelope } from "./net.ts";
import { camera, bindPointer } from "./camera.ts";
import { hooks, liveIn, office, publish, pushFeed, setConnection, isPresenter, type ActorInfo, type SessionInfo } from "./api.ts";
import { bindUi } from "./ui.ts";

const TOP = 34;
const RESIZE_DEBOUNCE_MS = 150;
const BLOCK_HOLD_MS = 45_000; // shortcut: a blocked agent is gone from state, so hold its desk this long; upgrade when the daemon keeps stopped agents
const HUDDLE_HOLD_MS = 6000;

const host = document.getElementById("stage")!;
const app = new Application();
const overlay = new URLSearchParams(location.search).get("overlay") === "1"; // transparent page for OBS-style capture
await app.init({ resizeTo: host, background: 0x14121f, backgroundAlpha: overlay ? 0 : 1, antialias: false, resolution: window.devicePixelRatio || 1, autoDensity: true, roundPixels: true });
host.appendChild(app.canvas);
bindPointer(app.canvas);

const world = new Container();
const uiLayer = new Container();
app.stage.addChild(world, uiLayer);

let layout: Layout;
let scene: Scene;
let ysort: Container;
let fx: Container;
let tether: Graphics;
let cfgKey = "";
let lastCfg: OfficeConfig | null = null;
let layoutKey = "";
let fitKey = "";
let curBands: number | null = null;
let state: OfficeState = { sessions: {}, agents: {}, queue: [], log: [], nextId: 1, pending: {} };
let themeName = "default";
let themeOverride: string | null = null; // set from the settings popover; wins over the daemon theme
let hoverId: string | null = null;
let liveIds = new Set<string>();
let boardText: string[] = [];
let seatStates = new Map<string, SeatState>(); // shared with the scene; `working` is refreshed per frame, no allocation
const bindings: { key: string; id: string }[] = [];
const links: [string, string][] = []; // [child, parent] pairs drawn as tethers
const running = new Set<string>(); // ids with a tool in flight (state.doing)
const cursor = newCursor();
const actors = new Map<string, Actor>();
const meta = new Map<string, { role: string; type: string; name: string; session: string }>();
const lastBusy = new Map<string, number>();
const visitors = new Map<string, number>(); // target id -> visits so far, rotates where visitors stand
const blocked = new Map<string, { until: number; session: string }>();
const huddling = new Map<string, number>();
const strolled = new Map<string, number>();
const seenConflicts = new Set<string>();
const particles: { s: Sprite; vx: number; vy: number; life: number; max: number; g: number }[] = [];
const sparks: { g: Graphics; life: number }[] = [];
const GOLD = 0xffe08a;

const route = (a: Tile, b: Tile) => findPath(layout, a, b);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const nextSlot = (id: string) => { const n = visitors.get(id) ?? 0; visitors.set(id, n + 1); return n; };
const nameOf = (id: string) => meta.get(id)?.name ?? actors.get(id)?.label ?? id.replace(/^lead:/, "");
const gold = (a: Actor) => { if (a.lead && a.alert !== "blocked") a.tag.style.fill = GOLD; };
const nearOf = (t: Actor) => standNear(layout, t.home ?? t.tile(), nextSlot(t.id));

const fitScale = (l: Layout, W: number, H: number) => {
  const sc = Math.min(W / (l.cols * T), H / (l.rows * T));
  return Math.floor(sc * 8) / 8; // fine steps: use the window, art stays nearest-filtered
};

/** Band count with the biggest zoom, but sticky: only switch for a clear gain (#44). Cheap when nothing relevant changed. */
function chooseLayout(force = false) {
  if (!lastCfg) return;
  const W = app.screen.width, H = app.screen.height - TOP;
  const lobbySlots = Math.max(4, Object.keys(state.sessions).length);
  const fk = `${cfgKey}|${lobbySlots}|${W}x${H}`;
  if (fk === fitKey && !force) return;
  fitKey = fk;
  const bands = pickBands([1, 2, 3].map((b) => fitScale(buildLayout(lastCfg!, { bands: b, lobbySlots }), W, H)), curBands);
  const key = `${cfgKey}|${bands}|${lobbySlots}`;
  if (key === layoutKey && !force) return;
  curBands = bands;
  layoutKey = key;
  relayout(buildLayout(lastCfg, { bands, lobbySlots }));
}

/** Swap the floor plan but keep the people and their scripts: only stale walk targets are dropped and re-routed home (#42). */
function relayout(l: Layout) {
  for (const a of actors.values()) a.c.parent?.removeChild(a.c);
  scene?.destroy();
  world.removeChildren().forEach((c) => c.destroy({ children: true }));
  for (const p of particles) if (!p.s.destroyed) p.s.destroy();
  particles.length = 0;
  sparks.length = 0;
  layout = l;
  ysort = new Container();
  ysort.sortableChildren = true;
  fx = new Container();
  scene = new Scene(layout, world, ysort, uiLayer); // also registers the roles (setRoles)
  tether = new Graphics();
  fx.addChild(tether);
  world.addChild(fx);
  for (const [id, a] of actors) {
    ysort.addChild(a.c);
    a.door = layout.door;
    a.path = [];
    const m = meta.get(id);
    if (m) a.look = lookFor(m.role, id, a.lead); // role set or theme may have changed (#63/#71)
    // tile targets belong to the old plan: drop walks, keep speech/waits/exit; the actor re-routes from where it stands
    if (a.cur?.k === "walk") a.cur = null;
    if (a.cur?.k === "exit") { a.cur = null; a.steps.unshift({ k: "exit" }); }
    a.steps = a.steps.filter((s) => s.k !== "walk");
  }
  scene.setSeats(seatStates);
}

// ---- particles ----------------------------------------------------------------------------------

function burst(x: number, y: number, n: number, colors: number[], spread = 30, up = 40) {
  if (!burstAllowed()) return;
  for (let i = 0; i < n; i++) {
    const s = new Sprite(whiteTex());
    s.tint = colors[i % colors.length];
    s.scale.set(1 + (i % 2));
    s.position.set(x, y);
    fx.addChild(s);
    const a = Math.random() * Math.PI * 2;
    particles.push({ s, vx: Math.cos(a) * spread * Math.random(), vy: -up * (0.5 + Math.random()), life: 0, max: 0.8 + Math.random() * 0.6, g: 110 });
  }
}
const puff = (x: number, y: number) => {
  if (!burstAllowed()) return;
  const s = new Sprite(whiteTex());
  s.tint = 0xe8ecff;
  s.alpha = 0.7;
  s.scale.set(2);
  s.position.set(x + (Math.random() - 0.5) * 3, y);
  fx.addChild(s);
  particles.push({ s, vx: (Math.random() - 0.5) * 3, vy: -9, life: 0, max: 1.4, g: 0 });
};

// ---- actors ---------------------------------------------------------------------------------------

function ensure(id: string, label: string, role: string, lead: boolean, home: Tile, seated: boolean): Actor {
  let a = actors.get(id);
  if (!a) {
    a = new Actor(id, label, lookFor(role, id, lead), lead, layout.door, home, route, layout.door, ysort, uiLayer);
    const act = a;
    gold(act);
    act.c.on("pointertap", () => { if (!camera.dragged) office.select(office.selected === id ? null : id); });
    act.c.on("pointerover", () => { hoverId = id; act.setHover(true); });
    act.c.on("pointerout", () => { if (hoverId === id) hoverId = null; act.setHover(false); });
    act.setSelected(office.selected === id);
    actors.set(id, a);
  }
  a.leaving = false;
  a.setLabel(label);
  a.setHome(home, seated);
  return a;
}

function queueTileFor(role: string, rank: number): Tile {
  const z = layout.zones.find((z) => z.role === role) ?? layout.zones[layout.zones.length - 1];
  return z.queue[Math.min(rank, z.queue.length - 1)];
}

function syncActors() {
  bindings.length = 0;
  links.length = 0;
  running.clear();
  seatStates = new Map();
  const live = new Set<string>();
  const kids = new Map<string, string[]>();
  const sessions = Object.values(state.sessions).sort((a, b) => a.startedAt - b.startedAt);

  sessions.forEach((s, i) => {
    const idx = Math.min(i, layout.lobby.length - 1);
    const id = leadId(s.id);
    live.add(id);
    blocked.delete(id);
    meta.set(id, { role: "lead", type: "lead", name: s.project, session: s.id });
    const a = ensure(id, s.project, "lead", true, layout.lobby[idx], true);
    if (s.busyAt) a.busyAt = Math.max(a.busyAt, s.busyAt);
    const key = `lobby#${idx}`;
    seatStates.set(key, { used: true, working: false });
    bindings.push({ key, id });
    if (s.doing) running.add(id);
    if (s.busyAt && lastBusy.get(id) !== s.busyAt) {
      lastBusy.set(id, s.busyAt);
      if (s.doing) a.tool(clip(`${s.doing}${s.detail ? " " + s.detail : ""}`, 44));
    }
    if (s.waiting && a.emote?.e !== "exclaim") a.showEmote("exclaim", 3000);
    if (s.waiting && s.waitingText && !a.speech) a.speak(s.waitingText, "say", 5000);
  });

  const qseen: Record<string, number> = {};
  for (const ag of Object.values(state.agents)) {
    live.add(ag.id);
    blocked.delete(ag.id);
    const name = ag.role === "guest" ? ag.agentType.replace(/^.*:/, "") : ag.seat?.name ?? `${ag.role} (queued)`;
    meta.set(ag.id, { role: ag.role, type: ag.agentType, name, session: ag.session });
    let home: Tile, seated = true;
    if (ag.seat) home = seatTile(layout, ag.seat.id);
    else { home = queueTileFor(ag.role, (qseen[ag.role] = (qseen[ag.role] ?? -1) + 1)); seated = false; }
    const a = ensure(ag.id, name, ag.role, false, home, seated);
    a.queued = !ag.seat;
    if (ag.busyAt) a.busyAt = Math.max(a.busyAt, ag.busyAt);
    if (ag.seat) { seatStates.set(ag.seat.id, { used: true, working: false }); bindings.push({ key: ag.seat.id, id: ag.id }); }
    if (ag.doing) running.add(ag.id);
    if (!a.queued) {
      links.push([ag.id, ag.parent]);
      (kids.get(ag.parent) ?? kids.set(ag.parent, []).get(ag.parent)!).push(name);
    }
    if (ag.busyAt && lastBusy.get(ag.id) !== ag.busyAt) {
      lastBusy.set(ag.id, ag.busyAt);
      if (ag.doing) a.tool(clip(`${ag.doing}${ag.detail ? " " + ag.detail : ""}`, 44));
    }
  }
  // lead "waiting on <names>" (#85)
  for (const s of sessions) {
    const id = leadId(s.id), n = kids.get(id), a = actors.get(id)!;
    const want = n ? `${s.project}\nwaiting on ${clip(n.slice(0, 2).join(", ") + (n.length > 2 ? ` +${n.length - 2}` : ""), 22)}` : s.project;
    if (a.label !== want) { a.setLabel(want); gold(a); }
  }
  liveIds = live;
  scene.setSeats(seatStates);
}

function departing() {
  for (const [id, a] of actors) {
    if (liveIds.has(id) || a.leaving || blocked.has(id)) continue;
    a.leaving = true;
    a.seated = false;
    a.path = [];
    a.cur = null;
    a.steps = [{ k: "exit" }];
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
      t?.speak(a.text, "user", 5000, "prompt");
      t?.showEmote("exclaim", 1500);
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
      f.queue({ k: "walk", to: nearOf(t) }, { k: "face", toward: t.pos }, { k: "say", text: a.text, kind: "say", badge: a.badge });
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
        const near = nearOf(t);
        f.queue({ k: "walk", to: near }, { k: "face", toward: t.pos });
        f.queue({ k: "say", text: a.text, kind: "report", badge: "report", emote: "check", ms: Math.min(4500, 1400 + a.text.length * 35) });
        t.showEmote("check", 2500);
        burst(feet(near).x, feet(near).y - 14, 10, [0x5be37d, 0xffe08a, 0x8fd0ff]);
      }
      f.queue({ k: "exit" });
      break;
    }
    case "block": {
      const f = actors.get(a.id);
      if (!f) break;
      blocked.set(a.id, { until: now + BLOCK_HOLD_MS, session: meta.get(a.id)?.session ?? "" });
      f.leaving = false;
      f.setAlert("blocked");
      f.speak(a.text, "blocked", 6000, "report");
      const lead = a.by ? actors.get(a.by) : undefined;
      if (lead && lead !== f) { lead.trim(3); lead.queue({ k: "walk", to: nearOf(f) }, { k: "face", toward: f.pos }); }
      break;
    }
    case "celebrate": {
      const f = actors.get(a.id);
      if (!f) break;
      f.showEmote("check", 2500);
      burst(f.pos.x, f.pos.y - 16, 22, [0xff6b6b, 0xffd84a, 0x5be37d, 0x6bb8ff, 0xd58cff], 45, 55);
      break;
    }
    case "spark": {
      const p = actors.get(a.a), q = actors.get(a.b);
      if (!p || !q) break;
      const [ax, ay, bx, by] = [p.pos.x, p.pos.y - 8, q.pos.x, q.pos.y - 8], mx = (ax + bx) / 2, my = (ay + by) / 2;
      const g = new Graphics().moveTo(ax, ay).lineTo(mx + 4, my - 4).lineTo(mx - 4, my + 4).lineTo(bx, by).stroke({ width: 1.5, color: 0xffd84a });
      fx.addChild(g);
      sparks.push({ g, life: 0 });
      burst(mx, my, 6, [0xffd84a, 0xff8a3d], 20, 20);
      break;
    }
    case "stroll": {
      const f = actors.get(a.id);
      const d = layout.decor.find((x) => x.kind === a.where) ?? layout.decor.find((x) => x.kind === "coffee");
      if (!f || !d) break;
      strolled.set(a.id, now);
      f.idleStroll(standNear(layout, d, nextSlot(d.kind)), 5000);
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

/** Labeled idle ambient: one quiet seated agent at a time, never during alerts or reduced motion (#83). */
function maybeStroll(now: number) {
  if (document.hidden || !layout || office.getEnvelope() === null || actors.size === 0) return;
  for (const a of actors.values()) if (a.alert) return;
  if (isReduced()) return;
  const cands = [];
  for (const [id, a] of actors) {
    const ag = state.agents[id];
    if (!ag || !ag.seat || a.leaving || !a.sitting || a.steps.length || running.has(id)) continue;
    cands.push({ id, lastActive: Math.max(a.busyAt, ag.seatedAt ?? 0, ag.startedAt ?? 0), strolledAt: strolled.get(id) ?? 0 });
  }
  const p = pickStroller(cands, now);
  if (p) exec({ k: "stroll", ...p }, now);
}
const isReduced = () => !burstAllowed(); // burstAllowed() is exactly !reducedMotion

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
  for (const p of particles) if (!p.s.destroyed) p.s.destroy();
  particles.length = 0;
  for (const s of sparks) s.g.destroy();
  sparks.length = 0;
  huddling.clear();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && layout) fastForward(); });

// ---- theme --------------------------------------------------------------------------------------------------

async function setTheme(name: string) {
  themeName = name;
  let t: Theme | null = THEMES[name] ?? null;
  if (!t) {
    try {
      const r = await fetch(`/themes/${encodeURIComponent(name)}.json`, { credentials: "same-origin" });
      if (r.ok) t = parseTheme(await r.json());
    } catch { /* offline or missing: built-in theme */ }
  }
  if (themeName !== name) return; // superseded while fetching
  applyTheme(t ?? DEFAULT_THEME);
  chooseLayout(true); // rebuild the scene; relayout refreshes every actor's look
}

// ---- snapshot ------------------------------------------------------------------------------------------------

function onEnvelope(env: Envelope) {
  const r = advance(cursor, env);
  if (!r) return; // not newer than what we have
  if (r.fresh) {
    // first snapshot or daemon restart: per-epoch caches must not outlive the epoch
    meta.clear(); lastBusy.clear(); visitors.clear(); huddling.clear(); strolled.clear(); seenConflicts.clear();
  }
  const k = JSON.stringify(env.config);
  if (k !== cfgKey) { cfgKey = k; lastCfg = env.config; } // a config change re-lays out; it never touches the log cursor
  state = env.state;
  const th = themeOverride ?? env.theme ?? "default";
  if (th !== themeName) void setTheme(th);
  chooseLayout();
  syncActors();
  const now = Date.now(), hidden = document.hidden;

  for (const it of r.items) {
    if (!hidden) for (const a of planInteraction(it, ctx)) exec(a, now);
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
  const al = alertsFor(state, blocked.keys(), leadId);
  for (const a of actors.values()) {
    const before = a.alert;
    a.setAlert(al.get(a.id) ?? null);
    if (a.alert !== before) gold(a);
  }
  const lines = boardLines(state.tasks);
  if (lines.join("\n") !== boardText.join("\n")) boardText = lines;
  // prune per-actor maps of everything that left (#40)
  for (const m of [meta, lastBusy, visitors, huddling, strolled] as Map<string, unknown>[])
    for (const id of m.keys()) if (!actors.has(id) && !liveIds.has(id)) m.delete(id);
  publish(env);
}

// ---- frame loop --------------------------------------------------------------------------------------------

let steamT = 0;
let vw = -1, vh = -1, viewAt = 0, viewDirty = false;
app.ticker.add((tk) => {
  if (!layout) return;
  const dt = Math.min(0.1, tk.deltaMS / 1000), now = Date.now();
  const W = app.screen.width, H = app.screen.height - TOP;
  if (W !== vw || H !== vh) { vw = W; vh = H; viewAt = now; viewDirty = true; }
  if (viewDirty && now - viewAt >= RESIZE_DEBOUNCE_MS) {
    viewDirty = false;
    chooseLayout();
    if (lastCfg) syncActors();
  }
  const target = camera.follow ? actors.get(camera.follow)?.pos : null;
  if (camera.follow && !target) camera.setFollow(null);
  const v = camera.view(fitScale(layout, W, H), W, H, TOP, layout.cols * T, layout.rows * T, target, dt);
  world.scale.set(v.sc);
  world.position.set(v.ox, v.oy);

  for (const [id, a] of actors) {
    a.working = !a.queued && isWorking(running.has(id), a.busyAt, now);
    a.update(dt, now);
    a.syncUi(v.ox, v.oy, v.sc);
    if (a.gone) {
      a.destroy();
      actors.delete(id);
      blocked.delete(id);
      if (office.selected === id) office.select(null);
    }
  }
  layoutBubbles(actors.values());
  for (const b of bindings) { const st = seatStates.get(b.key); if (st) st.working = !!actors.get(b.id)?.working; }
  scene.tick(now, v.ox, v.oy, v.sc, boardText);

  // tethers: lead -> active children (faint), plus the hovered/selected actor's parent chain (stronger)
  tether.clear();
  for (const [c, p] of links) {
    const a = actors.get(c), b = actors.get(p);
    if (a && b && !a.leaving) tether.moveTo(b.pos.x, b.pos.y - 8).lineTo(a.pos.x, a.pos.y - 8);
  }
  tether.stroke({ width: 0.8, color: 0xffffff, alpha: 0.18 });
  const fid = office.selected ?? hoverId;
  if (fid) {
    const chain = [fid, ...parentChain(state, fid)];
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = actors.get(chain[i]), b = actors.get(chain[i + 1]);
      if (a && b) tether.moveTo(b.pos.x, b.pos.y - 8).lineTo(a.pos.x, a.pos.y - 8);
    }
    tether.stroke({ width: 1.5, color: 0x9ad7f5, alpha: 0.85 });
  }

  steamT += dt;
  if (steamT > 0.35) { steamT = 0; puff(scene.coffee.x, scene.coffee.y); }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    p.vy += p.g * dt;
    p.s.x += p.vx * dt;
    p.s.y += p.vy * dt;
    p.s.alpha = Math.max(0, 1 - p.life / p.max);
    if (p.life >= p.max) { p.s.destroy(); particles.splice(i, 1); }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life += dt;
    s.g.alpha = Math.max(0, 1 - s.life / 1.8);
    if (s.life >= 1.8) { s.g.destroy(); sparks.splice(i, 1); }
  }
});

// 1 Hz housekeeping: nothing here needs a snapshot to arrive
setInterval(() => {
  const now = Date.now();
  if (!layout) return;
  releaseBlocked(now);
  maybeStroll(now);
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
  prevSel = id;
});
addEventListener("keydown", (e) => { if (e.key === "Escape") office.select(null); });

hooks.canvas = () => app.canvas;
hooks.pulse = (id) => actors.get(id)?.hopNow();
hooks.ingest = onEnvelope;
hooks.setTheme = (n) => { themeOverride = n || null; void setTheme(n || office.getEnvelope()?.theme || "default"); };
hooks.applyTextScale = (n) => { setTextScale(n); for (const a of actors.values()) a.refreshText(); };
hooks.sessions = (): SessionInfo[] =>
  Object.values(state.sessions).map((s) => ({
    id: s.id, lead: leadId(s.id), project: s.project, cwd: s.cwd, branch: s.branch, gaps: s.gaps ?? 0, recovered: !!s.recovered,
    usage: s.usage, waiting: s.waiting, startedAt: s.startedAt, agents: Object.values(state.agents).filter((a) => a.session === s.id).length,
  }));
hooks.actors = (): ActorInfo[] => {
  const out: ActorInfo[] = [];
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
      parent: ag?.parent, children: childrenOf(state, id).map((c) => c.id), chain: parentChain(state, id),
      ...(held ? { outcome: "blocked" as const } : {}),
    });
  }
  return out;
};

bindUi();
connect(liveIn, setConnection, office.source.private);
