// Canvas recording (#96) and share poster (#97). DOM/canvas only; the poster content comes from logic.posterModel.
import { office } from "./api.ts";
import { download } from "./dom.ts";
import { coverFit, posterModel, usageTotal, whoLine } from "./logic.ts";
import { roleColor } from "./theme.ts";

let rec: MediaRecorder | null = null;
export const recording = () => !!rec;

/** Start/stop. Returns a status line for the UI. */
export function toggleRecording(): string {
  if (rec) { rec.stop(); return "saving…"; }
  const c = office.snapshotCanvas();
  if (!c || typeof MediaRecorder === "undefined" || !c.captureStream) return "Recording is not supported in this browser.";
  const chunks: Blob[] = [];
  rec = new MediaRecorder(c.captureStream(30), { mimeType: MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "" });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    rec = null;
    download(new Blob(chunks, { type: "video/webm" }), `agent-office-${Date.now()}.webm`);
    document.dispatchEvent(new CustomEvent("ao-rec-stop"));
  };
  rec.start(1000);
  return "recording…";
}

export async function sharePoster() {
  const env = office.getEnvelope();
  const m = posterModel(env?.state ?? { sessions: {}, agents: {}, queue: [], log: [], nextId: 1, pending: {} }, Date.now());
  const W = 1200, H = 630, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  // a WebGL canvas is only readable in the frame it was drawn: wait for the ticker's rAF, then read in the same task
  await new Promise((r) => requestAnimationFrame(r));
  const SHOT_W = 720; // left 60%: the live canvas, cover-fit; the stats move to the right
  const shot = office.snapshotCanvas();
  let hasShot = false;
  if (shot && shot.width && shot.height) {
    try {
      const f = coverFit(shot.width, shot.height, SHOT_W, H);
      g.save(); g.beginPath(); g.rect(0, 0, SHOT_W, H); g.clip();
      g.drawImage(shot, f.x, f.y, shot.width * f.s, shot.height * f.s);
      g.restore();
      // still black (nothing rendered this frame): keep the plain design
      const px = g.getImageData(0, 0, SHOT_W, H).data;
      for (let i = 0; i < px.length && !hasShot; i += 4 * 97) hasShot = px[i] + px[i + 1] + px[i + 2] > 0;
      if (!hasShot) g.clearRect(0, 0, SHOT_W, H);
    } catch { /* tainted or unavailable canvas: plain design */ }
  }
  g.globalCompositeOperation = "destination-over";
  g.fillStyle = "#14121f"; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "source-over";
  const x0 = hasShot ? SHOT_W + 40 : 60, cols = hasShot ? 2 : 6, colW = hasShot ? 210 : 185, big = hasShot ? 40 : 56, small = hasShot ? 20 : 24;
  const mono = (px: number, bold = false) => `${bold ? "bold " : ""}${px}px ui-monospace, Menlo, monospace`;
  g.fillStyle = "#e8e6f5"; g.font = mono(hasShot ? 36 : 56, true); g.textBaseline = "top";
  g.fillText("AGENT OFFICE", x0, 50);
  g.fillStyle = "#8d89ab"; g.font = mono(hasShot ? 20 : 26);
  g.fillText(new Date().toLocaleDateString(), x0, hasShot ? 100 : 120);
  // same total as the radar and session rows (usageTotal counts cache writes); posterModel.tokens leaves them out
  const tokens = Object.values(env?.state.sessions ?? {}).reduce((n, s) => n + usageTotal(s.usage), 0);
  const tok = tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 100_000 ? 0 : 1)}k` : String(tokens);
  const stats: [string, string | number][] = [["sessions", m.sessions], ["agents", m.agents.length], ["done", m.done], ["blocked", m.blocked], ["errors", m.errors], ["tokens", tok]];
  const y0 = hasShot ? 150 : 190, rowH = hasShot ? 90 : 0;
  stats.forEach(([k, v], i) => {
    const x = x0 + (i % cols) * colW, y = y0 + Math.floor(i / cols) * rowH;
    g.fillStyle = k === "blocked" && m.blocked ? "#ff8a80" : "#8fb7ff"; g.font = mono(big, true); g.fillText(String(v), x, y);
    g.fillStyle = "#8d89ab"; g.font = mono(small); g.fillText(k, x, y + big + 8);
  });
  g.fillStyle = "#8d89ab"; g.font = mono(small);
  const ym = hasShot ? y0 + 3 * rowH : 305;
  g.fillText(`${m.minutes} min${m.longest && !hasShot ? ` · longest: ${m.longest.name.slice(0, 16)} ${m.longest.minutes} min` : ""}`, x0, ym);
  if (hasShot) {
    // names only (no prompt or report text): the latest finished line is "<agent> finished"
    const done = office.feed.find((f) => f.kind === "done" || (f.kind === "report" && f.outcome === "done"));
    if (done) { g.fillStyle = "#5be37d"; g.fillText(whoLine(done).slice(0, 36), x0, H - 60); }
  } else {
    g.font = mono(22);
    m.agents.slice(0, 36).forEach((a, i) => {
      const x = 60 + (i % 6) * 185, y = 370 + Math.floor(i / 6) * 40;
      g.fillStyle = roleColor(a.role); g.fillRect(x, y + 4, 16, 16);
      g.fillStyle = "#e8e6f5"; g.fillText(a.name.slice(0, 12), x + 26, y);
    });
  }
  c.toBlob((b) => b && download(b, `agent-office-${Date.now()}.png`), "image/png");
}
