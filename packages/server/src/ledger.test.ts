import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ledgerTotal, newLedger, tallyUsage } from "./usage.ts";

const home = mkdtempSync(join(tmpdir(), "ao-led-"));
const dir = join(home, ".claude", "projects", "p");
mkdirSync(dir, { recursive: true });
const line = (id: string | undefined, out: number) => JSON.stringify({ type: "assistant", message: { ...(id ? { id } : {}), content: [{ type: "text", text: "secret words" }], usage: { input_tokens: 10, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 1 } } }) + "\n";

test("ledger: reads only appended bytes, counts each message id once across reads and across lead + subagent files", () => {
  const lead = join(dir, "lead.jsonl"), sub = join(dir, "agent-a.jsonl");
  writeFileSync(lead, line("m1", 3) + line("m1", 5) + line(undefined, 1));
  const l = newLedger();
  tallyUsage(l, lead, undefined, home);
  assert.deepEqual(ledgerTotal(l), { input: 20, output: 6, cacheRead: 0, cacheCreate: 2 });
  tallyUsage(l, lead, undefined, home); // nothing new: unchanged (the id-less line is keyed by offset, not counted twice)
  assert.equal(ledgerTotal(l)!.output, 6);
  appendFileSync(lead, line("m2", 4) + '{"type":"assistant","message":{"id":"m3","usage":{"output_tok'); // unfinished last line
  tallyUsage(l, lead, undefined, home);
  assert.equal(ledgerTotal(l)!.output, 10);
  appendFileSync(lead, 'ens":2}}}\n');
  tallyUsage(l, lead, undefined, home);
  assert.equal(ledgerTotal(l)!.output, 12, "the finished line is read from its start");
  writeFileSync(sub, line("s1", 100) + line("m2", 4)); // m2 mirrored in the subagent file counts once
  tallyUsage(l, sub, undefined, home);
  assert.equal(ledgerTotal(l)!.output, 112);
});

test("ledger: a window that slides past old messages never shrinks the running total; outside paths are never read", () => {
  const f = join(dir, "big.jsonl");
  writeFileSync(f, line("old", 7));
  const l = newLedger();
  tallyUsage(l, f, undefined, home);
  appendFileSync(f, line("new", 1));
  tallyUsage(l, f, undefined, home);
  assert.equal(ledgerTotal(l)!.output, 8);
  const outside = join(mkdtempSync(join(tmpdir(), "ao-out-")), "x.jsonl");
  writeFileSync(outside, line("x", 50));
  tallyUsage(l, outside, undefined, home);
  assert.equal(ledgerTotal(l)!.output, 8);
  assert.equal(ledgerTotal(newLedger()), undefined);
});
