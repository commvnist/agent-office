// Panel shell and small global chrome: collapsible/resizable side panel with mobile drawer (#74), presenter mode (#94), settings popover (#67/#69/#71), legend + first-run explainer + connection banner (#89).
import { office } from "./api.ts";
import { $, btn, el, store } from "./dom.ts";
import { STUCK_MIN, enableDesktop, mutes, prefs, spendLimit, stuckMin } from "./notify.ts";
import { chimePrefs, testChime } from "./chime.ts";
import { settings, setAmbientPaused } from "./settings.ts";
import { captionText, whoLine } from "./logic.ts";
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
import { bindLan, isRemote, shareSection } from "./lan.ts";
import "./chrome.css";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const PANEL_W = { min: 260, max: 640 };
const body = document.body;

// ---- panel ----
function bindPanel() {
  const narrow = () => matchMedia("(max-width:800px)").matches;
  const saved = store.get("panel.open");
  let isOpen = saved === null ? !narrow() : saved === "1"; // phones start with the drawer closed
  let width = clamp(Number(store.get("panel.w")) || 340, PANEL_W.min, PANEL_W.max);
  // F16: the closed toggle carries the needs-you count so a phone user sees why to open it
  let n = 0; // the radar count ui.ts shows under NEEDS YOU, so the two cannot differ
  // B8: one control, one name; a chevron for the direction and the needs-you count as a badge while closed
  const label = () => {
    const tg = $("tg"), c = el("span", "cnt", String(n));
    tg.replaceChildren(`${t("panel")} ${isOpen ? "▸" : "◂"}`, ...(!isOpen && n ? [" ", c] : []));
    tg.setAttribute("aria-label", !isOpen && n ? `${t("panel")}, ${t("needYou", { n })}` : t("panel"));
    tg.classList.toggle("hot", !isOpen && n > 0);
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

// ---- presenter ----
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
  $("caption").hidden = !on; // presenter keeps the bar up for the counts
  if (on) $("cap-who").textContent = $("cap-text").textContent = "";
}
function bindPresenter() {
  $("pr").addEventListener("click", () => setPresenter(!body.classList.contains("presenter")));
  $("px").addEventListener("click", () => setPresenter(false));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && body.classList.contains("presenter")) { e.preventDefault(); e.stopPropagation(); setPresenter(false); return; }
    if ((e.key === "p" || e.key === "P") && !ignoreKey(e) && !isRemote()) setPresenter(!body.classList.contains("presenter"));
  });
  office.onFeed((f) => {
    if (!body.classList.contains("presenter")) return;
    const cap = $("caption");
    $("cap-who").textContent = whoLine(f);
    $("cap-text").textContent = hideText() ? "" : captionText(f); // stream-safe / private: names only
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
/** V2: what the office injects into Claude sessions, in one line per protocol (read-only; office.json decides). */
export const PROTOCOL: Record<string, string> = {
  office: "Sessions get a short roster, identity and report-format note when they start, and a spawn may be refused when no desk is free (enforceSeats).",
  observe: "Nothing is injected and nothing is refused: the office only watches.",
};
export const protocolOf = () => office.source.liveEnvelope()?.config.protocol ?? office.getEnvelope()?.config.protocol ?? "office";
function bindSettings(tools: HTMLElement) {
  const pop = $("settings");
  pop.setAttribute("aria-labelledby", "set-h");
  let box: HTMLElement = pop;
  const sec = (name: string, line?: string) => { box = el("fieldset", "sgrp"); box.append(el("legend", "", name)); if (line) box.append(el("p", "k", line)); pop.append(box); return box; };
  const row = (label: string, c: HTMLElement, hint = "") => {
    const d = el("label", "srow");
    d.append(el("span", "", label), c);
    if (hint) { d.title = hint; c.title ||= hint; }
    box.append(d);
    return d;
  };
  const range = (min: number, max: number, step: number, v: number, fn: (v: number) => void) => {
    const i = el("input"); i.type = "range"; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(v);
    i.addEventListener("input", () => fn(+i.value));
    return i;
  };
  const check = (init: boolean, fn: (b: boolean) => void) => { const c = el("input"); c.type = "checkbox"; c.checked = init; c.addEventListener("change", () => fn(c.checked)); return c; };
  const head = el("div", "dhead"), h = el("h2", "", "Settings");
  h.id = "set-h";
  const x = btn("×", "Close settings (Esc)", () => m.close(), "b sm");
  x.setAttribute("aria-label", "Close settings");
  head.append(h, x);
  pop.append(head);

  sec("Display");
  row("Text size", range(0.8, 2, 0.1, savedScale(), (v) => { store.set("scale", String(v)); applyScale(body.classList.contains("presenter") ? Math.max(1.5, v) : v); }));
  const font = el("select");
  for (const f of Object.keys(FONTS)) { const o = el("option", "", f); o.value = f; font.append(o); }
  font.value = store.get("font") ?? "mono";
  font.addEventListener("change", () => { store.set("font", font.value); applyType(); });
  row("Font", font);
  row("Line height", range(1.2, 2, 0.1, clamp(Number(store.get("lh")) || 1.5, 1.2, 2), (v) => { store.set("lh", String(v)); applyType(); }));
  row("Letter spacing", range(0, 0.12, 0.01, clamp(Number(store.get("ls")) || 0, 0, 0.12), (v) => { store.set("ls", String(v)); applyType(); }));

  sec("Motion");
  const rm = store.get("motion");
  row("Reduce motion", check(rm === "1" || (rm === null && matchMedia("(prefers-reduced-motion: reduce)").matches), (b) => { store.set("motion", b ? "1" : "0"); office.setReducedMotion(b); }), "Follows the system setting until you change it here");
  row("Pause ambient motion", check(settings.ambientPaused, setAmbientPaused), "Stops dust, steam, strolls and other loops; real activity still moves");

  sec("Sound", "Off by default. Needs one click on the page first (browser rule).");
  row("Chimes", check(chimePrefs.on.get(), chimePrefs.on.set), "A short tone when something needs you, gives up or finishes");
  row("Chime volume", range(0, 100, 5, chimePrefs.volume, (v) => { chimePrefs.volume = v; }));
  row("Silence chimes for now", check(chimePrefs.mute.get(), chimePrefs.mute.set), "Keeps your chime choice but plays nothing until you untick this");
  row("Beep when chimes are off", check(prefs.sound.get(), prefs.sound.set), "One plain beep per alert, for when chimes are off");
  box.append(btn("Test chime", "Plays one short tone", testChime));

  // X8: the NEEDS YOU threshold lives here, not inside the list
  sec("Needs you");
  const stuck = el("select");
  for (const m of STUCK_MIN) stuck.append(Object.assign(el("option", "", `${m} min`), { value: String(m) }));
  stuck.value = String(stuckMin());
  stuck.addEventListener("change", () => store.set("stuck", stuck.value));
  row("Stuck after silence of", stuck, "NEEDS YOU lists a session silent mid-turn for this long (3x while a tool runs) and a helper silent for 3x this long.");

  sec("Notifications");
  const dn = btn("Enable desktop notifications", "Asks the browser for permission", async (b) => { b.textContent = `Notifications: ${await enableDesktop()}`; });
  if (prefs.desktop.get()) dn.textContent = "Notifications: on";
  box.append(dn);
  row("Alert while this tab is focused", check(prefs.focused.get(), prefs.focused.set));
  const sp = el("input");
  sp.type = "number"; sp.min = "0"; sp.step = "10000"; sp.placeholder = String(spendLimit() || "off");
  sp.value = store.get("spend") ?? "";
  sp.addEventListener("change", () => store.set("spend", String(Math.max(0, Math.floor(Number(sp.value)) || 0))));
  row("Spend alarm (tokens)", sp, "Notify once per session when new input + output tokens (cache excluded) pass this. 0 or empty uses office.json spendAlarmTokens.");
  // #188: per-session mute / 30 min snooze, rebuilt each time the dialog opens
  const mu = el("div", "mutes");
  box.append(mu);
  const fillMutes = () => {
    mu.replaceChildren(...(office.sessions().length ? [] : [el("div", "k", "No sessions to mute yet: they appear here once Claude Code is running.")]), ...office.sessions().map((s) => {
      const r = el("div", "srow"), on = mutes.active(s.id);
      const set = (until: number) => () => { mutes.set(s.id, until); fillMutes(); };
      const name = el("span", "", s.project);
      name.title = s.project;
      r.append(name);
      const ctl = el("span", "sctl");
      // the visible label repeats per session, so the accessible name carries the project
      const named = (b: HTMLButtonElement) => (b.setAttribute("aria-label", `${b.textContent} ${s.project}`), b);
      if (on) ctl.append(named(btn("Unmute", "Alert for this session again", set(0), "b sm")));
      else ctl.append(named(btn("Snooze 30m", "No alerts from this session for 30 minutes", set(Date.now() + 30 * 60_000), "b sm")),
        named(btn("Mute", "No alerts from this session", set(Number.MAX_SAFE_INTEGER), "b sm")));
      r.append(ctl);
      return r;
    }));
  };

  // I1-I3: two switches that differ in scope, one line each
  sec("Privacy");
  row("Private, everywhere", check(office.source.private, (b) => office.source.setPrivate(b)), "Reloads the page");
  box.append(el("p", "k", "Hides prompts, commands, paths and narration on every surface, the canvas included. Reloads the page."));
  const ss = check(streamSafe(), setStreamSafe);
  ss.disabled = F.streamSafe !== null; // ?streamsafe=0|1 in the URL decides
  row("Stream-safe", ss);
  box.append(el("p", "k", "Hides the same text only while showing others: Present, Kiosk, the Sessions and History views."));
  const dp = el("p", "k");
  box.append(dp);

  const proto = sec("Office protocol");
  const pl = el("p", "");
  proto.append(pl, el("p", "k", "Read-only here: set \"protocol\": \"office\" or \"observe\" in office.json."));
  const fillInfo = () => {
    const p = protocolOf();
    pl.replaceChildren(el("b", "", p === "observe" ? "observe" : "office (protocol on)"), document.createTextNode(`: ${PROTOCOL[p] ?? PROTOCOL.office}`));
    dp.textContent = office.privacy ? "The daemon is blanking text for everyone (office.json privacy)." : "";
  };

  const fillShare = shareSection(sec("Share on network"), row);

  pop.hidden = true;
  const openBtn = btn("⚙", "Settings: display, motion, sound, notifications, privacy, office protocol", () => m.toggle());
  openBtn.setAttribute("aria-haspopup", "dialog");
  openBtn.setAttribute("aria-label", "Settings");
  openBtn.id = "set-open";
  group(tools, "Setup").append(openBtn);
  const m = modal(pop, openBtn, () => { fillMutes(); fillInfo(); fillShare(); });
  register("Open Settings", () => m.open());
  bindPalette();
  // apply persisted choices
  if (rm !== null) office.setReducedMotion(rm === "1");
  applyType();
  applyScale(savedScale());
}

// ---- first-run intro (B3): one short paragraph and its own "Got it" row; Help keeps the full explainer and the legend ----
function bindIntro() {
  const intro = $("intro");
  if (store.get("seen") === "1") return;
  intro.hidden = false;
  const r = el("div", "row");
  r.append(btn("Got it", "Hide this; Help (?) explains everything again", () => { intro.hidden = true; store.set("seen", "1"); }, "b sm"));
  intro.append(r);
}

// ---- connection banner ----
async function probe(): Promise<string> {
  try {
    const r = await fetch("/state", { credentials: "same-origin" });
    if (r.status === 401 && isRemote()) return "This device is no longer paired (revoked, or unused for 30 days). Open /pair on this address and type a new code from the host.";
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
  // Z7 (Agent A): the daemon marks an envelope degraded instead of dropping it silently
  const deg = (office.source.liveEnvelope() as { degraded?: boolean | string } | null)?.degraded;
  if (deg) msgs.push(typeof deg === "string" ? deg : "The office is too large to stream in full: some detail is missing from this view.");
  if (s === "retrying") {
    if (!probing) { probing = true; void probe().then((m) => { probed = m; probing = false; banner(); }); }
    staleSince ||= Date.now();
    msgs.push(`Stale since ${new Date(staleSince).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. ${probed || "Connection lost, retrying…"}`);
  } else { probed = ""; staleSince = 0; }
  staleEl.hidden = !staleSince;
  // on a paired phone the probe's reason (e.g. "no longer paired") is the useful line, not a generic "stream is down"
  if (staleSince) staleEl.textContent = isRemote() && probed ? probed : t("stale", { time: new Date(staleSince).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
  if (s === "connecting") msgs.push("Connecting to the daemon…");

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
  group(tools, "Display").append(pr);
  bindPresenter();
  register("Display: Present (P)", () => setPresenter(!body.classList.contains("presenter")));
  bindViews(tools);
  bindKiosk(tools);
  bindSettings(tools);
  bindLan();
  bindKeys(tools);
  bindIntro();
  office.connection.onChange(() => { $("live").classList.toggle("off", office.connection.state !== "live"); banner(); });
  office.subscribe(banner);
  office.source.onMode(banner);
  banner();
}
