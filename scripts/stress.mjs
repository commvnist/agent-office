// Stress office: a throwaway daemon (temp HOME, free port) with 40 agents (default) over 4 sessions, mixed types incl. unmapped "general-purpose".
// Usage: node scripts/stress.mjs [--seconds N] [--agents N]   (prints the URL, stays up until Ctrl+C or N seconds)
import { spawn as launch } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (k, d) => Number(process.argv[process.argv.indexOf(k) + 1]) || d;
const secs = arg("--seconds", 0), agents = arg("--agents", 40);
const tmp = mkdtempSync(join(tmpdir(), "ao-stress-"));
const main = fileURLToPath(new URL("../packages/server/src/main.ts", import.meta.url));
const [maj, min] = process.versions.node.split(".").map(Number);
const child = launch(process.execPath, [...(maj === 22 && min < 18 ? ["--experimental-strip-types"] : []), main],
  { env: { ...process.env, AGENT_OFFICE_HOME: tmp, AGENT_OFFICE_PORT: "0" }, stdio: ["ignore", "pipe", "inherit"] });
const cleanup = () => { child.kill(); rmSync(tmp, { recursive: true, force: true }); };
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { cleanup(); process.exit(130); });
process.on("exit", cleanup);
const url = await new Promise((res) => { let b = ""; child.stdout.on("data", (d) => { b += d; const m = /listening on (http:\/\/\S+)/.exec(b); if (m) res(m[1]); }); child.on("exit", () => res("")); });
if (!url) { console.error("could not start a throwaway daemon"); process.exit(1); }
const token = readFileSync(join(tmp, "token"), "utf8").trim();
const post = (e) => fetch(`${url.replace(/\/$/, "")}/event`, { method: "POST", headers: { "x-agent-office-token": token }, body: JSON.stringify(e) });

const projects = ["shop-api", "landing-page", "infra", "mobile-app"];
const types = ["backend-dev", "frontend-dev", "qa-engineer", "reviewer", "researcher", "general-purpose", "devops", "docs-writer", "architect", "security-auditor"];
for (const [i, p] of projects.entries()) await post({ hook_event_name: "SessionStart", session_id: `s${i}`, cwd: `/work/${p}` });
for (let n = 0; n < agents; n++) {
  const s = `s${n % 4}`, type = types[(n * 3 + (n >> 2)) % types.length];
  await post({ hook_event_name: "SubagentStart", session_id: s, agent_id: `a${n}`, agent_type: type === "general-purpose" ? type : `agent-office:${type}` });
  if (n % 3 === 0) await post({ hook_event_name: "PreToolUse", session_id: s, agent_id: `a${n}`, tool_name: "Edit", tool_input: { file_path: `/work/${projects[n % 4]}/f${n}.ts` } });
}
console.log(`stress office (isolated): ${url}\n${agents} agents, 4 sessions. Ctrl+C to stop${secs ? `, or wait ${secs}s` : ""}.`);
if (secs) setTimeout(() => process.exit(0), secs * 1000);
else setInterval(() => {}, 1 << 30);
