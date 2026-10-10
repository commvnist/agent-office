// Local simulation for sample data (#90) and replay (#33): events go through the core reducer; the engine sees envelopes.
// Pure (core only), so it is testable under node.
import { emptyState, reduce, type OfficeConfig, type OfficeEvent, type OfficeState } from "@agent-office/core";
import type { Envelope } from "./net.ts";

/** Used when the daemon never answered (no live config to borrow). */
export const FALLBACK_CFG: OfficeConfig = {
  roles: {
    architect: { agent: "architect", count: 1, names: ["Ada"] },
    backend: { agent: "backend-dev", count: 2, names: ["Dev", "Priya"] },
    frontend: { agent: "frontend-dev", count: 1, names: ["Maya"] },
    qa: { agent: "qa-engineer", count: 2, names: ["Quinn", "Sam"] },
  },
};

/** Cumulative event offsets (ms) with idle gaps capped, so a replay never sits still for minutes. */
export function virtualTimes(ts: number[], cap = 3000): number[] {
  const out: number[] = [];
  let v = 0;
  ts.forEach((t, i) => { if (i) v += Math.min(cap, Math.max(0, t - ts[i - 1])); out.push(v); });
  return out;
}

export class Playback {
  state: OfficeState = emptyState();
  idx = 0; // events applied so far
  readonly vt: number[];
  readonly cfg: OfficeConfig;
  readonly events: OfficeEvent[];
  constructor(cfg: OfficeConfig, events: OfficeEvent[], cap = 3000) {
    this.cfg = cfg;
    this.events = events;
    this.vt = virtualTimes(events.map((e) => e.t), cap);
  }
  get end() { return this.vt.length ? this.vt[this.vt.length - 1] : 0; }
  /** Number of events whose virtual time is <= v. */
  countAt(v: number) {
    let n = 0;
    while (n < this.vt.length && this.vt[n] <= v) n++;
    return n;
  }
  /** Apply events up to `to` (exclusive). Backwards re-reduces from scratch. Event times are rebased so the newest lands on `now`. */
  seek(to: number, now: number): OfficeState {
    to = Math.max(0, Math.min(this.events.length, to));
    if (to < this.idx) { this.state = emptyState(); this.idx = 0; }
    for (; this.idx < to; this.idx++) {
      this.state = reduce(this.cfg, this.state, { ...this.events[this.idx], t: now - (this.vt[to - 1] - this.vt[this.idx]) } as OfficeEvent);
    }
    return this.state;
  }
}

export function simEnvelope(state: OfficeState, config: OfficeConfig, epoch: string, rev: number, theme?: string): Envelope {
  return { schema: 1, version: "sim", epoch, rev, theme, privacy: false, state, config };
}

/** The scripted scenario (event shapes as in scripts/demo.mjs, already normalized). Times are offsets in ms. */
export function demoScript(): OfficeEvent[] {
  const out: OfficeEvent[] = [];
  let t = 0, n = 0;
  const at = (ms: number) => { t += ms; return t; };
  const ev = (ms: number, e: Record<string, unknown>) => out.push({ ...e, t: at(ms) } as OfficeEvent);
  const spawn = (s: string, id: string, type: string, text: string) => {
    ev(300, { type: "delegate", session: s, agentType: type, text, id: `d${++n}` });
    ev(200, { type: "agent_start", session: s, agentId: id, agentType: type });
  };
  const tool = (s: string, id: string | undefined, name: string, detail: string, why: string) => ev(900, { type: "tool", session: s, agentId: id, tool: name, detail, why, id: `t${++n}` });
  ev(0, { type: "session_start", session: "demo1", project: "shop-api", cwd: "/work/shop-api", branch: "main" });
  ev(700, { type: "session_start", session: "demo2", project: "landing-page", cwd: "/work/landing-page" });
  ev(1000, { type: "prompt", session: "demo1", text: "Add a discount-code field to checkout, with API support and tests" });
  tool("demo1", undefined, "Read", "src/checkout.ts", "Understand the current checkout flow");
  spawn("demo1", "arch", "architect", "Design discount code data model + endpoint");
  tool("demo1", "arch", "Read", "src/models/order.ts", "Check the order model");
  ev(1500, { type: "agent_stop", session: "demo1", agentId: "arch", message: "DONE: DiscountCode model, POST /checkout/discount, UI field" });
  spawn("demo1", "be1", "backend-dev", "Implement DiscountCode model and endpoint");
  spawn("demo1", "fe1", "frontend-dev", "Add discount-code input to CartSummary");
  spawn("demo1", "qa1", "qa-engineer", "Write API tests for the discount endpoint");
  spawn("demo2", "qa2", "qa-engineer", "Check the hero image sizes for LCP");
  for (let i = 0; i < 2; i++) {
    tool("demo1", "be1", "Edit", "src/discount.ts", "Add the validation rules");
    tool("demo1", "fe1", "Write", "web/CartSummary.tsx", "Create the input component");
    tool("demo1", "qa1", "Bash", "npm test -- discount", "Run the new tests");
  }
  ev(1200, { type: "waiting", session: "demo2", text: "Claude needs your permission to use WebFetch" });
  ev(3000, { type: "agent_stop", session: "demo1", agentId: "be1", message: "DONE: model + endpoint added, 4 files" });
  ev(1500, { type: "agent_stop", session: "demo1", agentId: "fe1", message: "DONE: field wired into CartSummary" });
  ev(1500, { type: "agent_stop", session: "demo1", agentId: "qa1", message: "BLOCKED: no test harness in the repo" });
  ev(1500, { type: "agent_stop", session: "demo2", agentId: "qa2", message: "DONE: use 1600w AVIF hero" });
  ev(1500, { type: "turn_end", session: "demo1" });
  ev(4000, { type: "session_end", session: "demo1" });
  ev(500, { type: "session_end", session: "demo2" });
  return out;
}
