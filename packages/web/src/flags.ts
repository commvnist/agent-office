// URL flags for wall displays. Pure: `F` is read once from location.search.
// ?kiosk, ?streamsafe=0|1 (overrides the default and the Settings choice).
export function parseFlags(search: string) {
  const q = new URLSearchParams(search);
  const on = (k: string) => q.has(k) && q.get(k) !== "0";
  const ss = q.get("streamsafe");
  return { kiosk: on("kiosk"), streamSafe: ss === "1" ? true : ss === "0" ? false : null };
}
export const F = parseFlags(typeof location === "undefined" ? "" : location.search);
