// Panel shell and small global chrome: collapsible/resizable side panel with mobile drawer (#74), presenter (#94) and
// overlay (#95) modes, settings popover (#67/#69/#71), legend + first-run explainer + connection banner (#89).
import { office } from "./api.ts";
import { $, btn, el, store } from "./dom.ts";
import { enableDesktop, mutes, prefs, spendLimit } from "./notify.ts";
import { chimePrefs, testChime } from "./chime.ts";
import { settings, setAmbientPaused } from "./settings.ts";
import { whoLine } from "./logic.ts";
import { modal } from "./dialog.ts";
import { group } from "./toolbar.ts";
import { bindKeys } from "./keys.ts";
import { bindViews } from "./views.ts";
import { bindPalette, register } from "./palette.ts";
import { setLang, t } from "./i18n.ts";
import { ignoreKey } from "./camera.ts";
import { stopSample } from "./modes.ts";
import { F } from "./flags.ts";
import { hideText, setStreamSafe, streamSafe } from "./stream.ts";
import { bindKiosk } from "./kiosk.ts";
import "./chrome.css";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const PANEL_W = { min: 260, max: 640 };
const body = document.body;
export const OVERLAY = F.overlay;

// ---- panel ----
function bindPanel() {
  const narrow = () => matchMedia("(max-width:800px)").matches;
  const saved = store.get("panel.open");
  let isOpen = saved === null ? !narrow() : saved === "1"; // phones start with the drawer closed
  let width = clamp(Number(store.get("panel.w")) || 340, PANEL_W.min, PANEL_W.max);
  // F16: the closed toggle carries the needs-you count so a phone user sees why to open it
  let n = 0; // the radar count ui.ts shows under NEEDS YOU, so the two cannot differ
  const label = () => {
    $("tg").textContent = isOpen ? t("hidePanel") : n ? `${t("panel")} (${t("needYou", { n })})` : t("panel");
    $("tg").classList.toggle("hot", !isOpen && n > 0);
  };
  const apply = () => {
    body.classList.toggle("collapsed", !isOpen);
    body.style.setProperty("--swx", `${width}px`);
    $("tg").setAttribute("aria-expanded", String(isOpen));
    label();
    store.set("panel.open", isOpen ? "1" : "0");
    store.set("panel.w", String(width));
  };
  $("tg").addEventListener("click", () => { isOpen = !isOpen; apply(); });
  document.addEventListener("ao:radar", (e) => { n = (e as CustomEvent<number>).detail; label(); });
  // #177: swipe the drawer to the right to dismiss it
  let sx = 0, sy = 0;
  $("side").addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $("side").addEventListener("touchend", (e) => {
    const p = e.changedTouches[0];
    if (narrow() && isOpen && p.clientX - sx > 70 && Math.abs(p.clientY - sy) < 50) { isOpen = false; apply(); }
  }, { passive: true });
  const h = $("handle");
  h.addEventListener("pointerdown", (e) => {
    h.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => { width = clamp(innerWidth - m.clientX, PANEL_W.min, PANEL_W.max); apply(); };
    const up = () => {
      h.removeEventListener("pointermove", move);
      h.removeEventListener("pointerup", up);
      h.removeEventListener("pointercancel", up);
    };
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", up);
    h.addEventListener("pointercancel", up);
  });
  h.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { width = clamp(width + (e.key === "ArrowLeft" ? 20 : -20), PANEL_W.min, PANEL_W.max); apply(); e.preventDefault(); }
  });
  apply();
  // pixi's resizeTo only listens to window resize: tell it when the panel changes the stage size
  new ResizeObserver(() => dispatchEvent(new Event("resize"))).observe($("stage"));
}

// ---- presenter / overlay ----
const savedScale = () => clamp(Number(store.get("scale")) || 1, 0.8, 2);
let capTimer: ReturnType<typeof setTimeout> | undefined;
/** Canvas text scale plus the DOM `--ts` var (#161). */
function applyScale(v: number) {
  office.applyTextScale(v);
  document.documentElement.style.setProperty("--ts", String(v));
}
function setPresenter(on: boolean) {
  body.classList.toggle("presenter", on);
  office.setPresenter(on);
  applyScale(on ? Math.max(1.5, savedScale()) : savedScale());
  $("pr").setAttribute("aria-pressed", String(on));
  $("px").hidden = !on;
  if (!OVERLAY) $("caption").hidden = !on; // presenter keeps the bar up for the counts; overlay shows it per feed item
  if (on) $("cap-who").textContent = $("cap-text").textContent = "";
}
function bindPresenter() {
  $("pr").addEventListener("click", () => setPresenter(!body.classList.contains("presenter")));
  $("px").addEventListener("click", () => setPresenter(false));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && body.classList.contains("presenter")) { e.preventDefault(); e.stopPropagation(); setPresenter(false); return; }
    if ((e.key === "p" || e.key === "P") && !ignoreKey(e)) setPresenter(!body.classList.contains("presenter"));
  });
  office.onFeed((f) => {
    if (!body.classList.contains("presenter") && !OVERLAY) return;
    const cap = $("caption");
    $("cap-who").textContent = whoLine(f);
    $("cap-text").textContent = hideText() ? "" : f.text; // stream-safe / private: names only
    cap.hidden = false;
    clearTimeout(capTimer);
    capTimer = setTimeout(() => { $("cap-who").textContent = $("cap-text").textContent = ""; cap.hidden = !body.classList.contains("presenter"); }, 7000);
  });
}

// ---- settings popover ----
const FONTS: Record<string, string> = {
  mono: "ui-monospace,Menlo,Consolas,monospace",
  sans: "system-ui,-apple-system,Segoe UI,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
};
function applyType() {
  const r = document.documentElement.style;
  r.setProperty("--font", FONTS[store.get("font") ?? ""] ?? FONTS.mono);
  r.setProperty("--lh", String(clamp(Number(store.get("lh")) || 1.5, 1.2, 2)));
  r.setProperty("--ls", `${clamp(Number(store.get("ls")) || 0, 0, 0.12)}em`);
}
function bindSettings(tools: HTMLElement) {
  const pop = $("settings");
  const row = (label: string, ...c: Node[]) => { const d = el("label", "srow"); d.append(el("span", "", label), ...c); pop.append(d); };
  const range = (min: number, max: number, step: number, v: number, fn: (v: number) => void) => {
    const i = el("input"); i.type = "range"; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(v);
    i.addEventListener("input", () => fn(+i.value));
    return i;
  };
  row("Text size", range(0.8, 2, 0.1, savedScale(), (v) => { store.set("scale", String(v)); applyScale(body.classList.contains("presenter") ? Math.max(1.5, v) : v); }));
  const font = el("select");
  for (const f of Object.keys(FONTS)) { const o = el("option", "", f); o.value = f; font.append(o); }
  font.value = store.get("font") ?? "mono";
  font.addEventListener("change", () => { store.set("font", font.value); applyType(); });
  row("Font", font);
  row("Line height", range(1.2, 2, 0.1, clamp(Number(store.get("lh")) || 1.5, 1.2, 2), (v) => { store.set("lh", String(v)); applyType(); }));
  row("Letter spacing", range(0, 0.12, 0.01, clamp(Number(store.get("ls")) || 0, 0, 0.12), (v) => { store.set("ls", String(v)); applyType(); }));
  const check = (init: boolean, fn: (b: boolean) => void) => { const c = el("input"); c.type = "checkbox"; c.checked = init; c.addEventListener("change", () => fn(c.checked)); return c; };
  const rm = store.get("motion");
  row("Reduce motion", check(rm === "1" || (rm === null && matchMedia("(prefers-reduced-motion: reduce)").matches), (b) => { store.set("motion", b ? "1" : "0"); office.setReducedMotion(b); }));
  row("Alert sound", check(prefs.sound.get(), prefs.sound.set));
  row("Alert when focused", check(prefs.focused.get(), prefs.focused.set));
  const ss = check(streamSafe(), setStreamSafe);
  ss.disabled = F.streamSafe !== null; // ?streamsafe=0|1 in the URL decides
  ss.title = "Names stay; prompts, paths and tool details are blurred or dropped. The canvas bubbles are blanked by Private (reload).";
  row("Stream-safe (hide text in overlay, presenter, wall, kiosk)", ss);
  row("Pause ambient motion", check(settings.ambientPaused, setAmbientPaused));
  row("Sound (off by default)", check(chimePrefs.on.get(), chimePrefs.on.set));
  row("Chime volume", range(0, 100, 5, chimePrefs.volume, (v) => { chimePrefs.volume = v; }));
  row("Mute chimes", check(chimePrefs.mute.get(), chimePrefs.mute.set));
  pop.append(btn("Test chime", "Plays one short tone (needs a click first: browser autoplay rule)", testChime));
  const sp = el("input");
  sp.type = "number"; sp.min = "0"; sp.step = "10000"; sp.placeholder = String(spendLimit() || "off");
  sp.value = store.get("spend") ?? "";
  sp.title = "Notify once per session when new input + output tokens (cache excluded) pass this. 0 or empty uses office.json spendAlarmTokens.";
  sp.addEventListener("change", () => store.set("spend", String(Math.max(0, Math.floor(Number(sp.value)) || 0))));
  row("Spend alarm (tokens)", sp);
  const dn = btn("Enable desktop notifications", "Asks the browser for permission", async (b) => { b.textContent = `Notifications: ${await enableDesktop()}`; });
  if (prefs.desktop.get()) dn.textContent = "Notifications: on";
  pop.append(dn);
  // #188: per-session mute / 30 min snooze, rebuilt each time the dialog opens
  const mu = el("div");
  pop.append(mu);
  const fillMutes = () => {
    mu.replaceChildren(...(office.sessions().length ? [] : [el("div", "k", "No sessions to mute yet: they appear here once Claude Code is running.")]), ...office.sessions().map((s) => {
      const r = el("div", "srow"), on = mutes.active(s.id);
      const set = (until: number) => () => { mutes.set(s.id, until); fillMutes(); };
      r.append(el("span", "", s.project));
      if (on) r.append(btn("Unmute", "Alert for this session again", set(0), "b sm"));
      else r.append(btn("Snooze 30m", "No alerts from this session for 30 minutes", set(Date.now() + 30 * 60_000), "b sm"),
        btn("Mute", "No alerts from this session", set(Number.MAX_SAFE_INTEGER), "b sm"));
      return r;
    }));
  };
  pop.hidden = true;
  const open = btn("Settings", "Text size, font, motion, alerts, sound, mute sessions", () => m.toggle());
  open.setAttribute("aria-haspopup", "dialog");
  group(tools, "Setup").append(open);
  const m = modal(pop, open, fillMutes);
  register("Open Settings", () => m.open());
  bindPalette(tools);
  // apply persisted choices
  if (rm !== null) office.setReducedMotion(rm === "1");
  applyType();
  applyScale(OVERLAY ? Math.max(1.6, savedScale()) : savedScale());
}

// ---- legend + first-run intro ----
const LEGEND: [string, string][] = [
  ["green / red dot", "Top bar: connected to the daemon / not connected."],
  ["gold ring + !", "A session is waiting for you (permission or input)."],
  ["red ring, flag, ! tag", "An agent reported BLOCKED; its desk is held until you look."],
  ["? on a bubble", "Attribution is a guess: several or no matching delegations."],
  ["? over a queued agent", "Waiting in line for a free seat."],
  ["...", "Thinking: seated, between tools."],
  ["bubble badges", "Chip on a bubble: prompt, delegate, report, tool, message."],
  ["gold name", "Session lead; \"waiting on\" lists its active helpers."],
  ["board on the wall", "Tasks: pending, running, done, blocked."],
  ["thin line", "Lead to active helper; highlighted for the selected agent's chain."],
  ["loop ×N · tool", "Amber text: the same tool call repeated N times in a row (roster, selected card, NEEDS YOU)."],
  ["Frozen · N new", "The view is held on purpose (key .); Resume applies the newest state."],
  ["spark", "Two agents edited the same file: a possible conflict."],
];
function bindLegend() {
  const d = $("legend");
  d.append(el("summary", "", "LEGEND"));
  for (const [k, v] of LEGEND) { const r = el("div", "lg"); r.append(el("b", "", k), el("span", "", v)); d.append(r); }
  // one intro paragraph: shown on first run with "Got it" (persisted), then only via the Intro button
  const intro = $("intro");
  if (store.get("seen") === "1") return;
  intro.hidden = false;
  intro.append(btn("Got it", "Hide the intro; the Intro button brings it back", () => { intro.hidden = true; store.set("seen", "1"); }));
}

// ---- connection banner ----
async function probe(): Promise<string> {
  try {
    const r = await fetch("/state", { credentials: "same-origin" });
    if (r.status === 401) return "Unauthorized: this page has no access cookie. Open it through the daemon URL (http://127.0.0.1:<port>/), not a copy or another host.";
    if (r.status === 403) return "Host not allowed: open the page as 127.0.0.1 or localhost on the daemon port.";
    return "The stream dropped; retrying. If this persists run: node scripts/office.mjs doctor";
  } catch {
    return "Cannot reach the daemon. Start Claude Code with the plugin (it starts the daemon) or run: node packages/server/src/main.ts. Check with: node scripts/office.mjs status";
  }
}
let probing = false, probed = "", staleSince = 0;
let staleEl: HTMLElement;
function banner() {
  const b = $("banner"), e = office.getEnvelope(), s = office.connection.state, sim = office.source.mode !== "live", demo = office.source.mode === "demo";
  const msgs: string[] = [];
  const cfgErr = office.source.liveEnvelope()?.configError;
  if (cfgErr) msgs.push(`office.json is invalid, using the last good config: ${cfgErr.message}`);
  const cfgWarn = office.source.liveEnvelope()?.configWarning;
  if (cfgWarn) msgs.push(cfgWarn);
  if (s === "retrying") {
    if (!probing) { probing = true; void probe().then((m) => { probed = m; probing = false; banner(); }); }
    staleSince ||= Date.now();
    msgs.push(`Stale since ${new Date(staleSince).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. ${probed || "Connection lost, retrying…"}`);
  } else { probed = ""; staleSince = 0; }
  staleEl.hidden = !staleSince;
  if (staleSince) staleEl.textContent = t("stale", { time: new Date(staleSince).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
  if (s === "connecting") msgs.push("Connecting to the daemon…");
  if (!sim && s === "live" && e && !Object.keys(e.state.sessions).length) msgs.push("No sessions yet. Start Claude Code with --plugin-dir plugin and send a prompt; hooks load at startup, so restart any claude that was already running.");
  const sig = `${demo}\n${msgs.join("\n")}`;
  if (b.dataset.sig === sig) return;
  b.dataset.sig = sig;
  const rows = msgs.map((m) => el("div", "warn", m));
  if (demo) { // fake agents must not pass for the user's sessions
    const d = el("div", "warn", "Sample data, not your sessions. ");
    d.append(btn("Stop sample", "Stop the built-in sample data", stopSample));
    rows.unshift(d);
  }
  b.replaceChildren(...rows);
  b.hidden = !rows.length;
}

export function bindPanelChrome(tools: HTMLElement) {
  if (OVERLAY) body.classList.add("overlay");
  if (F.obs) body.classList.add("obs");
  if (F.size) { body.classList.add("obs-fixed"); body.style.setProperty("--ow", `${F.size[0]}px`); body.style.setProperty("--oh", `${F.size[1]}px`); }
  bindPanel();
  setLang();
  staleEl = el("div");
  staleEl.id = "stale";
  staleEl.setAttribute("role", "alert");
  staleEl.hidden = true;
  body.append(staleEl);
  const pr = btn("Present", "Presenter mode (P): big captions, panel hidden", () => {});
  pr.id = "pr";
  pr.setAttribute("aria-pressed", "false");
  group(tools, "View").append(pr);
  bindPresenter();
  register("View: Present", () => setPresenter(!body.classList.contains("presenter")));
  bindViews(tools);
  bindKiosk(tools);
  bindSettings(tools);
  bindKeys(tools);
  bindLegend();
  office.connection.onChange(() => { $("live").classList.toggle("off", office.connection.state !== "live"); banner(); });
  office.subscribe(banner);
  office.source.onMode(banner);
  banner();
}
