// Panel shell and small global chrome: collapsible/resizable side panel with mobile drawer (#74), presenter (#94) and
// overlay (#95) modes, settings popover (#67/#69/#71), legend + first-run explainer + connection banner (#89).
import { office } from "./api.ts";
import { $, btn, el, store } from "./dom.ts";
import { enableDesktop, prefs } from "./notify.ts";
import { whoLine } from "./logic.ts";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const body = document.body;
const params = new URLSearchParams(location.search);
export const OVERLAY = params.get("overlay") === "1";

// ---- panel ----
function bindPanel() {
  const narrow = () => matchMedia("(max-width:800px)").matches;
  const saved = store.get("panel.open");
  let isOpen = saved === null ? !narrow() : saved === "1"; // phones start with the drawer closed
  let width = clamp(Number(store.get("panel.w")) || 340, 260, 640);
  const apply = () => {
    body.classList.toggle("collapsed", !isOpen);
    body.style.setProperty("--swx", `${width}px`);
    $("tg").setAttribute("aria-expanded", String(isOpen));
    $("tg").textContent = isOpen ? "Hide panel" : "Panel";
    store.set("panel.open", isOpen ? "1" : "0");
    store.set("panel.w", String(width));
  };
  $("tg").addEventListener("click", () => { isOpen = !isOpen; apply(); });
  const h = $("handle");
  h.addEventListener("pointerdown", (e) => {
    h.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => { width = clamp(innerWidth - m.clientX, 260, 640); apply(); };
    const up = () => { h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); };
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", up);
  });
  h.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { width = clamp(width + (e.key === "ArrowLeft" ? 20 : -20), 260, 640); apply(); e.preventDefault(); }
  });
  apply();
  // pixi's resizeTo only listens to window resize: tell it when the panel changes the stage size
  new ResizeObserver(() => dispatchEvent(new Event("resize"))).observe($("stage"));
}

// ---- presenter / overlay ----
const savedScale = () => clamp(Number(store.get("scale")) || 1, 0.8, 2);
let capTimer: ReturnType<typeof setTimeout> | undefined;
function setPresenter(on: boolean) {
  body.classList.toggle("presenter", on);
  office.setPresenter(on);
  office.applyTextScale(on ? Math.max(1.5, savedScale()) : savedScale());
  $("pr").setAttribute("aria-pressed", String(on));
}
function bindPresenter() {
  $("pr").addEventListener("click", () => setPresenter(!body.classList.contains("presenter")));
  addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) setPresenter(!body.classList.contains("presenter"));
  });
  office.onFeed((f) => {
    if (!body.classList.contains("presenter") && !OVERLAY) return;
    const cap = $("caption");
    cap.replaceChildren(el("b", "", whoLine(f)), el("span", "", f.text));
    cap.hidden = false;
    clearTimeout(capTimer);
    capTimer = setTimeout(() => { cap.hidden = true; }, 7000);
  });
}

// ---- settings popover ----
function bindSettings(tools: HTMLElement) {
  const pop = $("settings");
  const row = (label: string, ...c: Node[]) => { const d = el("label", "srow"); d.append(el("span", "", label), ...c); pop.append(d); };
  const scale = el("input"); scale.type = "range"; scale.min = "0.8"; scale.max = "2"; scale.step = "0.1"; scale.value = String(savedScale());
  scale.addEventListener("input", () => { store.set("scale", scale.value); office.applyTextScale(body.classList.contains("presenter") ? Math.max(1.5, +scale.value) : +scale.value); });
  row("Text size", scale);
  const check = (init: boolean, fn: (b: boolean) => void) => { const c = el("input"); c.type = "checkbox"; c.checked = init; c.addEventListener("change", () => fn(c.checked)); return c; };
  const rm = store.get("motion");
  row("Reduce motion", check(rm === "1" || (rm === null && matchMedia("(prefers-reduced-motion: reduce)").matches), (b) => { store.set("motion", b ? "1" : "0"); office.setReducedMotion(b); }));
  const th = el("select");
  const addTheme = (v: string, l = v) => { const o = el("option", "", l); o.value = v; th.append(o); };
  addTheme("", "daemon default");
  ["default", "high-contrast", "light"].forEach((n) => addTheme(n));
  fetch("/themes", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
    const have = new Set(["default", "high-contrast", "light"]);
    for (const n of (j?.themes ?? []) as string[]) if (typeof n === "string" && !have.has(n)) addTheme(n);
    th.value = store.get("theme") ?? "";
  }).catch(() => { /* offline: built-in themes only */ });
  th.addEventListener("change", () => { store.set("theme", th.value); office.setTheme(th.value); });
  row("Theme", th);
  row("Alert sound", check(prefs.sound.get(), prefs.sound.set));
  row("Alert when focused", check(prefs.focused.get(), prefs.focused.set));
  const dn = btn("Enable desktop notifications", "Asks the browser for permission", async (b) => { b.textContent = `Notifications: ${await enableDesktop()}`; });
  if (prefs.desktop.get()) dn.textContent = "Notifications: on";
  pop.append(dn);
  pop.hidden = true;
  const open = btn("Settings", "Text size, motion, theme, alerts", () => { pop.hidden = !pop.hidden; });
  open.setAttribute("aria-haspopup", "dialog");
  tools.append(open);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { pop.hidden = true; open.focus(); } });
  // apply persisted choices
  if (rm !== null) office.setReducedMotion(rm === "1");
  const t = store.get("theme");
  if (t) office.setTheme(t);
  office.applyTextScale(OVERLAY ? Math.max(1.6, savedScale()) : savedScale());
}

// ---- legend + explainer ----
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
  ["spark", "Two agents edited the same file: a possible conflict."],
];
function bindLegend() {
  const d = $("legend");
  d.append(el("summary", "", "LEGEND"));
  for (const [k, v] of LEGEND) { const r = el("div", "lg"); r.append(el("b", "", k), el("span", "", v)); d.append(r); }
  const ex = $("explain");
  if (store.get("seen") === "1") return;
  ex.hidden = false;
  ex.append(el("div", "", "Each Claude Code session is a lead at the door; subagents sit at desks. Speech bubbles are prompts, delegations and reports. Gold ring = waiting for you, red = blocked. Click anyone to inspect them."),
    btn("Got it", "Dismiss", () => { ex.hidden = true; store.set("seen", "1"); }));
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
let probing = false, probed = "";
function banner() {
  const b = $("banner"), e = office.getEnvelope(), s = office.connection.state, sim = office.source.mode !== "live";
  const msgs: string[] = [];
  const cfgErr = office.source.liveEnvelope()?.configError;
  if (cfgErr) msgs.push(`office.json is invalid, using the last good config: ${cfgErr.message}`);
  if (s === "retrying") {
    if (!probing) { probing = true; void probe().then((m) => { probed = m; probing = false; banner(); }); }
    msgs.push(probed || "Connection lost, retrying…");
  } else probed = "";
  if (s === "connecting") msgs.push("Connecting to the daemon…");
  if (!sim && s === "live" && e && !Object.keys(e.state.sessions).length) msgs.push("No sessions yet. Start Claude Code with --plugin-dir plugin and send a prompt; hooks load at startup, so restart any claude that was already running.");
  const sig = msgs.join("\n");
  if (b.dataset.sig === sig) return;
  b.dataset.sig = sig;
  b.replaceChildren(...msgs.map((m) => el("div", "warn", m)));
  b.hidden = !msgs.length;
}

export function bindPanelChrome(tools: HTMLElement) {
  if (OVERLAY) body.classList.add("overlay");
  bindPanel();
  const pr = btn("Present", "Presenter mode (P): big captions, panel hidden", () => {});
  pr.id = "pr";
  pr.setAttribute("aria-pressed", "false");
  tools.append(pr);
  bindPresenter();
  bindSettings(tools);
  bindLegend();
  office.connection.onChange(() => { $("live").classList.toggle("off", office.connection.state !== "live"); banner(); });
  office.subscribe(banner);
  office.source.onMode(banner);
  banner();
}
