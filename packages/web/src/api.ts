// Public client API for UI chrome (side panel, legend, alerts, recording, replay, settings).
// main.ts owns the scene and fills `hooks`; chrome code only imports `office` from here and never touches pixi.
//
//   office.getEnvelope()        last accepted snapshot {epoch, rev, privacy, configError?, state, config} | null
//   office.subscribe(fn)        fn(envelope) after each accepted snapshot (stale/equal rev are dropped); returns unsubscribe
//   office.actors()             ActorInfo[]: id, label, role, session, project, status (working|thinking|queued|waiting|blocked|idle),
//                               lead, task, why, confidence ("guess" = attribution is ambiguous), doing, detail, cwd, branch,
//                               parent, children[], chain[] (ancestors nearest first), outcome ("blocked" while held)
//   office.sessions()           SessionInfo[]: one per lead: project, cwd, branch, gaps, recovered, usage, waiting, startedAt, agents
//   office.parentChain(id) / office.children(id)   ids
//   office.select(id|null), office.selected, office.onSelect(fn)   fn(id|null); selection is also drawn on the actor
//   office.focus(id)            camera follows that actor at >= 2x (office.camera.setFollow(null) stops)
//   office.camera               { zoomBy(factor), reset(), fitAll() (whole office; key 0), setFollow(id|null), get zoom }; manual drag/wheel/pinch/0/dblclick built in
//   office.feed                 FeedItem[] newest first (cap 100): kind prompt|delegate|report|message|done|conflict, from/to (names),
//                               text, t, outcome, confidence, possible (conflicts are flagged "possible"); office.onFeed(fn(item))
//   office.tasks()              state.tasks (pending|running|done|blocked, owner)
//   office.configError          {message, t} | undefined: office.json invalid, last good config still active
//   office.privacy              boolean: the daemon is blanking free text
//   office.setPresenter(on)     flag + camera auto-focuses the most recently active actor; office.presenter reads it
//   office.applyTextScale(n)    0.8..2, refreshes live text;  office.setReducedMotion(b)
//   office.connection           { state: "connecting"|"live"|"retrying", onChange(fn) }
//   office.snapshotCanvas()     the Pixi canvas (for MediaRecorder.captureStream / toBlob)
//   office.pulse(id)            hop the actor (feed click)
//   office.freeze               {on, held, set(on), toggle(), onChange(fn)}: while on, incoming snapshots are held (newest kept) and
//                               the panel/canvas keep the last applied state; set(false) applies the newest at once
//   office.source               pluggable data source: mode "live"|"demo"|"replay"; begin(mode) -> push(envelope)* -> end();
//                               onMode(fn), onLive(fn) (every live envelope, even while simulating), liveEnvelope(),
//                               private + setPrivate(b) (persists, reloads: the stream is reopened with ?private=1)
import { childrenOf, parentChain, type Task } from "@agent-office/core";
import { camera } from "./camera.ts";
import { frozen, settings, setFrozen } from "./settings.ts";
import { holder } from "./logic.ts";
import { store } from "./dom.ts";
import type { ConnState, Envelope } from "./net.ts";
import type { FeedItem, Status } from "./choreo.ts";

export type { FeedItem, Status, ConnState, Envelope };
export type ActorInfo = {
  id: string; label: string; role: string; session: string; project: string; status: Status; lead: boolean;
  task?: string; why?: string; confidence?: "exact" | "guess"; doing?: string; detail?: string; cwd?: string; branch?: string;
  parent?: string; children: string[]; chain: string[]; outcome?: "blocked";
};
export type SessionInfo = {
  id: string; lead: string; project: string; cwd?: string; branch?: string; gaps: number; recovered: boolean;
  usage?: { input: number; output: number; cacheRead: number; cacheCreate: number }; waiting: boolean; startedAt: number; agents: number;
};

/** Filled by main.ts. */
export const hooks = {
  actors: (): ActorInfo[] => [],
  sessions: (): SessionInfo[] => [],
  canvas: (): HTMLCanvasElement | null => null,
  applyTextScale: (_n: number) => {},
  pulse: (_id: string) => {},
  ingest: (_e: Envelope) => {},
};
export type Mode = "live" | "demo" | "replay";

let env: Envelope | null = null;
let selected: string | null = null;
let conn: ConnState = "connecting";
let presenter = false;
const subs = new Set<(e: Envelope) => void>();
const selSubs = new Set<(id: string | null) => void>();
const feedSubs = new Set<(i: FeedItem) => void>();
const connSubs = new Set<(s: ConnState) => void>();
let mode: Mode = "live";
let live: Envelope | null = null;
const modeSubs = new Set<(m: Mode) => void>();
const liveSubs = new Set<(e: Envelope) => void>();
const isPrivate = store.get("private") === "1" || new URLSearchParams(location.search).get("private") === "1";
const freezeSubs = new Set<() => void>();
const hold = holder<Envelope>(() => frozen.on);
/** The single gate into the engine: a frozen view keeps only the newest snapshot. */
const apply = (e: Envelope) => { if (hold.offer(e)) freezeSubs.forEach((f) => f()); else hooks.ingest(e); };
const on = <T,>(set: Set<T>, fn: T) => { set.add(fn); return () => void set.delete(fn); };

export const office = {
  getEnvelope: () => env,
  subscribe: (fn: (e: Envelope) => void) => on(subs, fn),
  actors: () => hooks.actors(),
  sessions: () => hooks.sessions(),
  parentChain: (id: string) => (env ? parentChain(env.state, id) : []),
  children: (id: string) => (env ? childrenOf(env.state, id).map((a) => a.id) : []),
  get selected() { return selected; },
  select(id: string | null) {
    if (id === selected) return;
    selected = id;
    selSubs.forEach((f) => f(id));
  },
  onSelect: (fn: (id: string | null) => void) => on(selSubs, fn),
  focus: (id: string) => camera.focus(id),
  camera: {
    zoomBy: (f: number) => camera.zoomBy(f),
    reset: () => camera.reset(),
    fitAll: () => camera.reset(),
    setFollow: (id: string | null) => camera.setFollow(id),
    get zoom() { return camera.zoom; },
  },
  feed: [] as FeedItem[],
  onFeed: (fn: (i: FeedItem) => void) => on(feedSubs, fn),
  tasks: (): Task[] => env?.state.tasks ?? [],
  get configError() { return env?.configError; },
  get privacy() { return !!env?.privacy; },
  get presenter() { return presenter; },
  setPresenter(on: boolean) {
    presenter = on;
    if (!on) camera.setFollow(null);
  },
  applyTextScale: (n: number) => hooks.applyTextScale(n),
  setReducedMotion: (b: boolean) => { settings.reducedMotion = b; },
  connection: {
    get state() { return conn; },
    onChange: (fn: (s: ConnState) => void) => on(connSubs, fn),
  },
  snapshotCanvas: () => hooks.canvas(),
  pulse: (id: string) => hooks.pulse(id),
  freeze: {
    get on() { return frozen.on; },
    get held() { return hold.n; },
    set(b: boolean) {
      if (b === frozen.on) return;
      setFrozen(b);
      const e = hold.take();
      if (!b && e) hooks.ingest(e);
      freezeSubs.forEach((f) => f());
    },
    toggle() { office.freeze.set(!frozen.on); },
    onChange: (fn: () => void) => on(freezeSubs, fn),
  },
  source: {
    get mode() { return mode; },
    get private() { return isPrivate; },
    setPrivate(b: boolean) {
      store.set("private", b ? "1" : "0");
      // the URL param wins over the stored flag, so it must go too or privacy can never turn off
      const u = new URL(location.href);
      u.searchParams.delete("private");
      if (b) u.searchParams.set("private", "1");
      history.replaceState(null, "", u);
      location.reload(); // shortcut: reload reopens the stream with ?private=1 and drops cached text; upgrade if replay state must survive
    },
    liveEnvelope: () => live,
    onLive: (fn: (e: Envelope) => void) => on(liveSubs, fn),
    onMode: (fn: (m: Mode) => void) => on(modeSubs, fn),
    begin(m: Mode) { office.freeze.set(false); mode = m; office.feed.length = 0; modeSubs.forEach((f) => f(m)); },
    push: apply,
    end() {
      hold.take();
      mode = "live";
      office.feed.length = 0;
      modeSubs.forEach((f) => f("live"));
      if (live) hooks.ingest(live);
    },
  },
};

// ---- main.ts only ----
export function publish(e: Envelope) {
  env = e;
  subs.forEach((f) => f(e));
}
export function pushFeed(i: FeedItem) {
  office.feed.unshift(i);
  office.feed.length = Math.min(office.feed.length, 100);
  feedSubs.forEach((f) => f(i));
}
/** Every envelope from the real stream; only reaches the engine while no simulation is active. */
export function liveIn(e: Envelope) {
  live = e;
  liveSubs.forEach((f) => f(e));
  if (mode === "live") apply(e);
}
export function setConnection(s: ConnState) {
  if (s === conn) return;
  conn = s;
  connSubs.forEach((f) => f(s));
}
export const isPresenter = () => presenter;
