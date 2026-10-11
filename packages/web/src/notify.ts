// Opt-in alerts (#88): Notification API (permission asked on a click), tab title + favicon badge, optional beep.
// Always about the LIVE envelope (Z6): ui.ts passes live radar items even during Replay or Sample, so nothing simulated
// alerts and nothing live is hidden. Never while the tab is focused unless configured, once per episode.
import { office } from "./api.ts";
import { store } from "./dom.ts";
import { F } from "./flags.ts";
import { HOT_MS, LONG_TOOL_MS, spendCrossed, spendTokens, sustained, titleFor, type ChimeKind, type RadarItem } from "./logic.ts";
import { chime, chimePrefs } from "./chime.ts";
import { STATUS } from "./theme.ts";
import { look, waitKindOf } from "./triage.ts";

/** A radar item's STATUS key, read from the live state (waiting -> permission or your turn). */
export const kindOf = (i: RadarItem) => i.kind === "waiting" ? waitKindOf((office.source.liveEnvelope() ?? office.getEnvelope())?.state.sessions[i.key.slice(8)]) : i.kind;

const flag = (k: string) => ({ get: () => store.get(k) === "1", set: (b: boolean) => store.set(k, b ? "1" : "0") });
export const prefs = { desktop: flag("alert.desktop"), sound: flag("alert.sound"), focused: flag("alert.focused") };

// #188: per-session snooze/mute, {session: until-ms} in the browser. Permanent mute = MAX_SAFE_INTEGER.
const readMutes = (): Record<string, number> => { try { return JSON.parse(store.get("mutes") ?? "{}"); } catch { return {}; } };
export const mutes = {
  active: (session: string) => (readMutes()[session] ?? 0) > Date.now(),
  set(session: string, until: number) {
    const m = readMutes();
    if (until) m[session] = until; else delete m[session];
    for (const k of Object.keys(m)) if (m[k] <= Date.now()) delete m[k];
    store.set("mutes", JSON.stringify(m));
  },
};
const TIERS = [5, 15]; // minutes of waiting that re-alert (#189)
const ERR_RUN = 3, QUIET_MS = 30_000; // consecutive tool failures (#187); all-idle quiet period (#190)

/** Must run from a click handler. */
export async function enableDesktop(): Promise<string> {
  if (typeof Notification === "undefined") return "unsupported";
  const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  prefs.desktop.set(p === "granted");
  return p;
}

let ctx: AudioContext | null = null;
function beep() {
  if (F.obs) return;
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

const CHIME_OF: Record<string, ChimeKind> = { blocked: "blocked", waiting: "waiting", fin: "finished" };
function fire(key: string, text: string, session?: string) {
  if (fired.has(key)) return;
  fired.add(key);
  if (fired.size > 200) fired.delete(fired.values().next().value!);
  if (session && mutes.active(session)) return;
  const ck = CHIME_OF[key.split(":")[0]];
  if (ck) chime(ck, key); // an explicit opt-in: sounds even while the tab is focused
  if (document.hasFocus() && !prefs.focused.get()) return;
  if (prefs.desktop.get() && typeof Notification !== "undefined" && Notification.permission === "granted") {
    try { new Notification("Agent Office", { body: priv() ? "A session needs you" : text, tag: key }); } catch { /* some browsers require a service worker */ }
  }
  if (prefs.sound.get() && !chimePrefs.on.get()) beep();
}

const base = document.title;
let icon: HTMLLinkElement | null = null, idle = "";
let drawn = "";
const canvas32 = () => { const c = document.createElement("canvas"); c.width = c.height = 32; return c; };
/** The app's own icon (no external file): dark tile with the wordmark's cyan tick. Used whenever nothing needs you. */
function idleIcon() {
  if (idle) return idle;
  const c = canvas32(), g = c.getContext("2d")!;
  g.fillStyle = "#14121f"; g.beginPath(); g.roundRect(1, 1, 30, 30, 6); g.fill();
  g.fillStyle = "#4de8ff"; g.fillRect(12, 7, 5, 18);
  g.fillStyle = "#e8e6f5"; g.fillRect(19, 14, 7, 4);
  return (idle = c.toDataURL());
}
/** A dot in the loudest item's STATUS colour with the count. Redrawn only when the count or colour changes. Count 0 always restores the app icon. */
function favicon(n: number, col: string = STATUS.permission.color) {
  icon ??= document.querySelector<HTMLLinkElement>("link[rel~=icon]") ?? Object.assign(document.head.appendChild(document.createElement("link")), { rel: "icon" });
  if (!n) { drawn = ""; const own = idleIcon(); if (icon.href !== own) icon.href = own; return; }
  const key = `${Math.min(n, 9)}${col}`;
  if (key === drawn) return;
  drawn = key;
  const c = canvas32(), g = c.getContext("2d")!;
  g.fillStyle = col;
  g.beginPath(); g.arc(16, 16, 15, 0, 7); g.fill();
  g.fillStyle = "#14121f"; g.font = "bold 20px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(String(Math.min(n, 9)), 16, 17);
  icon.href = c.toDataURL();
}

const hotFor = new Map<string, { since: number; fired: boolean }>();
const longFired = new Set<string>();
const errRun = new Map<string, { seen: number; run: number; fired: boolean }>();
const busy = new Set<string>();
const spendWas = new Map<string, boolean>();
/** Browser-local override first (Settings), then the daemon's office.json value; 0 = off. */
export const spendLimit = () => Number(store.get("spend")) || (office.getEnvelope()?.config as { spendAlarmTokens?: number } | undefined)?.spendAlarmTokens || 0;
/** Failure runs (#187) and "session finished" (#190) from the live state; call after the radar pass. */
function watchState(now: number, hot: { id: string; project: string }[]) {
  const e = office.getEnvelope();
  // shortcut: these secondary alerts read the displayed actors, so they pause during Replay/Sample; live NEEDS YOU alerts do not
  if (!e || office.source.mode !== "live") return;
  const rows = [
    ...Object.values(e.state.sessions).map((x) => ({ k: x.id, session: x.id, who: x.project, n: x.errors ?? 0, last: x.lastError })),
    ...Object.values(e.state.agents).map((x) => ({ k: x.id, session: x.session, who: x.seat?.name ?? x.role, n: x.errors ?? 0, last: x.lastError })),
  ];
  for (const r of rows) {
    const p = errRun.get(r.k) ?? { seen: r.n, run: 0, fired: false }; // first sighting is the baseline
    if (!r.last) { p.run = 0; p.fired = false; } else if (r.n > p.seen) p.run += r.n - p.seen;
    p.seen = r.n;
    errRun.set(r.k, p);
    if (p.run >= ERR_RUN && !p.fired) { p.fired = true; fire(`err:${r.k}:${r.n}`, `${r.who} had ${p.run} failed tool calls in a row`, r.session); }
  }
  // #1 burn rate hot for HOT_MS; once per episode (own gate: the radar episode cleanup in update() would re-arm `fired` keys)
  const hotIds = new Set(hot.map((h) => h.id));
  for (const k of hotFor.keys()) if (!hotIds.has(k)) hotFor.delete(k);
  for (const h of hot) if (sustained(hotFor, h.id, true, now, HOT_MS)) fire(`burn:${h.id}:${now}`, `${h.project} is burning tokens fast`, h.id);
  // #2 one tool call in flight (doing + busyAt = its start) past LONG_TOOL_MS, unless the session waits on you anyway
  const inflight = [
    ...Object.values(e.state.sessions).map((x) => ({ k: x.id, session: x.id, who: x.project, doing: x.doing, at: x.busyAt })),
    ...Object.values(e.state.agents).map((x) => ({ k: x.id, session: x.session, who: x.seat?.name ?? x.role, doing: x.doing, at: x.busyAt })),
  ].filter((r) => r.doing && r.at && !e.state.sessions[r.session]?.waiting);
  const live = new Set(inflight.map((r) => `${r.k}:${r.at}`));
  for (const k of longFired) if (!live.has(k)) longFired.delete(k);
  for (const r of inflight) {
    const k = `${r.k}:${r.at}`;
    if (now - r.at! < LONG_TOOL_MS || longFired.has(k)) continue;
    longFired.add(k);
    fire(`long:${k}`, `${r.who} has been running ${r.doing} for ${Math.round((now - r.at!) / 60_000)} min`, r.session);
  }
  const limit = spendLimit();
  for (const x of Object.values(e.state.sessions)) {
    if (spendCrossed(spendWas, x.id, spendTokens(x.usage), limit)) fire(`spend:${x.id}`, `${x.project} passed ${limit.toLocaleString()} tokens (non-cached input + output)`, x.id);
  }
  const acts = office.actors();
  for (const s of office.sessions()) {
    if (acts.some((a) => a.session === s.id && a.status !== "idle")) { busy.add(s.id); continue; }
    const last = e.state.sessions[s.id]?.lastAt ?? s.startedAt;
    if (busy.has(s.id) && now - last >= QUIET_MS) { busy.delete(s.id); fire(`fin:${s.id}:${last}`, `${s.project} finished`, s.id); }
  }
}

/** Called with the LIVE radar every refresh (sorted loudest first by ui.ts). */
export function update(items: RadarItem[], hot: { id: string; project: string }[] = []) {
  const now = Date.now();
  const long = items.some((i) => i.kind !== "stuck" && now - i.since >= TIERS[1] * 60_000);
  document.title = (office.connection.state === "retrying" ? "(offline) " : "") + (long ? "! " : "") + titleFor(items, base);
  favicon(items.length, items[0] && look(kindOf(items[0])).color);
  const keys = new Set(items.map((i) => i.key));
  for (const k of fired) if (k.includes(":") && !keys.has(k.split("@")[0])) fired.delete(k); // episode over: may alert again
  const tiers = (i: RadarItem) => TIERS.filter((m) => now - i.since >= m * 60_000);
  if (!primed) { primed = true; for (const i of items) { fired.add(i.key); for (const m of tiers(i)) fired.add(`${i.key}@${m}`); } return; } // what was already waiting at load is not news
  const sess = (i: RadarItem) => (i.kind === "blocked" ? office.actors().find((a) => a.id === i.id)?.session : i.id.slice(5)); // lead:<session>
  for (const i of items) {
    if (i.kind === "stuck") continue;
    const word = look(kindOf(i)).label;
    fire(i.key, `${i.label}: ${word}`, sess(i));
    for (const m of tiers(i)) fire(`${i.key}@${m}`, `${i.label}: still ${word} after ${m} min`, sess(i));
  }
  watchState(now, hot);
}
