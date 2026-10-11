import { appendFileSync, existsSync, readFileSync, renameSync, statSync, chmodSync, unlinkSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { emptyState, pseudonym, reduce, sweep, SCHEMA_VERSION, type OfficeConfig, type OfficeEvent, type OfficeState } from "@agent-office/core";

export const MAX_BYTES = 5 * 1024 * 1024;

/** Append a line (mode 0600); past `max` bytes the file moves to `<file>.1`, replacing the old backup. */
export function appendRotating(file: string, line: string, max = MAX_BYTES) {
  try { if (statSync(file).size > max) renameSync(file, file + ".1"); } catch { /* missing yet */ }
  const fresh = !existsSync(file);
  appendFileSync(file, line + "\n", { mode: 0o600 });
  if (fresh) try { chmodSync(file, 0o600); } catch { /* best effort on non-POSIX */ }
}

/** Retention: drop stored events older than `since` (and unparseable lines) from the log and its backup. Returns lines removed. `timeOf` reads a line's time. */
export function pruneEvents(file: string, since: number, timeOf = (l: string): unknown => JSON.parse(l)?.t): number {
  let removed = 0;
  for (const f of [file + ".1", file]) {
    let lines: string[];
    try { lines = readFileSync(f, "utf8").split("\n").filter(Boolean); } catch { continue; }
    const keep = lines.filter((l) => { try { const t = timeOf(l); return typeof t === "number" && t >= since; } catch { return false; } });
    if (keep.length === lines.length) continue;
    removed += lines.length - keep.length;
    if (!keep.length) { unlinkSync(f); continue; }
    writeFileSync(f + ".tmp", keep.join("\n") + "\n", { mode: 0o600 });
    renameSync(f + ".tmp", f);
  }
  return removed;
}

/** Rebuild state from stored events, then sweep so sessions that went quiet do not resurrect. */
export function replay(cfg: OfficeConfig, events: OfficeEvent[], now: number, ttlMs: number): OfficeState {
  let s = emptyState();
  for (const e of events) s = reduce(cfg, s, e);
  return sweep(s, now, ttlMs, cfg).state;
}

// Per-day storage (P2). DIR/events/YYYY-MM-DD.jsonl (UTC day of the event) holds structure lines: the event without its free
// text (`text` kept as "" so it still replays). DIR/events/YYYY-MM-DD.text.jsonl holds `{o, <text fields>}` where `o` is the
// byte offset of the structure line it belongs to. DIR/events/YYYY-MM-DD.idx holds `t offset textOffset` lines, one at the
// first event a daemon writes to the day and then one per IDX_EVERY bytes, so a read can seek instead of scanning the day.
// The legacy DIR/events.jsonl(.1) is only read (history from before the switch) and pruned by pruneEvents, never written.

/** Free-text fields of an event: stored apart from the structure, blanked by `private=1`. */
export const TEXTY = ["text", "detail", "why", "message", "error", "cwd", "branch"];
export const strip = (e: object) => Object.fromEntries(Object.entries(e).filter(([k]) => !TEXTY.includes(k)));
/** Structure form: the text fields gone, `text` kept as "" so the event still replays. */
export const scrub = (e: OfficeEvent) => ({ ...strip(e), ...("text" in e ? { text: "" } : {}) });

const IDX_EVERY = 64 * 1024;
const DAY = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayEnd = (d: string) => Date.parse(`${d}T00:00:00Z`) + 86_400_000;
const sizeOf = (f: string) => { try { return statSync(f).size; } catch { return 0; } };
const lastIdx = new Map<string, number>();
function append(f: string, line: string) {
  const fresh = !existsSync(f);
  appendFileSync(f, line + "\n", { mode: 0o600 });
  if (fresh) try { chmodSync(f, 0o600); } catch { /* best effort on non-POSIX */ }
}

/** Append one event to today's day files (dir mode 0700, files 0600). `priv`: no text file is written at all, and the project is a pseudonym. */
export function appendEvent(home: string, e: OfficeEvent, priv: boolean) {
  if (priv && e.type === "session_start") e = { ...e, project: pseudonym(e.session) };
  const dir = join(home, "events");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const day = dayOf(e.t), f = join(dir, `${day}.jsonl`), tf = join(dir, `${day}.text.jsonl`);
  const off = sizeOf(f), last = lastIdx.get(f);
  if (last === undefined || off < last || off - last >= IDX_EVERY) { append(join(dir, `${day}.idx`), `${e.t} ${off} ${sizeOf(tf)}`); lastIdx.set(f, off); }
  append(f, JSON.stringify({ v: SCHEMA_VERSION, ...scrub(e) }));
  const text = priv ? [] : Object.entries(e).filter(([k, v]) => TEXTY.includes(k) && typeof v === "string" && v);
  if (text.length) append(tf, JSON.stringify({ o: off, ...Object.fromEntries(text) }));
}

/** Call `each(line, byteOffset)` for every line in [start, end) of `file`, reading 64 KB at a time (a missing file reads as empty). */
async function scan(file: string, start: number, end: number, each: (line: string, off: number) => void) {
  let fh;
  try { fh = await open(file, "r"); } catch { return; }
  try {
    const buf = Buffer.alloc(64 * 1024);
    let pos = start, carry = Buffer.alloc(0), at = start;
    while (pos < end) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, end - pos), pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const chunk = Buffer.concat([carry, buf.subarray(0, bytesRead)]); // a copy: buf is reused
      let from = 0;
      for (let i; (i = chunk.indexOf(10, from)) >= 0; from = i + 1) each(chunk.toString("utf8", from, i), at + from);
      at += from; carry = chunk.subarray(from);
    }
    if (carry.length) each(carry.toString("utf8"), at);
  } finally { await fh.close(); }
}

const valid = (e: any): e is OfficeEvent => e && typeof e.t === "number" && typeof e.type === "string";

/** The newest `cap` matching lines of one file range, oldest first, with their offsets. */
async function collect(file: string, start: number, end: number, since: number, until: number, cap: number, keep?: (e: OfficeEvent) => boolean) {
  let got: { e: OfficeEvent; o: number }[] = [];
  await scan(file, start, end, (line, o) => {
    try { const e = JSON.parse(line); if (valid(e) && e.t >= since && e.t <= until && (!keep || keep(e))) got.push({ e, o }); } catch { /* skip */ }
    if (got.length > 2 * cap) got = got.slice(-cap);
  });
  return got.slice(-cap);
}

/**
 * Stored events with since <= t <= until, oldest first: the newest `limit` of them, `more` = older ones exist in range.
 * Reads day files newest first (seeking with the .idx), then the legacy events.jsonl(.1), and stops once it has enough.
 * `text`: rejoin the free text from the .text.jsonl files (absent text stays "", the timeline replays without it).
 * shortcut: idx seeking assumes append order is time order (the daemon stamps t on receipt); a clock jump back can hide events at a range edge, add a sort-on-read if that shows up.
 */
export async function readEvents(home: string, o: { since?: number; until?: number; limit?: number; text?: boolean; keep?: (e: OfficeEvent) => boolean } = {}): Promise<{ events: OfficeEvent[]; more: boolean }> {
  const since = o.since ?? 0, until = o.until ?? Infinity, want = (o.limit ?? 5000) + 1;
  const dir = join(home, "events");
  let names: string[] = [];
  try { names = await readdir(dir); } catch { /* no day files yet */ }
  const day = (t: number, edge: string) => (Math.abs(t) < 8.64e15 ? dayOf(Math.max(0, t)) : edge); // Date's range
  const lo = day(since, "9999"), hi = day(until, "9999");
  const days = names.map((n) => DAY.exec(n)?.[1]).filter((d): d is string => !!d && d >= lo && d <= hi).sort().reverse();
  const parts: OfficeEvent[][] = [];
  let n = 0;
  for (const day of days) {
    if (n >= want) break;
    const f = join(dir, `${day}.jsonl`);
    let idx: number[][] = [];
    try { idx = (await readFile(join(dir, `${day}.idx`), "utf8")).split("\n").map((l) => l.split(" ").map(Number)).filter((x) => x.length === 3 && x.every(Number.isFinite)); } catch { /* none: scan the day */ }
    const from = idx.filter((x) => x[0] < since).at(-1), to = idx.find((x) => x[0] > until);
    const got = await collect(f, from?.[1] ?? 0, to?.[1] ?? Infinity, since, until, want - n, o.keep);
    if (o.text && got.length) {
      const need = new Map(got.map((g) => [g.o, g.e as Record<string, unknown>]));
      await scan(join(dir, `${day}.text.jsonl`), from?.[2] ?? 0, to?.[2] ?? Infinity, (line) => {
        try {
          const x = JSON.parse(line), e = need.get(x?.o);
          if (e) for (const k of TEXTY) if (typeof x[k] === "string") e[k] = x[k];
        } catch { /* skip */ }
      });
    }
    parts.unshift(got.map((g) => g.e)); n += got.length;
  }
  for (const f of [join(home, "events.jsonl"), join(home, "events.jsonl.1")]) {
    if (n >= want) break;
    const got = await collect(f, 0, Infinity, since, until, want - n, o.keep);
    parts.unshift(got.map((g) => g.e)); n += got.length;
  }
  const events = parts.flat();
  return { events: events.slice(-(want - 1)), more: events.length >= want };
}

/** Everything but the high-volume tool traffic: what a restart needs to know who is in the office and what they were asked. */
const lifecycle = (e: OfficeEvent) => e.type !== "tool" && e.type !== "tool_end" && e.type !== "message" && e.type !== "usage";
/**
 * The events a daemon boots from: the newest `limit` of the window, preceded by every older non-tool event of the window
 * (session and agent starts and stops, delegations, prompts, waits), so a busy hour of tool calls cannot push the office out.
 * shortcut: older events sharing the first recent event's millisecond are skipped (no offsets across the two reads); checkpoint state if that ever matters.
 */
export async function bootEvents(home: string, since: number, text: boolean, limit = 50_000): Promise<OfficeEvent[]> {
  const recent = await readEvents(home, { since, limit, text });
  if (!recent.more || !recent.events.length) return recent.events;
  const old = await readEvents(home, { since, until: recent.events[0].t - 1, limit: 4 * limit, text, keep: lifecycle });
  return [...old.events, ...recent.events];
}

/** Retention for day files: whole days ending before `since` go (structure, text, idx); text files of days ending before `textSince` go earlier. Returns files removed. */
export function pruneDays(home: string, since: number, textSince = since): number {
  let names: string[];
  try { names = readdirSync(join(home, "events")); } catch { return 0; }
  let removed = 0;
  for (const n of names) {
    const m = /^(\d{4}-\d{2}-\d{2})\.(jsonl|text\.jsonl|idx)$/.exec(n);
    if (!m || dayEnd(m[1]) > (m[2] === "text.jsonl" ? Math.max(since, textSince) : since)) continue;
    try { unlinkSync(join(home, "events", n)); removed++; } catch { /* gone */ }
  }
  return removed;
}
