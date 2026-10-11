// Opt-in chimes (default OFF): generated WebAudio tones, no files. The AudioContext is created on the first user gesture
// (the browser autoplay rule); while it is not running a chime is simply skipped.
import { store } from "./dom.ts";
import { F } from "./flags.ts";
import { chimeGate, type ChimeKind } from "./logic.ts";

const flag = (k: string, def: string) => ({ get: () => (store.get(k) ?? def) === "1", set: (b: boolean) => store.set(k, b ? "1" : "0") });
export const chimePrefs = {
  on: flag("chime.on", "0"),
  mute: flag("chime.mute", "0"),
  get volume() { const v = Number(store.get("chime.vol") ?? 50); return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 50; },
  set volume(v: number) { store.set("chime.vol", String(Math.max(0, Math.min(100, Math.round(v))))); },
};
// Distinct shapes: blocked falls and buzzes, waiting asks (two rising), finished resolves (three rising), loop is a flat double tick.
const TONES: Record<ChimeKind, { f: number[]; type: OscillatorType }> = {
  blocked: { f: [392, 262], type: "square" },
  waiting: { f: [523, 659], type: "sine" },
  finished: { f: [523, 659, 784], type: "triangle" },
  loop: { f: [440, 440], type: "sine" },
};
let ctx: AudioContext | null = null;
const wake = () => { try { ctx ??= new AudioContext(); } catch { /* no WebAudio: silent */ } };
for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, wake, { once: true, capture: true });
const gate = chimeGate();

/** Play one chime for `key` if enabled, unmuted, audible, not a repeat and inside the rate limits. */
export function chime(kind: ChimeKind, key: string, force = false) {
  if (F.obs) return; // OBS preset: a capture page never makes sound
  if (!force && (!chimePrefs.on.get() || chimePrefs.mute.get())) return;
  if (!ctx || ctx.state !== "running" || !chimePrefs.volume) return;
  if (!force && !gate(kind, key, Date.now())) return;
  const { f, type } = TONES[kind], t0 = ctx.currentTime, vol = (chimePrefs.volume / 100) * 0.15;
  f.forEach((hz, i) => {
    const o = ctx!.createOscillator(), g = ctx!.createGain(), t = t0 + i * 0.14;
    o.type = type;
    o.frequency.value = hz;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g).connect(ctx!.destination);
    o.start(t);
    o.stop(t + 0.14);
  });
}
/** Settings "Test" button: a click is a gesture, so the context can be created and resumed here. */
export function testChime() {
  wake();
  void ctx?.resume().then(() => chime("waiting", "test", true));
}
