// "Record GIF": only while armed, keep the last 8 s of the stage canvas at 10 fps as small frames, encode on Save.
// The canvas is read after redaction (Private blanks bubble text there); DOM overlays are not part of it.
import { office } from "./api.ts";
import { download } from "./dom.ts";
import { GIF_TAIL, buildPalette, gifFrame, gifHead, indexFrame } from "./gif.ts";

const FPS = 10, KEEP = 8 * FPS, MAX_W = 320, MAX_BYTES = 16 << 20;
// 80 frames x 320x180x4 B is ~18 MB: the byte cap drops the oldest frames beyond 16 MB while armed; released on save or cancel.
export const GIF_NOTE = "GIF shows the office canvas only; toasts, captions and panel text are not included.";
const ring: Uint8ClampedArray[] = [];
let raf = 0, last = 0, W = 0, H = 0, work: CanvasRenderingContext2D | null = null;
export const gifArmed = () => !!raf;

function grab() {
  const src = office.snapshotCanvas();
  if (!src || !src.width || !src.height) return;
  const w = Math.min(MAX_W, src.width), h = Math.max(1, Math.round((src.height * w) / src.width));
  if (!work || w !== W || h !== H) { // a resize starts a new clip: frames must share one size
    ring.length = 0; W = w; H = h;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    work = c.getContext("2d", { willReadFrequently: true });
  }
  if (!work) return;
  work.clearRect(0, 0, w, h);
  work.drawImage(src, 0, 0, w, h); // WebGL: valid in the frame pixi just rendered (this rAF runs after pixi's)
  const px = work.getImageData(0, 0, w, h).data;
  ring.push(px);
  while (ring.length > KEEP || (ring.length > 1 && ring.length * px.length > MAX_BYTES)) ring.shift();
}
export function armGif() {
  if (raf) return;
  const loop = (now: number) => { raf = requestAnimationFrame(loop); if (now - last >= 1000 / FPS - 4) { last = now; grab(); } };
  raf = requestAnimationFrame(loop);
}
export function cancelGif() { cancelAnimationFrame(raf); raf = 0; ring.length = 0; work = null; }

/** Encode what is buffered, one frame per macrotask so the page stays responsive; downloads the file. Returns a status line. */
export async function saveGif(progress: (done: number, total: number) => void = () => {}): Promise<string> {
  const frames = ring.slice(), w = W, h = H;
  cancelGif();
  if (frames.length < 5) return "Nothing buffered yet: arm it, wait a few seconds, then save.";
  const { pal, lut } = buildPalette(frames);
  await new Promise((r) => setTimeout(r));
  const parts: Uint8Array[] = [gifHead(w, h, pal)];
  for (const [i, f] of frames.entries()) {
    parts.push(gifFrame(w, h, indexFrame(f, lut), Math.round(100 / FPS), pal.length / 3));
    progress(i + 1, frames.length);
    await new Promise((r) => setTimeout(r));
  }
  parts.push(GIF_TAIL);
  download(new Blob(parts as BlobPart[], { type: "image/gif" }), `agent-office-${Date.now()}.gif`);
  return `saved ${Math.round(frames.length / FPS)} s GIF. ${GIF_NOTE}`;
}
