import { basename } from "node:path";
import type { OfficeEvent, SourceAdapter } from "@agent-office/core";
import { safeId, stripMeta, metaSummary } from "@agent-office/core";

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b./g;
const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿؜]/g; // zero-width, bidi marks/overrides/isolates
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g;
// Harness markup wrapped around messages (<agent-message ...>, <system-reminder>, ...); shown text keeps the inside only.
// Allowlisted so user text such as <my-component> or a<b-c && d>e survives.
const ENVELOPE = /<\/?(?:agent-message|system-reminder|task-notification|subagent-hand-back|function_results|command-name|local-command-stdout)(?:\s[^<>]*)?>/gi;

const SECRETS: [RegExp, string][] = [
  [/(authorization\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?\S+/gi, "$1[redacted]"],
  [/\b(bearer|basic)\s+[\w.~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\bsk-[\w-]{16,}/g, "[redacted]"],
  [/\bgh[pousr]_\w{20,}/g, "[redacted]"],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted]"],
  [/(--?(?:password|passwd|token|secret|api[_-]?key)\s+)\S+/gi, "$1[redacted]"],
  [/(\b(?:password|passwd|token|secret|api[_-]?key)["']?\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, "$1[redacted]"],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, "$1[redacted]@"],
];
/** Obvious secrets only; this is a courtesy filter, not a guarantee. */
export const redact = (s: string) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s);

/** Untrusted text -> one safe, redacted, length-bounded line. */
export const clip = (v: unknown, n: number) => {
  if (typeof v !== "string") return "";
  // Bound regex work on huge inputs; output is at most n anyway.
  const s = redact(v.slice(0, n * 4 + 64).replace(ANSI, "").replace(INVISIBLE, "").replace(ENVELOPE, " ").replace(CONTROL, " ")).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const NAME = /^[\w.:-]{1,64}$/;
const name = (v: unknown, fallback: string) => (typeof v === "string" && NAME.test(v) ? v : fallback);

/** What a tool call is acting on, in a few words, for bubbles. */
function detail(tool: string, i: Record<string, unknown>): string {
  switch (tool) {
    case "Bash": return clip(i.command, 48);
    case "Read": case "Edit": case "Write": case "MultiEdit": case "NotebookEdit":
      return clip(basename(String(i.file_path ?? i.notebook_path ?? "")), 48);
    case "Grep": case "Glob": return clip(i.pattern, 40);
    case "WebFetch": return clip(i.url, 48);
    case "WebSearch": return clip(i.query, 48);
    case "Agent": case "Task": return clip(i.description, 48);
    default: return clip(i.description ?? i.file_path ?? i.query ?? i.prompt, 48);
  }
}

const VERBS = new Map([
  ["Read", "Reading"], ["Edit", "Editing"], ["MultiEdit", "Editing"], ["NotebookEdit", "Editing"], ["Write", "Writing"],
  ["Grep", "Searching for"], ["Glob", "Finding"], ["WebFetch", "Fetching"], ["WebSearch", "Searching the web for"],
  ["Agent", "Delegating:"], ["Task", "Delegating:"], ["Bash", "Running"],
]);
/** Plain-English reason: Bash's own description, else a verb phrase from tool + detail. */
function why(tool: string, i: Record<string, unknown>, d: string): string | undefined {
  const own = tool === "Bash" ? clip(i.description, 80) : "";
  const verb = VERBS.get(tool);
  return own || (verb && d ? `${verb} ${d}` : undefined);
}

const SOURCES = ["startup", "resume", "compact", "clear"] as const;
const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Claude Code hook payload -> OfficeEvents. The only code that knows the hook shape. Never throws. */
export const adapt: SourceAdapter = (payload, now = Date.now()) => {
  try {
    if (!isObj(payload)) return [];
    const p = payload;
    const t = Number.isFinite(now) ? now : Date.now();
    const session = p.session_id;
    if (!safeId(session)) return [];
    const agentId = p.agent_id === undefined ? undefined : p.agent_id;
    if (agentId !== undefined && !safeId(agentId)) return [];
    const seq = Number.isSafeInteger(p.ao_seq) ? (p.ao_seq as number) : undefined;
    const id = typeof p.tool_use_id === "string" && NAME.test(p.tool_use_id) ? p.tool_use_id : undefined;
    const out = events(p, session, agentId, id, t);
    return out.map((e) => defined({ ...e, seq }));
  } catch {
    return [];
  }
};

function events(p: Record<string, unknown>, session: string, agentId: string | undefined, id: string | undefined, t: number): OfficeEvent[] {
  const input = isObj(p.tool_input) ? p.tool_input : {};
  const tool = name(p.tool_name, "?");
  switch (p.hook_event_name) {
    case "SessionStart": {
      const cwd = clip(p.cwd, 200);
      const source = SOURCES.find((s) => s === p.source);
      return [{ type: "session_start", session, project: clip(basename(cwd), 40) || session.slice(0, 8),
        cwd: cwd || undefined, branch: clip(p.git_branch ?? p.branch, 60) || undefined, source, t }];
    }
    case "SessionEnd":
      return [{ type: "session_end", session, t }];
    case "SubagentStart":
      return agentId ? [{ type: "agent_start", session, agentId, agentType: name(p.agent_type, "unknown"), t }] : [];
    case "SubagentStop":
      return agentId ? [{ type: "agent_stop", session, agentId, message: clip(p.last_assistant_message, 220) || undefined, t }] : [];
    case "UserPromptSubmit":
      {
        // Harness markup (task notifications, reminders) is removed WITH its content before clipping, so a long
        // notification cannot crowd real text out. A pure notification is not a user prompt: it flips the session
        // back to working (empty prompt) and keeps its one-line summary as a quiet lead note.
        const raw = typeof p.prompt === "string" ? p.prompt : "";
        const text = clip(stripMeta(raw), 140);
        const sum = text ? "" : clip(metaSummary(raw), 120);
        return sum
          ? [{ type: "prompt", session, text: "", t }, { type: "message", session, to: "user", text: sum, t }]
          : [{ type: "prompt", session, text, t }];
      }
    case "Stop":
      return [{ type: "turn_end", session, t }];
    case "Notification":
    {
      // Known notification types decide the kind; otherwise the reducer reads it from the text.
      const kind = p.notification_type === "permission_prompt" ? "permission" : p.notification_type === "idle_prompt" ? "turn" : undefined;
      return [{ type: "waiting", session, text: clip(p.message, 80) || undefined, ...(kind === "turn" ? { idle: true } : {}), kind, t }];
    }
    case "PostToolUse": {
      const r = isObj(p.tool_response) ? p.tool_response : {};
      if (r.success === false || r.is_error === true)
        return [{ type: "tool_end", session, agentId, tool, ok: false, error: clip(r.error ?? p.error, 120) || "failed", id, t }];
      return [{ type: "tool_end", session, agentId, tool, ok: true, id, t }];
    }
    case "PostToolUseFailure":
      return [{ type: "tool_end", session, agentId, tool, ok: false, error: clip(p.error ?? input.error, 120) || "failed", id, t }];
    case "PreToolUse": {
      const d = detail(tool, input);
      const out: OfficeEvent[] = [{ type: "tool", session, agentId, tool, detail: d || undefined, why: why(tool, input, d), id, t }];
      if ((tool === "Agent" || tool === "Task") && input.subagent_type) {
        out.push({ type: "delegate", session, from: agentId, agentType: name(input.subagent_type, "unknown"), text: clip(input.description ?? input.prompt, 140), id, t });
      } else if (/SendMessage/i.test(tool)) {
        out.push({ type: "message", session, from: agentId, to: clip(input.to ?? input.recipient, 40), text: clip(input.message ?? input.content ?? input.summary, 140), id, t });
      }
      return out;
    }
    default:
      return [];
  }
}
