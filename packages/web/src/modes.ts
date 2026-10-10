// Pluggable data sources (#90 sample data, #33 replay) + the toolbar buttons that switch them, privacy (#10), record (#96), share (#97).
// Both simulations run events through the core reducer locally (sim.ts) and push envelopes via office.source.
import { emptyState } from "@agent-office/core";
import { office } from "./api.ts";
import { $, btn, el } from "./dom.ts";
import { FALLBACK_CFG, Playback, demoScript, simEnvelope } from "./sim.ts";
import { recording, sharePoster, toggleRecording } from "./record.ts";

const AUTO_AFTER_MS = 3000;
let epoch = "", rev = 0;
let pb: Playback | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let manual = false; // the user stopped sample data: do not restart it by itself

const cfgNow = () => office.source.liveEnvelope()?.config ?? FALLBACK_CFG;
const push = () => pb && office.source.push(simEnvelope(pb.state, pb.cfg, epoch, ++rev, office.source.liveEnvelope()?.theme));
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
async function startReplay(sinceMs: number, status: HTMLElement) {
  status.textContent = "loading…";
  try {
    const q = `/history?since=${Date.now() - sinceMs}&limit=2000${office.source.private ? "&private=1" : ""}`;
    const r = await fetch(q, { credentials: "same-origin" });
    if (!r.ok) throw new Error(r.status === 401 ? "unauthorized (open the page via the daemon URL)" : `HTTP ${r.status}`);
    const events = (await r.json()).events ?? [];
    if (!events.length) { status.textContent = "No stored events in that range."; return; }
    manual = true;
    begin("replay", new Playback(cfgNow(), events));
    playing = true; vpos = 0;
    status.textContent = "";
    const slider = $("rp-slider") as HTMLInputElement;
    slider.max = String(events.length);
    slider.value = "0";
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
      $("rp-pos").textContent = `${pb.idx}/${pb.events.length}`;
      $("rp-play").textContent = playing ? "Pause" : "Play";
    }, 100);
  } catch (e) {
    status.textContent = `Could not load history: ${(e as Error).message}`;
  }
}

export function bindModes(tools: HTMLElement, bar: HTMLElement) {
  const badge = $("badge");
  let ctl: HTMLElement | null = null;
  office.source.onMode((m) => {
    badge.hidden = m === "live";
    badge.textContent = m === "demo" ? "SAMPLE DATA" : "REPLAY";
    if (ctl) ctl.hidden = m !== "replay";
  });

  tools.append(
    btn("Sample", "Play a built-in scenario with fake data", () => {
      if (office.source.mode === "demo") { manual = true; stop(); } else { manual = false; startDemo(); }
    }),
    btn("Replay", "Replay stored history through the office", () => {
      const box = $("rp-box");
      box.hidden = !box.hidden;
    }),
    btn(office.source.private ? "Private: on" : "Private", "Hide free text (prompts, tool details, paths). Reloads the page.", () => office.source.setPrivate(!office.source.private)),
    btn("Record", "Record the office canvas to a .webm file", (b) => {
      const s = toggleRecording();
      b.textContent = recording() ? "Stop rec" : "Record";
      $("rec-note").textContent = s;
    }),
    btn("Share", "Download a PNG poster (counts and names only, no text)", sharePoster),
  );
  document.addEventListener("ao-rec-stop", () => { $("rec-note").textContent = "saved"; });
  const note = el("div", "note");
  note.id = "rec-note";
  note.title = "Recordings include speech bubbles, which can contain prompts. Turn Private on to hide them.";
  tools.after(note);

  // replay bar
  const box = el("div", "rp");
  box.id = "rp-box";
  box.hidden = true;
  const status = el("span", "k");
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
  const pos = el("span", "k");
  pos.id = "rp-pos";
  const play = btn("Pause", "Play or pause", () => { playing = !playing; if (playing && pb && pb.idx >= pb.events.length) { pb.seek(0, Date.now()); vpos = 0; push(); } });
  play.id = "rp-play";
  c.append(play, ...[1, 4, 16].map((x) => btn(`${x}x`, `Speed ${x}x`, () => { speed = x; })), pos, slider,
    btn("Exit", "Back to live", () => { manual = true; stop(); }));
  box.append(sel, btn("Load", "Load stored events", () => void startReplay(Number(sel.value), status)), status, c);
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
