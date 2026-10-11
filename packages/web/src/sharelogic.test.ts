import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLink, mostRecent, parseLink, toolTracker } from "./sharelogic.ts";
import { parseFlags } from "./flags.ts";

test("permalink round-trips and drops junk", () => {
  const l = { sel: "lead:s1", s: "s1", k: "report", a: "Ada", v: "timeline" } as const;
  assert.deepEqual(parseLink(buildLink(l)), l);
  assert.equal(buildLink({ v: "wall", sel: "x" }), "#wall&sel=x");
  assert.equal(parseLink("#wall&sel=x").v, "wall");
  assert.deepEqual(parseLink("#v=evil&fl=wild"), { sel: "", s: "", k: "", a: "", v: "" });
  assert.equal(buildLink({}), "");
});

test("tool tracker keeps 12, marks errors and durations on the previous call", () => {
  const t = toolTracker();
  t.feed("a", { doing: "Read", detail: "a.ts", busyAt: 1, errors: 0 });
  t.feed("a", { doing: "Bash", detail: "ls", busyAt: 2, errors: 1, lastDurationMs: 40 });
  const h = t.get("a");
  assert.deepEqual(h.map((c) => [c.tool, c.ok, c.ms]), [["Read", false, 40], ["Bash", true, undefined]]);
  for (let i = 3; i < 30; i++) t.feed("a", { doing: "Edit", busyAt: i });
  assert.equal(t.get("a").length, 12);
  assert.equal(t.get("none").length, 0);
});

test("mostRecent prefers the latest tool call, leads included", () => {
  const s = { sessions: { s1: { id: "s1", startedAt: 5, busyAt: 50 } }, agents: { a1: { id: "a1", busyAt: 40 }, a2: { id: "a2", busyAt: 60 } } } as never;
  assert.equal(mostRecent(s), "a2");
});

test("flags: obs presets imply overlay and a fixed size; kiosk and streamsafe parse", () => {
  const f = parseFlags("?preset=obs-720&kiosk&streamsafe=0");
  assert.deepEqual([f.obs, f.overlay, f.size, f.kiosk, f.streamSafe], [true, true, [1280, 720], true, false]);
  assert.equal(parseFlags("?overlay").overlay, true);
  assert.equal(parseFlags("?overlay=0").overlay, false);
  assert.equal(parseFlags("").streamSafe, null);
});
