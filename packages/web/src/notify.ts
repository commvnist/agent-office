// Opt-in alerts (#88): Notification API (permission asked on a click), tab title + favicon badge, optional beep.
// Never fires for sample/replay data, never while the tab is focused unless configured, once per episode.
import { office } from "./api.ts";
import { store } from "./dom.ts";
import { titleFor, type RadarItem } from "./logic.ts";

const flag = (k: string) => ({ get: () => store.get(k) === "1", set: (b: boolean) => store.set(k, b ? "1" : "0") });
export const prefs = { desktop: flag("alert.desktop"), sound: flag("alert.sound"), focused: flag("alert.focused") };

/** Must run from a click handler. */
export async function enableDesktop(): Promise<string> {
  if (typeof Notification === "undefined") return "unsupported";
  const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  prefs.desktop.set(p === "granted");
  return p;
}

let ctx: AudioContext | null = null;
function beep() {
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.04;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.12);
  } catch { /* audio blocked: silent */ }
}

const fired = new Set<string>();
let primed = false;
const priv = () => office.privacy || office.source.private;

function fire(key: string, text: string) {
  if (fired.has(key)) return;
  fired.add(key);
  if (fired.size > 200) fired.delete(fired.values().next().value!);
  if (office.source.mode !== "live") return;
  if (document.hasFocus() && !prefs.focused.get()) return;
  if (prefs.desktop.get() && typeof Notification !== "undefined" && Notification.permission === "granted") {
    try { new Notification("Agent Office", { body: priv() ? "A session needs you" : text, tag: key }); } catch { /* some browsers require a service worker */ }
  }
  if (prefs.sound.get()) beep();
}

const base = document.title;
let icon: HTMLLinkElement | null = null, plain = "";
function favicon(n: number) {
  icon ??= document.querySelector<HTMLLinkElement>("link[rel~=icon]") ?? Object.assign(document.head.appendChild(document.createElement("link")), { rel: "icon" });
  if (!plain) plain = icon.href;
  if (!n) { if (icon.href !== plain) icon.href = plain; return; }
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e0524a";
  g.beginPath(); g.arc(16, 16, 15, 0, 7); g.fill();
  g.fillStyle = "#fff"; g.font = "bold 20px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(String(Math.min(n, 9)), 16, 17);
  icon.href = c.toDataURL();
}

/** Called with the current radar every refresh. */
export function update(items: RadarItem[]) {
  const live = office.source.mode === "live";
  document.title = live ? titleFor(items, base) : base;
  favicon(live ? items.length : 0);
  const keys = new Set(items.map((i) => i.key));
  for (const k of fired) if (k.includes(":") && !k.startsWith("done:") && !keys.has(k)) fired.delete(k); // episode over: may alert again
  if (!primed) { primed = true; for (const k of keys) fired.add(k); return; } // what was already waiting at load is not news
  for (const i of items) if (i.kind !== "stuck") fire(i.key, i.kind === "blocked" ? `${i.label} is blocked` : `${i.project} is waiting for you`);
}

export const turnDone = (key: string, who: string) => fire(`done:${key}`, `${who} finished its turn`);
