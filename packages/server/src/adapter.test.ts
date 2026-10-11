import { test } from "node:test";
import assert from "node:assert/strict";
import { adapt } from "./adapter.ts";

test("maps subagent and tool hooks, ignores unknown events", () => {
  assert.deepEqual(adapt({ hook_event_name: "SubagentStart", session_id: "s", agent_id: "a1", agent_type: "qa-engineer" }, 1),
    [{ type: "agent_start", session: "s", agentId: "a1", agentType: "qa-engineer", t: 1 }]);
  assert.equal(adapt({ hook_event_name: "PreToolUse", session_id: "s", tool_name: "Bash", agent_id: "a1" }, 1)[0].type, "tool");
  assert.deepEqual(adapt({ hook_event_name: "PreCompact", session_id: "s" }, 1), [{ type: "compact", session: "s", t: 1 }]);
  assert.deepEqual(adapt({ hook_event_name: "Stop", session_id: "s", cwd: "/w/api" }, 1), [{ type: "turn_end", session: "s", cwd: "/w/api", t: 1 }], "S7: cwd on every event");
  assert.deepEqual(adapt({ hook_event_name: "TeammateIdle", session_id: "s" }), []);
  assert.deepEqual(adapt({ hook_event_name: "SessionStart" }), []);
});

test("a subagent's SubagentHandback carries its report; the lead's or another tool's does not", () => {
  const base = { hook_event_name: "PreToolUse", session_id: "s", tool_name: "SubagentHandback", tool_input: { message: "DONE: shipped" } };
  assert.equal((adapt({ ...base, agent_id: "a" })[0] as { message?: string }).message, "DONE: shipped");
  assert.equal((adapt(base)[0] as { message?: string }).message, undefined);
  assert.equal((adapt({ ...base, agent_id: "a", tool_name: "Bash" })[0] as { message?: string }).message, undefined);
});

test("a question prompt is a question (not a permission), a tool permission prompt is permission", () => {
  const n = (message: string) => adapt({ hook_event_name: "Notification", session_id: "s", notification_type: "permission_prompt", message })[0] as { kind?: string };
  assert.equal(n("Claude needs your permission to use AskUserQuestion").kind, "question");
  assert.equal(n("Claude needs your permission to use Bash").kind, "permission");
  assert.equal((n("Claude needs your permission to use AskUserQuestion") as { idle?: boolean }).idle, undefined, "a question does not end the turn");
  const idle = adapt({ hook_event_name: "Notification", session_id: "s", notification_type: "idle_prompt", message: "Claude is waiting for your input" })[0] as { idle?: boolean };
  assert.equal(idle.idle, true);
});

test("a helper's notification names the helper; Stop carries the first line of the lead's answer", () => {
  const [w] = adapt({ hook_event_name: "Notification", session_id: "s", agent_id: "h1", notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" }, 1);
  assert.equal((w as { agentId?: string }).agentId, "h1");
  const [e] = adapt({ hook_event_name: "Stop", session_id: "s", last_assistant_message: "Done, token=abc123secret\nmore" }, 1);
  assert.deepEqual(e, { type: "turn_end", session: "s", message: "Done, token=[redacted]", t: 1 });
  assert.deepEqual(adapt({ hook_event_name: "Stop", session_id: "s" }, 1), [{ type: "turn_end", session: "s", t: 1 }]);
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

test("UserPromptSubmit: harness notifications are not user prompts; their summary becomes a lead note", () => {
  const note = '<task-notification><task-id>a1</task-id><tool-use-id>t1</tool-use-id><output-file>/tmp/x</output-file><summary>Agent "Build" finished</summary></task-notification>';
  const out = adapt({ hook_event_name: "UserPromptSubmit", session_id: "s", prompt: note }, 5);
  assert.deepEqual(out, [{ type: "prompt", session: "s", text: "", t: 5 }, { type: "message", session: "s", to: "user", text: 'Agent "Build" finished', t: 5 }]);
  // text the user typed next to the markup is kept, markup and its content are not
  const mixed = adapt({ hook_event_name: "UserPromptSubmit", session_id: "s", prompt: `${note} now add tests` }, 6);
  assert.deepEqual(mixed, [{ type: "prompt", session: "s", text: "now add tests", t: 6 }]);
  // a killed or failed background helper sends no SubagentStop: its notification retires it; a completed one has its own
  const killed = note.replace("<summary>", "<status>killed</status><summary>");
  assert.deepEqual(adapt({ hook_event_name: "UserPromptSubmit", session_id: "s", prompt: killed }, 8)[0], { type: "agent_stop", session: "s", agentId: "a1", t: 8 });
  assert.equal(adapt({ hook_event_name: "UserPromptSubmit", session_id: "s", prompt: note.replace("<summary>", "<status>completed</status><summary>") }, 8)[0].type, "prompt");
  assert.equal(adapt({ hook_event_name: "UserPromptSubmit", session_id: "s", prompt: killed.replace("<task-id>a1", "<task-id>a1/../x") }, 8)[0].type, "prompt", "an id that is not an id is ignored");
  // a plain prompt is untouched
  assert.deepEqual(adapt({ hook_event_name: "UserPromptSubmit", session_id: "s", prompt: "fix the header" }, 7), [{ type: "prompt", session: "s", text: "fix the header", t: 7 }]);
});

test("idle_prompt notification is flagged idle; other notifications are not", () => {
  const n = (type?: string) => adapt({ hook_event_name: "Notification", session_id: "s", message: "m", notification_type: type }, 1)[0];
  assert.equal((n("idle_prompt") as { idle?: boolean }).idle, true);
  assert.equal((n("permission_prompt") as { idle?: boolean }).idle, undefined);
});

test("notification kind: permission_prompt is permission, idle_prompt is turn, unknown types are left to the reducer", () => {
  const n = (type?: string) => adapt({ hook_event_name: "Notification", session_id: "s", message: "m", notification_type: type }, 1)[0] as { kind?: string };
  assert.equal(n("permission_prompt").kind, "permission");
  assert.equal(n("idle_prompt").kind, "turn");
  assert.equal(n(undefined).kind, undefined);
});
