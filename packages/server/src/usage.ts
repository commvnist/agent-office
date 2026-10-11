import { closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import type { Usage } from "@agent-office/core";

const MAX_BYTES = 8 * 1024 * 1024;
const NARRATION_BYTES = 256 * 1024;
const under = (p: string, root: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
/**
 * A session's cwd is a second allowed root (transcripts can live there), but never a root so broad that it allows
 * any .jsonl on disk: "/" , the home directory itself and shallow system dirs are refused.
 */
function addCwdRoot(roots: string[], cwd: unknown, home: string) {
  if (typeof cwd !== "string" || !cwd) return;
  const r = realpathSync(cwd);
  if (r === sep || r === realpathSync(home) || r.split(sep).filter(Boolean).length < 2) return;
  roots.push(r);
}
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** Real path of a `.jsonl` under ~/.claude/projects or the payload cwd, else undefined (never read anything else). */
function allowed(path: unknown, cwd: unknown, home: string): string | undefined {
  if (typeof path !== "string" || !path.endsWith(".jsonl")) return undefined;
  const real = realpathSync(path);
  const roots = [join(home, ".claude", "projects")];
  addCwdRoot(roots, cwd, home);
  return roots.some((r) => { try { return under(real, realpathSync(r)); } catch { return false; } }) ? real : undefined;
}

/**
 * A session's running token total across its transcripts (lead + subagents). Message ids are shared across files, so a
 * message mirrored in two transcripts counts once; a streamed message repeats its id and the last line wins.
 */
export type Ledger = { offsets: Map<string, number>; ids: Map<string, Usage>; base: Usage };
export const newLedger = (): Ledger => ({ offsets: new Map(), ids: new Map(), base: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 } });
const LEDGER_IDS = 50_000;

/**
 * Read only what was appended to a transcript since the last call (at most its last 8 MB) and add its assistant `usage`
 * fields to the ledger. Nothing else of a line is kept. Same path rules as readNarration. Never throws.
 * shortcut: past LEDGER_IDS messages the oldest are folded into `base`, so a very late repeat of a folded id would count twice; fine for streamed repeats, which are adjacent.
 */
export function tallyUsage(l: Ledger, path: unknown, cwd?: unknown, home = homedir()): void {
  try {
    const real = allowed(path, cwd, home);
    if (!real) return;
    const fd = openSync(real, "r");
    let text: string, from: number, at = l.offsets.get(real) ?? 0;
    try {
      const size = fstatSync(fd).size;
      if (at > size) at = 0; // replaced or truncated: start over (ids dedupe what was already counted)
      from = Math.max(at, size - MAX_BYTES);
      const buf = Buffer.alloc(size - from);
      readSync(fd, buf, 0, buf.length, from);
      text = buf.toString("utf8");
    } finally { closeSync(fd); }
    if (from > at) { const cut = text.indexOf("\n") + 1; from += Buffer.byteLength(text.slice(0, cut)); text = text.slice(cut); } // partial first line
    let pos = from;
    for (const line of text.split("\n")) {
      const start = pos;
      pos += Buffer.byteLength(line) + 1;
      if (!line.includes('"usage"')) continue;
      try {
        const o = JSON.parse(line);
        const m = o?.type === "assistant" ? o.message : undefined;
        if (!m || typeof m.usage !== "object" || !m.usage) continue;
        const u = m.usage, key = typeof m.id === "string" ? m.id : `${real}@${start}`; // no id: the byte offset is stable across reads
        l.ids.delete(key); // re-insert so the newest stays last
        l.ids.set(key, { input: n(u.input_tokens), output: n(u.output_tokens), cacheRead: n(u.cache_read_input_tokens), cacheCreate: n(u.cache_creation_input_tokens) });
      } catch { /* partial or non-JSON line */ }
    }
    // Resume at the start of the last (possibly unfinished) line: a line re-read later keeps its key, so it never counts twice.
    l.offsets.set(real, from + Buffer.byteLength(text.slice(0, text.lastIndexOf("\n") + 1)));
    for (const [k, x] of l.ids) {
      if (l.ids.size <= LEDGER_IDS) break;
      for (const f of ["input", "output", "cacheRead", "cacheCreate"] as const) l.base[f] += x[f];
      l.ids.delete(k);
    }
  } catch { /* unreadable: keep what we have */ }
}

export function ledgerTotal(l: Ledger): Usage | undefined {
  if (!l.ids.size && !l.base.input && !l.base.output) return undefined;
  const u = { ...l.base };
  for (const x of l.ids.values()) { u.input += x.input; u.output += x.output; u.cacheRead += x.cacheRead; u.cacheCreate += x.cacheCreate; }
  return u;
}

/** Token total of one transcript (its last 8 MB). Local telemetry only; same path rules. */
export function readUsage(path: unknown, cwd?: unknown, home = homedir()): Usage | undefined {
  const l = newLedger();
  tallyUsage(l, path, cwd, home);
  return ledgerTotal(l);
}

/**
 * New assistant narration ("what the lead is saying between tool calls") from a transcript JSONL's last 256 KB.
 * Only `text` blocks of `assistant` entries are read: never user entries, tool_use inputs or tool results.
 * Same path rules as readUsage (.jsonl under ~/.claude/projects or the payload cwd). A streamed message repeats one id:
 * the last version of each id wins. Returns [{id, text}] oldest first, raw (the caller redacts and clips).
 */
export function readNarration(path: unknown, cwd?: unknown, home = homedir()): { id: string; text: string }[] {
  try {
    const real = allowed(path, cwd, home);
    if (!real) return [];
    const fd = openSync(real, "r");
    let text: string;
    try {
      const size = fstatSync(fd).size, len = Math.min(size, NARRATION_BYTES), buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      text = buf.toString("utf8");
      if (size > len) text = text.slice(text.indexOf("\n") + 1);
    } finally { closeSync(fd); }
    const byId = new Map<string, string>();
    let i = 0;
    for (const line of text.split("\n")) {
      if (!line.includes('"assistant"')) continue;
      try {
        const o = JSON.parse(line);
        if (o?.type !== "assistant") continue;
        const m = o.message, content = m?.content;
        if (!Array.isArray(content)) continue;
        const t = content.filter((b: unknown) => (b as { type?: string })?.type === "text" && typeof (b as { text?: unknown }).text === "string")
          .map((b: { text: string }) => b.text).join(" ").trim();
        if (!t) continue;
        byId.set(typeof m.id === "string" ? m.id : `#${i++}`, t);
      } catch { /* partial or non-JSON line */ }
    }
    return [...byId].map(([id, text]) => ({ id, text }));
  } catch { return []; }
}
