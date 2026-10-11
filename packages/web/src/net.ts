// Stream connection + the pure snapshot gate (epoch/rev/log cursor). Node-testable: nothing runs at import time.
import type { Interaction, OfficeConfig, OfficeState } from "@agent-office/core";

export type Envelope = {
  schema: number; version: string; epoch: string; rev: number; privacy?: boolean;
  /** Set by the LAN listener: this page is a paired device's read-only view. */
  remote?: boolean;
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

/** P1: one `event: patch` frame (contract 3). null in maps = key removed; log drops `drop` from the front, then appends `add`. */
export type Patch = {
  epoch: string; rev: number; base: number;
  head?: Partial<Omit<Envelope, "state">>;
  maps?: Partial<Record<"sessions" | "agents" | "pending", Record<string, unknown>>>;
  keys?: Record<string, unknown>;
  log?: { drop: number; add: Interaction[] };
};
/** Apply a patch to a copy of `env`; null = it does not fit (other epoch or base), so the caller resyncs from /state. */
export function applyPatch(env: Envelope | null, p: Patch): Envelope | null {
  if (!env || p.epoch !== env.epoch || p.base !== env.rev) return null;
  const st = { ...env.state, ...p.keys } as Record<string, unknown>;
  for (const [k, m] of Object.entries(p.maps ?? {})) {
    const next = { ...(st[k] as Record<string, unknown>) };
    for (const [id, v] of Object.entries(m ?? {})) if (v === null) delete next[id]; else next[id] = v;
    st[k] = next;
  }
  if (p.log) st.log = [...env.state.log.slice(p.log.drop), ...p.log.add];
  return { ...env, ...p.head, epoch: p.epoch, rev: p.rev, state: st as OfficeState };
}

export type ConnState = "connecting" | "live" | "retrying";
/** Open /stream (same-origin cookie auth). EventSource reconnects by itself and sends Last-Event-ID; patches that do not fit resync from /state. */
export function connect(onEnvelope: (e: Envelope) => void, onState: (s: ConnState) => void, priv = false): () => void {
  const es = new EventSource(priv ? "/stream?private=1" : "/stream");
  let cur: Envelope | null = null, syncing = false;
  const take = (e: Envelope) => { cur = e; onEnvelope(e); };
  const resync = async () => {
    if (syncing) return;
    syncing = true;
    try {
      const r = await fetch(priv ? "/state?private=1" : "/state", { credentials: "same-origin" });
      if (r.ok) { const e: Envelope = await r.json(); if (!cur || e.epoch !== cur.epoch || e.rev > cur.rev) take(e); }
    } catch (e) { console.error("resync failed", e); } finally { syncing = false; }
  };
  es.onopen = () => onState("live");
  es.onerror = () => onState("retrying");
  es.onmessage = (m) => {
    try { take(JSON.parse(m.data)); } catch (e) { console.error("bad snapshot", e); }
  };
  es.addEventListener("patch", (m) => {
    try {
      const p: Patch = JSON.parse((m as MessageEvent).data);
      if (cur && p.epoch === cur.epoch && p.rev <= cur.rev) return; // already covered (a resync overtook it)
      const next = applyPatch(cur, p);
      if (next) take(next); else void resync();
    } catch (e) { console.error("bad patch", e); }
  });
  return () => es.close();
}
