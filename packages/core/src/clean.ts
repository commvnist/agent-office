// Harness "meta" markup that Claude Code injects into prompts and messages (background-task notifications,
// system reminders, hook output). It is machine language, not something a person wrote: it must never be shown as
// "You -> ..." or used as a session's prompt. Pure; applied by the adapter before clipping and again by the reducer
// so events stored by older builds replay clean too.

/** Tags whose presence marks a block as harness markup; their whole content goes. */
const STRONG = ["task-notification", "task-id", "tool-use-id", "output-file", "system-reminder", "agent-message", "subagent-hand-back", "function_results", "local-command-stdout", "local-command-caveat", "command-name", "command-message", "command-args", "user-prompt-submit-hook", "cross-session-message"];
/** Generic names that only count as meta when a strong tag is also present (so a user's own <summary> survives). */
const WEAK = ["status", "summary", "result", "usage", "worktree", "worktree-path", "worktree-branch", "note"];

/** Plain-text harness messages (no XML wrapper) injected as "user" turns: the whole message is machine-generated. */
const HARNESS_START = [/^\[Subagent hand-back\]/i, /^\[SYSTEM NOTIFICATION\b/i, /^\[Cross-session\b/i, /^\[harness:/i, /^Another Claude session sent a message\b/i];
const isHarness = (t: string) => HARNESS_START.some((re) => re.test(t.trimStart()));

const alt = (l: string[]) => l.join("|");
const strongOpen = new RegExp(`<(?:${alt(STRONG)})(?:\\s[^<>]*)?>`, "i");

/** Remove every closed or unterminated meta block (with its content) and stray closing tags. */
function drop(text: string, names: string[]): string {
  const a = alt(names);
  let t = text;
  for (let i = 0; i < 6; i++) {
    const next = t.replace(new RegExp(`<(${a})(?:\\s[^<>]*)?>[\\s\\S]*?</\\1\\s*>`, "gi"), " ");
    if (next === t) break;
    t = next;
  }
  t = t.replace(new RegExp(`<(?:${a})(?:\\s[^<>]*)?>[\\s\\S]*$`, "i"), " "); // unterminated (clipped) block: drop to the end
  return t.replace(new RegExp(`</(?:${a})\\s*>`, "gi"), " ");
}

/** A one-line human summary of a machine message: a task notification's <summary>, or a subagent hand-back's first report line. */
export function metaSummary(text: string): string | undefined {
  const t = text.trimStart();
  if (/^\[Subagent hand-back\]/i.test(t)) {
    const i = t.search(/The report follows:/i);
    const body = i >= 0 ? t.slice(i + "The report follows:".length) : "";
    const line = body.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).find((l) => l.length > 0);
    return line ? `Report: ${line}` : undefined;
  }
  if (!strongOpen.test(text)) return undefined;
  const m = /<summary>([\s\S]*?)<\/summary>/i.exec(text);
  const s = m?.[1].replace(/\s+/g, " ").trim();
  return s || undefined;
}

/** `text` with harness markup removed and whitespace collapsed. Empty when the whole message was machine-generated. */
export function stripMeta(text: string): string {
  if (!text) return text;
  if (isHarness(text)) return "";
  if (!text.includes("<")) return text;
  const hasStrong = strongOpen.test(text) || new RegExp(`</(?:${alt(STRONG)})\\s*>`, "i").test(text);
  let t = drop(text, STRONG);
  if (hasStrong) t = drop(t, WEAK);
  return t.replace(/\s+/g, " ").trim();
}
