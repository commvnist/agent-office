import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanText, scanDir } from "./check-compliance.mjs";

test("flags each forbidden pattern", () => {
  assert.ok(scanText(`spawn("claude", ["-p"])`).length >= 1);
  assert.equal(scanText(`fetch("https://api.anthropic.com/v1")`).length, 1);
  assert.equal(scanText(`join(home, ".claude", ".credentials.json")`).length, 1);
  assert.equal(scanText(`import x from "@anthropic-ai/sdk"`).length, 1);
});

test("ignores benign code", () => {
  assert.deepEqual(scanText(`const claudeCode = "agent-office:claude"; spawn("node", [])`), []);
});

test("scanDir skips node_modules and docs, reports offenders", () => {
  const d = mkdtempSync(join(tmpdir(), "cc-"));
  for (const s of ["node_modules", "docs", "src"]) mkdirSync(join(d, s));
  for (const s of ["node_modules", "docs", "src"]) writeFileSync(join(d, s, "a.ts"), `fetch("api.anthropic.com")`);
  assert.deepEqual(scanDir(d), ["src/a.ts: uses the Anthropic API/SDK"]);
});

test("`claude plugin ...` is allowed; prompting or flags are not", () => {
  assert.deepEqual(scanText(`execFileSync("claude", ["plugin", "install", "agent-office"])`), []);
  assert.deepEqual(scanText("spawnSync('claude plugin marketplace add ./')"), []);
  assert.deepEqual(scanText(`exec("claude plugin list")`), []);
  assert.ok(scanText(`execFileSync("claude", ["-p", "hi"])`).length >= 1);
  assert.ok(scanText(`execFileSync("claude", ["--print", "hi"])`).length >= 1);
  assert.ok(scanText(`execSync('claude -p "hi"')`).length >= 1);
  assert.ok(scanText(`execSync("claude --print hi")`).length >= 1);
  assert.ok(scanText(`execSync('claude "write tests"')`).length >= 1);
  assert.ok(scanText(`spawn("claude", ["write tests"])`).length >= 1);
  assert.ok(scanText(`spawn("claude")`).length >= 1);
});
