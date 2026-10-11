// Pure helper for the pod plaque caption (scene.ts draws it). No pixi, no DOM.

/** One-line last-prompt caption: whitespace collapsed, clipped with an ellipsis at `max`; blank in privacy mode. */
export function promptCaption(prompt: string | undefined, privacy: boolean, max = 28): string {
  if (privacy || !prompt) return "";
  const t = prompt.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
