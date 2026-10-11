// DOM chrome (replaces legacy-dom.ts): radar, card, sessions, roster, feed, aria. A pure consumer of api.ts `office`.
// Ids come from index.html. Free text is only ever set with textContent.
import { office, type ActorInfo, type FeedItem } from "./api.ts";
import { hotFiles, leadId } from "@agent-office/core";
import { $, announce as domAnnounce, btn, clip, copy, el, renderIf, store, sync } from "./dom.ts";
import { bySession, burnHot, captionText, burnRate, cdCommand, filterFeed, fmtAge, fmtDur, fmtTokens, projectHue, quietBefore, radar, rosterGroups, sanitizeFilters, statusGroups, summary, sumUsage, urgency, usageTotal, whoLine, type FeedFilter, type RadarItem } from "./logic.ts";
import { bindPanelChrome } from "./panel.ts";
import { backToLive, bindModes, toggleSample } from "./modes.ts";
import { STATUS, STATUS_ORDER } from "./theme.ts";
import { clipWords, doneRows, dropOutcome, look, nextStep, outcomeLook, permLine, sessionAgg, aggLine, statusKey, statusWord, topTools, tree } from "./triage.ts";
import * as notify from "./notify.ts";
import { bindFun, ringsEl } from "./fundom.ts";
import { bindColonists } from "./colonists.ts";
import { buildLink, parseLink, toolTracker, type ToolCall } from "./sharelogic.ts";
import { hideText } from "./stream.ts";

const pick = (id: string) => { office.select(id); office.focus(id); office.pulse(id); };
const projectOf = (sid: string) => office.sessions().find((s) => s.id === sid)?.project ?? sid;
const FEEDBACK_MS = 1200;
/** Copy button that shows "Copied" / "Copy failed" for a moment, then its label again. */
const copyBtn = (label: string, text: string, title: string) =>
  btn(label, title, async (b) => { b.textContent = (await copy(text)) ? "Copied" : "Copy failed"; setTimeout(() => (b.textContent = label), FEEDBACK_MS); }, "b sm");
const loadJson = <T,>(k: string, fb: T): T => { try { return JSON.parse(store.get(k) ?? "") ?? fb; } catch { return fb; } };
const accent = (e: HTMLElement, project: string) => { e.classList.add("pc"); e.style.setProperty("--pc", `hsl(${projectHue(project)} 60% 65%)`); };
const stateOf = () => office.getEnvelope()?.state;
const signals = (sid: string) => stateOf()?.sessions[sid];
/** Live source with the daemon stream down: panel sections say so instead of looking empty. */
const offline = () => office.source.mode === "live" && office.connection.state === "retrying";
/** Leads of a waiting session read as waiting everywhere (radar, roster, session row). */
const effStatus = (a: ActorInfo) => (a.lead && a.status !== "blocked" && stateOf()?.sessions[a.session]?.waiting ? "waiting" : a.status);
/** The shared STATUS key of an actor (one map for every surface, A1). */
const keyOf = (a: ActorInfo) => statusKey(effStatus(a), stateOf()?.sessions[a.session]);
/** Status chip: colour from the shared map, plus glyph and word (never colour alone). */
const chip = (k: Parameters<typeof look>[0]) => { const c = el("span", "stc", statusWord(k)); c.style.setProperty("--st", look(k).color); return c; };

// ---- aria live regions: structure only, batched in dom.ts; blocked/waiting go to the assertive one ----
const announce = (s: string, hot = false) => domAnnounce(s, hot, office.source.mode === "live" ? Infinity : 3);

// ---- radar (#93) ----
const firstSeen = new Map<string, number>();
let radarKeys = new Set<string>();
let items: RadarItem[] = [];
const STUCK_MIN = [1, 2, 5, 10];
let stuckMin = STUCK_MIN.includes(Number(store.get("stuck"))) ? Number(store.get("stuck")) : 2;
const SNOOZE_MS = 30 * 60_000;
const snoozed = new Map<string, number>(Object.entries(loadJson<Record<string, number>>("snooze", {})));
const lastReport = (id: string) => office.feed.find((i) => i.kind === "report" && i.fromId === id && i.text)?.text;

const RANKED = [...STATUS_ORDER, "stuck"];
/** Z6: NEEDS YOU, the header pill, title, favicon and chimes read the LIVE envelope, also during Replay and Sample. */
function renderRadar(now: number) {
  const sim = office.source.mode !== "live", env = sim ? office.source.liveEnvelope() : office.getEnvelope();
  // shortcut: during a simulation the live blocked helpers are not known (main.ts holds them per displayed scene); live waits and stalls are
  const all = env ? radar(sim ? [] : office.actors(), env.state, now, (k, fb) => firstSeen.get(k) ?? (firstSeen.set(k, fb), fb), stuckMin * 60_000) : [];
  all.sort((a, b) => RANKED.indexOf(notify.kindOf(a)) - RANKED.indexOf(notify.kindOf(b)) || a.since - b.since); // permission is the loudest (V3)
  const keys = new Set(all.map((i) => i.key));
  for (const k of firstSeen.keys()) if (!keys.has(k)) firstSeen.delete(k);
  let changed = false;
  for (const [k, u] of snoozed) if (u <= now || !keys.has(k)) { snoozed.delete(k); changed = true; }
  if (changed) store.set("snooze", JSON.stringify(Object.fromEntries(snoozed)));
  items = all.filter((i) => !snoozed.has(i.key));
  for (const i of items) if (!radarKeys.has(i.key) && i.kind !== "stuck") announce(`${i.label}: ${look(notify.kindOf(i)).label}`, true);
  radarKeys = new Set(items.map((i) => i.key));
  const why = (i: RadarItem) => dropOutcome(i.reason ?? (i.kind === "blocked" ? lastReport(i.id) ?? "" : "")).trim();
  // a live row during a replay: go back to live first, then find it there
  const open = (i: RadarItem) => { if (sim) backToLive(); pick(i.id); };
  renderIf($("radar-list"), JSON.stringify([sim, items.map((i) => `${i.key}|${notify.kindOf(i)}|${fmtAge(now - i.since)}|${why(i)}`)]), () =>
    items.length
      ? items.map((i) => {
        const k = notify.kindOf(i), w = el("div", `rdw t${i.tier}`);
        w.style.setProperty("--st", look(k).color);
        w.setAttribute("role", "listitem");
        accent(w, i.project);
        const b = el("button", "rd");
        b.type = "button";
        const head = el("span", "rh");
        head.append(chip(k), el("b", "", ` ${i.label}`), el("span", "k", ` · ${i.tier ? "escalated · " : ""}${fmtAge(now - i.since)}`));
        b.append(head);
        const full = why(i);
        if (full) { b.append(el("span", "why", clipWords(full, 140))); b.title = full; }
        b.addEventListener("click", () => open(i));
        const acts = el("div", "ra");
        const go = btn("Open", sim ? "Back to live and focus it" : "Focus it in the office", () => open(i), "b sm pri");
        go.setAttribute("aria-label", `Open ${i.label}`);
        acts.append(go);
        if (i.kind !== "blocked") acts.append(btn("Snooze", "Hide this for 30 minutes", () => { snoozed.set(i.key, Date.now() + SNOOZE_MS); store.set("snooze", JSON.stringify(Object.fromEntries(snoozed))); refresh(); }, "b sm"));
        w.append(b, acts);
        return w;
      })
      : [el("div", "k pad", sim ? "Nothing live needs you." : "Nothing needs you.")]);
  document.dispatchEvent(new CustomEvent("ao:radar", { detail: items.length })); // the collapsed panel toggle and kiosk use this same count
  $("radar").classList.toggle("hot", items.length > 0);
  $("n-radar").textContent = items.length ? `(${items.length})` : "";
  renderPill(sim);
}
/** The one header pill (A3, B6, H2): the loudest live item with its name and reason; during Replay/Sample the LIVE chip. */
function renderPill(sim: boolean) {
  const n = $("need"), first = items[0];
  n.hidden = !first && !(sim && office.source.mode === "replay"); // an empty sample has its own Stop button
  n.classList.toggle("live-chip", sim);
  if (sim) {
    n.style.removeProperty("--st");
    n.textContent = `LIVE: ${items.length ? `${items.length} need${items.length === 1 ? "s" : ""} you` : "nothing needs you"} · back to live`;
    n.title = "Stop the replay or sample and show the live office";
    return;
  }
  if (!first) return;
  const k = notify.kindOf(first), why = dropOutcome(first.reason ?? "");
  n.style.setProperty("--st", look(k).color);
  // a squeezed header cuts the tail: the count leads when several wait (it must survive), else the name; glyph + colour say the state
  n.textContent = items.length > 1 ? `${look(k).glyph} ${items.length} need you · ${first.label}` : `${look(k).glyph} ${first.label} · ${look(k).label}`;
  n.title = `${first.label}: ${look(k).label}${why ? ` (${why})` : ""}. ${nextStep(k, first.project)} Click to open it; n cycles.`;
}

// ---- per-agent tool timeline: the state keeps only the latest call, so successive snapshots build the last 12 ----
const tools = toolTracker(12);
let toolsOpen = true;
function trackTools() {
  const st = stateOf();
  if (!st) return;
  for (const a of Object.values(st.agents)) tools.feed(a.id, a);
  for (const x of Object.values(st.sessions)) tools.feed(leadId(x.id), x);
}
const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : fmtDur(ms));
function toolList(calls: readonly ToolCall[], hide: boolean): HTMLElement {
  const d = el("details", "full tcalls");
  d.open = toolsOpen;
  d.addEventListener("toggle", () => { toolsOpen = d.open; });
  d.append(el("summary", "", `recent tools (${calls.length})`));
  if (!calls.length) { d.append(el("div", "k", "No tool calls seen since this page opened; they appear as the agent works.")); return d; }
  const ul = el("ul", "tc");
  ul.tabIndex = 0; // a scrollable list must be reachable by keyboard
  ul.setAttribute("aria-label", "Recent tool calls, newest first");
  for (const c of calls.slice().reverse()) {
    const li = el("li"), g = el("span", c.ok ? "ok" : "er", c.ok ? "✓" : "✕");
    g.setAttribute("role", "img");
    g.setAttribute("aria-label", c.ok ? "ok" : "failed");
    li.append(g, el("b", "", ` ${c.tool}`));
    if (c.detail && !hide) li.append(el("span", "k", ` ${clip(c.detail, 36)}`));
    if (c.ms !== undefined) li.append(el("span", "k", ` ${fmtMs(c.ms)}`));
    ul.append(li);
  }
  d.append(ul);
  return d;
}

/** Per-tool timings of the session (contract 1): the 5 busiest tools, p50/p95 over their last 64 calls and the failure rate. */
function toolStatsList(sid: string): HTMLElement | null {
  const top = topTools(signals(sid)?.toolStats);
  if (!top.length) return null;
  const d = el("details", "full tcalls");
  d.append(el("summary", "", "session tool timings (p50 / p95)"));
  const ul = el("ul", "tc");
  ul.setAttribute("aria-label", "Busiest tools of this session with median and 95th percentile duration");
  for (const x of top) {
    const li = el("li");
    li.append(el("b", "", x.tool), el("span", "k", ` ${x.n} · p50 ${fmtMs(x.p50)} · p95 ${fmtMs(x.p95)}`));
    if (x.fail) li.append(el("span", "er", ` · ${Math.round((x.fail / x.n) * 100)}% failed`));
    ul.append(li);
  }
  d.append(ul);
  return d;
}

// ---- selected card (#79 #91 #92) = the triage card (X1, X2): state, reason, who delegated it, the next step, the tree ----
function renderCard() {
  const c = $("card"), id = office.selected;
  const a = id ? office.actors().find((x) => x.id === id) : undefined;
  if (!a) { c.dataset.sig = ""; c.replaceChildren(); return; } // renderCrumb decides whether the section shows
  const acts = office.actors(), k = keyOf(a), sess = stateOf()?.sessions[a.session];
  const t = tree(acts, a.id), lead = t.up[0];
  const f = office.feed;
  const last = (p: (i: FeedItem) => boolean) => f.find((i) => p(i) && i.text);
  const report = last((i) => i.kind === "report" && i.fromId === a.id)?.text;
  // the reason for the state, up front: the lead's prompt text, or the helper's report; never the "BLOCKED:" prefix twice (A9)
  const reason = k === "permission" || k === "turn" ? sess?.waitingText ?? "" : k === "blocked" ? dropOutcome(report ?? "no report text") : "";
  const rows: [string, string][] = [["role", a.lead ? "session lead" : a.role], ["session", a.project]];
  if (a.doing) rows.push(["last tool", `${a.doing}${a.detail ? " · " + a.detail : ""}`]);
  if (a.why) rows.push(["why", a.why]);
  if (a.confidence === "guess") rows.push(["handed by", "a guess: several or no delegations matched this helper"]);
  if (a.branch) rows.push(["branch", a.branch]);
  if (a.cwd) rows.push(["folder", a.cwd]);
  const perm = a.lead ? permLine(signals(a.session)?.permWait, Date.now(), fmtDur) : "";
  if (perm) rows.push(["permission", perm]);
  const timings = toolStatsList(a.session);
  const texts: [string, string | undefined][] = [
    ["prompt", last((i) => i.kind === "prompt" && i.toId === a.id)?.text],
    ["delegation received", last((i) => i.kind === "delegate" && i.toId === a.id)?.text],
    ["delegated", last((i) => i.kind === "delegate" && i.fromId === a.id)?.text],
    ["said", last((i) => i.kind === "message" && i.fromId === a.id)?.text],
    ["report", report],
  ];
  const full = texts.filter((x): x is [string, string] => !!x[1]);
  if (k === "blocked") full.sort((x, y) => +(y[0] === "report") - +(x[0] === "report")); // most relevant first
  const calls = tools.get(a.id), hide = hideText();
  const sig = JSON.stringify([a.label, k, reason, a.task, t.up.map((x) => x.id), t.down.map((x) => [x.id, keyOf(x)]), rows, full, calls, hide, office.source.mode, timings?.textContent]);
  renderIf(c, sig, () => {
    const out: Node[] = [];
    const head = el("div", "chead");
    head.append(el("span", "n", a.label), chip(k));
    out.push(head);
    if (reason) { const r = el("div", "al tx", reason); r.style.setProperty("--st", look(k).color); out.push(r); }
    const by = a.lead ? "You, in the terminal" : lead ? `${lead.label}${a.task ? `: ${a.task}` : ""}` : a.task ?? "";
    const kv = el("div", "kvs");
    const put = (key: string, v: string, cls = "") => { kv.append(el("span", "k", key), el("span", cls, v)); };
    if (by) put(a.lead ? "asked by" : "delegated by", by, "tx");
    else if (a.task) put("task", a.task, "tx");
    put("next", office.source.mode === "live" ? nextStep(k, a.project, lead?.label) : "This is a replay or sample: nothing to do.");
    for (const [key, v] of rows) put(key, v, key === "folder" || key === "why" || key === "last tool" ? "tx" : "");
    out.push(kv);
    // X2: lead -> ... -> this agent -> its helpers, each one click away
    if (t.up.length || t.down.length) {
      const ul = el("ul", "tree");
      ul.setAttribute("aria-label", "Delegation chain");
      const li = (x: ActorInfo, depth: number, me = false) => {
        const l = el("li");
        l.style.setProperty("--d", String(depth));
        if (me) l.append(el("b", "", x.label), document.createTextNode(" (this one) "), chip(keyOf(x)));
        else { const b = btn(x.label, "Select and focus", () => pick(x.id), "sname"); l.append(b, " ", chip(keyOf(x))); }
        ul.append(l);
      };
      t.up.forEach((x, i) => li(x, i));
      li(a, t.up.length, true);
      t.down.forEach((x) => li(x, t.up.length + 1));
      out.push(ul);
    }
    const md = [`## ${a.label}: ${look(k).label}`, ...(reason ? [`- reason: ${reason}`] : []), ...(by ? [`- delegated by: ${by}`] : []), ...rows.map(([key, v]) => `- ${key}: ${v}`), ...full.map(([key, v]) => `\n### ${key}\n${v}`)].join("\n");
    const bar = el("div", "row");
    bar.append(btn("Focus", "Zoom to and follow it (f)", () => office.focus(a.id), "b sm"), copyBtn("Copy summary", md, "Copy this agent's state as markdown"), btn("Clear", "Deselect (Esc)", () => office.select(null), "b sm"));
    out.push(bar, toolList(calls, hide), ...(timings ? [timings] : []));
    full.forEach(([key, v], n) => {
      const d = el("details", "full");
      d.open = n === 0 && k !== "working";
      d.append(el("summary", "", key), el("div", "tx", v), copyBtn("Copy", v, `Copy ${key} text`));
      out.push(d);
    });
    return out;
  });
}

// ---- Recently done (V1 in the panel): state.outcomes newest first, else the reports still in the feed ----
function renderDone(now: number) {
  const rows = doneRows((stateOf() as { outcomes?: Parameters<typeof doneRows>[0] } | undefined)?.outcomes, office.feed, projectOf);
  $("n-done").textContent = rows.length ? `(${rows.length})` : "";
  const hide = hideText();
  renderIf($("done"), JSON.stringify([rows.map((r) => [r.key, fmtAge(now - r.t)]), hide]), () => rows.length ? rows.map((r) => {
    const o = outcomeLook(r.outcome), b = el("button", "dn");
    b.type = "button";
    b.style.setProperty("--st", o.color);
    const head = el("span", "rh"), g = el("span", "stc", `${o.glyph} ${o.label}`);
    g.style.setProperty("--st", o.color);
    head.append(g, el("b", "", ` ${r.name}`), el("span", "k", ` · ${r.project} · ${fmtAge(now - r.t)}`));
    b.append(head);
    const text = r.text || r.task;
    if (text && !hide) { b.append(el("span", "why", clipWords(text, 120))); b.title = r.task ? `${text}\n\ntask: ${r.task}` : text; }
    b.addEventListener("click", () => { if (office.actors().some((x) => x.id === r.agentId)) pick(r.agentId); else announce(`${r.name} has left the floor`); });
    return b;
  }) : [el("div", "k pad", "Nothing finished yet: when a helper reports back (done, gave up, partly done) it is listed here.")]);
}

// ---- sessions (#91 #36) + usage / burn rate (#185 #186) ----
const burn = new Map<string, { t: number; total: number }[]>();
let idleOpen = false;
/** Record usage samples (runs every refresh, also in a background tab, so the burn alert keeps working). */
function sampleBurn(now: number) {
  for (const s of office.sessions()) {
    if (!s.usage) continue;
    const arr = burn.get(s.id) ?? [], total = usageTotal(s.usage);
    if (!arr.length || arr[arr.length - 1].total !== total) { arr.push({ t: now, total }); if (arr.length > 6) arr.shift(); burn.set(s.id, arr); }
  }
}
const rateOf = (id: string, now: number) => (now - (burn.get(id)?.at(-1)?.t ?? 0) < 600_000 ? burnRate(burn.get(id) ?? []) : 0);
/** Working / done (idle) / blocked-or-waiting agent counts of one session, for the rings. */
function ringCounts(acts: ActorInfo[], session: string) {
  const mine = acts.filter((a) => a.session === session).map(effStatus);
  const n = (f: (s: string) => boolean) => mine.filter(f).length;
  return { total: mine.length, working: n((s) => s === "working" || s === "thinking"), done: n((s) => s === "idle"), blocked: n((s) => s === "blocked" || s === "waiting") };
}
function renderSessions(now: number) {
  const st = stateOf();
  const acts = office.actors();
  const list = office.sessions();
  const rows = list.map((s) => ({ s, last: st?.sessions[s.id]?.lastAt, prompt: st?.sessions[s.id]?.prompt, perm: permLine(signals(s.id)?.permWait, now, fmtDur), u: urgency(s, acts), rate: rateOf(s.id, now), c: ringCounts(acts, s.id), g: sessionAgg(acts.filter((a) => a.session === s.id).map(keyOf)) }))
    .sort((a, b) => a.u - b.u || a.s.project.localeCompare(b.s.project));
  const tot = sumUsage(list.map((s) => s.usage));
  $("n-sess").textContent = rows.length ? `(${rows.length})` : "";
  renderIf($("sessions"), JSON.stringify([rows.map((r) => [r.s, r.prompt, r.u, r.perm, r.last ? fmtAge(now - r.last) : "", Math.round(r.rate / 1000), filter.session === r.s.id, r.c, r.g]), idleOpen]), () => {
    if (!rows.length) return [el("div", "k pad", offline() ? "Offline: waiting for the daemon (see the banner at the top of the panel)." : "No sessions yet. Start Claude Code with the plugin.")];
    const one = ({ s, last, prompt, perm, rate, c, g }: (typeof rows)[number]) => {
      const d = el("div", c.total ? "sess hasr" : "sess");
      accent(d, s.project);
      if (c.total) d.append(ringsEl(c));
      const h = btn(s.project, "Scope the panel to this session (click again to clear) and select its lead", () => { setFilter("session", filter.session === s.id ? "" : s.id); if (filter.session) pick(s.lead); }, "sname");
      h.setAttribute("aria-pressed", String(filter.session === s.id));
      d.append(h);
      const alert = g.worst !== "working" && g.worst !== "idle";
      if (alert) d.append(" ", chip(g.worst)); // G1: the session's worst state, glyph + word
      if (prompt) { const p = el("div", "pr", prompt); p.title = prompt; d.append(p); }
      const quiet = last ? (now - last < 60_000 ? "active now" : `quiet ${fmtAge(now - last)}`) : "";
      d.append(el("div", "k", [`${s.agents} agent${s.agents === 1 ? "" : "s"}`, aggLine(g), s.branch ? `branch ${s.branch}` : "", quiet].filter(Boolean).join(" · ")));
      if (perm) d.append(el("div", "k", perm));
      if (s.usage) {
        const u = el("div", "k", fmtTokens(s.usage));
        if (rate > 0) { const r = el("span", `burn${burnHot(rate) ? " hot" : ""}`, ` · ~${Math.round(rate / 1000)}k tokens/min${burnHot(rate) ? " (high)" : ""}`); u.append(r); }
        d.append(u);
      }
      if (s.recovered) { const b = el("span", "badge", "recovered"); b.title = "Joined mid-stream after a daemon restart; earlier history is unknown."; d.append(b); }
      if (s.gaps) { const b = el("span", "badge", `${s.gaps} gap${s.gaps === 1 ? "" : "s"}`); b.title = `${s.gaps} hook event${s.gaps === 1 ? " was" : "s were"} never received (sequence numbers skipped), so the picture may miss steps.`; d.append(b); }
      if (s.waiting && !alert) d.append(el("span", "badge warn", "waiting"));
      if (s.cwd) {
        const p = el("div", "cwd");
        p.append(el("span", "k", s.cwd), (() => { const b = copyBtn("copy cd", cdCommand(s.cwd), "Copy a shell cd command for this folder"); b.setAttribute("aria-label", `Copy cd command for ${s.project}`); return b; })());
        d.append(p);
      }
      return d;
    };
    const live = rows.filter((r) => r.u < 3), idle = rows.filter((r) => r.u === 3);
    const out: Node[] = [];
    if (rows.length > 1) out.push(el("div", "k pad", `Current sessions: ${fmtTokens(tot)}`)); // sums only the sessions listed, not all of today
    if (!live.length) return [...out, ...idle.map(one)];
    out.push(...live.map(one));
    if (idle.length) {
      const dt = el("details");
      dt.open = idleOpen;
      dt.addEventListener("toggle", () => { idleOpen = dt.open; });
      dt.append(el("summary", "k pad", `${idle.length} idle session${idle.length === 1 ? "" : "s"}`), ...idle.map(one));
      out.push(dt);
    }
    return out;
  });
}

// ---- roster (#75) ----
const rosterLi = new Map<string, HTMLLIElement>();
let rover: string | null = null, idleAgents = false;
const FOLD_AT = 12;
const foldedGroups = new Set<string>(loadJson<string[]>("roster.fold", []));
// shows which session the roster and feed are scoped to (set by a session click or the feed filter); the × clears it
const scope = el("div", "badge"), scopeName = el("span"), scopeClear = btn("×", "Show agents and activity from every session", () => setFilter("session", ""), "b sm");
scope.hidden = true;
scopeClear.setAttribute("aria-label", "Clear session scope");
scope.append(scopeName, " ", scopeClear); // shortcut: idle helpers fold only past this many agents; real windowing (virtual list) if hundreds
type Ent = { key: string; a?: ActorInfo; text?: string; st?: string; folded?: boolean };
function renderRoster(now: number) {
  const ul = $("roster"), st = stateOf();
  let rows = office.actors().map((a) => ({ a, s: effStatus(a) }));
  const total = rows.length;
  if (filter.session) rows = rows.filter((r) => r.a.session === filter.session);
  const idle = rows.filter((r) => r.s === "idle" && !r.a.lead && r.a.id !== office.selected);
  const fold = total > FOLD_AT && !idleAgents && idle.length > 0;
  if (fold) rows = rows.filter((r) => !idle.includes(r));
  const ents: Ent[] = [];
  for (const grp of statusGroups(rows)) {
    const folded = foldedGroups.has(grp.id), ordered = rosterGroups(grp.rows, projectOf);
    ents.push({ key: `g:${grp.id}`, text: `${grp.title} (${grp.rows.length})`, folded });
    if (folded) continue;
    for (const { s, g } of ordered) {
      if (ordered.length > 1) ents.push({ key: `h:${grp.id}:${s}`, text: `${projectOf(s)} (${g.length})` });
      for (const r of g) ents.push({ key: `r:${r.a.id}`, a: r.a, st: r.s });
    }
  }
  if (idle.length && total > FOLD_AT) ents.push({ key: "idle", text: idleAgents ? "Hide idle agents" : `Show ${idle.length} idle agent${idle.length === 1 ? "" : "s"}` });
  if (!ents.length) ents.push({ key: "none", text: filter.session ? "No agents in this session." : "No agents yet: they appear when a session starts or delegates to a subagent." });
  $("n-agents").textContent = filter.session ? `(${rows.length} of ${total})` : total ? `(${total})` : "";
  scope.hidden = !filter.session;
  scopeName.textContent = filter.session ? `Scoped to ${projectOf(filter.session)}` : "";
  if (!ents.some((e) => e.a?.id === rover)) rover = ents.find((e) => e.a)?.a?.id ?? null;
  const nodes = sync($("roster"), rosterLi, ents.map((e) => e.key), (key) => {
    const li = el("li");
    if (key.startsWith("r:")) {
      const id = key.slice(2), b = el("button", "r");
      b.type = "button";
      b.dataset.id = id;
      b.append(el("span", "m"), el("span", "sub"));
      b.addEventListener("click", () => office.select(office.selected === id ? null : id));
      b.addEventListener("focus", () => { rover = id; });
      b.addEventListener("mouseenter", () => document.dispatchEvent(new CustomEvent("ao:hover", { detail: id })));
      b.addEventListener("mouseleave", () => document.dispatchEvent(new CustomEvent("ao:hover", { detail: null })));
      li.append(b);
    } else if (key.startsWith("g:")) {
      const id = key.slice(2), h = el("button", "gh");
      h.type = "button";
      h.addEventListener("click", () => {
        if (!foldedGroups.delete(id)) foldedGroups.add(id);
        store.set("roster.fold", JSON.stringify([...foldedGroups]));
        renderRoster(Date.now());
      });
      li.append(h);
    } else if (key === "idle") {
      li.append(btn("", "Idle agents are folded while the office is busy", () => { idleAgents = !idleAgents; renderRoster(Date.now()); }, "b sm"));
    }
    return li;
  });
  nodes.forEach((li, i) => {
    const e = ents[i], a = e.a;
    if (!a) {
      const t = li.firstElementChild ?? li;
      if (e.key.startsWith("g:")) {
        li.className = "gh-li";
        const txt = `${e.folded ? "▸" : "▾"} ${e.text}`;
        if (t.textContent !== txt) t.textContent = txt;
        t.setAttribute("aria-expanded", String(!e.folded));
        return;
      }
      if (e.key === "idle") { if (t.textContent !== e.text) t.textContent = e.text!; li.className = ""; } else { li.className = e.key === "none" ? "k pad" : "h"; if (li.textContent !== e.text) li.textContent = e.text!; }
      return;
    }
    const b = li.firstChild as HTMLButtonElement, [m, sub] = Array.from(b.children) as HTMLElement[];
    const started = a.lead ? st?.sessions[a.session]?.startedAt : st?.agents[a.id]?.startedAt;
    const k = keyOf(a);
    const t = `${a.label}: ${a.lead ? "session lead" : a.role}, ${statusWord(k)}${started ? ` · ${fmtDur(now - started)}` : ""}`;
    if (m.textContent !== t) m.textContent = t;
    const task = clip(a.task ?? "", 80);
    if (sub.textContent !== task) sub.textContent = task;
    b.className = `r ${e.st}`;
    b.style.setProperty("--st", look(k).color);
    b.title = a.why ?? a.task ?? "";
    b.setAttribute("aria-pressed", String(office.selected === a.id));
    b.tabIndex = a.id === rover ? 0 : -1;
  });
  markHover();
}
function bindRosterKeys() {
  $("roster").before(scope);
  $("roster").addEventListener("keydown", (e) => {
    const bs = Array.from($("roster").querySelectorAll<HTMLButtonElement>("button"));
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    const to = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: bs.length - 1 }[e.key as string];
    if (to === undefined || i < 0) return;
    e.preventDefault();
    e.stopPropagation(); // arrows move the roster, not the canvas camera
    bs[Math.max(0, Math.min(bs.length - 1, to))]?.focus();
  });
}
// ---- hot files: most-touched paths this run, top 8 (core hotFiles), click selects that session's lead ----
function renderFiles() {
  const st = stateOf();
  const list = st ? hotFiles(st, filter.session || undefined, 8) : [];
  $("n-files").textContent = list.length ? `(${list.length})` : "";
  renderIf($("files"), JSON.stringify(list.map((f) => [f.path, f.count, f.session])), () =>
    list.length ? list.map((f) => {
      const i = Math.max(f.path.lastIndexOf("/"), f.path.lastIndexOf("\\")), dir = f.path.slice(0, i + 1), base = f.path.slice(i + 1);
      const b = el("button", "hf pc");
      b.type = "button";
      accent(b, projectOf(f.session));
      b.title = f.path;
      b.append(el("b", "", base), el("span", "k dir", dir ? ` ${clip(dir, 40)}` : ""), el("span", "n", `×${f.count}`));
      b.addEventListener("click", () => { const lead = office.sessions().find((s) => s.id === f.session)?.lead; if (lead) pick(lead); });
      return b;
    }) : [el("div", "k pad", "No file activity yet: files an agent reads or edits are counted here.")]);
}
// canvas hover (A dispatches ao:canvas-hover with an actor id or null) marks the matching roster/feed rows
let canvasHover: string | null = null;
function markHover() {
  document.querySelectorAll<HTMLElement>("[data-id],[data-ids]").forEach((n) =>
    n.classList.toggle("hov", !!canvasHover && (n.dataset.id === canvasHover || (n.dataset.ids ?? "").split("|").includes(canvasHover))));
}

// ---- feed (#77 #78): persisted + deep-linked filters, keyed rows ----
const filter: FeedFilter = { session: "", kind: "", agent: "", muted: new Set() };
let grouped = false, hoverSnap: FeedItem[] | null = null, pointerIn = false;
const KINDS = ["prompt", "delegate", "report", "message", "done", "conflict"];
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const feedCache = new Map<string, HTMLElement>();
let pendingSel: string | null = null;

function saveFilters() {
  store.set("filters", JSON.stringify({ session: filter.session, kind: filter.kind, agent: filter.agent, muted: [...filter.muted], grouped }));
}
function setFilter(key: "session" | "kind" | "agent", v: string) {
  filter[key] = v;
  saveFilters();
  renderFeed();
  renderRoster(Date.now());
  renderSessions(Date.now());
}
function loadFilters() {
  const s = sanitizeFilters(loadJson<unknown>("filters", {}));
  filter.session = s.session; filter.kind = s.kind; filter.agent = s.agent;
  filter.muted = new Set(s.muted);
  grouped = s.grouped;
  const h = parseLink(location.hash); // deep link wins over the stored filters
  if (h.s) filter.session = h.s;
  if (h.k) filter.kind = h.k;
  if (h.a) filter.agent = h.a;
  pendingSel = h.sel || null;
}
function syncHash() {
  // the view (wall bare token, v=timeline) comes from what is visible, so views.ts and this writer cannot disagree
  const v = document.querySelector("#wall:not([hidden])") ? "wall" : document.querySelector("#timeline:not([hidden])") ? "timeline" : "";
  const h = buildLink({ sel: office.selected ?? pendingSel ?? "", s: filter.session, k: filter.kind, a: filter.agent, v });
  if (location.hash !== h) history.replaceState(null, "", h || location.pathname + location.search);
}

function feedRow(f: FeedItem): HTMLElement {
  const row = el("div", `it ${f.kind}`);
  row.setAttribute("role", "listitem");
  row.dataset.ids = [f.fromId, f.toId].filter(Boolean).join("|");
  accent(row, projectOf(f.session ?? ""));
  const main = el("button", "row");
  main.type = "button";
  main.title = "Select and pulse this actor";
  const head = el("div");
  const t = el("span", "t", time(f.t));
  head.append(el("span", "who", whoLine(f)), t);
  main.append(head);
  if (f.text) main.append(el("span", "tx", f.kind === "report" ? captionText(f) : f.text)); // A9: the headline already says blocked / finished
  const target = () => [f.fromId, f.toId].find((x) => x && office.actors().some((a) => a.id === x)) ?? null;
  main.addEventListener("click", () => { const id = target(); if (id) pick(id); });
  main.addEventListener("mouseenter", () => { t.title = `${fmtAge(Date.now() - f.t)} ago`; document.dispatchEvent(new CustomEvent("ao:hover", { detail: target() })); });
  main.addEventListener("mouseleave", () => document.dispatchEvent(new CustomEvent("ao:hover", { detail: null })));
  row.append(main);
  if (f.text && (f.text.length > 160 || f.text.includes("\n"))) {
    const more = btn("more", "Show the full text", () => { const o = row.classList.toggle("open"); more.textContent = o ? "less" : "more"; more.setAttribute("aria-expanded", String(o)); }, "b sm more");
    row.append(more);
  }
  row.append(btn("mute", `Hide everything from ${f.from}`, () => { filter.muted.add(f.from); saveFilters(); renderFeed(); }, "b sm mute"));
  return row;
}

function renderFeed() {
  const src = hoverSnap ?? office.feed;
  const all = filterFeed(src, filter);
  const shown = all.slice(0, 60);
  const i0 = hoverSnap?.[0] ? office.feed.indexOf(hoverSnap[0]) : office.feed.length;
  const fresh = hoverSnap ? (i0 < 0 ? office.feed.length : i0) : 0; // rows that arrived while the list was held
  $("fd-new").hidden = fresh === 0;
  $("fd-new").textContent = `${fresh} new`;
  const active = !!(filter.session || filter.kind || filter.agent || filter.muted.size);
  $("fd-clear").hidden = !active;
  $("n-feed").textContent = active ? `(${all.length} of ${src.length})` : src.length ? `(${src.length})` : "";
  const sessIds = [...new Set(src.map((i) => i.session).filter((x): x is string => !!x))];
  fillSelect($("fd-session") as HTMLSelectElement, "all sessions", sessIds.map((s) => [s, projectOf(s)]), filter.session ? [filter.session, projectOf(filter.session)] : null);
  fillSelect($("fd-kind") as HTMLSelectElement, "all kinds", KINDS.map((k) => [k, k]), null);
  fillSelect($("fd-agent") as HTMLSelectElement, "all agents", [...new Set(src.flatMap((i) => [i.from, i.to]).filter(Boolean))].sort().map((n) => [n, n]), filter.agent ? [filter.agent, filter.agent] : null);
  ($("fd-session") as HTMLSelectElement).value = filter.session;
  ($("fd-kind") as HTMLSelectElement).value = filter.kind;
  ($("fd-agent") as HTMLSelectElement).value = filter.agent;
  ($("fd-group") as HTMLInputElement).checked = grouped;
  // keyed entries: feed rows keep their node (focus, scroll, "more" state) across renders
  const byKey = new Map<string, FeedItem>(), label = new Map<string, string>(), keys: string[] = [];
  const dup = new Map<string, number>();
  const rowKey = (f: FeedItem) => { const b = `${f.t}|${f.kind}|${f.fromId ?? f.from}|${f.toId ?? f.to}|${f.text.length}`; const n = dup.get(b) ?? 0; dup.set(b, n + 1); return `f:${b}#${n}`; };
  const push = (f: FeedItem) => { const k = rowKey(f); byKey.set(k, f); keys.push(k); };
  if (!shown.length) { keys.push("none"); label.set("none", active ? "Nothing matches the filters. Use Clear all to see everything." : offline() ? "Offline: waiting for the daemon." : "No activity yet: prompts, delegations and reports appear here."); }
  else if (!grouped) {
    const quiet = quietBefore(shown); // the quiet gap sits between a row and the newer one above it
    shown.forEach((f, i) => {
      if (quiet[i]) { const k = `g:${f.t}`; keys.push(k); label.set(k, `quiet for ${fmtAge(quiet[i])}`); }
      push(f);
    });
  } else {
    for (const [s, list] of bySession(shown)) { const k = `h:${s}`; keys.push(k); label.set(k, s ? projectOf(s) : "other"); list.forEach(push); }
  }
  const feed = $("feed");
  const nodes = sync(feed, feedCache, keys, (k) => {
    if (k.startsWith("f:")) return feedRow(byKey.get(k)!);
    return el(k.startsWith("h:") ? "h3" : "div", k.startsWith("g:") ? "gap" : k === "none" ? "k pad" : "", label.get(k));
  });
  nodes.forEach((n, i) => { if (!keys[i].startsWith("f:") && n.textContent !== label.get(keys[i])) n.textContent = label.get(keys[i])!; });
  markHover();
}
function fillSelect(sel: HTMLSelectElement, all: string, opts: [string, string][], cur: [string, string] | null) {
  if (cur && !opts.some(([v]) => v === cur[0])) opts = [...opts, cur];
  const sig = JSON.stringify(opts);
  if (sel.dataset.sig === sig) return;
  sel.dataset.sig = sig;
  sel.replaceChildren(...[["", all], ...opts].map(([v, l]) => Object.assign(el("option", "", l), { value: v })));
}
function bindFeed() {
  loadFilters();
  const bar = $("filters");
  const sel = (id: string, label: string, key: "session" | "kind" | "agent") => {
    const s = el("select");
    s.id = id;
    s.setAttribute("aria-label", label);
    s.addEventListener("change", () => setFilter(key, s.value));
    return s;
  };
  const group = el("input");
  group.type = "checkbox";
  group.id = "fd-group";
  group.addEventListener("change", () => { grouped = group.checked; saveFilters(); renderFeed(); });
  const gl = el("label", "k");
  gl.append(group, document.createTextNode(" group by session"));
  const clear = btn("Clear all", "Remove every filter and un-mute all agents", () => { filter.session = filter.kind = filter.agent = ""; filter.muted.clear(); saveFilters(); renderFeed(); renderRoster(Date.now()); renderSessions(Date.now()); });
  clear.id = "fd-clear";
  const fresh = btn("new", "Show the newest activity", () => { hoverSnap = null; $("feed").scrollTop = 0; renderFeed(); });
  fresh.id = "fd-new";
  fresh.hidden = true;
  bar.append(sel("fd-session", "Filter by session", "session"), sel("fd-kind", "Filter by kind", "kind"), sel("fd-agent", "Filter by agent", "agent"), gl, fresh, clear);
  // hovering or reading further down freezes the list so rows do not move under the pointer
  const feed = $("feed");
  const hold = () => {
    const on = pointerIn || feed.scrollTop > 8;
    if (on && !hoverSnap) hoverSnap = office.feed.slice();
    if (!on) hoverSnap = null;
    renderFeed();
  };
  feed.addEventListener("mouseenter", () => { pointerIn = true; hold(); });
  feed.addEventListener("mouseleave", () => { pointerIn = false; hold(); });
  feed.addEventListener("scroll", hold, { passive: true });
  office.onFeed((f) => {
    if (!document.hidden) renderFeed();
    if (f.kind === "delegate" || f.kind === "report" || f.kind === "done") announce(`${whoLine(f)}${f.kind === "report" && f.outcome ? ` (${f.outcome})` : ""}`);
  });
}

// ---- stats / aria ----
function renderStats() {
  const e = office.getEnvelope();
  if (!e) return;
  const s = e.state, as = office.actors(), ns = Object.keys(s.sessions).length, q = as.filter((a) => a.status === "queued").length;
  // agents = every actor on the floor, leads included: the same number as the AGENTS list and the canvas label
  const working = as.filter((a) => a.status === "working" || a.status === "thinking").length;
  const full = `${ns} session${ns === 1 ? "" : "s"} · ${as.length} agent${as.length === 1 ? "" : "s"}${q ? ` · ${q} queued` : ""}${items.length ? ` · ${items.length} need you` : ""}${e.configError ? " · config error" : ""}`;
  const outs = (s as { outcomes?: { outcome?: string }[] }).outcomes;
  const done = outs ? outs.filter((o) => o.outcome === "done").length : office.feed.filter((f) => f.kind === "report" && f.outcome === "done").length;
  // the needs-you count lives in the pill (#need); these are the calm numbers: busy and finished (H2)
  const pill = $("stats"), short = ns ? `${working} working · ${done} done` : "";
  pill.textContent = short + (e.configError ? " · config error" : "");
  pill.setAttribute("aria-label", short ? `${short}. ${full}` : full); // the visible numbers first, then the totals
  pill.title = `${full}. Agents include each session's lead`;
  $("cap-stats").textContent = `${short}${items.length ? ` · ${items.length} need you` : ""}`;
  $("empty").style.display = ns || office.source.mode !== "live" ? "none" : "block";
  $("top").classList.toggle("priv", office.privacy || office.source.private);
  document.body.classList.toggle("priv", hideText());
  // I1: is free text on screen right now? One chip, always visible; it toggles Private (which reloads)
  const pc = $("privchip"), hidden = hideText(), pv = office.source.private;
  const ptxt = hidden ? "◌ text hidden" : "◉ text shown";
  if (pc.textContent !== ptxt) pc.replaceChildren(ptxt.slice(0, 1), el("span", "pl", ptxt.slice(1)));
  pc.setAttribute("aria-pressed", String(pv));
  const cfg = e.config as { textHours?: number; historyHours?: number }, keep = Math.round((cfg.textHours ?? cfg.historyHours ?? 168) / 24);
  // say what "text" covers and where it lives, not just on/off (final review: the chip read as status, not as a control)
  pc.title = `${hidden ? "Prompts, commands, paths and reports are hidden" : "Prompts, commands, paths and reports are shown (clipped, with secrets redacted)"}${office.privacy ? ". The daemon is in privacy mode: no text is stored or sent" : `. Text is stored only on this machine (~/.agent-office) for ${keep} day${keep === 1 ? "" : "s"}; nothing leaves it`}. Click to turn Private ${pv ? "off" : "on"} (reloads).`;
  // V2: the office protocol shapes the sessions it shows: say so
  const nudged = (office.source.liveEnvelope()?.config.protocol ?? e.config.protocol ?? "office") === "office";
  $("nudge").hidden = !nudged;
  const mode = office.source.mode, st = office.connection.state, live = $("live");
  const name = mode === "replay" ? "replay" : mode !== "live" ? "sample" : st === "live" ? "connected" : st === "retrying" ? "offline, retrying" : "connecting";
  if (live.getAttribute("aria-label") !== name) { live.setAttribute("aria-label", name); live.title = name; }
}

function refresh() {
  const now = Date.now();
  renderRadar(now);
  sampleBurn(now);
  notify.update(items, office.sessions().filter((s) => burnHot(rateOf(s.id, now)))); // title + alerts keep working in a background tab
  if (document.hidden) return; // nobody is looking: skip the DOM work
  renderStats();
  renderCrumb();
  renderCard();
  renderDone(now);
  renderSessions(now);
  if (pendingSel && office.actors().some((a) => a.id === pendingSel)) { const id = pendingSel; pendingSel = null; office.select(id); }
  renderRoster(now);
  renderFiles();
  renderFeed();
  syncHash();
  const c = office.snapshotCanvas();
  if (c) {
    c.setAttribute("role", "img");
    const t = summary(office.actors() as ActorInfo[], office.sessions());
    if (c.getAttribute("aria-label") !== t) c.setAttribute("aria-label", t);
  }
}

// ---- scope breadcrumb (X6): All > project > agent, each a step up; Esc walks up one level ----
function renderCrumb() {
  const a = office.selected ? office.actors().find((x) => x.id === office.selected) : undefined;
  const scoped = filter.session, nav = $("crumb");
  const sig = JSON.stringify([scoped, a?.id, a?.label, a?.project]);
  $("card-sec").hidden = !a && !scoped;
  renderIf(nav, sig, () => {
    const out: Node[] = [btn("All", "Show every session and clear the selection", () => { office.select(null); setFilter("session", ""); }, "crumb")];
    const sid = a?.session ?? scoped;
    if (sid) out.push(el("span", "sep", "▸"), btn(projectOf(sid), "Scope the panel to this session", () => { office.select(null); setFilter("session", sid); }, "crumb"));
    if (a) out.push(el("span", "sep", "▸"), el("b", "", a.label));
    return out;
  });
}
function bindEscScope() {
  // capture: runs before main.ts clears the selection, so one Esc walks up exactly one level
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || office.selected || !filter.session) return;
    if (document.querySelector(".dlg:not([hidden]),.view:not([hidden]),#settings:not([hidden]),.mpop:not([hidden])") || document.body.matches(".presenter,.kiosk")) return;
    setFilter("session", "");
  }, true);
}
/** Phones (H3): the toolbar lives in the sheet's "More" section, after NEEDS YOU and the lists; desktops keep it in the header. */
function bindPlacement(tools: HTMLElement) {
  const mq = matchMedia("(max-width:800px)");
  const place = () => (mq.matches ? $("more-body") : $("top-tools")).append(tools);
  mq.addEventListener("change", place);
  place();
}

function bindFolds() {
  const narrow = matchMedia("(max-width:800px)").matches;
  document.querySelectorAll<HTMLDetailsElement>("details.sec").forEach((d) => {
    const def = d.hasAttribute("open") || (narrow && d.id === "lists"); // phones: the agent list right after NEEDS YOU
    d.open = (store.get(`fold.${d.id}`) ?? (def ? "1" : "0")) !== "0";
    d.addEventListener("toggle", () => store.set(`fold.${d.id}`, d.open ? "1" : "0"));
  });
}
function bindRadarOpts() {
  const s = el("select");
  s.setAttribute("aria-label", "Flag a session as stuck after");
  for (const m of STUCK_MIN) s.append(Object.assign(el("option", "", `${m} min`), { value: String(m) }));
  s.value = String(stuckMin);
  s.addEventListener("change", () => { stuckMin = Number(s.value); store.set("stuck", s.value); refresh(); });
  const o = $("radar-opts");
  o.title = "NEEDS YOU lists blocked agents, sessions waiting on a permission or input, and sessions silent mid-turn for this long (3x while a tool runs).";
  o.append(document.createTextNode("Stuck after silence of "), s);
}

/** Wire all chrome; main.ts calls this once after the engine is up. */
export function bindUi() {
  const tools = $("tools");
  // A rebuilt row never fires mouseleave: clear a stuck canvas hover when the pointer leaves the panel.
  $("side").addEventListener("pointerleave", () => document.dispatchEvent(new CustomEvent("ao:hover", { detail: null })));
  // Wall and timeline views sit under #top, which grows with text scale or wrapped toolbar groups.
  new ResizeObserver(() => document.documentElement.style.setProperty("--top-h", $("top").offsetHeight + "px")).observe($("top"));
  bindPanelChrome(tools);
  bindModes(tools, $("modebar"));
  $("empty-sample").addEventListener("click", toggleSample);
  bindPlacement(tools);
  bindEscScope();
  for (const k of STATUS_ORDER) document.documentElement.style.setProperty(`--st-${k}`, STATUS[k].color);
  $("privchip").addEventListener("click", () => office.source.setPrivate(!office.source.private));
  bindFolds();
  bindRadarOpts();
  bindFeed();
  bindFun();
  bindColonists();
  bindRosterKeys();
  $("need").addEventListener("click", () => {
    if (office.source.mode !== "live") { backToLive(); return; }
    if (items[0]) pick(items[0].id);
    if (document.body.classList.contains("collapsed")) $("tg").click();
    $("radar").scrollIntoView({ block: "nearest" });
  });
  document.addEventListener("ao:canvas-hover", (e) => { canvasHover = (e as CustomEvent<string | null>).detail ?? null; markHover(); });
  document.addEventListener("visibilitychange", refresh);
  office.subscribe(trackTools);
  office.subscribe(refresh);
  office.onSelect((id) => {
    if (id && document.body.classList.contains("collapsed")) $("tg").click();
    const a = id ? office.actors().find((x) => x.id === id) : undefined;
    if (a) announce(`Selected ${a.label}, ${effStatus(a)}`);
    refresh();
    if (id) $("card-sec").scrollIntoView({ block: "nearest" });
  });
  office.source.onMode(refresh);
  setInterval(refresh, 500);
  refresh();
}
