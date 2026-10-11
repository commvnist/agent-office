// Pluggable data sources (#90 sample data, #33 replay) + the toolbar buttons that switch them, privacy (#10), record (#96), share (#97).
// Both simulations run events through the core reducer locally (sim.ts) and push envelopes via office.source.
import { emptyState } from "@agent-office/core";
import { office } from "./api.ts";
import { $, btn, download, el } from "./dom.ts";
import { FALLBACK_CFG, Playback, demoScript, simEnvelope } from "./sim.ts";
import { recording, shareRecap, sharePoster, toggleRecording } from "./record.ts";
import { HISTORY_LIMIT, fetchHistory, markers, toCsv, toJsonl, type Marker } from "./history.ts";
import { group } from "./toolbar.ts";
import { register } from "./palette.ts";
import { copyLink } from "./actions.ts";
import { GIF_NOTE, armGif, cancelGif, gifArmed, saveGif } from "./gifrec.ts";
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

// ---- sample data ----
/** The banner's Stop and the Sample toggle: stop and do not restart it by itself. */
export function stopSample() {
  if (office.source.mode !== "demo") return;
  manual = true;
  stop();
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
    if (!events.length) { status.textContent = "No stored events in that range. Pick a wider range, or run a session first."; return; }
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

export function bindModes(tools: HTMLElement, bar: HTMLElement) {
  const badge = $("badge");
  $("stop-sample").addEventListener("click", stopSample);
  let ctl: HTMLElement | null = null;
  let sampleBtn: HTMLElement | null = null;
  office.source.onMode((m) => {
    badge.hidden = m === "live";
    badge.textContent = m === "demo" ? "SAMPLE DATA" : "REPLAY";
    $("stop-sample").hidden = m !== "demo"; // keyboard users reach Stop here even while the panel is closed
    if (ctl) ctl.hidden = m !== "replay";
    sampleBtn?.setAttribute("aria-pressed", String(m === "demo"));
  });

  const data = group(tools, "Data"), out = group(tools, "Output"), setup = group(tools, "Setup");
  sampleBtn = btn("Sample", "Play a built-in scenario with fake data", () => {
    if (office.source.mode === "demo") stopSample(); else { manual = false; startDemo(); }
  });
  sampleBtn.id = "sample"; // the empty-state card's Sample button clicks this
  sampleBtn.setAttribute("aria-pressed", "false");
  const toggleReplay = () => { const box = $("rp-box"); box.hidden = !box.hidden; };
  data.append(sampleBtn, btn("Replay", "Replay stored history through the office: pick a time range, then scrub", toggleReplay));
  register("View: Replay", toggleReplay);
  register("Data: Sample data on / off", () => sampleBtn!.click());
  setup.append(btn(office.source.private ? "Private: on" : "Private", "Hide free text (prompts, tool details, paths). Reloads the page.", () => office.source.setPrivate(!office.source.private)));
  const note = (s: string) => { $("rec-note").textContent = s; };
  const recBtn = btn("Record", "Record the office canvas to a .webm file", (b) => {
    const s = toggleRecording();
    b.textContent = recording() ? "Stop rec" : "Record";
    note(s);
  });
  const recap = async (b?: HTMLButtonElement) => { if (b) b.disabled = true; note(await shareRecap()); if (b) b.disabled = false; };
  // GIF: the first press arms a rolling 8 s buffer, the second saves it; the palette can cancel
  const gifBtn = btn("Record GIF", "Arm a rolling buffer of the last 8 seconds of the canvas (10 fps), press again to save a .gif. Nothing is kept while it is not armed.", async (b) => {
    if (!gifArmed()) {
      armGif();
      b.textContent = "Save GIF";
      b.setAttribute("aria-pressed", "true");
      note(`GIF armed: buffering the last 8 s. ${GIF_NOTE}`);
      return;
    }
    b.disabled = true;
    note("encoding GIF…");
    note(await saveGif((i, n) => note(`encoding GIF ${i}/${n}`)));
    b.disabled = false;
    b.textContent = "Record GIF";
    b.setAttribute("aria-pressed", "false");
  });
  gifBtn.setAttribute("aria-pressed", "false");
  const linkBtn = btn("Copy link", "Copy a URL that restores the selection, scope, view and filters. Nothing is sent anywhere.", async () => note(await copyLink()));
  out.append(recBtn, gifBtn, linkBtn, btn("Share", "Download a PNG poster: office snapshot, counts and names (speech bubbles in the snapshot can show text; Private blanks them)", sharePoster),
    btn("Recap", "Download a \"Today in the office\" PNG: sessions, busiest hour, longest tool, top files (names only when Private)", (b) => void recap(b)));
  register("Output: Copy link", () => linkBtn.click());
  register("Output: Record GIF (arm, then run again to save)", () => gifBtn.click());
  register("Output: Cancel GIF buffer", () => { cancelGif(); gifBtn.textContent = "Record GIF"; gifBtn.setAttribute("aria-pressed", "false"); note("GIF buffer cleared"); });
  register("Output: Record video (.webm)", () => recBtn.click());
  register("Output: Share poster (PNG)", () => void sharePoster());
  register("Output: Recap (PNG)", () => void recap());
  register("Setup: Private on / off", () => office.source.setPrivate(!office.source.private));
  document.addEventListener("ao-rec-stop", () => { recBtn.textContent = "Record"; $("rec-note").textContent = "saved"; });
  const noteEl = el("div", "note");
  noteEl.id = "rec-note";
  noteEl.title = "Recordings include speech bubbles, which can contain prompts. Turn Private on to hide them.";
  tools.after(noteEl);

  // replay bar
  const box = el("div", "rp");
  box.id = "rp-box";
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
    btn("Exit", "Back to live", () => { manual = true; stop(); }));
  const save = (name: string, fmt: () => string, type: string) => btn(name, "Download the loaded events as served (free text already removed when Private is on)", () => {
    if (loaded.length) download(new Blob([fmt()], { type }), `agent-office-history-${Date.now()}.${name === "CSV" ? "csv" : "jsonl"}`);
  });
  const exp = [save("JSONL", () => toJsonl(loaded), "application/x-ndjson"), save("CSV", () => toCsv(loaded), "text/csv")];
  exp.forEach((b) => { b.disabled = true; });
  const ms = (i: HTMLInputElement) => (i.value ? new Date(i.value).getTime() : 0);
  box.append(sel, fromW, toW, btn("Load", "Load stored events for the range", () =>
    void startReplay(ms(from) || Date.now() - Number(sel.value), ms(to), status, () => exp.forEach((b) => { b.disabled = !loaded.length; }))), ...exp, status, c);
  bar.append(box);

  // auto sample data when the office has been empty for a few seconds
  let lastReal = Date.now();
  const realSessions = () => Object.keys(office.source.liveEnvelope()?.state.sessions ?? {}).length > 0;
  office.source.onLive(() => {
    if (!realSessions()) return;
    lastReal = Date.now();
    if (office.source.mode === "demo") stop(); // a real session appeared: sample data ends immediately
  });
  setInterval(() => {
    if (realSessions()) lastReal = Date.now(); // sessions stay real between events
    else if (office.source.mode === "live" && !manual && Date.now() - lastReal > AUTO_AFTER_MS) startDemo();
  }, 1000);
}
