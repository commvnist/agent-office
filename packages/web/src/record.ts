// Canvas recording (#96) and share poster (#97). DOM/canvas only; the poster content comes from logic.posterModel.
import { office } from "./api.ts";
import { download } from "./dom.ts";
import { posterModel } from "./logic.ts";
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

export function sharePoster() {
  const env = office.getEnvelope();
  const m = posterModel(env?.state ?? { sessions: {}, agents: {}, queue: [], log: [], nextId: 1, pending: {} }, Date.now());
  const W = 1200, H = 630, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#14121f"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#e8e6f5"; g.font = "bold 56px ui-monospace, Menlo, monospace"; g.textBaseline = "top";
  g.fillText("AGENT OFFICE", 60, 50);
  g.fillStyle = "#8d89ab"; g.font = "26px ui-monospace, Menlo, monospace";
  g.fillText(new Date().toLocaleDateString(), 60, 120);
  const stats: [string, number][] = [["sessions", m.sessions], ["agents", m.agents.length], ["tasks done", m.done], ["minutes", m.minutes]];
  stats.forEach(([k, v], i) => {
    const x = 60 + i * 280;
    g.fillStyle = "#8fb7ff"; g.font = "bold 84px ui-monospace, Menlo, monospace"; g.fillText(String(v), x, 190);
    g.fillStyle = "#8d89ab"; g.font = "24px ui-monospace, Menlo, monospace"; g.fillText(k, x, 290);
  });
  g.font = "22px ui-monospace, Menlo, monospace";
  m.agents.slice(0, 36).forEach((a, i) => {
    const x = 60 + (i % 6) * 185, y = 360 + Math.floor(i / 6) * 40;
    g.fillStyle = roleColor(a.role); g.fillRect(x, y + 4, 16, 16);
    g.fillStyle = "#e8e6f5"; g.fillText(a.name.slice(0, 12), x + 26, y);
  });
  c.toBlob((b) => b && download(b, `agent-office-${Date.now()}.png`), "image/png");
}
