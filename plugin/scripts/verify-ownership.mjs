#!/usr/bin/env node
// Usage: node verify-ownership.mjs '{"backend-dev":["server/**"],"qa-engineer":["tests/**"]}'  (or JSON on stdin)
// Compares `git status --porcelain` with the declared ownership; exit 1 on any violation.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const rx = (g) => {
  if (g.endsWith("/")) g += "**";
  const s = g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?|\*|\?/g, (m) => (m[0] === "*" && m[1] === "*" ? ".*" : m === "*" ? "[^/]*" : "[^/]"));
  return new RegExp(`^${s}$`);
};

/** Pure: returns [{file, problem, owners}] for changed files owned by nobody or by several agents. */
export function violations(owners, files) {
  const compiled = Object.entries(owners).map(([a, gs]) => [a, gs.map(rx)]);
  const out = [];
  for (const file of files) {
    if (file.startsWith(".office/")) continue;
    const who = compiled.filter(([, rs]) => rs.some((r) => r.test(file))).map(([a]) => a);
    if (who.length === 0) out.push({ file, problem: "unowned", owners: who });
    else if (who.length > 1) out.push({ file, problem: "overlap", owners: who });
  }
  return out;
}

export function changedFiles() {
  const out = execFileSync("git", ["status", "--porcelain", "-uall"], { encoding: "utf8" });
  // "XY path" or "XY old -> new"; paths with spaces are quoted, which we strip.
  return out.split("\n").filter(Boolean).map((l) => l.slice(3).split(" -> ").pop().replace(/^"|"$/g, ""));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const raw = process.argv[2] ?? (await new Promise((r) => { let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => r(d)); }));
  const v = violations(JSON.parse(raw), changedFiles());
  for (const x of v) console.log(`${x.problem}: ${x.file}${x.owners.length ? ` (${x.owners.join(", ")})` : ""}`);
  console.log(v.length ? `${v.length} ownership violation(s)` : "ownership ok");
  process.exit(v.length ? 1 : 0);
}
