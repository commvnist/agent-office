// Share on the local network (S6). Loopback page: the Settings section and the "shared · N devices" header chip, both
// fed by the S5 routes (GET/POST /share, POST /share/code, DELETE /share/devices[/id]). Paired phone (envelope.remote):
// body.remote hides every control that changes the host (CSS in index.html) and the chip says "viewing <host>".
import { office } from "./api.ts";
import { $, btn, copy, el } from "./dom.ts";
import { fmtAge } from "./logic.ts";
import { lanChip, mmss, shortFp, type LanShare } from "./sharelogic.ts";

/** True on a page served to a paired device: no Settings, no host controls. */
export const isRemote = () => !!office.source.liveEnvelope()?.remote;

let info: LanShare | null = null, avail = true, msg = "", pairing: { code: string; expiresAt: number } | null = null, loadedAt = 0;
const paints = new Set<() => void>();
const paint = () => paints.forEach((f) => f());

async function load() {
  loadedAt = Date.now();
  try {
    const r = await fetch("/share", { credentials: "same-origin" });
    avail = r.ok;
    info = r.ok ? await r.json() : null;
  } catch { avail = false; info = null; }
  if (pairing && (!info?.code || pairing.expiresAt <= Date.now())) pairing = null; // used (a phone paired) or expired
  paint();
}
async function send(method: "POST" | "DELETE", path: string, body?: unknown): Promise<unknown> {
  msg = "";
  let out: unknown = null;
  try {
    const r = await fetch(path, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (r.ok) out = await r.json().catch(() => ({}));
    else msg = `The daemon refused (${r.status}).`;
  } catch { msg = "Cannot reach the daemon."; }
  await load();
  return out;
}

/** Settings > Share on network. Fills `box` once; returns the open hook (reloads the state). */
export function shareSection(box: HTMLElement, row: (label: string, c: HTMLElement, hint?: string) => HTMLElement): () => void {
  box.append(el("p", "k", "Lets phones on this network watch the office, read-only: no host settings, no controls. Hooks and the token stay on this machine. Off by default; stops by itself."),
    el("p", "k", "A phone can sound or vibrate when something needs you, but only while its page is open: there is no push service, nothing leaves this network."));
  const on = el("input");
  on.type = "checkbox";
  on.addEventListener("change", () => { on.disabled = true; void send("POST", "/share", { on: on.checked }).finally(() => { on.disabled = false; }); });
  row("Share on network", on, "A second, HTTPS-only listener on this machine's private network address");
  const note = el("p", "k"), facts = el("div", "lanf"), pair = el("div", "lanpair"), devs = el("div", "mutes devs");
  const pairBtn = btn("Pair a phone", "Shows a 6-digit code for 2 minutes; type it on the phone at the address above", async () => {
    const r = (await send("POST", "/share/code")) as { code?: string; expiresAt?: number } | null;
    if (r?.code && r.expiresAt) { pairing = { code: String(r.code), expiresAt: r.expiresAt }; paint(); }
  });
  box.append(note, facts, pairBtn, pair, devs);
  const kv = (k: string, v: Node | string) => { const d = el("div", "kv"); d.append(el("span", "k", k), typeof v === "string" ? el("span", "", v) : v); return d; };
  const draw = () => {
    if (!box.isConnected || box.closest("[hidden]")) return;
    const s = info, live = !!s?.enabled;
    on.checked = live;
    on.disabled = !avail;
    note.textContent = msg || (!avail ? "This daemon does not offer sharing (update it, then reopen Settings)." : "");
    note.hidden = !note.textContent;
    const sig = JSON.stringify([live, s?.url, s?.fingerprint, s?.until]);
    if (facts.dataset.sig !== sig) {
      facts.dataset.sig = sig;
      const url = el("span", "cwd");
      if (s?.url) url.append(el("span", "", s.url), btn("Copy", "Copy the address", async (b) => { b.textContent = (await copy(s.url!)) ? "Copied" : "Copy failed"; }, "b sm"));
      facts.replaceChildren(...(live ? [
        kv("Address", url),
        kv("Certificate", el("span", "fp", shortFp(s?.fingerprint))),
        ...(s?.until ? [kv("Stops at", new Date(s.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))] : []),
        el("p", "k", "The phone warns about the certificate once: check that it shows this fingerprint, then accept."),
        el("p", "k", "Phones see what this page shows. The Private toggle only hides text on this page; turn on privacy in office.json to hide it everywhere."),
      ] : []));
    }
    pairBtn.hidden = !live || !!pairing;
    const left = pairing ? pairing.expiresAt - Date.now() : 0;
    pair.hidden = !live || !pairing || left <= 0;
    if (!pair.hidden && pairing) {
      const code = el("div", "pcode", pairing.code.replace(/(\d{3})(\d{3})/, "$1 $2"));
      code.setAttribute("aria-label", `Pairing code ${pairing.code.split("").join(" ")}`);
      const k = el("p", "k", `On the phone open the address above and type this code. Expires in ${mmss(left)}; single use.`);
      // X10: the address large beside the code: both are typed on the phone
      if (pair.firstElementChild?.nextElementSibling?.textContent !== code.textContent) pair.replaceChildren(el("div", "purl", `${s?.url ?? ""}/pair`), code, k);
      else pair.lastElementChild!.textContent = k.textContent; // tick only the countdown: the code keeps its node
    }
    const ds = live ? s!.devices : [];
    const dsig = JSON.stringify(ds.map((d) => [d.id, d.name, fmtAge(Date.now() - d.lastSeen)]));
    if (devs.dataset.sig !== dsig) {
      devs.dataset.sig = dsig;
      devs.replaceChildren(...(live ? [el("p", "k", ds.length ? `Paired devices (${ds.length})` : "No paired devices yet.")] : []), ...ds.map((d) => {
        // X8: the name the phone gave (or its browser) and when it paired: two phones of one model can be told apart
        const r = el("div", "srow"), name = el("span", "", `${d.name} · paired ${new Date(d.createdAt).toLocaleDateString([], { day: "numeric", month: "short" })}`);
        name.title = `${d.name}, paired ${new Date(d.createdAt).toLocaleString()}`;
        const ctl = el("span", "sctl");
        const rv = btn("Revoke", "Unpair this device now: its open views close at once", () => void send("DELETE", `/share/devices/${encodeURIComponent(d.id)}`), "b sm");
        rv.setAttribute("aria-label", `Revoke ${d.name}`);
        ctl.append(el("span", "k", `seen ${fmtAge(Date.now() - d.lastSeen)}`), rv);
        r.append(name, ctl);
        return r;
      }), ...(ds.length > 1 ? [btn("Revoke all", "Unpair every device now", () => void send("DELETE", "/share/devices"), "b sm")] : []));
    }
  };
  paints.add(draw);
  return () => { void load(); };
}

/** Header chip and body.remote; polls GET /share on the loopback page only (the LAN listener has no /share). */
export function bindLan() {
  const chip = $("sharechip");
  let started = false;
  office.source.onLive((e) => {
    document.body.classList.toggle("remote", !!e.remote);
    if (e.remote) {
      const t = `viewing ${location.hostname}`;
      if (chip.textContent !== t) { chip.textContent = t; chip.title = "A read-only view of another computer's office, over the local network. Click for this device's settings."; }
      chip.hidden = false;
    } else if (!started) {
      started = true;
      void load();
      // shortcut: polls (10 s, 2 s while a code is shown) instead of a share event on /stream; upgrade if the envelope carries share state
      setInterval(() => {
        const due = Date.now() - loadedAt >= (pairing ? 2000 : 10_000);
        if (!document.hidden && due) void load(); else paint(); // paint ticks the countdown every second
      }, 1000);
    }
  });
  paints.add(() => {
    if (isRemote()) return;
    const t = lanChip(info);
    chip.hidden = !t;
    if (chip.textContent !== t) { chip.textContent = t; chip.title = "Phones on this network can watch this office, read-only. Click for Settings > Share on network."; }
  });
}
