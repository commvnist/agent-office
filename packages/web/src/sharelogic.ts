// Pure helpers for sharing and ambient display: fragment permalink, per-agent tool history,
// "most recent agent". No DOM, no pixi (tested under node).
import { leadId, type OfficeState } from "@agent-office/core";

// ---- fragment permalink: #[wall&]sel=..&s=..&k=..&a=..&v=timeline (never leaves the browser) ----
export type Link = { sel: string; s: string; k: string; a: string; v: "" | "wall" | "timeline" };
const VIEWS = ["wall", "timeline"];
export function parseLink(hash: string): Link {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const v = p.get("v") ?? (p.has("wall") ? "wall" : "");
  return {
    sel: p.get("sel") ?? "", s: p.get("s") ?? "", k: p.get("k") ?? "", a: p.get("a") ?? "",
    v: VIEWS.includes(v) ? (v as Link["v"]) : "",
  };
}
/** "" when nothing is set. The wall keeps its bare `wall` token (documented, first). */
export function buildLink(l: Partial<Link>): string {
  const p = new URLSearchParams();
  for (const k of ["sel", "s", "k", "a"] as const) if (l[k]) p.set(k, l[k]!);
  if (l.v === "timeline") p.set("v", "timeline");
  const q = p.toString(), h = [l.v === "wall" ? "wall" : "", q].filter(Boolean).join("&");
  return h ? `#${h}` : "";
}

// ---- per-agent tool history from successive snapshots (the state keeps only the latest call) ----
export type ToolCall = { tool: string; detail: string; at: number; ms?: number; ok: boolean };
type Probe = { doing?: string; detail?: string; busyAt?: number; errors?: number; lastDurationMs?: number };
export function toolTracker(max = 12) {
  const hist = new Map<string, ToolCall[]>(), meta = new Map<string, { err: number; dur?: number }>();
  return {
    feed(id: string, p: Probe) {
      const h = hist.get(id) ?? [], m = meta.get(id) ?? { err: p.errors ?? 0, dur: p.lastDurationMs };
      const last = h[h.length - 1];
      // end-of-call facts belong to the previous call: apply them before a new call is pushed
      if (last && (p.errors ?? 0) > m.err) last.ok = false;
      if (last && p.lastDurationMs !== undefined && p.lastDurationMs !== m.dur) last.ms = p.lastDurationMs;
      if (p.doing && p.busyAt && last?.at !== p.busyAt) { h.push({ tool: p.doing, detail: p.detail ?? "", at: p.busyAt, ok: true }); if (h.length > max) h.shift(); }
      meta.set(id, { err: p.errors ?? 0, dur: p.lastDurationMs });
      hist.set(id, h);
    },
    get: (id: string): readonly ToolCall[] => hist.get(id) ?? [],
  };
}

/** Actor id of whoever did something last (tool call, else seating/start). */
export function mostRecent(s: OfficeState): string | null {
  let best: string | null = null, t = -1;
  const see = (id: string, at: number) => { if (at > t) { t = at; best = id; } };
  for (const a of Object.values(s.agents)) see(a.id, a.busyAt ?? a.seatedAt ?? a.startedAt ?? 0);
  for (const x of Object.values(s.sessions)) see(leadId(x.id), x.busyAt ?? x.lastAt ?? x.startedAt);
  return best;
}

// ---- share on the local network (S5/S6): what GET /share returns on the loopback page ----
export type LanDevice = { id: string; name: string; createdAt: number; lastSeen: number };
export type LanShare = { enabled: boolean; url?: string; fingerprint?: string; until?: number; devices: LanDevice[]; code?: { expiresAt: number } };
/** The certificate fingerprint as the phone's browser shows it: upper-case hex pairs, the first 16. */
export const shortFp = (fp = "") => (fp.replace(/[^0-9a-f]/gi, "").toUpperCase().match(/../g) ?? []).slice(0, 16).join(":");
/** Pairing countdown, rounded up so it reads 0:00 only at expiry. */
export const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
/** Header chip while sharing is on; "" hides it. */
export const lanChip = (s: LanShare | null) => {
  const n = s?.enabled ? s.devices.length : -1;
  return n < 0 ? "" : `shared · ${n} device${n === 1 ? "" : "s"}`;
};
/** Palette commands a paired (view-only) page drops: they change the host or export from it. */
export const hostOnly = (label: string) => /^(Export|Privacy|Setup):|^Open Settings|Present|Kiosk/.test(label);
