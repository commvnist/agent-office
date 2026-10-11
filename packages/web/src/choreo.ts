// Pure choreography planner (no pixi, no DOM): decides what should happen; main.ts executes it.
// Everything is derived from state + timestamps; no text is invented, only hook-derived text is ever spoken.
import type { Interaction, OfficeState, Task } from "@agent-office/core";
import type { Alert, Badge } from "./actor.ts";
import { hash } from "./color.ts";

export const HUDDLE_WINDOW_MS = 4000;
export const WORKING_MS = 5000;

export type Action =
  | { k: "user"; id: string; text: string }
  | { k: "say"; id: string; text: string }
  | { k: "notice"; id: string; emote: "exclaim" | "check"; ms: number; hop?: boolean }
  | { k: "visit"; from: string; to: string; text: string; badge: Badge }
  | { k: "huddle"; id: string; text: string; badge: Badge; members: string[] }
  | { k: "report"; from: string; to?: string; text: string; partial?: boolean }
  | { k: "block"; id: string; text: string; by?: string }
  | { k: "celebrate"; id: string }
  | { k: "spark"; a: string; b: string; file: string }
  | { k: "stroll"; id: string; where: "coffee" | "couch"; with?: string };

export type PlanCtx = {
  has: (id: string) => boolean;
  /** id or name hint -> actor id */
  resolve: (hint: string) => string | undefined;
  /** recent interactions, ascending (state.log) */
  log: readonly Interaction[];
};

const strip = (s: string) => s.replace(/^\s*(DONE|BLOCKED|PARTIAL)\b:?\s*/i, "");

/** Untrusted display text: drop hook/envelope tags like <agent-message ...>, collapse blanks, clip (#F7). */
export function cleanText(s: string, max = 240): string {
  const t = s.replace(/<\/?[A-Za-z][^<>]{0,200}>/g, "").replace(/<\/?[A-Za-z][\w-]*(\s[^>]*)?$/, "").replace(/[ \t]+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** Make duplicate display names distinct: "name 1", "name 2" by start time then id; unique names stay as they are. */
export function uniqueNames(items: { id: string; name: string; t: number }[]): Map<string, string> {
  const by = new Map<string, typeof items>();
  for (const x of items) (by.get(x.name) ?? by.set(x.name, []).get(x.name)!).push(x);
  const out = new Map<string, string>();
  for (const [name, g] of by) {
    g.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    g.forEach((x, i) => out.set(x.id, g.length > 1 ? `${name} ${i + 1}` : name));
  }
  return out;
}

/** `dir` 1 = prefer stacking downward (lead plaques: up would cover their own desk); unset = nearest spot wins. */
export type Box = { x: number; y: number; w: number; h: number; pri?: number; dir?: 1; /** boxes of one owner never push each other (an agent's own flag and tag) */ own?: object };
export type Rect = { x: number; y: number; w: number; h: number };
/**
 * Vertical offsets that push overlapping label boxes (x = centre, y = top) clear of each other (#F1). Higher `pri` (alerts) places first and keeps its spot.
 * With a floor rect `r`, boxes are clamped first and stack inside it (down, or up from the edge); one that cannot fit sets `hide[i]` (caller shows a pip).
 */
export function stackLabels(boxes: Box[], r?: Rect, hide?: boolean[]): number[] {
  const dy = boxes.map(() => 0), placed: { l: number; rt: number; t: number; b: number; own?: object }[] = [];
  const order = boxes.map((_, i) => i).sort((a, b) => (boxes[b].pri ?? 0) - (boxes[a].pri ?? 0) || boxes[a].y - boxes[b].y || boxes[a].x - boxes[b].x);
  for (const i of order) {
    const k = boxes[i], c = r ? clampBox(k, r) : k, l = c.x - k.w / 2, rt = c.x + k.w / 2;
    const clash = (y: number) => placed.some((p) => (!k.own || p.own !== k.own) && l < p.rt && rt > p.l && y < p.b && y + k.h > p.t);
    // the lowest free spot at/below the start is always flush under a placed box (or the start); inside a floor also try flush above one
    const cand = [c.y];
    for (const p of placed) { cand.push(p.b + 1); if (r) cand.push(p.t - k.h - 1); }
    const cost = (y: number) => Math.abs(y - c.y) + (k.dir && y < c.y ? 2 * k.h : 0); // an upward spot only when it is much closer than any downward one
    const ok = cand.filter((y) => (r ? y >= r.y && y + k.h <= r.y + r.h : y >= c.y) && !clash(y)).sort((a, b) => cost(a) - cost(b) || a - b);
    if (!ok.length && hide) { hide[i] = true; continue; }
    const y = ok.length ? ok[0] : c.y;
    dy[i] = y - k.y;
    placed.push({ l, rt, t: y, b: y + k.h, own: k.own });
  }
  return dy;
}

/** Keep a box (x = centre, y = top) inside `r`; a box larger than `r` is centred on it. */
export function clampBox(b: Box, r: Rect): { x: number; y: number } {
  const fit = (c: number, size: number, lo: number, hi: number) => (size >= hi - lo ? (lo + hi) / 2 : Math.max(lo + size / 2, Math.min(hi - size / 2, c)));
  return { x: fit(b.x, b.w, r.x, r.x + r.w), y: fit(b.y + b.h / 2, b.h, r.y, r.y + r.h) - b.h / 2 };
}

/** Sit-down / stand-up body offsets: 3 steps of ~50ms from `cur` toward `target` (0 standing, 7 seated). */
export const DROPS = [0, 2, 5, 7];
export const stepDrop = (cur: number, target: number) => DROPS[Math.max(0, Math.min(3, DROPS.indexOf(cur) + Math.sign(target - cur)))];

/** Hop: 60ms anticipation squash, 240ms parabolic 4px arc (ease-out up, ease-in down), 100ms landing squash. `ms` = time since start. */
export const HOP_MS = 400;
export function hopPose(ms: number): { y: number; sy: number } {
  if (ms >= HOP_MS) return { y: 0, sy: 1 };
  if (ms < 60) return { y: 0, sy: 1 - 0.1 * (ms / 60) };
  if (ms < 300) { const u = (ms - 60) / 240; return { y: -4 * (1 - (2 * u - 1) ** 2), sy: ms < 100 ? 1.08 : 1 }; } // one stretched frame as the feet leave
  return { y: 0, sy: 0.88 + 0.12 * ((ms - 300) / 100) };
}

/** Emote / speech pop-in: scale 0.5 -> 1 with easeOutBack over 140ms. */
export function popScale(ms: number): number {
  const t = Math.max(0, Math.min(1, ms / 140)) - 1;
  return 0.5 + 0.5 * (1 + 2.70158 * t ** 3 + 1.70158 * t * t);
}

export const QUIRKS = ["stretch", "phone", "yawn"] as const;
/** Idle fidget at time `now` for a person with id hash `h`: one of 3 quirks for 1.5s every 12s, phase offset per person. */
export function quirkAt(now: number, h: number): (typeof QUIRKS)[number] | null {
  return (now + (h % 12000)) % 12000 < 1500 ? QUIRKS[((h >> 14) & 3) % 3] : null;
}

export type ToolIconName = "book" | "term" | "pencil" | "globe" | "arrow" | "lens";
/** Icon family for a tool name (first word of the bubble text); null = text only. */
export function toolIcon(text: string): ToolIconName | null {
  const w = text.trim();
  if (/^(bash|shell|powershell)/i.test(w)) return "term";
  if (/^(edit|write|multiedit|notebookedit)/i.test(w)) return "pencil";
  if (/^(grep|glob|ls)/i.test(w)) return "lens";
  if (/^(read|notebookread)/i.test(w)) return "book";
  if (/^(web|mcp__.*(fetch|search|browser))/i.test(w)) return "globe";
  if (/^(agent|task|delegate|sendmessage)/i.test(w)) return "arrow";
  return null;
}

export type ToolKind = "term" | "edit" | "read" | "web" | "other";
/** Monitor glyph class for a tool name (#102). */
export function toolKind(tool: string | undefined): ToolKind {
  if (!tool) return "other";
  if (/^(bash|shell|powershell)/i.test(tool)) return "term";
  if (/^(edit|write|multiedit|notebookedit)/i.test(tool)) return "edit";
  if (/^(read|grep|glob|ls|notebookread)/i.test(tool)) return "read";
  if (/^(web|mcp__.*(fetch|search|browser))/i.test(tool)) return "web";
  return "other";
}

const NIGHT: [number, number] = [0x0e1535, 0x1f2a5a], DUSK: [number, number] = [0xf0925a, 0xffd08a], DAY: [number, number] = [0x7ec8f5, 0xcdeaff];
const SKY: [number, [number, number]][] = [[0, NIGHT], [5, NIGHT], [6.5, DUSK], [8, DAY], [17, DAY], [18.5, DUSK], [20, NIGHT], [24, NIGHT]];
const lerp = (a: number, b: number, t: number) => {
  const c = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (c(16) << 16) | (c(8) << 8) | c(0);
};
/** Window sky colours for an hour 0..24, blended between night/dusk/day keyframes (#106). */
export function skyAt(hour: number): { top: number; bottom: number; night: boolean } {
  let i = 1;
  while (i < SKY.length - 1 && SKY[i][0] <= hour) i++;
  const [h0, c0] = SKY[i - 1], [h1, c1] = SKY[i], t = Math.max(0, Math.min(1, (hour - h0) / (h1 - h0)));
  return { top: lerp(c0[0], c1[0], t), bottom: lerp(c0[1], c1[1], t), night: hour < 5.5 || hour >= 19.5 };
}

/** What one new interaction should look like. `guess` delegations carry the "guess" badge (#29). */
export function planInteraction(it: Interaction, c: PlanCtx): Action[] {
  switch (it.kind) {
    case "prompt":
      return c.has(it.to) ? [{ k: "user", id: it.to, text: it.text }] : [];
    case "delegate": {
      if (!c.has(it.to)) return [];
      const out: Action[] = [{ k: "notice", id: it.to, emote: "exclaim", ms: 2600, hop: !c.has(it.from) }]; // with a sender the ticket's arrival hops instead
      if (c.has(it.from) && it.text) {
        const badge: Badge = it.confidence === "guess" ? "guess" : "delegate";
        const burst = c.log.filter((x) => x.kind === "delegate" && x.from === it.from && !!x.text && x.t <= it.t && it.t - x.t <= HUDDLE_WINDOW_MS);
        const members = [...new Set(burst.map((x) => x.to))].filter((id) => id !== it.from && c.has(id));
        out.push(burst.length >= 2 ? { k: "huddle", id: it.from, text: it.text, badge, members } : { k: "visit", from: it.from, to: it.to, text: it.text, badge });
      }
      return out;
    }
    case "report": {
      if (!c.has(it.from)) return [];
      const to = c.has(it.to) ? it.to : undefined;
      if (it.outcome === "blocked") return [{ k: "block", id: it.from, text: strip(it.text) || "Blocked.", by: to }];
      // "partial" comes from core's Outcome once implementer C lands it; cast keeps this compiling either way
      if ((it.outcome as string) === "partial") return [{ k: "report", from: it.from, to, text: strip(it.text) || "Partly done.", partial: true }];
      return [{ k: "report", from: it.from, to, text: strip(it.text) || "Done." }];
    }
    case "message": {
      const target = c.resolve(it.to);
      // The lead talking to the person watching (its own narration or a task note): a bubble at its desk, no visit.
      if (c.has(it.from) && it.text && (it.to === "user" || !target)) return [{ k: "say", id: it.from, text: it.text }];
      if (!c.has(it.from) || !target || target === it.from || !it.text) return [];
      return [{ k: "visit", from: it.from, to: target, text: it.text, badge: "message" }, { k: "notice", id: target, emote: "exclaim", ms: 2000 }];
    }
    case "done":
      return c.has(it.from) ? [{ k: "celebrate", id: it.from }] : [];
  }
}

export type Ticket = { from: string; to: string; kind: "send" | "done" | "blocked" | "partial" };
/** The paper ticket a delegation or report sends along the lead<->agent line, or null when an end is not on the floor. */
export function ticketFor(it: Interaction, c: PlanCtx): Ticket | null {
  if (!c.has(it.from) || !c.has(it.to)) return null;
  if (it.kind === "delegate") return { from: it.from, to: it.to, kind: "send" };
  if (it.kind !== "report") return null;
  return { from: it.from, to: it.to, kind: it.outcome === "blocked" ? "blocked" : (it.outcome as string) === "partial" ? "partial" : "done" };
}

export const easeInOutSine = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;
export const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
/** Arrival squash: scaleY 0.7 -> 1 over 180ms with easeOutBack. */
export const SQUASH_MS = 180;
export const squashY = (ms: number) => (ms >= SQUASH_MS ? 1 : 0.7 + 0.3 * easeOutBack(Math.max(0, ms) / SQUASH_MS));
/** Error jitter: +-1px, 4 frames of 100ms, then rest. */
export const JITTER_MS = 400;
export const jitterX = (ms: number) => (ms >= JITTER_MS ? 0 : Math.floor(ms / 100) % 2 ? -1 : 1);
/** Ticket flight: progress 0..1 over `ms`; every ticket flies the whole way (a stalled one read as litter on the floor). */
export const TICKET_MS = 500;
export const ticketT = (ms: number) => easeInOutSine(Math.min(1, ms / TICKET_MS));
/**
 * Where a ticket ends. A delegation lands on the recipient's desk only when they are seated at a real desk tile;
 * a queued/deskless recipient (home = waiting-row floor tile) gets it at their own position, so it never rests on bare floor.
 * `feetOf` maps a tile to its bottom-centre in art px.
 */
const AT_DESK_PX = 12; // art px from the desk's feet that counts as "seated there"
export function ticketEnd(
  kind: Ticket["kind"] | "spark",
  b: { home: { x: number; y: number } | null; seated: boolean; pos: { x: number; y: number } },
  deskAt: (t: { x: number; y: number }) => boolean,
  feetOf: (t: { x: number; y: number }) => { x: number; y: number },
) {
  if (kind === "send" && b.seated && b.home && deskAt(b.home)) {
    const d = feetOf(b.home);
    // only once the recipient is physically at the desk: a ticket must not land on an empty chair while they are still walking in
    if (Math.hypot(b.pos.x - d.x, b.pos.y - d.y) <= AT_DESK_PX) return { x: d.x, y: d.y - 4 };
  }
  return { x: b.pos.x, y: b.pos.y - 8 };
}
/** Seat spots (art px, feet) of a couch of `w` tiles at tile (x, y): one per tile, centred, 1px above the couch's bottom edge. */
export const couchSeats = (d: { x: number; y: number; w?: number }, tile: number) =>
  Array.from({ length: d.w ?? 1 }, (_, i) => ({ x: (d.x + i) * tile + tile / 2, y: (d.y + 1) * tile - 1 }));

/** Crowd LOD latch: on above 24 live agents, or heavy tag stacking (>8 displaced) from 18 up; off again below 18 (no flicker). */
export const crowdLod = (prev: boolean, agents: number, displaced: number) => (prev ? agents >= 18 : agents > 24 || (agents >= 18 && displaced > 8));

/** Alerts per actor id: waiting sessions' leads, and agents held as blocked (#64/#80). */
export function alertsFor(s: OfficeState, blocked: Iterable<string>, leadOf: (session: string) => string): Map<string, Alert> {
  const m = new Map<string, Alert>();
  for (const x of Object.values(s.sessions)) if (x.waiting) m.set(leadOf(x.id), "waiting");
  for (const id of blocked) m.set(id, "blocked");
  return m;
}

/** Ids whose alert is new or changed since `seen` (a transition, not every snapshot); `seen` is replaced by `cur`. */
export function newAlerts(seen: Map<string, Alert>, cur: Map<string, Alert>): string[] {
  const out: string[] = [];
  for (const [id, a] of cur) if (seen.get(id) !== a) out.push(id);
  seen.clear();
  for (const [id, a] of cur) seen.set(id, a);
  return out;
}

export type Status = "working" | "thinking" | "queued" | "waiting" | "blocked" | "idle";
/** blocked > waiting > queued > working > thinking > idle. `active` = has something to think about. */
export function statusOf(x: { blocked?: boolean; waiting?: boolean; queued?: boolean; working: boolean; active: boolean }): Status {
  return x.blocked ? "blocked" : x.waiting ? "waiting" : x.queued ? "queued" : x.working ? "working" : x.active ? "thinking" : "idle";
}

/** working = a tool is running (and not stale) or one started within WORKING_MS (#65). */
export const isWorking = (running: boolean, busyAt: number, now: number) =>
  (running && now - busyAt < 120_000) || now - busyAt < WORKING_MS; // shortcut: 2 min cap so a lost tool_end cannot type forever

const MARK: Record<Task["status"], string> = { pending: "o", running: ">", done: "+", blocked: "!" };
/** Whiteboard lines from state.tasks, newest first (#81). Marks are ASCII-safe and distinguishable without colour. */
export function boardLines(tasks: readonly Task[] | undefined, max = 6): string[] {
  const out: string[] = [];
  for (let i = (tasks?.length ?? 0) - 1; i >= 0 && out.length < max; i--) {
    const t = tasks![i];
    out.push(`${MARK[t.status] ?? "o"} ${t.owner ?? t.role}: ${t.text}`);
  }
  return out;
}

export type StrollCand = { id: string; lastActive: number; strolledAt: number; session?: string };
/** Idle ladder by real silence: 0 fidget (<6s), 1 micro-posture (<20s), 2 stroll (<60s), 3 drift to the lounge. */
export const idleTier = (silenceMs: number) => (silenceMs < 6000 ? 0 : silenceMs < 20_000 ? 1 : silenceMs < 60_000 ? 2 : 3);
/**
 * First seated agent idle for `idleMs` and not strolled within `cooldownMs` (#83). The ladder picks the place:
 * coffee at tier 2, the couch once silence passes a minute.
 */
export function pickStroller(c: readonly StrollCand[], now: number, idleMs = 20_000, cooldownMs = 60_000): { id: string; where: "coffee" | "couch" } | null {
  for (const x of c) {
    if (now - x.lastActive >= idleMs && now - x.strolledAt >= cooldownMs) return { id: x.id, where: idleTier(now - x.lastActive) >= 3 ? "couch" : "coffee" };
  }
  return null;
}
/** Chat partner at the coffee machine: another candidate of the SAME session who is equally idle and off cooldown; never across sessions. */
export function pickPartner(c: readonly StrollCand[], first: string, now: number, idleMs = 20_000, cooldownMs = 60_000): string | null {
  const a = c.find((x) => x.id === first);
  if (!a?.session) return null;
  return c.find((x) => x.id !== first && x.session === a.session && now - x.lastActive >= idleMs && now - x.strolledAt >= cooldownMs)?.id ?? null;
}

/** Micro-posture while seated and quiet (tier 1): one 5s slot per person phase; the first 1.5s of a slot may carry a look-left/right or a lean. */
export const MICRO_SLOT_MS = 5000;
export const microSlot = (now: number, h: number) => Math.floor((now + (h % MICRO_SLOT_MS)) / MICRO_SLOT_MS);
export function microPose(now: number, h: number): "look-l" | "look-r" | "lean" | null {
  if ((now + (h % MICRO_SLOT_MS)) % MICRO_SLOT_MS >= 1500) return null;
  const k = ((h ^ Math.imul(microSlot(now, h), 2654435761)) >>> 0) % 5;
  return k === 0 ? "look-l" : k === 1 ? "look-r" : k === 2 ? "lean" : null;
}

/** Walk yielding: a lower id just ahead of the walker's next step holds it; at most YIELD_MAX_MS, then it slips past for SLIP_MS (no deadlock). */
export const YIELD_MAX_MS = 1500, SLIP_MS = 1000;
type P = { id: string; pos: { x: number; y: number } };
export const yieldsTo = (a: P, n: { x: number; y: number }, o: P) =>
  o.id < a.id && Math.hypot(o.pos.x - a.pos.x, o.pos.y - a.pos.y) < 10 && (o.pos.x - a.pos.x) * (n.x - a.pos.x) + (o.pos.y - a.pos.y) * (n.y - a.pos.y) > 0;
/** Next held-time counter; it rearms (0) after the slip window. */
export const stepHold = (held: number, want: boolean, ms: number) => (!want ? 0 : held + ms > YIELD_MAX_MS + SLIP_MS ? 0 : held + ms);
export const holds = (held: number, want: boolean) => want && held <= YIELD_MAX_MS;
/** Door token: one arrival at a time, and anyone leaving has right of way. `a` is at the door; `o` walks near it. */
export const doorHold = (a: P, o: P & { leaving: boolean }, door: { x: number; y: number }, r: number) => {
  if (o.id === a.id || Math.hypot(a.pos.x - door.x, a.pos.y - door.y) > r * 0.6) return false;
  const d = Math.hypot(o.pos.x - door.x, o.pos.y - door.y);
  return o.leaving ? d < r : o.id < a.id && d < r * 0.6;
};

/** Delegation tether: full while the ticket flies, then a 600ms fade (events only; nothing persists). */
export const TETHER_FADE_MS = 600;
export const tetherAlpha = (lifeMs: number) => (lifeMs < TICKET_MS ? 1 : Math.max(0, 1 - (lifeMs - TICKET_MS) / TETHER_FADE_MS));

/** Desk load step from tool calls in the last 30s: 0 idle, 1 light, 2 busy, 3 heavy. */
export const loadLevel = (n: number): 0 | 1 | 2 | 3 => (n <= 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : 3);

/** Per-session identity hue 0..359 that skips red (0-20), gold (40-60) and cyan (170-200): maps onto the 290 degrees left. */
const HUE_BANDS: [number, number][] = [[20, 40], [60, 170], [200, 360]];
export function sessionHue(id: string): number {
  let p = hash(id) % 290;
  for (const [lo, hi] of HUE_BANDS) { if (p < hi - lo) return lo + p; p -= hi - lo; }
  return 220;
}

/** Client shrink ratchet: built desks only grow at once; a trailing row decays after sitting unused for `holdMs`, one step per hold. */
export const SHRINK_HOLD_MS = 90_000;
export type Shrink = { floor: number; since: number };
export function shrinkFloor(s: Shrink, demand: number, used: number, now: number, rowDesks = 12, holdMs = SHRINK_HOLD_MS): number {
  const need = Math.max(demand, used);
  if (need >= s.floor) { s.floor = need; s.since = now; return need; }
  const start = (Math.ceil(s.floor / rowDesks) - 1) * rowDesks; // first desk of the trailing row
  if (used > start) s.since = now; // somebody sits in it: it stays
  else if (now - s.since >= holdMs) { s.floor = Math.max(need, start); s.since = now; }
  return s.floor;
}

export type FeedItem = {
  kind: Interaction["kind"] | "conflict";
  from: string;
  to: string;
  text: string;
  t: number;
  outcome?: Interaction["outcome"];
  /** delegate: attribution was a guess (several or no outstanding delegations matched). */
  confidence?: "exact" | "guess";
  /** conflict: heuristic, not proof. */
  possible?: boolean;
  /** Chrome helpers: grouping and click-to-select. */
  session?: string;
  fromId?: string;
  toId?: string;
};

export const feedItem = (it: Interaction, nameOf: (id: string) => string): FeedItem => ({
  kind: it.kind, from: it.kind === "prompt" ? "You" : nameOf(it.from), to: it.kind === "done" ? "" : nameOf(it.to), text: it.text, t: it.t,
  session: it.session, fromId: it.from, toId: it.to,
  ...(it.outcome ? { outcome: it.outcome } : {}), ...(it.confidence ? { confidence: it.confidence } : {}),
});

/** Overflow mover queue: FIFO, bounded; past the hard cap the oldest is dropped (cosmetic only: the visit itself already happened). */
export const MAX_QUEUED = 12;
export function pushCapped<T>(q: T[], x: T, max = MAX_QUEUED): void {
  q.push(x);
  if (q.length > max) q.splice(0, q.length - max);
}

/**
 * Mug state while seated, quiet and calm (idle tier 1, 6-20 s): "desk" = mug on the desk for the whole window,
 * "sip" = raised to the face for the first 3.5 s of a seeded 5 s slot. `still` (reduced motion / ambient paused) never sips.
 */
export function sipState(silenceMs: number, calm: boolean, still: boolean, now: number, h: number): "none" | "desk" | "sip" {
  if (!calm || idleTier(silenceMs) !== 1) return "none";
  if (still || (now + (h % MICRO_SLOT_MS)) % MICRO_SLOT_MS >= 3500) return "desk";
  return ((h ^ Math.imul(microSlot(now, h), 2654435761)) >>> 0) % 5 === 3 ? "sip" : "desk";
}

/** Ambient courier cadence: at most one per COURIER_GAP_MS, at a hash(period)-seeded moment of each period; never with an alert, a live one, or ambient off. */
export const COURIER_GAP_MS = 8 * 60_000;
export function courierDue(now: number, last: number, o: { live: boolean; alert: boolean; ambient: boolean }): boolean {
  if (o.live || o.alert || !o.ambient || now - last < COURIER_GAP_MS) return false;
  return now % COURIER_GAP_MS >= hash(`courier${Math.floor(now / COURIER_GAP_MS)}`) % (COURIER_GAP_MS / 2);
}

/** Courier vs walkers: wait for anyone within 2.2 tiles, ghost within 1 tile, so the two never read as overlapping. `walkers` are non-seated positions in art px. */
export function courierGuard(cx: number, cy: number, walkers: Iterable<{ x: number; y: number }>, tile: number): { wait: boolean; fade: boolean } {
  let wait = false, fade = false;
  for (const w of walkers) {
    const d = Math.hypot(w.x - cx, w.y - cy);
    if (d < tile * 2.2) wait = true;
    if (d < tile) fade = true;
  }
  return { wait, fade };
}

/** When a running tool earns the long-call arc: 3x that tool's own p95 in this session once 5 calls are known (never under 10 s), else 30 s. */
export const longToolMs = (st?: { n: number; p95: number }) => (st && st.n >= 5 ? Math.max(10_000, 3 * st.p95) : 30_000);
