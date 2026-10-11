import { test } from "node:test";
import assert from "node:assert/strict";
import { adapt } from "./adapter.ts";

test("maps subagent and tool hooks, ignores unknown events", () => {
  assert.deepEqual(adapt({ hook_event_name: "SubagentStart", session_id: "s", agent_id: "a1", agent_type: "qa-engineer" }, 1),
    [{ type: "agent_start", session: "s", agentId: "a1", agentType: "qa-engineer", t: 1 }]);
  assert.equal(adapt({ hook_event_name: "PreToolUse", session_id: "s", tool_name: "Bash", agent_id: "a1" }, 1)[0].type, "tool");
  assert.deepEqual(adapt({ hook_event_name: "PreCompact", session_id: "s" }), []);
  assert.deepEqual(adapt({ hook_event_name: "SessionStart" }), []);
});

test("Agent tool call yields a tool event plus a delegation with the task text", () => {
  const evs = adapt({ hook_event_name: "PreToolUse", session_id: "s", tool_name: "Agent",
    tool_input: { subagent_type: "qa-engineer", description: "Write tests for the cart", prompt: "long..." } }, 1);
  assert.deepEqual(evs.map((e) => e.type), ["tool", "delegate"]);
  assert.equal((evs[1] as any).text, "Write tests for the cart");
});

test("tool detail is short and file paths are reduced to basenames", () => {
  const [e] = adapt({ hook_event_name: "PreToolUse", session_id: "s", tool_name: "Edit", tool_input: { file_path: "/a/b/cart.ts" } }, 1);
  assert.equal((e as any).detail, "cart.ts");
});

test("subagent stop carries a clipped final message", () => {
  const [e] = adapt({ hook_event_name: "SubagentStop", session_id: "s", agent_id: "a", last_assistant_message: "x".repeat(500) }, 1);
  assert.ok(((e as any).message as string).length <= 220);
});

import { redact, clip } from "./adapter.ts";

test("never throws and returns [] for non-object or hostile input", () => {
  const bad: unknown[] = [null, undefined, 5, "x", [], [{}], true, { session_id: 5 }, { session_id: "constructor", hook_event_name: "Stop" },
    { session_id: "s", hook_event_name: "PreToolUse", tool_input: "str", tool_name: { a: 1 } }, { session_id: "s", agent_id: "a|b", hook_event_name: "SubagentStart" }];
  for (const b of bad) assert.doesNotThrow(() => adapt(b as any, 1));
  for (const b of bad.slice(0, 8)) assert.deepEqual(adapt(b as any, 1), []);
  assert.deepEqual(adapt({ session_id: "s", agent_id: "constructor", hook_event_name: "SubagentStart" }, 1), []);
  assert.equal((adapt({ session_id: "s", hook_event_name: "PreToolUse", tool_input: "str", tool_name: { a: 1 } }, 1)[0] as { tool?: string }).tool, "?");
});

test("text is stripped of ANSI, control, bidi and zero-width characters", () => {
  assert.equal(clip("\x1b[31mred\x1b[0m a‮b​c\x07d\n\te", 50), "red abc d e");
});

test("secrets are redacted in text fields", () => {
  const cases: [string, string][] = [
    ["curl -H 'Authorization: Bearer abcdef123456' x", "abcdef123456"],
    ["Bearer abcdefghijkl", "abcdefghijkl"],
    ["key sk-ant-api03-abcdefghijklmnop", "abcdefghijklmnop"],
    ["AKIAABCDEFGHIJKLMNOP", "AKIAABCDEF"],
    ["run --password hunter2 now", "hunter2"],
    ["TOKEN=abc123xyz go", "abc123xyz"],
    ["git clone https://bob:pw123@host/x.git", "pw123"],
    ["ghp_abcdefghijklmnopqrstuvwx", "ghp_abc"],
  ];
  for (const [input, secret] of cases) assert.ok(!redact(input).includes(secret), input);
  const [e] = adapt({ hook_event_name: "PreToolUse", session_id: "s", tool_name: "Bash", tool_input: { command: "deploy --token=zzz999aaa" } }, 1);
  assert.ok(!(e as any).detail.includes("zzz999aaa"));
});

test("tool_end, why, seq, session_start fields", () => {
  const base = { session_id: "s", tool_name: "Bash", tool_use_id: "tu1" };
  assert.deepEqual(adapt({ ...base, hook_event_name: "PostToolUseFailure", error: "exit 2" }, 5),
    [{ type: "tool_end", session: "s", tool: "Bash", ok: false, error: "exit 2", id: "tu1", t: 5 }]);
  assert.equal((adapt({ ...base, hook_event_name: "PostToolUse" }, 5)[0] as any).ok, true);
  const [b] = adapt({ ...base, hook_event_name: "PreToolUse", tool_input: { command: "npm test", description: "Run the unit tests" }, ao_seq: 7 }, 1);
  assert.deepEqual([(b as any).why, b.seq, (b as any).id], ["Run the unit tests", 7, "tu1"]);
  const [r] = adapt({ hook_event_name: "PreToolUse", session_id: "s", tool_name: "Read", tool_input: { file_path: "/a/cart.ts" } }, 1);
  assert.equal((r as any).why, "Reading cart.ts");
  const [s] = adapt({ hook_event_name: "SessionStart", session_id: "s", cwd: "/w/shop", git_branch: "main", source: "resume" }, 1);
  assert.deepEqual(s, { type: "session_start", session: "s", project: "shop", cwd: "/w/shop", branch: "main", source: "resume", t: 1 });
});

test("hook envelope tags are stripped from shown text", () => {
  assert.equal(clip('<agent-message from="qa" to="lead">DONE: ok</agent-message><system-reminder>x</system-reminder>', 100), "DONE: ok x");
  assert.equal(clip("<task-notification>a < b</task-notification>", 100), "a < b");
  assert.equal(clip("<my-component>x</my-component>", 100), "<my-component>x</my-component>");
  assert.equal(clip("a<b-c && d>e", 100), "a<b-c && d>e");
});
