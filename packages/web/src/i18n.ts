// Message table and t() for the chrome modules (#174).
// shortcut: only panel/modes/views use it and only English ships; move the remaining inline strings and add locales when a translation exists.
const MSG: Record<string, Record<string, string>> = {
  en: {
    panel: "Panel", hidePanel: "Hide panel", needYou: "{n} need you", stale: "Stale since {time}: the daemon stream is down.",
    session: "{n} session|{n} sessions", agent: "{n} agent|{n} agents", event: "{n} event|{n} events",
  },
};
const base = (l: string) => l.toLowerCase().split("-")[0];
export const locale = (() => {
  let want = "en";
  try { want = localStorage.getItem("ao.lang") || navigator.language || "en"; } catch { /* default */ }
  return base(want) in MSG ? base(want) : "en";
})();

/** t("session", {n: 2}) -> "2 sessions". "a|b" holds the one|other forms; {x} is replaced from vars. */
export function t(key: string, vars: Record<string, string | number> = {}, loc = locale): string {
  let s = (MSG[loc] ?? MSG.en)[key] ?? MSG.en[key] ?? key;
  if (s.includes("|")) { const [one, other] = s.split("|"); s = new Intl.PluralRules(loc).select(Number(vars.n)) === "one" ? one : other; }
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
export const setLang = () => { document.documentElement.lang = locale; };
