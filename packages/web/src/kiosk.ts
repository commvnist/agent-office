// Wallboard kiosk: fullscreen, chrome hidden, rotates the live surfaces (office -> sessions wall), pauses after interaction,
// holds a wake lock. Something that needs you breaks the rotation: the office (where the alert is drawn) stays up until it clears (X8).
import { announce, btn } from "./dom.ts";
import { group } from "./toolbar.ts";
import { register } from "./palette.ts";
import { F } from "./flags.ts";
import { currentView, showView } from "./views.ts";

const ROTATE_MS = 20_000, PAUSE_MS = 60_000, ORDER = ["", "wall"] as const;
let timer: ReturnType<typeof setInterval> | undefined, touched = 0, lock: { release(): Promise<void> } | null = null, fs = false, need = 0;
export const kioskOn = () => document.body.classList.contains("kiosk");

async function hold() { // feature-detected; the browser drops it when the tab hides, so ask again on return
  try { lock = (await (navigator as unknown as { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen")) ?? null; } catch { lock = null; }
}
async function enterFullscreen() {
  try { await document.documentElement.requestFullscreen(); fs = true; } catch { /* needs a user gesture: retried on the first one */ }
}
export function startKiosk() {
  if (kioskOn()) return;
  document.body.classList.add("kiosk");
  touched = 0;
  showView("");
  void enterFullscreen();
  void hold();
  timer = setInterval(() => {
    if (Date.now() - touched < PAUSE_MS || need) return;
    showView(ORDER[(ORDER.indexOf(currentView() as (typeof ORDER)[number]) + 1) % ORDER.length]);
  }, ROTATE_MS);
  announce("Kiosk mode: the view rotates every 20 seconds; press Escape to leave");
}
export function stopKiosk() {
  if (!kioskOn()) return;
  document.body.classList.remove("kiosk");
  clearInterval(timer);
  void lock?.release().catch(() => {});
  lock = null;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  fs = false;
  showView("");
}
export const toggleKiosk = () => (kioskOn() ? stopKiosk() : startKiosk());

export function bindKiosk(tools: HTMLElement) {
  const b = btn("Kiosk", "Wallboard: fullscreen, rotates office / sessions, holds the office while something needs you, Esc leaves (?kiosk in the URL)", toggleKiosk);
  b.id = "kiosk";
  group(tools, "Display").append(b);
  document.addEventListener("ao:radar", (e) => {
    const was = need;
    need = (e as CustomEvent<number>).detail;
    if (kioskOn() && need && !was) showView(""); // an alert breaks the rotation
  });
  register("View: Kiosk (wallboard, Esc leaves)", toggleKiosk);
  const poke = () => { touched = Date.now(); if (kioskOn() && !fs && !document.fullscreenElement) void enterFullscreen(); };
  for (const ev of ["pointerdown", "wheel", "keydown"]) addEventListener(ev, poke, { capture: true, passive: true });
  // before every other Escape handler (views close, deselect): kiosk owns the key until it is left
  addEventListener("keydown", (e) => { if (e.key === "Escape" && kioskOn()) { e.preventDefault(); e.stopPropagation(); stopKiosk(); } }, true);
  document.addEventListener("fullscreenchange", () => { if (fs && !document.fullscreenElement) stopKiosk(); });
  document.addEventListener("visibilitychange", () => { if (kioskOn() && !document.hidden) void hold(); });
  if (F.kiosk) startKiosk();
}
