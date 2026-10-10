// Plays a fake multi-session scenario against the daemon. Usage: npm run demo
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const HOME = process.env.AGENT_OFFICE_HOME ?? join(homedir(), ".agent-office");
const PORT = process.env.AGENT_OFFICE_PORT ?? (() => { try { return readFileSync(join(HOME, "port"), "utf8").trim(); } catch { return 4747; } })();
const TOKEN = readFileSync(join(HOME, "token"), "utf8").trim(); // the daemon requires it on /event
const URL = `http://127.0.0.1:${PORT}/event`;
const post = (e) => fetch(URL, { method: "POST", headers: { "x-agent-office-token": TOKEN }, body: JSON.stringify(e) }).catch(() => console.error("daemon not running?"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const start = (s, id, type) => post({ hook_event_name: "SubagentStart", session_id: s, agent_id: id, agent_type: `agent-office:${type}` });
const stop = (s, id, msg) => post({ hook_event_name: "SubagentStop", session_id: s, agent_id: id, last_assistant_message: msg });
const tool = (s, id, name, input) => post({ hook_event_name: "PreToolUse", session_id: s, agent_id: id, tool_name: name, tool_input: input });
const lead = (s, name, input) => tool(s, undefined, name, input);
const delegate = (s, type, description) => lead(s, "Agent", { subagent_type: `agent-office:${type}`, description });
const spawn = async (s, id, type, description) => { await delegate(s, type, description); await sleep(150); await start(s, id, type); };

await post({ hook_event_name: "SessionStart", session_id: "s1", cwd: "/work/shop-api" });
await sleep(900);
await post({ hook_event_name: "SessionStart", session_id: "s2", cwd: "/work/landing-page" });
await sleep(900);
await post({ hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: "Add a discount-code field to checkout, with API support and tests" });
await sleep(1500);
await lead("s1", "Read", { file_path: "/work/shop-api/src/checkout.ts" });
await sleep(1200);
await spawn("s1", "arch", "architect", "Design discount code data model + endpoint");
await sleep(2500);
await tool("s1", "arch", "Read", { file_path: "/work/shop-api/src/models/order.ts" });
await sleep(1800);
await stop("s1", "arch", "DONE: Add DiscountCode model, POST /checkout/discount, UI field in CartSummary");
await sleep(5200);

// fan-out: three devs + two QA at once
await spawn("s1", "be1", "backend-dev", "Implement DiscountCode model and POST /checkout/discount");
await spawn("s1", "be2", "backend-dev", "Add discount validation + totals recalculation");
await spawn("s1", "fe1", "frontend-dev", "Add discount-code input to CartSummary");
await spawn("s1", "qa1", "qa-engineer", "Write API tests for discount endpoint");
await spawn("s1", "qa2", "qa-engineer", "Write checkout UI tests for discount field");
await spawn("s1", "qa3", "qa-engineer", "Regression sweep on existing cart tests"); // 3rd QA => temp
await spawn("s1", "qa4", "qa-engineer", "Check price rounding edge cases");
await spawn("s1", "qa5", "qa-engineer", "Load test the discount endpoint");        // queued
await spawn("s2", "x1", "researcher", "Find best hero-image sizes for LCP");
await sleep(2500);
for (let i = 0; i < 3; i++) {
  await tool("s1", "be1", "Edit", { file_path: "/work/shop-api/src/discount.ts" });
  await tool("s1", "be2", "Bash", { command: "npm test -- discount" });
  await tool("s1", "fe1", "Write", { file_path: "/work/shop-api/web/CartSummary.tsx" });
  await tool("s1", "qa1", "Read", { file_path: "/work/shop-api/test/checkout.test.ts" });
  await sleep(1800);
}
await post({ hook_event_name: "Notification", session_id: "s2", message: "Claude needs your permission to use WebFetch" });
await sleep(3000);
await stop("s1", "be1", "DONE: DiscountCode model + endpoint added, 4 files");
await sleep(2500);
await stop("s1", "fe1", "DONE: discount field wired into CartSummary");
await sleep(2500);
await stop("s2", "x1", "DONE: use 1600w AVIF hero, preload it, LCP -480ms");
await sleep(2500);
for (const [id, m] of [["be2", "DONE: totals recalculated, validation covered"], ["qa1", "DONE: 9 API tests pass"], ["qa2", "BLOCKED: no UI test harness in repo"], ["qa3", "DONE: no regressions"], ["qa4", "DONE: rounding ok to 2dp"], ["qa5", "DONE: 120 rps, p95 80ms"]]) {
  await stop("s1", id, m);
  await sleep(1800);
}
await post({ hook_event_name: "Stop", session_id: "s1" });
await sleep(6000);
await post({ hook_event_name: "SessionEnd", session_id: "s1" });
await post({ hook_event_name: "SessionEnd", session_id: "s2" });
