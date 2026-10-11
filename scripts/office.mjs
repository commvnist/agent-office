#!/usr/bin/env node
// agent-office CLI: status | start | restart | stop | doctor | init | config --validate | history [--purge] | uninstall [--purge]. Usage: node scripts/office.mjs <cmd>
import { readFileSync, existsSync, statSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { endpoint } from "../plugin/hooks/forward.mjs";
import { installedVersion } from "./plugin-version.mjs";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 6)) {
  console.error(`agent-office needs Node 22.6 or newer (found ${process.versions.node}).`);
  process.exit(1);
}

const HOME = process.env.AGENT_OFFICE_HOME ?? join(homedir(), ".agent-office");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB = fileURLToPath(new URL("../packages/web/dist/index.html", import.meta.url));
const token = () => { try { return readFileSync(join(HOME, "token"), "utf8").trim(); } catch { return ""; } };
const base = () => { const { host, port } = endpoint(); return `http://${host === "::1" ? "[::1]" : host}:${port}`; };
const get = async (path, auth) => {
  const r = await fetch(base() + path, { headers: auth ? { "x-agent-office-token": token() } : {}, signal: AbortSignal.timeout(1500) });
  return { status: r.status, body: await r.text() };
};
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
// Event-derived text (project, session) may hold ESC or other control bytes: drop them before printing.
const plain = (v) => String(v ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, "");
const age = (ms) => (ms < 90_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} min`);
const health = async () => { try { const r = await get("/health"); return r.status === 200 ? JSON.parse(r.body) : null; } catch { return null; } };

const cmds = {
  async status() {
    const h = await health();
    if (!h) return console.log("not running"), 1;
    const s = await get("/status?format=json", true);
    console.log(`running (pid ${h.pid}, v${h.version}, ${base()})${h.warning ? "\nwarning: " + h.warning : ""}`);
    if (s.status !== 200) return console.log(`status unavailable (HTTP ${s.status})`), 1;
    const j = JSON.parse(s.body);
    console.log(`${j.working} working, ${j.waiting} waiting, ${j.queued} queued; ${j.sessions} sessions, ${j.agents} agents`);
    console.log(j.lastEventAt ? `last event ${age(Date.now() - j.lastEventAt)} ago, ${j.events} events since daemon start` : "no events since daemon start (quiet, or hooks are not reaching it: npm run doctor)");
    for (const x of j.detail ?? []) console.log(`  ${plain(x.project)} ${x.state}, ${x.agents} agents${x.errors ? `, ${x.errors} errors` : ""}${x.lastAt ? `, last ${age(Date.now() - x.lastAt)} ago` : ""}`);
  },
  async start() {
    if (await health()) return console.log("already running"), 0;
    const entry = join(ROOT, "packages/server/src/main.ts");
    const old = major === 22 && minor < 18 ? ["--experimental-strip-types"] : [];
    spawn(process.execPath, [...old, entry], { detached: true, stdio: "ignore", env: process.env }).unref();
    for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 150)); if (await health()) return console.log(`started (${base()})`), 0; }
    console.log("did not come up; run `npm run server` to see the error");
    return 1;
  },
  async restart() {
    await cmds.stop();
    for (let i = 0; i < 20 && (await health()); i++) await new Promise((r) => setTimeout(r, 100));
    return cmds.start();
  },
  async init() {
    const cfg = join(HOME, "office.json");
    if (existsSync(cfg) && !process.argv.includes("--force")) return console.log(`${cfg} exists (use --force to overwrite)`), 1;
    mkdirSync(HOME, { recursive: true });
    const roles = readJson(join(ROOT, "plugin/packs/startup/pack.json")).roles;
    writeFileSync(cfg, JSON.stringify({ roles, parallelism: "auto", enforceSeats: false, privacy: false }, null, 2) + "\n");
    console.log(`wrote ${cfg}: edit names/counts, keys are documented in the README (JSON has no comments); validate with: node scripts/office.mjs config --validate`);
    return 0;
  },
  async config() {
    if (!process.argv.includes("--validate")) return console.error("usage: config --validate [file]"), 2;
    const file = process.argv.slice(4).find((a) => !a.startsWith("--")) ?? join(HOME, "office.json");
    let raw;
    try { raw = readFileSync(file, "utf8"); } catch { return console.log(`${file}: not found (built-in roster applies)`), 0; }
    let validateConfig, unknownKeys;
    try { ({ validateConfig, unknownKeys } = await import("../packages/server/src/config.ts")); }
    catch { return console.error("validation loads TypeScript: use Node 22.18+ or run with --experimental-strip-types"), 2; }
    try {
      const v = JSON.parse(raw);
      validateConfig(v, {});
      const u = unknownKeys(v);
      console.log(`ok   ${file}${u.length ? `\nwarn unknown keys ignored: ${u.join(", ")}` : ""}`);
      return 0;
    } catch (e) {
      const m = /position (\d+)/.exec(e.message);
      const line = m ? ` (line ${raw.slice(0, Number(m[1])).split("\n").length})` : "";
      console.log(`FAIL ${file}${line}: ${e.message}`);
      return 1;
    }
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
    try {
      const m = JSON.parse(readFileSync(join(HOME, "last-hook.json"), "utf8"));
      const ago = Math.round((Date.now() - m.t) / 1000);
      row(m.delivered, `last hook: ${m.event} ${age(ago * 1000)} ago (session ${plain(m.session)})${m.delivered ? "" : " but the daemon did not accept it"}${m.note ? `: ${m.note}` : ""}`);
    } catch { row(false, "no hook has ever fired: start a NEW Claude Code session (or /reload-plugins) and send a prompt, then rerun doctor"); }
    const pl = spawnSync("claude", ["plugin", "list"], { encoding: "utf8" });
    if (pl.error || pl.status !== 0) console.log("skip `claude` CLI not available; cannot check the plugin install");
    else {
      row(pl.stdout.includes("agent-office"), pl.stdout.includes("agent-office") ? "plugin installed in Claude Code" : "plugin not installed (npm run setup)");
      const want = readJson(join(ROOT, "plugin/.claude-plugin/plugin.json")).version, have = installedVersion(pl.stdout);
      if (have) row(have === want, have === want ? `installed plugin v${have} matches this checkout` : `installed plugin v${have} but this checkout is v${want} (npm run setup, then /reload-plugins)`);
    }
    if (h) { const want = readJson(join(ROOT, "packages/server/package.json")).version; row(h.version === want, h.version === want ? `daemon v${h.version} matches this checkout` : `daemon v${h.version} is older/newer than this checkout v${want} (node scripts/office.mjs restart)`); }
    const cfg = join(HOME, "office.json");
    if (existsSync(cfg)) {
      try { JSON.parse(readFileSync(cfg, "utf8")); row(true, "office.json parses"); } catch (e) { row(false, `office.json: ${e.message}`); }
      if (h) { const s = JSON.parse((await get("/state", true)).body); row(!s.configError, s.configError ? `office.json invalid: ${s.configError.message}` : "office.json valid"); }
    } else row(true, "office.json absent (built-in roster)");
    return bad ? 1 : 0;
  },
  async history() {
    // The on-disk history: the event log (and its backup) plus the opt-in raw log (AGENT_OFFICE_LOG).
    const files = ["events.jsonl", "events.jsonl.1", "events.log", "events.log.1"].map((f) => join(HOME, f)).filter((f) => existsSync(f));
    if (process.argv.includes("--purge")) {
      for (const f of files) rmSync(f, { force: true });
      console.log(files.length ? `deleted ${files.join(", ")}` : "no stored history");
      if (await health()) console.log("the running daemon still holds today's office in memory: node scripts/office.mjs restart clears it");
      return 0;
    }
    if (!files.length) return console.log(`no stored history in ${HOME}`), 0;
    for (const f of files) console.log(`${f}  ${Math.round(statSync(f).size / 1024)} KB`);
    console.log("kept for office.json historyHours (default 168); delete now with: node scripts/office.mjs history --purge");
    return 0;
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
if (!fn) { console.error("usage: node scripts/office.mjs status|start|restart|stop|doctor|init [--force]|config --validate [file]|history [--purge]|uninstall [--purge]"); process.exit(2); }
process.exitCode = (await fn()) ?? 0;
