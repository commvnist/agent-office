#!/usr/bin/env node
// One-command setup for Claude Code users: npm run setup [-- --dry-run | --uninstall]
// Installs the plugin through Claude Code's own `claude plugin` commands (plugin management only; it never prompts
// Claude), records where the daemon lives so hooks can auto-start it, builds the web client, and starts the daemon.
import { spawnSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { installedVersion } from "./plugin-version.mjs";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOME = process.env.AGENT_OFFICE_HOME ?? join(homedir(), ".agent-office");
const MARKET = "agent-office", PLUGIN = "agent-office@agent-office";
const dry = process.argv.includes("--dry-run"), uninstall = process.argv.includes("--uninstall");

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 6)) {
  console.error(`agent-office needs Node 22.6 or newer (found ${process.versions.node}). Upgrade with nvm (nvm install 22), fnm (fnm install 22) or from nodejs.org.`);
  process.exit(1);
}

// A custom-port daemon records its port in HOME/port; env wins, then that file, then the default.
const port = () => process.env.AGENT_OFFICE_PORT ?? (() => { try { return readFileSync(join(HOME, "port"), "utf8").trim() || 4747; } catch { return 4747; } })();
const say = (ok, msg) => console.log(`${ok ? "ok  " : "..  "} ${msg}`);
const run = (cmd, args, opts = {}) => {
  if (dry) { console.log(`     would run: ${cmd} ${args.join(" ")}`); return { status: 0, stdout: "" }; }
  return spawnSync(cmd, args, { encoding: "utf8", cwd: ROOT, ...opts });
};
// The only way this script touches the binary: `claude plugin ...` (plugin management, never prompting).
const plugin = (args) => {
  if (dry && args[0] !== "--help" && args[0] !== "list" && args.join(" ") !== "marketplace list") { console.log(`     would run: claude plugin ${args.join(" ")}`); return { status: 0, stdout: "", stderr: "" }; }
  return spawnSync("claude", ["plugin", ...args], { encoding: "utf8" });
};
const hasClaude = () => plugin(["--help"]).status === 0;
const listed = (args) => { const r = plugin(args); return r.status === 0 ? r.stdout : ""; };

if (!hasClaude()) {
  say(false, "`claude` is not on PATH, so I cannot install the plugin for you. Inside Claude Code run:");
  console.log(`\n     /plugin marketplace add ${ROOT}\n     /plugin install ${PLUGIN}\n`);
}

if (uninstall) {
  if (hasClaude()) {
    plugin(["uninstall", PLUGIN]);
    plugin(["marketplace", "remove", MARKET]);
    say(true, "plugin and marketplace removed");
  }
  // Without this a still-loaded plugin's hooks would relaunch the daemon from the recorded path.
  if (!dry) rmSync(join(HOME, "daemon"), { force: true });
  run(process.execPath, [join(ROOT, "scripts/office.mjs"), "stop"], { stdio: "inherit" });
  console.log(`State in ${HOME} was left in place (delete it with: node scripts/office.mjs uninstall --purge).`);
  process.exit(0);
}

// 1. web client (the daemon serves it)
if (!existsSync(join(ROOT, "packages/web/dist/index.html"))) {
  if (!existsSync(join(ROOT, "node_modules"))) { console.error("dependencies are not installed: run `npm install` in the repo, then rerun setup"); process.exit(1); }
  say(false, "building the web client (npm run build:web)");
  const r = run("npm", ["run", "build:web"], { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error("web build failed (see the output above); fix it and run `npm run build:web`"); process.exit(1); }
} else say(true, "web client built");

// 2. tell the hook forwarder where the daemon is (an installed plugin lives in Claude Code's plugin cache)
const entry = join(ROOT, "packages/server/src/main.ts");
if (!dry) { mkdirSync(HOME, { recursive: true }); writeFileSync(join(HOME, "daemon"), entry + "\n"); }
say(true, `daemon entry recorded (${HOME}/daemon)`);

// 3. plugin install, idempotent
if (hasClaude()) {
  if (listed(["marketplace", "list"]).includes(MARKET)) say(true, "marketplace already added");
  else {
    const r = plugin(["marketplace", "add", ROOT, "--scope", "user"]);
    say(r.status === 0, r.status === 0 ? "marketplace added" : `marketplace add failed: ${(r.stderr || r.stdout || "").trim()}`);
  }
  if (listed(["list"]).includes(PLUGIN)) {
    // `install` is a no-op for an installed plugin and `list` reports the SOURCE version, so a stale cached copy looked current:
    // refresh the marketplace, then update (the cache only changes when the manifest version was bumped).
    say(true, "plugin already installed (updating from this checkout)");
    plugin(["marketplace", "update", MARKET]);
    const u = plugin(["update", PLUGIN, "--scope", "user"]);
    say(u.status === 0, u.status === 0 ? "plugin updated (bump plugin/.claude-plugin/plugin.json version when hooks change)" : `plugin update failed: ${(u.stderr || u.stdout || "").trim()}`);
  } else {
    const r = plugin(["install", PLUGIN, "--scope", "user"]);
    say(r.status === 0, r.status === 0 ? "plugin installed" : `plugin install failed: ${(r.stderr || r.stdout || "").trim()}`);
  }
  // A cached copy can stay old after "install": compare with this checkout and ask for an update once.
  const want = JSON.parse(readFileSync(join(ROOT, "plugin/.claude-plugin/plugin.json"), "utf8")).version;
  let have = installedVersion(listed(["list"]));
  if (!dry && have && have !== want) { plugin(["update", PLUGIN]); have = installedVersion(listed(["list"])); }
  if (!dry && have) say(have === want, have === want ? `plugin v${have} matches this checkout` : `installed plugin is v${have}, checkout is v${want}: run /plugin update in Claude Code, then /reload-plugins`);
}

// 4. start the daemon now (hooks would also start it at the next session)
const up = async () => { try { return (await fetch(`http://127.0.0.1:${port()}/health`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };
if (!dry && !(await up())) {
  const old = major === 22 && minor < 18 ? ["--experimental-strip-types"] : []; // same flags as the other spawns (office.mjs, forward.mjs)
  spawn(process.execPath, [...old, entry], { detached: true, stdio: "ignore", env: process.env, windowsHide: true }).unref();
  for (let i = 0; i < 20 && !(await up()); i++) await new Promise((r) => setTimeout(r, 150));
}
say(dry || (await up()), dry ? "would start the daemon" : "daemon running");

console.log(`
Done. In Claude Code run /reload-plugins (or start a new session), then open:
     http://localhost:${port()}
Check anything with: node scripts/office.mjs doctor`);
