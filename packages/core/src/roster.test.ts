import { test } from "node:test";
import assert from "node:assert/strict";
import { leadRoster, introFor } from "./roster.ts";
import type { OfficeConfig, OfficeState } from "./types.ts";

const cfg: OfficeConfig = { roles: { be: { agent: "backend-dev", count: 1, names: ["Ann"] }, fe: { agent: "frontend-dev", count: 1 } } };

test("leadRoster honors parallelism mode", () => {
  assert.doesNotMatch(leadRoster({ ...cfg, parallelism: "off" }), /Parallelism/);
  assert.match(leadRoster(cfg), /Parallelism: auto.*Size gate/s);
  assert.match(leadRoster({ ...cfg, parallelism: "aggressive" }), /Parallelism: aggressive/);
  assert.match(leadRoster(cfg), /backend-dev: 1 on the core team \(Ann\)/);
});

test("introFor includes task, peer tasks and report contract", () => {
  const state = {
    agents: {
      a: { id: "a", role: "backend-dev", task: "build\nthe API", seat: { name: "Ann", kind: "permanent" } },
      b: { id: "b", role: "frontend-dev", task: "x".repeat(200), seat: { name: "Bob", kind: "permanent" } },
    },
  } as unknown as OfficeState;
  const t = introFor(cfg, state, "a")!;
  assert.match(t, /Your task: build the API/);
  assert.match(t, /Bob \(frontend-dev\): x+…/);
  assert.match(t, /DONE: .*BLOCKED: .*PARTIAL:/);
  assert.equal(introFor(cfg, state, "zzz"), null);
});
