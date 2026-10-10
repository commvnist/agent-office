import { appendFileSync, existsSync, readFileSync, renameSync, statSync, chmodSync } from "node:fs";
import { emptyState, reduce, sweep, type OfficeConfig, type OfficeEvent, type OfficeState } from "@agent-office/core";

export const MAX_BYTES = 5 * 1024 * 1024;

/** Append a line (mode 0600); past `max` bytes the file moves to `<file>.1`, replacing the old backup. */
export function appendRotating(file: string, line: string, max = MAX_BYTES) {
  try { if (statSync(file).size > max) renameSync(file, file + ".1"); } catch { /* missing yet */ }
  const fresh = !existsSync(file);
  appendFileSync(file, line + "\n", { mode: 0o600 });
  if (fresh) try { chmodSync(file, 0o600); } catch { /* best effort on non-POSIX */ }
}

/** Stored events (oldest first) with t >= since, at most the last `limit`. Bad lines are skipped. */
export function loadEvents(file: string, since = 0, limit = 5000): OfficeEvent[] {
  const out: OfficeEvent[] = [];
  for (const f of [file + ".1", file]) {
    let text = "";
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      try {
        const e = JSON.parse(line);
        if (e && typeof e.t === "number" && typeof e.type === "string" && e.t >= since) out.push(e);
      } catch { /* skip */ }
    }
  }
  return out.slice(-limit);
}

/** Rebuild state from stored events, then sweep so sessions that went quiet do not resurrect. */
export function replay(cfg: OfficeConfig, events: OfficeEvent[], now: number, ttlMs: number): OfficeState {
  let s = emptyState();
  for (const e of events) s = reduce(cfg, s, e);
  return sweep(s, now, ttlMs, cfg).state;
}
