// Message table and t() for the chrome modules (#174).
// shortcut: only panel/modes/views use it and only English ships; move the remaining inline strings and add locales when a translation exists.
// A plural message maps Intl.PluralRules categories (zero/one/two/few/many/other) to forms; `other` is required.
type Msg = string | (Partial<Record<Intl.LDMLPluralRule, string>> & { other: string });
export const MSG: Record<string, Record<string, Msg>> = {
  en: {
    panel: "Panel", needYou: "{n} need you", stale: "Stale since {time}: the daemon stream is down.",
    session: { one: "{n} session", other: "{n} sessions" }, agent: { one: "{n} agent", other: "{n} agents" }, helper: { one: "{n} helper", other: "{n} helpers" }, event: { one: "{n} event", other: "{n} events" },
  },
};
const base = (l: string) => l.toLowerCase().split("-")[0];
export const locale = (() => {
  let want = "en";
  try { want = localStorage.getItem("ao.lang") || navigator.language || "en"; } catch { /* default */ }
  return base(want) in MSG ? base(want) : "en";
})();

/** t("session", {n: 2}) -> "2 sessions". Plural forms are picked by Intl.PluralRules for vars.n; {x} is replaced from vars. */
export function t(key: string, vars: Record<string, string | number> = {}, loc = locale): string {
  const m = (MSG[loc] ?? MSG.en)[key] ?? MSG.en[key] ?? key;
  const s = typeof m === "string" ? m : m[new Intl.PluralRules(loc).select(Number(vars.n))] ?? m.other;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
export const setLang = () => { document.documentElement.lang = locale; };
