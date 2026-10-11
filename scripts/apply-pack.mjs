// Apply a role pack. Usage: node scripts/apply-pack.mjs <pack-name|pack-dir|pack.json> [--agents-dir <dir>] [--force] [--dry-run] [--undo] | --list
// Pack format: { name, description, roles: <office.json roles>, agents: { "<name>": "<md path relative to the pack>" } }
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve, isAbsolute } from "node:path";
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
    // Pack files are untrusted: the name becomes a filename and the source must be a relative .md path.
    if (!/^[\w-]+$/.test(name)) throw new Error(`bad agent name: ${name}`);
    if (typeof rel !== "string" || isAbsolute(rel) || !rel.endsWith(".md")) throw new Error(`bad agent source for ${name}: ${rel}`);
    const to = join(agentsDir, `${name}.md`);
    if (exists(to)) conflicts.push(`agent file ${to}`);
    return { from: resolve(packDir, rel), to };
  });
  return { config: { ...existing, roles }, copies, conflicts };
}

const PACKS = fileURLToPath(new URL("../plugin/packs/", import.meta.url));

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { "agents-dir": { type: "string" }, force: { type: "boolean" }, "dry-run": { type: "boolean" }, list: { type: "boolean" }, undo: { type: "boolean" } } });
  if (values.list) {
    for (const n of readdirSync(PACKS)) try { const p = JSON.parse(readFileSync(join(PACKS, n, "pack.json"), "utf8")); console.log(`${n}: ${p.description ?? ""}`); } catch { /* not a pack */ }
    return;
  }
  const arg = positionals[0];
  if (!arg) throw new Error("usage: apply-pack <pack-name|pack-dir|pack.json> [--agents-dir <dir, default ./.claude/agents>] [--force] [--dry-run] [--undo] | --list");
  const target = existsSync(arg) ? arg : join(PACKS, arg);
  const agentsDir = values["agents-dir"] ?? join(process.cwd(), ".claude", "agents");
  const file = statSync(target).isDirectory() ? join(target, "pack.json") : target;
  const pack = JSON.parse(readFileSync(file, "utf8"));
  const home = process.env.AGENT_OFFICE_HOME ?? join(homedir(), ".agent-office");
  const cfgPath = join(home, "office.json");
  const existing = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
  const plan = planPack(pack, existing, dirname(file), resolve(agentsDir));
  const dry = values["dry-run"] ? "[dry-run] " : "";
  if (values.undo) {
    // Restores the `.bak` files a forced apply left; agent files the pack newly created have no backup and stay.
    for (const f of [cfgPath, ...plan.copies.map((c) => c.to)]) {
      if (!existsSync(f + ".bak")) continue;
      console.log(`${dry}restore ${f}`);
      if (!values["dry-run"]) { copyFileSync(f + ".bak", f); unlinkSync(f + ".bak"); }
    }
    return;
  }
  if (plan.conflicts.length && !values.force) throw new Error(`would overwrite: ${plan.conflicts.join(", ")} (use --force)`);
  console.log(`${dry}pack ${pack.name}: ${Object.keys(pack.roles).length} roles -> ${cfgPath}; ${plan.copies.length} agents -> ${agentsDir}`);
  if (values["dry-run"]) return;
  mkdirSync(home, { recursive: true });
  // Keep the first backup: a second --force run must not overwrite the original with an earlier pack's output.
  const bak = (f) => { if (existsSync(f) && !existsSync(f + ".bak")) copyFileSync(f, f + ".bak"); };
  bak(cfgPath);
  writeFileSync(cfgPath, JSON.stringify(plan.config, null, 2) + "\n");
  mkdirSync(agentsDir, { recursive: true });
  for (const c of plan.copies) { bak(c.to); copyFileSync(c.from, c.to); }
  console.log("backups kept as *.bak; revert with --undo");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
