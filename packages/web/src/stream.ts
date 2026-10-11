// Stream-safe: one switch that forces privacy for presenter, wall and kiosk. Names stay, free text is hidden.
import { office } from "./api.ts";
import { store } from "./dom.ts";
import { F } from "./flags.ts";

export const streamSafe = () => F.streamSafe ?? (store.get("streamsafe") === "1");
export const setStreamSafe = (b: boolean) => store.set("streamsafe", b ? "1" : "0");
const wallOpen = () => !!document.querySelector("#wall:not([hidden]),#timeline:not([hidden])");
/** True when free text (prompts, paths, details) must not be shown right now. */
export const hideText = () => office.privacy || office.source.private
  || (streamSafe() && (wallOpen() || document.body.classList.contains("presenter") || document.body.classList.contains("kiosk")));
