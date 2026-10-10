// Observe-only guardrail: fail if production code spawns claude, reads Claude credentials, or calls the Anthropic API.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set(["node_modules", ".git", "docs", "dist", "fixtures", "packs"]);
// Self-exempt: these files must name the patterns they search for.
const ALLOW = new Set(["scripts/check-compliance.mjs", "scripts/check-compliance.test.mjs"]);
const EXT = /\.(m?[jt]s|tsx?|json|sh|ya?ml)$/;
// `claude plugin ...` (plugin management, never prompting) is the only sanctioned way to invoke the binary.
const PLUGIN_ONLY = String.raw`(?!\s+plugin\b|["'\x60]\s*,\s*\[\s*["'\x60]plugin["'\x60])`;
const RULES = [
  [new RegExp(String.raw`\b(spawn|exec|execFile|spawnSync|execSync|execFileSync|fork)\s*\(\s*["'\x60]claude\b` + PLUGIN_ONLY), "spawns claude"],
  [/["'`]claude\s+(?!plugin\b)\S/, "runs claude with a prompt or flags (only `claude plugin ...` is allowed)"],
  [/\.credentials\.json|oauth[_-]?token/i, "reads Claude credentials"],
  [/["'`]--print["'`]|["'`]claude["'`]\s*,\s*["'`]-p["'`]|["'`]-p["'`]\s*,\s*["'`]claude["'`]/, "runs claude non-interactively (-p/--print)"],
  [/api\.anthropic\.com|@anthropic-ai\/|from\s+["']anthropic["']/, "uses the Anthropic API/SDK"],
];

export function scanText(text) {
  return RULES.filter(([re]) => re.test(text)).map(([, why]) => why);
}

export function scanDir(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(root, p).replaceAll("\\", "/");
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) scanDir(root, p, out); continue; }
    if (!EXT.test(name) || ALLOW.has(rel) || /\.test\.[mc]?[jt]s$/.test(name) || name === "package-lock.json") continue;
    for (const why of scanText(readFileSync(p, "utf8"))) out.push(`${rel}: ${why}`);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bad = scanDir(process.cwd());
  if (bad.length) { console.error("compliance violations:\n" + bad.join("\n")); process.exit(1); }
  console.log("compliance ok");
}
