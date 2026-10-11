// Follow mode (settings.follow = "busiest"): pure target pick + gating. main.ts owns the camera calls.
export const FOLLOW_PAUSE_MS = 15_000; // a manual pan/zoom/focus pauses following this long
export const BUSY_WINDOW_MS = 30_000; // "recent tool events" window

export type FollowCand = { id: string; hits: readonly number[] };

/** The candidate with the most tool events in the last BUSY_WINDOW_MS (ties: the most recent event); null when none has any. */
export function pickBusiest(c: Iterable<FollowCand>, now: number): string | null {
  let best: string | null = null, bn = 0, bl = -Infinity;
  for (const x of c) {
    let n = 0, last = -Infinity;
    for (const h of x.hits) if (now - h < BUSY_WINDOW_MS) { n++; if (h > last) last = h; }
    if (n > bn || (n === bn && n > 0 && last > bl)) { best = x.id; bn = n; bl = last; }
  }
  return best;
}

/** Following is on, nothing forbids camera motion (freeze, presenter takes the camera itself, reduced motion) and the viewer has been hands-off. */
export const followDue = (o: { mode: string; frozen: boolean; presenter: boolean; reduced: boolean; now: number; touched: number }) =>
  o.mode === "busiest" && !o.frozen && !o.presenter && !o.reduced && o.now - o.touched >= FOLLOW_PAUSE_MS;
