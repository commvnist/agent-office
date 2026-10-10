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
  | { k: "huddle"; id: string; text: string; badge: Badge }
  | { k: "report"; from: string; to?: string; text: string }
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

const strip = (s: string) => s.replace(/^\s*(DONE|BLOCKED)\b:?\s*/i, "");

/** What one new interaction should look like. `guess` delegations carry the "guess" badge (#29). */
export function planInteraction(it: Interaction, c: PlanCtx): Action[] {
  switch (it.kind) {
    case "prompt":
      return c.has(it.to) ? [{ k: "user", id: it.to, text: it.text }] : [];
    case "delegate": {
      if (!c.has(it.to)) return [];
      const out: Action[] = [{ k: "notice", id: it.to, emote: "exclaim", ms: 2600, hop: true }];
      if (c.has(it.from) && it.text) {
        const badge: Badge = it.confidence === "guess" ? "guess" : "delegate";
        const burst = c.log.filter((x) => x.kind === "delegate" && x.from === it.from && !!x.text && x.t <= it.t && it.t - x.t <= HUDDLE_WINDOW_MS).length;
        out.push(burst >= 2 ? { k: "huddle", id: it.from, text: it.text, badge } : { k: "visit", from: it.from, to: it.to, text: it.text, badge });
      }
      return out;
    }
    case "report": {
      if (!c.has(it.from)) return [];
      const to = c.has(it.to) ? it.to : undefined;
      if (it.outcome === "blocked") return [{ k: "block", id: it.from, text: strip(it.text) || "Blocked.", by: to }];
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

/** Alerts per actor id: waiting sessions' leads, and agents held as blocked (#64/#80). */
export function alertsFor(s: OfficeState, blocked: Iterable<string>, leadOf: (session: string) => string): Map<string, Alert> {
  const m = new Map<string, Alert>();
  for (const x of Object.values(s.sessions)) if (x.waiting) m.set(leadOf(x.id), "waiting");
  for (const id of blocked) m.set(id, "blocked");
  return m;
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

/** Keep the current band count unless another beats it by `margin` (#44). `fits[i]` = scale for bands i+1. */
export function pickBands(fits: number[], cur: number | null, margin = 1.1): number {
  let best = 0;
  fits.forEach((sc, i) => { if (sc > fits[best] + 1e-6) best = i; });
  if (cur !== null && cur >= 1 && cur <= fits.length && fits[best] < fits[cur - 1] * margin) return cur;
  return best + 1;
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
