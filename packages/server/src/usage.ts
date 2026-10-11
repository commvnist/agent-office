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

/**
 * Sum assistant token usage in a transcript JSONL (last 8 MB). Local telemetry only.
 * Only `.jsonl` files whose real path is under ~/.claude/projects or the payload cwd are read.
 * shortcut: no streaming parse, the tail is held in memory (8 MB), and a partial first line is dropped.
 */
export function readUsage(path: unknown, cwd?: unknown, home = homedir()): Usage | undefined {
  try {
    if (typeof path !== "string" || !path.endsWith(".jsonl")) return undefined;
    const real = realpathSync(path);
    const roots = [join(home, ".claude", "projects")];
    addCwdRoot(roots, cwd, home);
    if (!roots.some((r) => { try { return under(real, realpathSync(r)); } catch { return false; } })) return undefined;
    const fd = openSync(real, "r");
    let text: string;
    try {
      const size = fstatSync(fd).size, len = Math.min(size, MAX_BYTES), buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      text = buf.toString("utf8");
      if (size > len) text = text.slice(text.indexOf("\n") + 1);
    } finally { closeSync(fd); }
    // Streamed responses repeat one message id; the last line of an id wins.
    const byId = new Map<string, Record<string, unknown>>();
    let i = 0;
    for (const line of text.split("\n")) {
      if (!line.includes('"usage"')) continue;
      try {
        const o = JSON.parse(line);
        const m = o?.type === "assistant" ? o.message : undefined;
        if (m && typeof m.usage === "object" && m.usage) byId.set(typeof m.id === "string" ? m.id : `#${i++}`, m.usage);
      } catch { /* partial or non-JSON line */ }
    }
    if (!byId.size) return undefined;
    const u: Usage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
    for (const x of byId.values()) {
      u.input += n(x.input_tokens); u.output += n(x.output_tokens);
      u.cacheRead += n(x.cache_read_input_tokens); u.cacheCreate += n(x.cache_creation_input_tokens);
    }
    return u;
  } catch { return undefined; }
}

/**
 * New assistant narration ("what the lead is saying between tool calls") from a transcript JSONL's last 256 KB.
 * Only `text` blocks of `assistant` entries are read: never user entries, tool_use inputs or tool results.
 * Same path rules as readUsage (.jsonl under ~/.claude/projects or the payload cwd). A streamed message repeats one id:
 * the last version of each id wins. Returns [{id, text}] oldest first, raw (the caller redacts and clips).
 */
export function readNarration(path: unknown, cwd?: unknown, home = homedir()): { id: string; text: string }[] {
  try {
    if (typeof path !== "string" || !path.endsWith(".jsonl")) return [];
    const real = realpathSync(path);
    const roots = [join(home, ".claude", "projects")];
    addCwdRoot(roots, cwd, home);
    if (!roots.some((r) => { try { return under(real, realpathSync(r)); } catch { return false; } })) return [];
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
