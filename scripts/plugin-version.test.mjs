import { test } from "node:test";
import assert from "node:assert/strict";
import { installedVersion } from "./plugin-version.mjs";

test("reads the installed version, undefined when absent", () => {
  assert.equal(installedVersion("  agent-office@agent-office\n    Version: 0.0.1\n    Scope: user\n"), "0.0.1");
  assert.equal(installedVersion("other@x\n Version: 9\n"), undefined);
});

test("installedVersion ignores another plugin's Version line", async () => {
  const { installedVersion } = await import("./plugin-version.mjs");
  assert.equal(installedVersion("agent-office@agent-office (user)\n  Status: enabled\n\nother-plugin@market\n  Version: 9.9.9\n"), undefined);
  assert.equal(installedVersion("agent-office@agent-office (user)\n  Version: 1.4.2\n  Status: enabled\n\nother@m\n  Version: 9.9.9\n"), "1.4.2");
});
