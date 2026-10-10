import type { OfficeConfig } from "@agent-office/core";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g;
const AGENT = /^[\w.:-]{1,64}$/;
const ROLE = /^[\w-]{1,32}$/;

function names(v: unknown, where: string): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 20 || v.some((n) => typeof n !== "string")) throw new Error(`${where}.names must be an array of up to 20 strings`);
  return v.map((n: string) => n.replace(CONTROL, "").trim().slice(0, 24)).filter(Boolean);
}

/** office.json -> a normalized config containing only known keys. Throws Error(message) on the first problem. */
export function validateConfig(raw: unknown, defaultRoles?: OfficeConfig["roles"]): OfficeConfig {
  // A file that only sets e.g. {"privacy": true} keeps the default roles instead of being rejected.
  const src = isObj(raw) && raw.roles === undefined && defaultRoles ? defaultRoles : isObj(raw) ? raw.roles : undefined;
  if (!isObj(raw) || !isObj(src)) throw new Error("`roles` must be an object");
  const keys = Object.keys(src);
  if (keys.length > 30) throw new Error("at most 30 roles");
  const roles: OfficeConfig["roles"] = {};
  for (const k of keys) {
    const r = src[k];
    if (!ROLE.test(k)) throw new Error(`role key "${k.slice(0, 20)}" must match ${ROLE}`);
    if (!isObj(r)) throw new Error(`roles.${k} must be an object`);
    if (typeof r.agent !== "string" || !AGENT.test(r.agent)) throw new Error(`roles.${k}.agent must match ${AGENT}`);
    if (!int(r.count, 0, 20)) throw new Error(`roles.${k}.count must be an integer 0-20`);
    const role: OfficeConfig["roles"][string] = { agent: r.agent, count: r.count as number };
    const n = names(r.names, `roles.${k}`);
    if (n) role.names = n;
    if (r.overflow !== undefined) {
      const o = r.overflow;
      if (!isObj(o) || !int(o.max, 0, 10)) throw new Error(`roles.${k}.overflow.max must be an integer 0-10`);
      role.overflow = { max: o.max as number, ...(o.names !== undefined ? { names: names(o.names, `roles.${k}.overflow`) } : {}) };
    }
    Object.defineProperty(roles, k, { value: role, enumerable: true, writable: true, configurable: true });
  }
  const cfg: OfficeConfig = { roles };
  if (raw.parallelism !== undefined) {
    if (raw.parallelism !== "off" && raw.parallelism !== "auto" && raw.parallelism !== "aggressive") throw new Error("parallelism must be off, auto or aggressive");
    cfg.parallelism = raw.parallelism;
  }
  for (const k of ["enforceSeats", "privacy"] as const) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] !== "boolean") throw new Error(`${k} must be a boolean`);
    cfg[k] = raw[k] as boolean;
  }
  if (raw.theme !== undefined) {
    if (typeof raw.theme !== "string" || !/^[\w-]{1,40}$/.test(raw.theme)) throw new Error("theme must match ^[\\w-]{1,40}$");
    cfg.theme = raw.theme;
  }
  if (raw.idleTtlMinutes !== undefined) {
    if (!int(raw.idleTtlMinutes, 1, 1440)) throw new Error("idleTtlMinutes must be an integer 1-1440");
    (cfg as OfficeConfig & { idleTtlMinutes?: number }).idleTtlMinutes = raw.idleTtlMinutes as number;
  }
  return cfg;
}
