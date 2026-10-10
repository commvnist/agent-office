#!/usr/bin/env node
// agent-office CLI: status | stop | doctor | uninstall [--purge]. Usage: node scripts/office.mjs <cmd>
import { readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { endpoint } from "../plugin/hooks/forward.mjs";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 6)) {
  console.error(`agent-office needs Node 22.6 or newer (found ${process.versions.node}).`);
  process.exit(1);
}

const HOME = process.env.AGENT_OFFICE_HOME ?? join(homedir(), ".agent-office");
const WEB = fileURLToPath(new URL("../packages/web/dist/index.html", import.meta.url));
const token = () => { try { return readFileSync(join(HOME, "token"), "utf8").trim(); } catch { return ""; } };
const base = () => { const { host, port } = endpoint(); return `http://${host === "::1" ? "[::1]" : host}:${port}`; };
const get = async (path, auth) => {
  const r = await fetch(base() + path, { headers: auth ? { "x-agent-office-token": token() } : {}, signal: AbortSignal.timeout(1500) });
  return { status: r.status, body: await r.text() };
};
const health = async () => { try { const r = await get("/health"); return r.status === 200 ? JSON.parse(r.body) : null; } catch { return null; } };

const cmds = {
  async status() {
    const h = await health();
    if (!h) return console.log("not running"), 1;
    const s = await get("/status", true);
    console.log(`running (pid ${h.pid}, v${h.version}, ${base()})${h.warning ? "\nwarning: " + h.warning : ""}`);
    console.log(s.status === 200 ? s.body.trim() : `status unavailable (HTTP ${s.status})`);
  },
  async stop() {
    const h = await health();
    if (!h) return console.log("not running"), 0;
    const r = await fetch(base() + "/shutdown", { method: "POST", headers: { "x-agent-office-token": token() }, signal: AbortSignal.timeout(1500) });
    console.log(r.status === 200 ? `stopped (pid ${h.pid})` : `shutdown refused (HTTP ${r.status}); try: kill ${h.pid}`);
    return r.status === 200 ? 0 : 1;
  },
  async doctor() {
    let bad = 0;
    const row = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) bad++; };
    row(true, `Node ${process.versions.node}`);
    const h = await health();
    row(!!h, h ? `daemon reachable at ${base()} (pid ${h.pid})` : `daemon not reachable at ${base()} (npm run server)`);
    if (h?.warning) row(false, h.warning);
    try {
      const m = statSync(join(HOME, "token")).mode & 0o777;
      row(process.platform === "win32" || (m & 0o077) === 0, `token file ${HOME}/token mode ${m.toString(8)}`);
    } catch { row(false, "token file missing (start the daemon once)"); }
    if (h) { const r = await get("/status", true).catch(() => null); row(r?.status === 200, "hooks can authenticate (token accepted)"); }
    row(existsSync(WEB), existsSync(WEB) ? "web client built" : "web client not built (npm run build:web)");
    const entry = (() => { try { return readFileSync(join(HOME, "daemon"), "utf8").trim(); } catch { return ""; } })();
    row(!!entry && existsSync(entry), entry ? `daemon entry ${entry}` : "daemon entry not recorded (npm run setup); hooks cannot auto-start it from the plugin cache");
    const pl = spawnSync("claude", ["plugin", "list"], { encoding: "utf8" });
    if (pl.error || pl.status !== 0) console.log("skip `claude` CLI not available; cannot check the plugin install");
    else row(pl.stdout.includes("agent-office"), pl.stdout.includes("agent-office") ? "plugin installed in Claude Code" : "plugin not installed (npm run setup)");
    const cfg = join(HOME, "office.json");
    if (existsSync(cfg)) {
      try { JSON.parse(readFileSync(cfg, "utf8")); row(true, "office.json parses"); } catch (e) { row(false, `office.json: ${e.message}`); }
      if (h) { const s = JSON.parse((await get("/state", true)).body); row(!s.configError, s.configError ? `office.json invalid: ${s.configError.message}` : "office.json valid"); }
    } else row(true, "office.json absent (built-in roster)");
    return bad ? 1 : 0;
  },
  async uninstall() {
    if (process.argv.includes("--purge")) { rmSync(HOME, { recursive: true, force: true }); console.log(`deleted ${HOME}`); return 0; }
    console.log(`To uninstall:
  1. /plugin uninstall agent-office@agent-office   (or stop passing --plugin-dir ./plugin)
  2. node scripts/office.mjs stop
  3. delete ${HOME} (config, token, event log); rerun with --purge to do it now`);
    return 0;
  },
};

const fn = cmds[process.argv[2]];
if (!fn) { console.error("usage: node scripts/office.mjs status|stop|doctor|uninstall [--purge]"); process.exit(2); }
process.exitCode = (await fn()) ?? 0;
