import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNarration } from "./usage.ts";

const home = mkdtempSync(join(tmpdir(), "ao-narr-"));
const dir = join(home, ".claude", "projects", "p");
mkdirSync(dir, { recursive: true });
const file = join(dir, "t.jsonl");
const L = (o: unknown) => JSON.stringify(o);
const assistant = (id: string, blocks: unknown[]) => L({ type: "assistant", message: { id, role: "assistant", content: blocks } });

test("reads only assistant text blocks: never tool inputs, tool results or user entries", () => {
  writeFileSync(file, [
    L({ type: "user", message: { role: "user", content: "my password is hunter2" } }),
    assistant("m1", [{ type: "text", text: "Fixing the header now." }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "cat ~/.ssh/id_rsa" } }]),
    L({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "-----BEGIN PRIVATE KEY-----" }] } }),
    assistant("m2", [{ type: "thinking", thinking: "secret reasoning" }, { type: "text", text: "Done: tests pass." }]),
    "{ not json",
  ].join("\n") + "\n");
  const out = readNarration(file, undefined, home);
  assert.deepEqual(out, [{ id: "m1", text: "Fixing the header now." }, { id: "m2", text: "Done: tests pass." }]);
});

test("a streamed message repeats one id: the last version wins; blocks are joined", () => {
  writeFileSync(file, [assistant("m1", [{ type: "text", text: "Part" }]), assistant("m1", [{ type: "text", text: "Part one" }, { type: "text", text: "and two" }])].join("\n") + "\n");
  assert.deepEqual(readNarration(file, undefined, home), [{ id: "m1", text: "Part one and two" }]);
});

test("paths outside ~/.claude/projects and the payload cwd, and non-jsonl files, are never read", () => {
  const other = mkdtempSync(join(tmpdir(), "ao-other-"));
  const f = join(other, "x.jsonl");
  writeFileSync(f, assistant("m1", [{ type: "text", text: "leak" }]) + "\n");
  assert.deepEqual(readNarration(f, undefined, home), []);
  assert.deepEqual(readNarration(join(dir, "t.txt"), undefined, home), []);
  assert.deepEqual(readNarration(undefined, undefined, home), []);
  assert.deepEqual(readNarration(f, other, home), [{ id: "m1", text: "leak" }]); // cwd root is allowed, as for usage
});

test("a cwd of / (or the home directory) is never accepted as a transcript root", () => {
  const other = mkdtempSync(join(tmpdir(), "ao-other-"));
  const f = join(other, "x.jsonl");
  writeFileSync(f, assistant("m1", [{ type: "text", text: "leak" }]) + "\n");
  assert.deepEqual(readNarration(f, "/", home), []);
  assert.deepEqual(readNarration(f, home, home), []);
});
