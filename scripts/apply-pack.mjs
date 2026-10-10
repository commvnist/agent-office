// Apply a role pack. Usage: node scripts/apply-pack.mjs <pack-dir|pack.json> --agents-dir <dir> [--force] [--dry-run]
// Pack format: { name, description, roles: <office.json roles>, agents: { "<name>": "<md path relative to the pack>" } }
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** Pure plan: merged office.json, files to copy, and conflicts (things that already exist and differ). */
export function planPack(pack, existing, packDir, agentsDir, exists = existsSync) {
  if (!pack?.roles || typeof pack.roles !== "object") throw new Error("pack.roles missing");
  const roles = { ...(existing.roles ?? {}) };
  const conflicts = [];
  for (const [k, v] of Object.entries(pack.roles)) {
    if (k in roles && JSON.stringify(roles[k]) !== JSON.stringify(v)) conflicts.push(`role ${k}`);
    roles[k] = v;
  }
  const copies = Object.entries(pack.agents ?? {}).map(([name, rel]) => {
    const to = join(agentsDir, `${name}.md`);
    if (exists(to)) conflicts.push(`agent file ${to}`);
    return { from: resolve(packDir, rel), to };
  });
  return { config: { ...existing, roles }, copies, conflicts };
}

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { "agents-dir": { type: "string" }, force: { type: "boolean" }, "dry-run": { type: "boolean" } } });
  const target = positionals[0];
  if (!target || !values["agents-dir"]) throw new Error("usage: apply-pack <pack-dir|pack.json> --agents-dir <dir> [--force] [--dry-run]");
  const file = statSync(target).isDirectory() ? join(target, "pack.json") : target;
  const pack = JSON.parse(readFileSync(file, "utf8"));
  const home = process.env.AGENT_OFFICE_HOME ?? join(homedir(), ".agent-office");
  const cfgPath = join(home, "office.json");
  const existing = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
  const plan = planPack(pack, existing, dirname(file), resolve(values["agents-dir"]));
  if (plan.conflicts.length && !values.force) throw new Error(`would overwrite: ${plan.conflicts.join(", ")} (use --force)`);
  console.log(`${values["dry-run"] ? "[dry-run] " : ""}pack ${pack.name}: ${Object.keys(pack.roles).length} roles -> ${cfgPath}; ${plan.copies.length} agents -> ${values["agents-dir"]}`);
  if (values["dry-run"]) return;
  mkdirSync(home, { recursive: true });
  writeFileSync(cfgPath, JSON.stringify(plan.config, null, 2) + "\n");
  mkdirSync(values["agents-dir"], { recursive: true });
  for (const c of plan.copies) copyFileSync(c.from, c.to);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
