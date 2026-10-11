// Pluggable data sources (#90 sample data, #33 replay) + the toolbar buttons that switch them, privacy (#10), copy link.
// Both simulations run events through the core reducer locally (sim.ts) and push envelopes via office.source.
import { emptyState } from "@agent-office/core";
import { office } from "./api.ts";
import { $, btn, download, el } from "./dom.ts";
import { FALLBACK_CFG, Playback, demoScript, simEnvelope } from "./sim.ts";
import { HISTORY_LIMIT, fetchHistory, markers, toCsv, toJsonl, type Marker } from "./history.ts";
import { group } from "./toolbar.ts";
import { register } from "./palette.ts";
import { copyLink } from "./actions.ts";
import { t } from "./i18n.ts";
import { whoLine } from "./logic.ts";
import type { OfficeEvent } from "@agent-office/core";

const AUTO_AFTER_MS = 3000;
let epoch = "", rev = 0;
let pb: Playback | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let manual = false; // the user stopped sample data: do not restart it by itself

const cfgNow = () => office.source.liveEnvelope()?.config ?? FALLBACK_CFG;
const push = () => pb && office.source.push(simEnvelope(pb.state, pb.cfg, epoch, ++rev));
function begin(mode: "demo" | "replay", p: Playback) {
  stop();
  epoch = `sim-${Date.now()}`;
  rev = 0;
  pb = p;
  office.source.begin(mode);
  pb.seek(0, Date.now());
  push();
}
function stop() {
  clearInterval(timer);
  timer = undefined;
  pb = null;
  if (office.source.mode === "live") return;
  office.source.end();
  // no daemon snapshot to fall back to: show an empty office instead of the last simulated frame
  if (!office.source.liveEnvelope()) office.source.push(simEnvelope(emptyState(), FALLBACK_CFG, `sim-${Date.now()}`, 0));
}

/** "back to live" (the LIVE chip during replay/sample, a NEEDS YOU row): stop the simulation and stay live. */
export function backToLive() {
  if (office.source.mode === "live") return;
  manual = true;
  stop();
}

// ---- sample data ----
/** The banner's Stop and the Sample toggle: stop and do not restart it by itself. */
export function stopSample() {
  if (office.source.mode !== "demo") return;
  manual = true;
  stop();
}
/** Sample on / off: the empty-state card and the palette (it is not in the toolbar: it only makes sense in an empty office). */
export function toggleSample() {
  if (office.source.mode === "demo") stopSample(); else { manual = false; startDemo(); }
}
function startDemo() {
  begin("demo", new Playback(cfgNow(), demoScript()));
  const t0 = performance.now();
  let base = t0;
  timer = setInterval(() => {
    if (!pb) return;
    const v = performance.now() - base, n = pb.countAt(v);
    if (n > pb.idx) { pb.seek(n, Date.now()); push(); }
    if (v > pb.end + 5000) { base = performance.now(); pb = new Playback(cfgNow(), demoScript()); pb.seek(0, Date.now()); epoch = `sim-${Date.now()}`; rev = 0; push(); } // loop
  }, 250);
}

// ---- replay ----
let playing = true, speed = 1, vpos = 0;
let loaded: OfficeEvent[] = [], marks: Marker[] = [];
async function startReplay(since: number, until: number, status: HTMLElement, onLoaded: () => void) {
  status.textContent = "loading…";
  try {
    const { events, limited } = await fetchHistory(since, until, office.source.private);
    loaded = events;
    marks = markers(events);
    onLoaded();
    if (!events.length) {
      if (office.source.mode === "replay") stop(); // do not leave the previous replay running under an "empty" message
      status.textContent = "No stored events in that range. Pick a wider range, or run a session first.";
      return;
    }
    manual = true;
    begin("replay", new Playback(cfgNow(), events));
    playing = true; vpos = 0;
    status.textContent = limited ? `Showing the newest ${t("event", { n: HISTORY_LIMIT })}: pick a narrower range to see the rest.` : "";
    const slider = $("rp-slider") as HTMLInputElement;
    slider.max = String(events.length);
    slider.value = "0";
    $("rp-marks").replaceChildren(...marks.map((x) => Object.assign(el("option"), { value: String(x.i), label: x.kind })));
    let last = performance.now();
    timer = setInterval(() => {
      const now = performance.now(), dt = now - last;
      last = now;
      if (!pb) return;
      if (playing && pb.idx < pb.events.length) {
        vpos += dt * speed;
        const n = pb.countAt(vpos);
        if (n > pb.idx) { pb.seek(n, Date.now()); push(); }
      } else if (pb.idx >= pb.events.length) playing = false;
      slider.value = String(pb.idx);
      $("rp-what").textContent = pb.idx && office.feed[0] ? `At this point: ${whoLine(office.feed[0])}` : "";
      $("rp-pos").textContent = `${pb.idx}/${pb.events.length}`;
      $("rp-play").textContent = playing ? "Pause" : "Play";
    }, 100);
  } catch (e) {
    status.textContent = `Could not load history: ${(e as Error).message}`;
  }
}

let statusEl: HTMLElement | null = null, onLoadedFn = () => {};
/** History view's "Replay…" (open the range picker) and "Replay this range" (X3). */
export function toggleReplay(open?: boolean) { const box = $("rp-box"); box.hidden = open === undefined ? !box.hidden : !open; if (!box.hidden) box.scrollIntoView({ block: "nearest" }); }
export function replayRange(since: number, until: number) {
  toggleReplay(true);
  if (statusEl) void startReplay(Math.floor(since), Math.ceil(until), statusEl, onLoadedFn);
}

export function bindModes(tools: HTMLElement, bar: HTMLElement) {
  const badge = $("badge");
  $("stop-sample").addEventListener("click", stopSample);
  let ctl: HTMLElement | null = null;
  office.source.onMode((m) => {
    badge.hidden = m === "live";
    badge.textContent = m === "demo" ? "SAMPLE DATA" : "REPLAY";
    $("stop-sample").hidden = m !== "demo"; // keyboard users reach Stop here even while the panel is closed
    if (ctl) ctl.hidden = m !== "replay";
    if (m === "replay") $("rp-box").hidden = false;
  });

  const out = group(tools, "Export");
  register("History: Replay a time range", () => toggleReplay(true));
  register("Data: Sample data on / off", toggleSample);
  register("Privacy: Private on / off (reloads)", () => office.source.setPrivate(!office.source.private));
  const linkBtn = btn("Copy link", "Copy a URL that restores the selection, scope, view and filters. Nothing is sent anywhere.", async () => { $("rec-note").textContent = await copyLink(); });
  out.append(linkBtn);
  register("Export: Copy link", () => linkBtn.click());
  register("Setup: Private on / off", () => office.source.setPrivate(!office.source.private));
  const noteEl = el("span", "note chip");
  noteEl.id = "rec-note";
  noteEl.setAttribute("role", "status");
  badge.after(noteEl); // a header chip: the Export menu closes on click, so its result shows here

  // replay bar
  const box = el("div", "rp");
  box.id = "rp-box";
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", "Replay");
  box.hidden = true;
  const status = el("span", "k");
  const when = (label: string) => {
    const i = el("input"), w = el("label", "k", `${label} `);
    i.type = "datetime-local";
    i.title = `${label} (optional; overrides the range above)`;
    w.append(i);
    return { i, w };
  };
  const { i: from, w: fromW } = when("From"), { i: to, w: toW } = when("To");
  const sel = el("select");
  sel.setAttribute("aria-label", "Replay range");
  for (const [l, ms] of [["last 15 min", 15 * 60e3], ["last hour", 3600e3], ["last 6 hours", 6 * 3600e3], ["last 24 hours", 24 * 3600e3]] as const) {
    const o = el("option", "", l);
    o.value = String(ms);
    sel.append(o);
  }
  const c = (ctl = el("div", "rp-ctl"));
  c.hidden = true;
  const slider = el("input");
  slider.type = "range"; slider.id = "rp-slider"; slider.min = "0"; slider.value = "0"; slider.setAttribute("aria-label", "Replay position");
  slider.addEventListener("input", () => {
    if (!pb) return;
    const i = Number(slider.value);
    pb.seek(i, Date.now());
    vpos = i ? pb.vt[i - 1] : 0;
    push();
  });
  slider.setAttribute("list", "rp-marks");
  const marksList = el("datalist");
  marksList.id = "rp-marks";
  // jump to the next landmark (BLOCKED, waiting, error, session start) after the current position
  const next = btn("Next marker", "Jump to the next blocked, waiting, error or session-start moment", () => {
    if (!pb) return;
    const m = marks.find((x) => x.i > pb!.idx) ?? marks[0];
    if (!m) { mark.textContent = "no markers"; return; }
    pb.seek(m.i, Date.now());
    vpos = m.i ? pb.vt[m.i - 1] : 0;
    push();
    mark.textContent = `${m.kind} at ${m.i}/${pb.events.length}`;
  });
  const pos = el("span", "k");
  pos.id = "rp-pos";
  const mark = el("span", "k");
  const play = btn("Pause", "Play or pause", () => { playing = !playing; if (playing && pb && pb.idx >= pb.events.length) { pb.seek(0, Date.now()); vpos = 0; push(); } });
  play.id = "rp-play";
  const SPEEDS = [1, 4, 16];
  const speeds = SPEEDS.map((x) => {
    const b = btn(`${x}x`, `Speed ${x}x`, () => { speed = x; speeds.forEach((o, i) => o.setAttribute("aria-pressed", String(SPEEDS[i] === x))); });
    b.setAttribute("aria-pressed", String(x === speed));
    return b;
  });
  const what = el("span", "k");
  what.id = "rp-what";
  what.setAttribute("aria-live", "off");
  const end = btn("Jump to end", "Jump to the newest loaded event", () => {
    if (!pb) return;
    pb.seek(pb.events.length, Date.now());
    vpos = pb.vt[pb.events.length - 1] ?? 0;
    playing = false;
    push();
  });
  c.append(play, ...speeds, next, end, mark, pos, slider, marksList, what,
    btn("Back to live", "Stop the replay and show the live office", backToLive));
  const save = (name: string, fmt: () => string, type: string) => btn(name, "Download the loaded events as served (free text already removed when Private is on)", () => {
    if (loaded.length) download(new Blob([fmt()], { type }), `agent-office-history-${Date.now()}.${name === "CSV" ? "csv" : "jsonl"}`);
  });
  const exp = [save("JSONL", () => toJsonl(loaded), "application/x-ndjson"), save("CSV", () => toCsv(loaded), "text/csv")];
  exp.forEach((b) => { b.disabled = true; });
  const ms = (i: HTMLInputElement) => (i.value ? new Date(i.value).getTime() : 0);
  statusEl = status;
  onLoadedFn = () => exp.forEach((b) => { b.disabled = !loaded.length; });
  const closeBox = btn("×", "Close the replay picker", () => { box.hidden = true; }, "b sm");
  closeBox.setAttribute("aria-label", "Close the replay picker");
  box.append(el("b", "", "Replay"), closeBox, sel, fromW, toW, btn("Load", "Load stored events for the range", () =>
    void startReplay(ms(from) || Date.now() - Number(sel.value), ms(to), status, () => exp.forEach((b) => { b.disabled = !loaded.length; }))), ...exp, status, c);
  bar.append(box);

  // X2: auto sample data only on a daemon that has never seen a session (first run): not after a Clear or the idle sweep, not on a paired device
  let lastReal = Date.now(), ever = false, hooks: boolean | null = null;
  const realSessions = () => Object.keys(office.source.liveEnvelope()?.state.sessions ?? {}).length > 0;
  const fresh = () => { const e = office.source.liveEnvelope(); return !!e && !e.remote && !ever && !e.state.summaries?.length && hooks === false; };
  // shortcut: "never saw a session" = no ended-session summaries and no hook since the daemon started (GET /status); a daemon
  // restarted after its summaries aged out counts as fresh. Upgrade if the envelope carries a lifetime session count.
  void fetch("/status?format=json", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j: { lastEventAt?: number } | null) => { hooks = j ? !!j.lastEventAt : true; }, () => { hooks = true; });
  office.source.onLive(() => {
    if (!realSessions()) return;
    ever = true;
    lastReal = Date.now();
    if (office.source.mode === "demo") stop(); // a real session appeared: sample data ends immediately
  });
  setInterval(() => {
    if (realSessions()) lastReal = Date.now(); // sessions stay real between events
    else if (office.source.mode === "live" && !manual && fresh() && Date.now() - lastReal > AUTO_AFTER_MS) startDemo();
  }, 1000);
}
