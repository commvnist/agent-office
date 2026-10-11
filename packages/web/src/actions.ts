// Direct handlers for toolbar buttons, hotkeys and palette commands (no clicking buttons by their label).
import { office } from "./api.ts";
import { camera } from "./camera.ts";
import { announce, copy } from "./dom.ts";
import { setFollow, settings } from "./settings.ts";
import { buildLink, mostRecent, parseLink } from "./sharelogic.ts";

export const following = () => settings.follow === "busiest";
/** Follow cycles off <-> busiest (the busiest agent is chosen by the scene). */
export function cycleFollow() {
  const on = !following();
  setFollow(on ? "busiest" : "off");
  if (!on) camera.setFollow(null); // turning follow off releases the camera too
  announce(on ? "Following the busiest agent" : "Follow off");
  document.dispatchEvent(new CustomEvent("ao:follow"));
}
/** Select and focus whoever did something last. */
export function jumpLatest() {
  const st = office.getEnvelope()?.state, id = st && mostRecent(st);
  if (!id || !office.actors().some((a) => a.id === id)) { announce("No agents on the floor"); return; }
  office.select(id); office.focus(id); office.pulse(id);
}
/** URL with the current selection, scope, filters, view (kept in the hash by ui.ts). Never sent anywhere. */
export async function copyLink(): Promise<string> {
  const url = location.origin + location.pathname + location.search + buildLink(parseLink(location.hash));
  const ok = await copy(url);
  announce(ok ? "Link copied" : "Could not copy the link");
  return ok ? "link copied" : "copy failed: select the address bar instead";
}
