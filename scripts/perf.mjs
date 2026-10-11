// Performance gate (P6): a throwaway daemon with 100 agents over 8 sessions and live tool traffic, the built web client in
// headless Chrome over CDP (Node's built-in WebSocket) with 4x CPU throttling; fails when frame p95 or live display
// objects exceed the budget. Also times the daemon's commit cost (POST /event round trips) at 100 agents.
// Usage: npm run build:web && npm run perf    Env: CHROME=<binary>, PERF_P95_MS, PERF_OBJECTS, PERF_SECONDS, PERF_AGENTS.
// Without a browser it skips (exit 0) locally and fails when CI=true.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Calibrated 2026-10 (README "Performance gate"): after removing a per-frame forced layout and an O(n^2) actor list,
// 3 local runs gave p95 13.6-14.5 ms and ~2640 objects at 108 actors with sessions collapsed.
// shortcut: calibrated on one local machine; if the CI runner is slower, measure there before loosening the 16 ms target.
export const BUDGET = { p95: 16, objects: 3500 };

/** Nearest-rank percentile of a list of numbers (0 for an empty list). */
export function pct(xs, p) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** Budget failures as readable lines ([] = pass). */
export function verdict(m, b) {
  const out = [];
  if (m.frames < 30) out.push(`only ${m.frames} frames sampled (page not animating?)`);
  if (m.p95 > b.p95) out.push(`frame p95 ${m.p95.toFixed(2)} ms > budget ${b.p95} ms`);
  if (m.objects > b.objects) out.push(`${m.objects} display objects > budget ${b.objects}`);
  return out;
}

/** CHROME env, then common install paths, then Playwright's cache. */
export function findChrome(env = process.env, exists = existsSync) {
  if (env.CHROME) return exists(env.CHROME) ? env.CHROME : null;
  const fixed = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"];
  const pw = join(homedir(), ".cache", "ms-playwright");
  let cached = [];
  try {
    for (const d of readdirSync(pw)) for (const [sub, bin] of [["chrome-linux", "chrome"], ["chrome-linux64", "chrome"], ["chrome-headless-shell-linux64", "chrome-headless-shell"]]) cached.push(join(pw, d, sub, bin));
  } catch { cached = []; }
  return [...fixed, ...cached].find((p) => exists(p)) ?? null;
}

async function main() {
  const env = process.env, seconds = Number(env.PERF_SECONDS) || 10, agents = Number(env.PERF_AGENTS) || 100, SESS = 8;
  const budget = { p95: Number(env.PERF_P95_MS) || BUDGET.p95, objects: Number(env.PERF_OBJECTS) || BUDGET.objects };
  const chrome = findChrome();
  if (!chrome) {
    console.log("perf: no Chrome/Chromium found (set CHROME=<binary>); skipped.");
    process.exit(env.CI === "true" ? 1 : 0);
  }
  if (!existsSync(fileURLToPath(new URL("../packages/web/dist/index.html", import.meta.url)))) { console.error("perf: run `npm run build:web` first"); process.exit(1); }

  const tmp = mkdtempSync(join(tmpdir(), "ao-perf-")), prof = mkdtempSync(join(tmpdir(), "ao-perf-chrome-"));
  const kids = [];
  const cleanup = () => { for (const k of kids) k.kill("SIGKILL"); for (const d of [tmp, prof]) rmSync(d, { recursive: true, force: true }); };
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
  process.on("exit", cleanup);

  // throwaway daemon (same start as scripts/stress.mjs)
  const [maj, min] = process.versions.node.split(".").map(Number);
  const daemon = spawn(process.execPath, [...(maj === 22 && min < 18 ? ["--experimental-strip-types"] : []), fileURLToPath(new URL("../packages/server/src/main.ts", import.meta.url))],
    { env: { ...env, AGENT_OFFICE_HOME: tmp, AGENT_OFFICE_PORT: "0" }, stdio: ["ignore", "pipe", "inherit"] });
  kids.push(daemon);
  const url = await new Promise((res) => { let b = ""; daemon.stdout.on("data", (d) => { b += d; const m = /listening on (http:\/\/\S+)/.exec(b); if (m) res(m[1].replace(/\/$/, "")); }); daemon.on("exit", () => res("")); });
  if (!url) { console.error("perf: could not start a throwaway daemon"); process.exit(1); }
  const token = readFileSync(join(tmp, "token"), "utf8").trim();
  const post = (e) => fetch(`${url}/event`, { method: "POST", headers: { "x-agent-office-token": token }, body: JSON.stringify(e) }).then((r) => r.arrayBuffer());
  /** Mean ms per sequential POST over n tool events (the commit cost a hook pays). */
  const commitMs = async (n) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) await post({ hook_event_name: i % 2 ? "PostToolUse" : "PreToolUse", session_id: `s${i % SESS}`, agent_id: `a${i % agents}`, tool_name: "Read", tool_input: { file_path: `/work/p${i % SESS}/f${i}.ts` } });
    return (performance.now() - t0) / n;
  };

  const types = ["backend-dev", "frontend-dev", "qa-engineer", "reviewer", "researcher", "general-purpose", "devops", "docs-writer", "architect", "security-auditor"];
  for (let i = 0; i < SESS; i++) await post({ hook_event_name: "SessionStart", session_id: `s${i}`, cwd: `/work/p${i}` });
  const empty = await commitMs(200);
  for (let n = 0; n < agents; n++) {
    const type = types[(n * 3 + (n >> 2)) % types.length];
    await post({ hook_event_name: "SubagentStart", session_id: `s${n % SESS}`, agent_id: `a${n}`, agent_type: type === "general-purpose" ? type : `agent-office:${type}` });
  }
  const full = await commitMs(400);

  // headless Chrome, DevTools endpoint from stderr
  const chromeProc = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${prof}`, "--no-first-run", "--no-default-browser-check",
    "--window-size=1440,900", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    ...(process.getuid?.() === 0 || env.CI === "true" ? ["--no-sandbox"] : []), "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  kids.push(chromeProc);
  const wsBrowser = await new Promise((res) => { let b = ""; chromeProc.stderr.on("data", (d) => { b += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(b); if (m) res(m[1]); }); chromeProc.on("exit", () => res("")); setTimeout(() => res(""), 20_000); });
  if (!wsBrowser) { console.error("perf: Chrome did not expose a DevTools endpoint"); process.exit(1); }
  const page = (await (await fetch(`http://${new URL(wsBrowser).host}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const waiting = new Map();
  ws.onmessage = (m) => { const r = JSON.parse(m.data); const w = waiting.get(r.id); if (w) { waiting.delete(r.id); r.error ? w.rej(new Error(r.error.message)) : w.res(r.result); } };
  const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await cdp("Page.navigate", { url: `${url}/` });
  const deadline = Date.now() + 30_000;
  while (!(await evalJs(`globalThis.__aoPerf?.actors() >= ${Math.min(agents, 64)}`).catch(() => false))) {
    if (Date.now() > deadline) { console.error("perf: the office never showed the agents (is the web build current?)"); process.exit(1); }
    await sleep(250);
  }

  const viewed = await commitMs(400); // same, with the browser subscribed to /stream (each commit is sent to it)

  // live tool traffic for the rest of the run: ~25 events/s spread over every agent
  let tick = 0, stop = false;
  const traffic = (async () => {
    while (!stop) {
      const n = tick++ % agents;
      await post(tick % 2 ? { hook_event_name: "PreToolUse", session_id: `s${n % SESS}`, agent_id: `a${n}`, tool_name: ["Edit", "Read", "Bash", "Grep"][tick % 4], tool_input: { file_path: `/work/p${n % SESS}/f${tick % 40}.ts` } }
        : { hook_event_name: "PostToolUse", session_id: `s${n % SESS}`, agent_id: `a${n}`, tool_name: "Edit" }).catch(() => {});
      await sleep(40);
    }
  })();
  await cdp("Emulation.setCPUThrottlingRate", { rate: 4 });
  await sleep(5000); // warm-up: walk-ins, texture bakes
  await evalJs("__aoPerf.reset()");
  if (env.PERF_PROFILE) { await cdp("Profiler.enable"); await cdp("Profiler.start"); } // opt-in: a .cpuprofile of the measured window (open in DevTools)
  await sleep(seconds * 1000);
  if (env.PERF_PROFILE) writeFileSync(env.PERF_PROFILE, JSON.stringify((await cdp("Profiler.stop")).profile));
  const frames = await evalJs("__aoPerf.frames()"), objects = await evalJs("__aoPerf.objects()"), actors = await evalJs("__aoPerf.actors()");
  stop = true;
  await traffic;
  ws.close();

  const m = { frames: frames.length, p50: pct(frames, 50), p95: pct(frames, 95), max: Math.max(0, ...frames), objects, actors };
  console.log(`perf: ${agents} agents / ${SESS} sessions, ${actors} actors on screen, CPU 4x throttled, ${seconds}s`);
  console.log(`  frame main-thread ms: p50 ${m.p50.toFixed(2)}  p95 ${m.p95.toFixed(2)}  max ${m.max.toFixed(2)}  (${m.frames} frames; budget p95 ${budget.p95})`);
  console.log(`  display objects: ${objects} (budget ${budget.objects})`);
  console.log(`  daemon commit: ${empty.toFixed(2)} ms/event with 0 agents, ${full.toFixed(2)} ms/event with ${agents}, ${viewed.toFixed(2)} with ${agents} and a browser on /stream (~${Math.round(1000 / viewed)} events/s sequential)`);
  const bad = verdict(m, budget);
  for (const b of bad) console.error(`perf FAIL: ${b}`);
  process.exit(bad.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
