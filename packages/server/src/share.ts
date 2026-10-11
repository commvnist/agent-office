// Share on the local network: an opt-in, read-only HTTPS viewer on a private address, for devices paired with a
// short-lived 6-digit code shown on the host. Hooks and control never reach this listener (see LAN_ROUTES).
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { BlockList, isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { createHash, generateKeyPairSync, randomBytes, randomInt, sign, timingSafeEqual, X509Certificate } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendRotating } from "./store.ts";

export type ShareSettings = { enabled?: boolean; port?: number; address?: string; stopAfterHours?: number };
export type Device = { id: string; name: string; tokenHash: string; createdAt: number; lastSeen: number };

const PRIVATE = new BlockList();
for (const [a, p] of [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["169.254.0.0", 16]] as const) PRIVATE.addSubnet(a, p, "ipv4");
for (const [a, p] of [["fd00::", 8], ["fe80::", 10]] as const) PRIVATE.addSubnet(a, p, "ipv6");
/** 10/8, 172.16/12, 192.168/16, 169.254/16, fd00::/8, fe80::/10. Anything else (public, loopback, 0.0.0.0, names) is refused. */
export const isPrivate = (ip: string) => { const v = isIP(ip); return v !== 0 && PRIVATE.check(ip, v === 4 ? "ipv4" : "ipv6"); };
/** The first non-internal private IPv4 of this machine. */
export const lanAddress = () => Object.values(networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal && isPrivate(a.address))?.address;

// ---- a minimal DER encoder: just enough X.509 v3 for a self-signed EC P-256 certificate ----
const len = (n: number) => { if (n < 128) return Buffer.from([n]); const b: number[] = []; for (; n; n = Math.floor(n / 256)) b.unshift(n & 255); return Buffer.from([0x80 | b.length, ...b]); };
const tlv = (tag: number, ...parts: Buffer[]) => { const v = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(v.length), v]); };
const seq = (...p: Buffer[]) => tlv(0x30, ...p);
const oid = (s: string) => {
  const [a, b, ...rest] = s.split(".").map(Number), out = [40 * a + b];
  for (const n of rest) { const x = [n & 127]; for (let m = n >> 7; m; m >>= 7) x.unshift(0x80 | (m & 127)); out.push(...x); }
  return tlv(6, Buffer.from(out));
};
const utc = (d: Date) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z")); // UTCTime, fine until 2050
const ipBytes = (ip: string) => {
  if (isIP(ip) === 4) return Buffer.from(ip.split(".").map(Number));
  const [h, t] = ip.split("::"), part = (s?: string) => (s ? s.split(":") : []);
  const head = part(h), tail = part(t), groups = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  return Buffer.from(groups.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 255]; }));
};

/** A self-signed certificate for `ip` (SAN iPAddress), EC P-256, ecdsa-with-SHA256, valid 2 years. node:crypto only. */
export function makeCert(ip: string, now = Date.now()) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const alg = seq(oid("1.2.840.10045.4.3.2"));
  const name = seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, Buffer.from("Agent Office")))));
  const serial = randomBytes(16); serial[0] = (serial[0] & 0x7f) | 0x40; // positive, minimal
  const ext = (id: string, v: Buffer) => seq(oid(id), tlv(4, v));
  const tbs = seq(
    tlv(0xa0, tlv(2, Buffer.from([2]))), // v3
    tlv(2, serial), alg, name,
    seq(utc(new Date(now - 3600_000)), utc(new Date(now + 2 * 365 * 86_400_000))),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    tlv(0xa3, seq(
      ext("2.5.29.17", seq(tlv(0x87, ipBytes(ip)))), // subjectAltName: iPAddress
      ext("2.5.29.37", seq(oid("1.3.6.1.5.5.7.3.1"))), // extKeyUsage: serverAuth (iOS requires it)
      ext("2.5.29.19", seq()), // basicConstraints: not a CA
    )),
  );
  const der = seq(tbs, alg, tlv(3, Buffer.from([0]), sign("sha256", tbs, privateKey)));
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
  return { key: privateKey.export({ type: "pkcs8", format: "pem" }) as string, cert };
}

/** tls/key.pem + tls/cert.pem (dir 0700, files 0600), reused while the SAN matches `ip` and it has a day left; else regenerated. */
export function loadCert(dir: string, ip: string) {
  const d = join(dir, "tls"), kf = join(d, "key.pem"), cf = join(d, "cert.pem");
  try {
    const cert = readFileSync(cf, "utf8"), x = new X509Certificate(cert);
    if (x.checkIP(ip) && Date.parse(x.validTo) > Date.now() + 86_400_000) return { key: readFileSync(kf, "utf8"), cert, fingerprint: x.fingerprint256 };
  } catch { /* missing or unreadable: make a new one */ }
  mkdirSync(d, { recursive: true, mode: 0o700 });
  const c = makeCert(ip);
  for (const [f, v] of [[kf, c.key], [cf, c.cert]]) { writeFileSync(f, v, { mode: 0o600 }); try { chmodSync(f, 0o600); } catch { /* non-POSIX */ } }
  return { ...c, fingerprint: new X509Certificate(c.cert).fingerprint256 };
}

/** The only routes the LAN listener has, plus GET of a web-build file (device cookie). No /event, /shutdown, /share*, /status, /outcomes, /health. */
export const LAN_ROUTES = ["GET /pair", "POST /pair", "GET /state", "GET /stream", "GET /history"] as const;
const READS = new Set(["/state", "/stream", "/history"]);
const HEADERS: Record<string, string> = {
  // 'unsafe-eval': PixiJS compiles shaders with new Function; 'unsafe-inline' styles: the page's <style> and style attributes. No inline scripts.
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
  // same-origin, not no-referrer: no-referrer makes browsers send "Origin: null" on the pairing form, which the origin check rejects
  "x-frame-options": "DENY", "referrer-policy": "same-origin", "x-content-type-options": "nosniff", "cache-control": "no-store",
};
const CODE_MS = 120_000, LOCK_MS = 60_000, MAX_WRONG = 5, DEVICE_MS = 30 * 86_400_000, PER_DEVICE = 2, MAX_LAN = 10;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** A short device name from the User-Agent: the platform part, printable ASCII only, clipped. */
export const deviceName = (ua = "") => ((/\(([^)]*)\)/.exec(ua)?.[1] ?? ua).replace(/[^\w .,;:/-]/g, "").trim().slice(0, 40) || "device");

const page = (msg = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair with Agent Office</title>
<style>body{font:16px system-ui,sans-serif;background:#111;color:#eee;max-width:22rem;margin:3rem auto;padding:0 16px}input,button{font:inherit;font-size:1.5rem;padding:.4rem;width:100%;box-sizing:border-box;margin-top:.6rem}input{letter-spacing:.3em;text-align:center}p.m{color:#f99}</style></head>
<body><h1>Agent Office</h1><p>Enter the 6-digit code shown on the host (Settings, Share on network, Pair a phone).</p>${msg ? `<p class="m">${esc(msg)}</p>` : ""}
<form method="post" action="/pair"><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required autofocus aria-label="Pairing code"><button>Pair</button></form></body></html>`;

export type ShareDeps = {
  dir: string;
  settings: () => ShareSettings;
  /** Serve GET /state, /stream or /history for a remote viewer (same handlers as loopback, envelope `remote: true`). */
  read: (path: string, req: IncomingMessage, res: ServerResponse, u: URL) => void;
  /** Serve a web-build file; false when there is none. */
  serve: (url: string, res: ServerResponse) => boolean;
  log: (...a: unknown[]) => void;
  now?: () => number;
  /** Tests only (in-process): listen here instead of the shared address; Host and the certificate still use the address. */
  bindHost?: string;
};

export function createShare(o: ShareDeps) {
  const now = o.now ?? Date.now;
  const DEVICES = join(o.dir, "devices.json"), LOG = join(o.dir, "share.log");
  const audit = (what: string) => { try { appendRotating(LOG, `${new Date(now()).toISOString()} ${what}`); } catch (e) { o.log("share.log:", (e as Error).message); } };
  let devices: Device[] = [];
  try { const d = JSON.parse(readFileSync(DEVICES, "utf8")); if (Array.isArray(d)) devices = d.filter((x) => x && typeof x.id === "string" && typeof x.tokenHash === "string" && /^[0-9a-f]{64}$/.test(x.tokenHash)); } catch { /* none yet */ }
  const save = () => { writeFileSync(DEVICES, JSON.stringify(devices), { mode: 0o600 }); try { chmodSync(DEVICES, 0o600); } catch { /* non-POSIX */ } };
  const expire = () => { const n = devices.length; devices = devices.filter((d) => now() - d.lastSeen < DEVICE_MS); if (devices.length !== n) save(); };

  let code: { value: string; expiresAt: number } | undefined, wrong = 0, lockedUntil = 0;
  let server: Server | undefined, host = "", url = "", fingerprint = "", until = 0, timer: NodeJS.Timeout | undefined;
  const streams = new Map<string, Set<ServerResponse>>();
  const total = () => [...streams.values()].reduce((n, s) => n + s.size, 0);
  const drop = (id: string) => { for (const r of streams.get(id) ?? []) r.destroy(); streams.delete(id); };

  /** The paired device a request's `ao_dev` cookie names, or undefined. Hashes compared with timingSafeEqual. */
  function deviceOf(req: IncomingMessage): Device | undefined {
    const tok = /(?:^|;\s*)ao_dev=([\w-]{43})(?:;|$)/.exec(req.headers.cookie ?? "")?.[1];
    if (!tok) return undefined;
    expire();
    const h = Buffer.from(sha(tok));
    const d = devices.find((x) => timingSafeEqual(Buffer.from(x.tokenHash), h));
    if (d && now() - d.lastSeen > 60_000) { d.lastSeen = now(); save(); } // lastSeen to the minute: not a write per request
    return d;
  }

  /** One attempt at the active code: any source counts towards the lockout. */
  function check(input: unknown): "ok" | "wrong" | "locked" {
    const t = now();
    if (t < lockedUntil) return "locked";
    const a = Buffer.from(typeof input === "string" ? input : ""), b = Buffer.from(code && t < code.expiresAt ? code.value : "");
    if (b.length && a.length === b.length && timingSafeEqual(a, b)) { code = undefined; wrong = 0; return "ok"; }
    if (++wrong >= MAX_WRONG) { code = undefined; wrong = 0; lockedUntil = t + LOCK_MS; audit("pairing locked (5 wrong codes)"); }
    return "wrong";
  }

  function pair(req: IncomingMessage, res: ServerResponse) {
    if (req.headers.origin !== undefined && req.headers.origin !== `https://${host}`) return void res.writeHead(403).end();
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (d: string) => { body += d; if (body.length > 1024 && !res.headersSent) { res.writeHead(413, { connection: "close" }).end(); req.destroy(); } });
    req.on("end", () => {
      if (res.headersSent) return;
      const from = req.socket.remoteAddress ?? "?";
      const r = check(new URLSearchParams(body).get("code"));
      if (r !== "ok") {
        audit(`pair failed from ${from}${r === "locked" ? " (locked)" : ""}`);
        return void res.writeHead(r === "locked" ? 429 : 401, { "content-type": "text/html; charset=utf-8" })
          .end(page(r === "locked" ? "Too many wrong codes. Ask the host for a new code in a minute." : "Wrong or expired code."));
      }
      const token = randomBytes(32).toString("base64url"), t = now();
      const d: Device = { id: randomBytes(4).toString("hex"), name: deviceName(req.headers["user-agent"]), tokenHash: sha(token), createdAt: t, lastSeen: t };
      devices.push(d); save();
      audit(`paired ${d.id} "${d.name}" from ${from}`);
      res.writeHead(303, { location: "/", "set-cookie": cookie(token) }).end();
    });
  }
  const cookie = (token: string) => `ao_dev=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${DEVICE_MS / 1000}`;

  function lan(req: IncomingMessage, res: ServerResponse) {
    for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
    if ((req.headers.host ?? "").toLowerCase() !== host) return void res.writeHead(403).end();
    let u: URL;
    try { u = new URL(req.url ?? "/", "https://x"); } catch { return void res.writeHead(400).end(); }
    const route = `${req.method} ${u.pathname}`;
    if (route === "GET /pair") return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page());
    if (route === "POST /pair") return pair(req, res);
    if (req.method !== "GET") return void res.writeHead(404).end();
    const d = deviceOf(req);
    if (!d) return void (u.pathname === "/" ? res.writeHead(302, { location: "/pair" }).end() : res.writeHead(401).end());
    if (READS.has(u.pathname)) {
      if (u.pathname === "/stream") {
        const mine = streams.get(d.id) ?? new Set();
        if (mine.size >= PER_DEVICE || total() >= MAX_LAN) return void res.writeHead(503).end();
        streams.set(d.id, mine.add(res));
        res.on("close", () => { mine.delete(res); if (!mine.size && streams.get(d.id) === mine) streams.delete(d.id); });
      }
      return o.read(u.pathname, req, res, u);
    }
    if (u.pathname === "/" || u.pathname === "/index.html") res.setHeader("set-cookie", cookie(/(?:^|;\s*)ao_dev=([\w-]{43})(?:;|$)/.exec(req.headers.cookie!)![1])); // slide the 30 days (same anchored parse as deviceOf: "xao_dev=" must not count)
    if (!o.serve(req.url ?? "/", res)) res.writeHead(404).end();
  }

  function status() {
    expire();
    return {
      enabled: !!server, url: server ? url : undefined, fingerprint: server ? fingerprint : undefined, until: server ? until : undefined,
      devices: devices.map(({ id, name, createdAt, lastSeen }) => ({ id, name, createdAt, lastSeen })),
      code: code && now() < code.expiresAt ? { expiresAt: code.expiresAt } : undefined,
    };
  }

  /** Start the LAN listener; resolves to an error message when it is refused or fails. */
  async function start(): Promise<string | undefined> {
    if (server) return undefined;
    const s = o.settings(), address = s.address ?? lanAddress();
    if (!address) return "no private network address found; set share.address in office.json";
    if (!isPrivate(address)) return `refusing to share on ${address}: not a private address (10/8, 172.16/12, 192.168/16, 169.254/16, fd00::/8, fe80::/10)`;
    const c = loadCert(o.dir, address);
    const srv = createServer({ key: c.key, cert: c.cert, headersTimeout: 10_000, requestTimeout: 10_000 }, (req, res) => { // slow clients cannot hold connections
      try { lan(req, res); } catch (e) { o.log("lan request error:", e); if (!res.headersSent) res.writeHead(500).end(); else res.end(); }
    });
    srv.maxConnections = 64;
    try { await new Promise<void>((ok, fail) => { srv.once("error", fail); srv.listen(s.port ?? 4748, o.bindHost ?? address, () => ok()); }); }
    catch (e) { return `cannot listen on ${address}:${s.port ?? 4748}: ${(e as Error).message}`; }
    srv.on("error", (e) => o.log("lan server error:", e.message));
    const port = (srv.address() as { port: number }).port, h = isIP(address) === 6 ? `[${address}]` : address;
    server = srv; host = `${h}:${port}`.toLowerCase(); url = `https://${h}:${port}`; fingerprint = c.fingerprint;
    until = now() + (s.stopAfterHours ?? 8) * 3600_000;
    timer = setTimeout(() => stop("auto-stop"), until - now()).unref();
    audit(`share on ${url}`);
    o.log(`sharing read-only on ${url} (certificate ${fingerprint.slice(0, 47)}), until ${new Date(until).toISOString()}`);
    return undefined;
  }

  function stop(why = "off") {
    if (!server) return;
    clearTimeout(timer);
    server.close(); server.closeAllConnections();
    for (const id of [...streams.keys()]) drop(id);
    server = undefined; code = undefined;
    audit(`share ${why}`);
  }

  function newCode() {
    if (!server) return { error: "sharing is off" };
    if (now() < lockedUntil) return { error: "pairing is locked after 5 wrong codes", lockedUntil };
    code = { value: String(randomInt(1_000_000)).padStart(6, "0"), expiresAt: now() + CODE_MS }; wrong = 0;
    return { code: code.value, expiresAt: code.expiresAt };
  }

  function revoke(id?: string) {
    const gone = devices.filter((d) => id === undefined || d.id === id);
    if (!gone.length) return 0;
    devices = devices.filter((d) => !gone.includes(d)); save();
    for (const d of gone) drop(d.id);
    audit(id === undefined ? `revoked all (${gone.length})` : `revoked ${id}`);
    return gone.length;
  }

  return { start, stop, status, newCode, revoke, check };
}
