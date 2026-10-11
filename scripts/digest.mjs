#!/usr/bin/env node
// Daily digest from the stored events (local files only, counts and no free text). Read-only; writes stdout, opens no port.
// --counts drops the top-files list (file paths), leaving counts, tool names and agent types: the shareable digest (P7).
// Usage: node scripts/digest.mjs [--days 7] [--json] [--counts] [--home <dir>]
import { join } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { readEvents } from "../packages/server/src/store.ts";
import { summarize, toMarkdown, totals, totalsMarkdown } from "../packages/server/src/digest.ts";

const { values } = parseArgs({ options: { days: { type: "string", default: "7" }, json: { type: "boolean" }, counts: { type: "boolean" }, home: { type: "string" } } });
const home = values.home ?? process.env.AGENT_OFFICE_HOME ?? join(homedir(), ".agent-office");
const days = Math.min(Math.max(Number(values.days) || 7, 1), 90);
const { events } = await readEvents(home, { since: Date.now() - days * 86_400_000, limit: 1e6, text: !values.counts }); // text only for top-file paths
const rows = summarize(events), extra = totals(events);
if (values.counts) extra.topFiles = [];
console.log(values.json ? JSON.stringify({ days: rows, ...extra }, null, 2) : toMarkdown(rows) + totalsMarkdown(extra));
