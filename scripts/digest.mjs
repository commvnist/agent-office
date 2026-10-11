#!/usr/bin/env node
// Daily digest from the stored event log (local file only, counts and no free text).
// Usage: node scripts/digest.mjs [--days 7] [--json] [--home <dir>]
import { join } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { loadEvents } from "../packages/server/src/store.ts";
import { summarize, toMarkdown, totals, totalsMarkdown } from "../packages/server/src/digest.ts";

const { values } = parseArgs({ options: { days: { type: "string", default: "7" }, json: { type: "boolean" }, home: { type: "string" } } });
const home = values.home ?? process.env.AGENT_OFFICE_HOME ?? join(homedir(), ".agent-office");
const days = Math.min(Math.max(Number(values.days) || 7, 1), 90);
const events = loadEvents(join(home, "events.jsonl"), Date.now() - days * 86_400_000, 1e6);
const rows = summarize(events), extra = totals(events);
console.log(values.json ? JSON.stringify({ days: rows, ...extra }, null, 2) : toMarkdown(rows) + totalsMarkdown(extra));
