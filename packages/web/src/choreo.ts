// Pure choreography planner (no pixi, no DOM): decides what should happen; main.ts executes it.
// Everything is derived from state + timestamps; no text is invented, only hook-derived text is ever spoken.
import type { Interaction, OfficeState, Task } from "@agent-office/core";
import type { Alert, Badge } from "./actor.ts";
import { hash } from "./color.ts";

export const HUDDLE_WINDOW_MS = 4000;
export const WORKING_MS = 5000;

export type Action =
  | { k: "user"; id: string; text: string }
  | { k: "notice"; id: string; emote: "exclaim" | "check"; ms: number; hop?: boolean }
  | { k: "visit"; from: string; to: string; text: string; badge: Badge }
  | { k: "huddle"; id: string; text: string; badge: Badge; members: string[] }
  | { k: "report"; from: string; to?: string; text: string; partial?: boolean }
  | { k: "block"; id: string; text: string; by?: string }
  | { k: "celebrate"; id: string }
  | { k: "spark"; a: string; b: string; file: string }
  | { k: "stroll"; id: string; where: "coffee" | "couch" };

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

export type Box = { x: number; y: number; w: number; h: number; pri?: number };
export type Rect = { x: number; y: number; w: number; h: number };
/**
 * Vertical offsets that push overlapping label boxes (x = centre, y = top) clear of each other (#F1). Higher `pri` (alerts) places first and keeps its spot.
 * With a floor rect `r`, boxes are clamped first and stack inside it (down, or up from the edge); one that cannot fit sets `hide[i]` (caller shows a pip).
 */
export function stackLabels(boxes: Box[], r?: Rect, hide?: boolean[]): number[] {
  const dy = boxes.map(() => 0), placed: { l: number; rt: number; t: number; b: number }[] = [];
  const order = boxes.map((_, i) => i).sort((a, b) => (boxes[b].pri ?? 0) - (boxes[a].pri ?? 0) || boxes[a].y - boxes[b].y || boxes[a].x - boxes[b].x);
  for (const i of order) {
    const k = boxes[i], c = r ? clampBox(k, r) : k, l = c.x - k.w / 2, rt = c.x + k.w / 2;
    const clash = (y: number) => placed.some((p) => l < p.rt && rt > p.l && y < p.b && y + k.h > p.t);
    // the lowest free spot at/below the start is always flush under a placed box (or the start); inside a floor also try flush above one
    const cand = [c.y];
    for (const p of placed) { cand.push(p.b + 1); if (r) cand.push(p.t - k.h - 1); }
    const ok = cand.filter((y) => (r ? y >= r.y && y + k.h <= r.y + r.h : y >= c.y) && !clash(y)).sort((a, b) => Math.abs(a - c.y) - Math.abs(b - c.y) || a - b);
    if (!ok.length && hide) { hide[i] = true; continue; }
    const y = ok.length ? ok[0] : c.y;
    dy[i] = y - k.y;
    placed.push({ l, rt, t: y, b: y + k.h });
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

export type StrollCand = { id: string; lastActive: number; strolledAt: number };
/** First seated agent idle for `idleMs` and not strolled within `cooldownMs`; the target alternates by hash (#83). */
export function pickStroller(c: readonly StrollCand[], now: number, idleMs = 20_000, cooldownMs = 60_000): { id: string; where: "coffee" | "couch" } | null {
  for (const x of c) {
    if (now - x.lastActive >= idleMs && now - x.strolledAt >= cooldownMs)
      return { id: x.id, where: hash(x.id + Math.floor(now / cooldownMs)) % 2 ? "couch" : "coffee" };
  }
  return null;
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
