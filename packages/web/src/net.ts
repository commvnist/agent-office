// Stream connection + the pure snapshot gate (epoch/rev/log cursor). Node-testable: nothing runs at import time.
import type { Interaction, OfficeConfig, OfficeState } from "@agent-office/core";

export type Envelope = {
  schema: number; version: string; epoch: string; rev: number; privacy?: boolean;
  configError?: { message: string; t: number };
  configWarning?: string;
  state: OfficeState; config: OfficeConfig;
};
export type Cursor = { epoch: string | null; rev: number; seen: number };
export const newCursor = (): Cursor => ({ epoch: null, rev: -1, seen: -1 });

/**
 * Gate one snapshot. null = not newer (same epoch, rev <= last): skip it.
 * `fresh` = first snapshot or daemon restart: caches must reset and history is not replayed (#41).
 * Otherwise `items` = log entries newer than the cursor, by id only; config changes never touch the cursor (#43).
 */
export function advance(c: Cursor, env: Envelope): { fresh: boolean; items: Interaction[] } | null {
  const epoch = env.epoch ?? "";
  const log = env.state.log ?? [];
  const last = log.length ? log[log.length - 1].id : 0;
  if (epoch !== c.epoch) {
    c.epoch = epoch; c.rev = env.rev ?? 0; c.seen = last;
    return { fresh: true, items: [] };
  }
  if (env.rev <= c.rev) return null;
  c.rev = env.rev;
  // shortcut: a log that went backwards without an epoch change is treated as all-new rather than guessed at.
  if (last < c.seen) c.seen = (log[0]?.id ?? 1) - 1;
  const items = log.filter((i) => i.id > c.seen);
  if (items.length) c.seen = last;
  return { fresh: false, items };
}

export type ConnState = "connecting" | "live" | "retrying";
/** Open /stream (same-origin cookie auth). EventSource reconnects by itself and sends Last-Event-ID. */
export function connect(onEnvelope: (e: Envelope) => void, onState: (s: ConnState) => void, priv = false): () => void {
  const es = new EventSource(priv ? "/stream?private=1" : "/stream");
  es.onopen = () => onState("live");
  es.onerror = () => onState("retrying");
  es.onmessage = (m) => {
    try { onEnvelope(JSON.parse(m.data)); } catch (e) { console.error("bad snapshot", e); }
  };
  return () => es.close();
}
