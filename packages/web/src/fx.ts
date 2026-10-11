// Feedback budget (rubric B11/B12): pure limiter every canvas juice call site goes through. No pixi, no DOM.
// take() returns the intensity to use: 1 full, 0.5 for flair repeated more than REPEAT_N times in a minute, 0 = drop it.

export type FxClass = "routine" | "milestone";
export const ROUTINE_MAX = 2, ROUTINE_WINDOW_MS = 500; // routine events: at most 2 start per 500 ms, so with one milestone a window never holds more than 3
export const MILESTONE_GAP_MS = 1500; // milestones (ship-it, confetti): their own budget, one per 1.5 s
export const REPEAT_N = 10, REPEAT_WINDOW_MS = 60_000; // identical flair beyond 10 repeats a minute plays at half strength

export class FxBudget {
  private routine: number[] = [];
  private lastMilestone = -Infinity;
  private seen = new Map<string, number[]>();

  take(cls: FxClass, key: string, now: number): number {
    if (cls === "milestone") {
      if (now - this.lastMilestone < MILESTONE_GAP_MS) return 0;
    } else {
      while (this.routine.length && now - this.routine[0] >= ROUTINE_WINDOW_MS) this.routine.shift();
      if (this.routine.length >= ROUTINE_MAX) return 0;
    }
    if (cls === "milestone") this.lastMilestone = now;
    else this.routine.push(now);
    let a = this.seen.get(key);
    if (!a) this.seen.set(key, (a = []));
    while (a.length && now - a[0] >= REPEAT_WINDOW_MS) a.shift();
    a.push(now);
    if (this.seen.size > 64) for (const [k, v] of this.seen) if (!v.length || now - v[v.length - 1] >= REPEAT_WINDOW_MS) this.seen.delete(k);
    return a.length > REPEAT_N ? 0.5 : 1;
  }
}

/** Scale a particle count by an intensity, keeping at least one pip when anything plays. */
export const scaled = (n: number, k: number) => (k <= 0 ? 0 : Math.max(1, Math.round(n * k)));
