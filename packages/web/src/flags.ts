// URL flags for streaming and wall displays. Pure: `F` is read once from location.search.
// ?overlay (or =1), ?preset=obs | obs-1080 | obs-720, ?kiosk, ?streamsafe=0|1 (overrides the default and the Settings choice).
const OBS = /^obs(?:-(1080|720))?$/;
export function parseFlags(search: string) {
  const q = new URLSearchParams(search), m = OBS.exec(q.get("preset") ?? "");
  const on = (k: string) => q.has(k) && q.get(k) !== "0";
  const overlay = !!m || on("overlay");
  const size: [number, number] | null = m?.[1] === "1080" ? [1920, 1080] : m?.[1] === "720" ? [1280, 720] : null;
  const ss = q.get("streamsafe");
  return { obs: !!m, overlay, size, kiosk: on("kiosk"), streamSafe: ss === "1" ? true : ss === "0" ? false : null };
}
export const F = parseFlags(typeof location === "undefined" ? "" : location.search);
