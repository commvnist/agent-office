import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:https";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { isPrivate, makeCert, loadCert, createShare, deviceName, givenName, lanAddresses, LAN_ROUTES } from "./share.ts";
import { validateConfig } from "./config.ts";

const posix = process.platform !== "win32";

test("isPrivate: only 10/8, 172.16/12, 192.168/16, 169.254/16, fd00::/8, fe80::/10", () => {
  for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.49", "169.254.1.1", "fd12::1", "fe80::1"]) assert.ok(isPrivate(ip), ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "127.0.0.1", "0.0.0.0", "::1", "::", "2001:db8::1", "fc00::1", "localhost", "", "192.168.1.1.1"]) assert.ok(!isPrivate(ip), ip);
});

test("config: share is validated", () => {
  assert.deepEqual(validateConfig({ share: { enabled: true, port: 4748, address: "192.168.1.5", stopAfterHours: 8 } }, {}).share, { enabled: true, port: 4748, address: "192.168.1.5", stopAfterHours: 8 });
  for (const share of [{ port: 70000 }, { address: "my-host" }, { enabled: "yes" }, { stopAfterHours: 0 }, { stopAfterHours: 169 }, []]) assert.throws(() => validateConfig({ share }, {}), /share/);
});

test("TLS: a self-signed P-256 certificate with an IP SAN, valid 2 years, verifies with its own key", () => {
  for (const ip of ["192.168.1.49", "fd00::1:2"]) {
    const now = Date.now(), c = makeCert(ip, now), x = new X509Certificate(c.cert);
    assert.equal(x.subject, "CN=Agent Office");
    assert.equal(x.issuer, "CN=Agent Office");
    assert.ok(x.checkIP(ip), ip);
    assert.equal(x.checkIP("192.168.1.50"), undefined);
    assert.match(x.subjectAltName!, /^IP Address:/);
    assert.ok(x.verify(x.publicKey), "self-signed signature verifies");
    assert.equal(x.publicKey.asymmetricKeyDetails?.namedCurve, "prime256v1");
    assert.ok(Math.abs(Date.parse(x.validTo) - now - 2 * 365 * 86_400_000) < 2000);
    assert.ok(Date.parse(x.validFrom) <= now);
    assert.equal(x.ca, false);
    assert.deepEqual(x.keyUsage, ["1.3.6.1.5.5.7.3.1"]);
    assert.ok(x.checkPrivateKey(createPrivateKey(c.key)), "the stored key matches the certificate");
  }
});

test("TLS: stored 0600 in a 0700 dir, reused while the SAN matches, regenerated when the address changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "ao-tls-"));
  const a = loadCert(dir, "192.168.1.49");
  if (posix) {
    assert.equal(statSync(join(dir, "tls")).mode & 0o777, 0o700);
    for (const f of ["key.pem", "cert.pem"]) assert.equal(statSync(join(dir, "tls", f)).mode & 0o777, 0o600);
  }
  assert.match(a.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.equal(loadCert(dir, "192.168.1.49").fingerprint, a.fingerprint);
  const b = loadCert(dir, "10.0.0.7");
  assert.notEqual(b.fingerprint, a.fingerprint);
  assert.ok(new X509Certificate(readFileSync(join(dir, "tls", "cert.pem"))).checkIP("10.0.0.7"));
});

test("deviceName: the platform part of the User-Agent, printable and clipped", () => {
  assert.equal(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit"), "iPhone; CPU iPhone OS 17_0 like Mac OS X");
  assert.equal(deviceName("x (<script>\u001b[31m</script>)"), "script31m/script");
  assert.equal(deviceName(""), "device");
  assert.ok(deviceName("a".repeat(500)).length <= 40);
});

// ---- the LAN listener, in-process: bound to 127.0.0.1, but Host and certificate use a private address ----
const ADDR = "192.168.77.7";
type R = { status: number; body: string; headers: Record<string, any> };
function lanServer(over: { stopAfterHours?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ao-share-"));
  let t = Date.now();
  const reads: string[] = [];
  const s = createShare({
    dir, log: () => {}, now: () => t, bindHost: "127.0.0.1",
    settings: () => ({ address: ADDR, port: 0, ...over }),
    read: (path, _req, res) => {
      reads.push(path);
      if (path === "/stream") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: {}\n\n"); return; }
      res.writeHead(200, { "content-type": "application/json" }).end(`{"remote":true}`);
    },
    serve: (url, res) => (url === "/" ? (res.writeHead(200).end("INDEX"), true) : false),
  });
  const call = (path: string, o: { method?: string; headers?: Record<string, string>; body?: string; host?: string } = {}) => new Promise<R>((resolve, reject) => {
    const port = Number(new URL(s.status().url!).port);
    const r = request({ host: "127.0.0.1", port, path, method: o.method ?? "GET", agent: false, rejectUnauthorized: false, headers: { host: o.host ?? `${ADDR}:${port}`, ...o.headers } }, (res) => {
      let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode!, body: b, headers: res.headers }));
    });
    r.on("error", reject); r.end(o.body);
  });
  const pair = (code: string) => call("/pair", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 (iPhone; CPU)" }, body: `code=${code}` });
  return { s, dir, call, pair, reads, advance: (ms: number) => { t += ms; } };
}

test("LAN: the route table is exactly the read-only list", () => {
  assert.deepEqual([...LAN_ROUTES], ["GET /pair", "POST /pair", "GET /state", "GET /stream", "GET /history"]);
});

test("LAN: refused off a private address; no code while off; Host check, headers, pair page, no access without a device", async () => {
  const off = createShare({ dir: mkdtempSync(join(tmpdir(), "ao-share-")), log: () => {}, settings: () => ({ address: "8.8.8.8", port: 0 }), read: () => {}, serve: () => false });
  assert.match((await off.start())!, /not a private address/);
  assert.equal(off.status().enabled, false);
  assert.deepEqual(off.newCode(), { error: "sharing is off" });
  const l = lanServer();
  assert.equal(await l.s.start(), undefined);
  try {
    const st = l.s.status();
    assert.match(st.url!, /^https:\/\/192\.168\.77\.7:\d+$/);
    assert.ok(st.until! > Date.now() + 7.9 * 3600_000);
    assert.equal((await l.call("/pair", { host: "evil.example" })).status, 403);
    assert.equal((await l.call("/pair", { host: `127.0.0.1:${new URL(st.url!).port}` })).status, 403, "only the bound address:port");
    const p = await l.call("/pair");
    assert.equal(p.status, 200);
    assert.match(p.body, /<form method="post" action="\/pair">/);
    assert.ok(!/<script/i.test(p.body), "no scripts on the pair page");
    assert.match(p.headers["content-security-policy"], /^default-src 'self'/);
    assert.match(p.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.equal(p.headers["x-frame-options"], "DENY");
    assert.equal(p.headers["referrer-policy"], "same-origin");
    assert.equal(p.headers["x-content-type-options"], "nosniff");
    assert.equal(p.headers["cache-control"], "no-store");
    assert.equal(p.headers["strict-transport-security"], undefined);
    assert.equal(p.headers["access-control-allow-origin"], undefined);
    const root = await l.call("/");
    assert.deepEqual([root.status, root.headers.location], [302, "/pair"]);
    for (const path of ["/state", "/stream", "/history", "/index.html"]) assert.equal((await l.call(path)).status, 401, path);
    assert.equal((await l.call("/state", { headers: { cookie: "ao_dev=" + "A".repeat(43) } })).status, 401, "unknown device token");
    assert.deepEqual(l.reads, []);
  } finally { l.s.stop(); }
});

test("LAN pairing: 6 digits, single use, 2-minute lifetime, 5 wrong attempts lock for 60 s; hashed device tokens in a 0600 file", async () => {
  const l = lanServer();
  await l.s.start();
  try {
    const c = l.s.newCode() as { code: string; expiresAt: number };
    assert.match(c.code, /^\d{6}$/);
    assert.ok(l.s.status().code && !("value" in l.s.status().code!) && !JSON.stringify(l.s.status()).includes(c.code), "status never carries the code");
    const ok = await l.pair(c.code);
    assert.deepEqual([ok.status, ok.headers.location], [303, "/"]);
    const ck = String(ok.headers["set-cookie"]);
    assert.match(ck, /^ao_dev=[\w-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=2592000$/);
    const token = /ao_dev=([\w-]+)/.exec(ck)![1];
    assert.equal((await l.pair(c.code)).status, 401, "single use");
    const file = readFileSync(join(l.dir, "devices.json"), "utf8"), devs = JSON.parse(file);
    assert.equal(devs.length, 1);
    assert.match(devs[0].id, /^[0-9a-f]{8}$/);
    assert.match(devs[0].tokenHash, /^[0-9a-f]{64}$/);
    assert.equal(devs[0].name, "iPhone; CPU");
    assert.ok(!file.includes(token), "the token itself is never stored");
    if (posix) assert.equal(statSync(join(l.dir, "devices.json")).mode & 0o777, 0o600);

    const c2 = l.s.newCode() as { code: string };
    l.advance(121_000);
    assert.equal((await l.pair(c2.code)).status, 401, "expired after 2 minutes");

    const c3 = l.s.newCode() as { code: string };
    const bad = c3.code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 4; i++) assert.equal((await l.pair(bad)).status, 401);
    assert.equal((await l.pair(bad)).status, 401, "5th wrong attempt");
    assert.equal((await l.pair(c3.code)).status, 429, "locked, even with the right code");
    assert.match(String((l.s.newCode() as { error?: string }).error), /locked/);
    l.advance(61_000);
    assert.equal((await l.pair(c3.code)).status, 401, "the code was invalidated by the lockout");
    const c4 = l.s.newCode() as { code: string };
    assert.equal((await l.pair(c4.code)).status, 303, "pairing works again after 60 s with a new code");
    assert.equal((await l.call("/pair", { method: "POST", headers: { origin: "https://evil.example" }, body: "code=1" })).status, 403);

    const log = readFileSync(join(l.dir, "share.log"), "utf8");
    assert.match(log, /paired [0-9a-f]{8} "iPhone; CPU" from /);
    assert.match(log, /pair failed from /);
    assert.match(log, /pairing locked/);
    for (const secret of [token, c.code, c3.code, devs[0].tokenHash]) assert.ok(!log.includes(secret), "no secrets in share.log");
  } finally { l.s.stop(); }
});

test("LAN with a device: reads only, nothing else exists; stream caps; revoke closes streams at once; 30-day expiry", async () => {
  const l = lanServer();
  await l.s.start();
  try {
    const code = (l.s.newCode() as { code: string }).code;
    const cookie = String((await l.pair(code)).headers["set-cookie"]).split(";")[0];
    const h = { cookie };
    for (const p of ["/state", "/history"]) assert.equal((await l.call(p, { headers: h })).status, 200, p);
    const root = await l.call("/", { headers: h });
    assert.deepEqual([root.status, root.body], [200, "INDEX"]);
    assert.match(String(root.headers["set-cookie"]), /Max-Age=2592000/, "loading the page slides the 30 days");
    // Every loopback route, every method: not found here, even with a device cookie and the master-token header.
    const all = { ...h, "x-agent-office-token": "x".repeat(64) };
    for (const path of ["/event", "/shutdown", "/sessions/clear", "/share", "/share/code", "/share/devices", "/share/devices/abcdef12", "/status", "/outcomes", "/health"]) {
      for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) assert.equal((await l.call(path, { method, headers: all, body: "{}" }).catch((e) => { throw new Error(`${method} ${path}: ${e.message}`); })).status, 404, `${method} ${path}`);
    }
    for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await l.call("/state", { method, headers: all })).status, 404, `${method} /state`);
    assert.deepEqual(l.reads, ["/state", "/history"]);

    // Streams: 2 per device, a third replaces the oldest (L1: a reload is never refused); a revoke destroys them.
    const port = Number(new URL(l.s.status().url!).port);
    const open = () => new Promise<{ closed: Promise<void> }>((resolve, reject) => {
      const r = request({ host: "127.0.0.1", port, path: "/stream", rejectUnauthorized: false, headers: { host: `${ADDR}:${port}`, cookie } }, (res) => {
        assert.equal(res.statusCode, 200);
        resolve({ closed: new Promise((c) => { res.on("close", () => c()); res.on("error", () => c()); res.resume(); }) });
      });
      r.on("error", reject); r.end();
    });
    const a = await open(), b = await open(), c = await open();
    await a.closed;
    const id = l.s.status().devices[0].id;
    assert.equal(l.s.revoke(id), 1);
    await Promise.all([b.closed, c.closed]);
    assert.equal((await l.call("/state", { headers: h })).status, 401, "revoked");
    assert.equal(l.s.revoke(id), 0);

    // 30 days unused: gone.
    const c2 = String((await l.pair((l.s.newCode() as { code: string }).code)).headers["set-cookie"]).split(";")[0];
    assert.equal((await l.call("/state", { headers: { cookie: c2 } })).status, 200);
    l.advance(30 * 86_400_000 + 1000);
    assert.equal((await l.call("/state", { headers: { cookie: c2 } })).status, 401, "expired after 30 days unused");
    assert.equal(l.s.status().devices.length, 0);
    assert.match(readFileSync(join(l.dir, "share.log"), "utf8"), /revoked [0-9a-f]{8}/);
  } finally { l.s.stop(); }
});

test("X8: an optional device name on the pair form, sanitised, stored with the pairing date and shown in status", async () => {
  assert.equal(givenName("Ana's <b>phone</b>\u001b[31m  \u202e!"), "Ana's bphoneb31m");
  assert.equal(givenName("x".repeat(80)).length, 32);
  assert.equal(givenName(null), "");
  const l = lanServer();
  await l.s.start();
  try {
    assert.match((await l.call("/pair")).body, /name="name" maxlength="32"/);
    const code = (l.s.newCode() as { code: string }).code;
    const r = await l.call("/pair", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `code=${code}&name=${encodeURIComponent("Kitchen tablet")}` });
    assert.equal(r.status, 303);
    const d = l.s.status().devices[0];
    assert.deepEqual([d.name, typeof d.createdAt], ["Kitchen tablet", "number"]);
  } finally { l.s.stop(); }
});

test("L5: LAN candidates rank 192.168 > 10 > 172.16 and skip container and VM bridges", () => {
  const a = (address: string) => ({ address, family: "IPv4", internal: false, netmask: "", mac: "", cidr: null }) as const;
  assert.deepEqual(lanAddresses({ docker0: [a("172.17.0.1")], "br-1a2b": [a("172.18.0.1")], veth9: [a("10.9.9.9")], "vEthernet (WSL)": [a("172.20.0.1")],
    eth0: [a("172.16.5.5")], wlan0: [a("10.0.0.5"), a("8.8.8.8")], en1: [a("192.168.1.20")], lo: [{ ...a("127.0.0.1"), internal: true }] }), ["192.168.1.20", "10.0.0.5", "172.16.5.5"]);
});

test("LAN: auto-stop after stopAfterHours closes the listener", async () => {
  const l = lanServer({ stopAfterHours: 0.3 / 3600 }); // 300 ms
  await l.s.start();
  assert.equal(l.s.status().enabled, true);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(l.s.status().enabled, false);
  assert.match(readFileSync(join(l.dir, "share.log"), "utf8"), /share auto-stop/);
});
