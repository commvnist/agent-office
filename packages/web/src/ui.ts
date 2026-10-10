// DOM chrome (replaces legacy-dom.ts): radar, card, sessions, roster, feed, aria. A pure consumer of api.ts `office`.
// Ids come from index.html. Free text is only ever set with textContent.
import { office, type ActorInfo, type FeedItem } from "./api.ts";
import { $, btn, copy, el, renderIf } from "./dom.ts";
import { cdCommand, filterFeed, fmtAge, fmtTokens, radar, summary, whoLine, type FeedFilter, type RadarItem } from "./logic.ts";
import { bindPanelChrome } from "./panel.ts";
import { bindModes } from "./modes.ts";
import * as notify from "./notify.ts";

const pick = (id: string) => { office.select(id); office.focus(id); office.pulse(id); };
const projectOf = (sid: string) => office.sessions().find((s) => s.id === sid)?.project ?? sid;

// ---- aria live region: structure only, batched ----
const pending: string[] = [];
const announce = (s: string) => { if (office.source.mode === "live" || pending.length < 3) pending.push(s); };
setInterval(() => { if (pending.length) $("live-region").textContent = pending.splice(0).slice(-3).join(". "); }, 1500);

// ---- radar (#93) ----
const firstSeen = new Map<string, number>();
let radarKeys = new Set<string>();
let items: RadarItem[] = [];
function renderRadar(now: number) {
  const env = office.getEnvelope();
  if (!env) return;
  items = radar(office.actors(), env.state, now, (k, fb) => firstSeen.get(k) ?? (firstSeen.set(k, fb), fb));
  const keys = new Set(items.map((i) => i.key));
  for (const k of firstSeen.keys()) if (!keys.has(k)) firstSeen.delete(k);
  for (const i of items) if (!radarKeys.has(i.key) && i.kind !== "stuck") announce(i.kind === "blocked" ? `${i.label} is blocked` : `${i.project} is waiting for you`);
  radarKeys = keys;
  const LABEL = { blocked: "blocked", waiting: "waiting for you", stuck: "no activity" };
  renderIf($("radar-list"), items.map((i) => `${i.key}|${fmtAge(now - i.since)}`).join(","), () =>
    items.length
      ? items.map((i) => {
        const b = el("button", `rd ${i.kind}`);
        b.type = "button";
        b.append(el("b", "", i.label), el("span", "", ` ${LABEL[i.kind]} · ${fmtAge(now - i.since)}`));
        b.addEventListener("click", () => pick(i.id));
        const li = el("div");
        li.setAttribute("role", "listitem");
        li.append(b);
        return li;
      })
      : [el("div", "k pad", "Nothing needs you.")]);
  $("radar").classList.toggle("hot", items.length > 0);
}

// ---- selected card (#79 #91 #92) ----
function renderCard() {
  const c = $("card"), id = office.selected;
  const a = id ? office.actors().find((x) => x.id === id) : undefined;
  $("card-sec").hidden = !a;
  if (!a) { c.dataset.sig = ""; return; }
  const rows: [string, string][] = [["role", a.lead ? "session lead" : a.role], ["session", a.project], ["status", a.status]];
  if (a.doing) rows.push(["last tool", `${a.doing}${a.detail ? " · " + a.detail : ""}`]);
  if (a.why) rows.push(["why", a.why]);
  if (a.task) rows.push(["task", a.task]);
  if (a.confidence === "guess") rows.push(["attribution", "guess (several or no matching delegations)"]);
  if (a.branch) rows.push(["branch", a.branch]);
  if (a.chain.length) rows.push(["reports to", a.chain[0].replace(/^lead:/, "")]);
  const f = office.feed;
  const last = (p: (i: FeedItem) => boolean) => f.find((i) => p(i) && i.text);
  const texts: [string, string | undefined][] = [
    ["prompt", last((i) => i.kind === "prompt" && i.toId === a.id)?.text],
    ["delegation received", last((i) => i.kind === "delegate" && i.toId === a.id)?.text],
    ["delegated", last((i) => i.kind === "delegate" && i.fromId === a.id)?.text],
    ["said", last((i) => i.kind === "message" && i.fromId === a.id)?.text],
    ["report", last((i) => i.kind === "report" && i.fromId === a.id)?.text],
  ];
  const full = texts.filter((t): t is [string, string] => !!t[1]);
  renderIf(c, JSON.stringify([a.label, rows, full]), () => {
    const out: Node[] = [el("div", "n", a.label)];
    for (const [k, v] of rows) { const d = el("div"); d.append(el("span", "k", k + "  "), document.createTextNode(v)); d.title = a.why ?? ""; out.push(d); }
    for (const [k, v] of full) {
      const d = el("div", "full");
      d.append(el("div", "k", k), el("div", "tx", v), btn("Copy", `Copy ${k} text`, async (b) => { b.textContent = (await copy(v)) ? "Copied" : "Copy failed"; setTimeout(() => (b.textContent = "Copy"), 1200); }, "b sm"));
      out.push(d);
    }
    return out;
  });
}

// ---- sessions (#91 #36) ----
function renderSessions(now: number) {
  const env = office.getEnvelope();
  const list = office.sessions();
  const rows = list.map((s) => ({ s, last: env?.state.sessions[s.id]?.lastAt }));
  renderIf($("sessions"), JSON.stringify(rows.map((r) => [r.s, r.last ? fmtAge(now - r.last) : ""])), () =>
    rows.length
      ? rows.map(({ s, last }) => {
        const d = el("div", "sess");
        const h = btn(s.project, "Select this session's lead", () => pick(s.lead), "sname");
        d.append(h);
        const meta = [`${s.agents} agent${s.agents === 1 ? "" : "s"}`, s.branch ? `branch ${s.branch}` : "", fmtTokens(s.usage), last ? `active ${fmtAge(now - last)}` : ""].filter(Boolean);
        d.append(el("div", "k", meta.join(" · ")));
        if (s.recovered) d.append(el("span", "badge", "recovered"));
        if (s.gaps) d.append(el("span", "badge", `${s.gaps} gap${s.gaps === 1 ? "" : "s"}`));
        if (s.waiting) d.append(el("span", "badge warn", "waiting"));
        if (s.cwd) {
          const p = el("div", "cwd");
          p.append(el("span", "k", s.cwd), btn("cd", "Copy a cd command for this folder", async (b) => { b.textContent = (await copy(cdCommand(s.cwd!))) ? "copied" : "failed"; setTimeout(() => (b.textContent = "cd"), 1200); }, "b sm"));
          d.append(p);
        }
        return d;
      })
      : [el("div", "k pad", "No sessions.")]);
}

// ---- roster (#75) ----
const rosterLi = new Map<string, HTMLLIElement>();
let rover: string | null = null;
function renderRoster() {
  const ul = $("roster"), as = office.actors(), seen = new Set<string>();
  if (!as.some((a) => a.id === rover)) rover = as[0]?.id ?? null;
  as.forEach((a, i) => {
    seen.add(a.id);
    let li = rosterLi.get(a.id);
    if (!li) {
      li = el("li");
      const b = el("button", "r");
      b.type = "button";
      b.dataset.id = a.id;
      b.addEventListener("click", () => office.select(office.selected === a.id ? null : a.id));
      b.addEventListener("focus", () => { rover = a.id; });
      li.append(b);
      rosterLi.set(a.id, li);
    }
    const b = li.firstChild as HTMLButtonElement;
    const t = `${a.label}: ${a.lead ? "session lead" : a.role}, ${a.status}`;
    if (b.textContent !== t) b.textContent = t;
    b.className = `r ${a.status}`;
    b.title = a.why ?? a.task ?? "";
    b.setAttribute("aria-pressed", String(office.selected === a.id));
    b.tabIndex = a.id === rover ? 0 : -1;
    if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] ?? null);
  });
  for (const [id, li] of rosterLi) if (!seen.has(id)) { li.remove(); rosterLi.delete(id); }
  if (!as.length) renderIf(ul, "empty", () => []);
}
function bindRosterKeys() {
  $("roster").addEventListener("keydown", (e) => {
    const bs = Array.from($("roster").querySelectorAll<HTMLButtonElement>("button"));
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    const to = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: bs.length - 1 }[e.key as string];
    if (to === undefined || i < 0) return;
    e.preventDefault();
    bs[Math.max(0, Math.min(bs.length - 1, to))]?.focus();
  });
}

// ---- feed (#77 #78) ----
const filter: FeedFilter = { session: "", kind: "", agent: "", muted: new Set() };
let grouped = false, frozen: FeedItem[] | null = null, feedDirty = true;
const KINDS = ["prompt", "delegate", "report", "message", "done", "conflict"];
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function feedRow(f: FeedItem): HTMLElement {
  const row = el("div", `it ${f.kind}`);
  row.setAttribute("role", "listitem");
  const main = el("button", "row");
  main.type = "button";
  main.title = "Select and pulse this actor";
  const head = el("div");
  head.append(el("span", "who", whoLine(f)), el("span", "t", time(f.t)));
  main.append(head);
  if (f.text) main.append(el("span", "tx", f.text));
  main.addEventListener("click", () => {
    const ids = new Set(office.actors().map((a) => a.id));
    const id = [f.fromId, f.toId].find((x) => x && ids.has(x));
    if (id) pick(id);
  });
  const mute = btn("mute", `Hide everything from ${f.from}`, () => { filter.muted.add(f.from); feedDirty = true; renderFeed(); }, "b sm mute");
  row.append(main, mute);
  return row;
}

function renderFeed() {
  const src = frozen ?? office.feed;
  const shown = filterFeed(src, filter).slice(0, 60);
  $("fd-pause").textContent = frozen ? `Resume${office.feed[0] && office.feed[0] !== frozen[0] ? " (new)" : ""}` : "Pause";
  $("fd-unmute").hidden = !filter.muted.size;
  const sessIds = [...new Set(src.map((i) => i.session).filter((x): x is string => !!x))];
  fillSelect($("fd-session") as HTMLSelectElement, "all sessions", sessIds.map((s) => [s, projectOf(s)]));
  fillSelect($("fd-kind") as HTMLSelectElement, "all kinds", KINDS.map((k) => [k, k]));
  fillSelect($("fd-agent") as HTMLSelectElement, "all agents", [...new Set(src.flatMap((i) => [i.from, i.to]).filter(Boolean))].sort().map((n) => [n, n]));
  const sig = JSON.stringify([shown.map((i) => [i.t, i.kind, i.from, i.to, i.text]), grouped, [...filter.muted]]);
  if (!feedDirty && $("feed").dataset.sig === sig) return;
  feedDirty = false;
  renderIf($("feed"), sig, () => {
    if (!shown.length) return [el("div", "k pad", "No activity yet.")];
    if (!grouped) return shown.map(feedRow);
    const out: Node[] = [];
    const by = new Map<string, FeedItem[]>();
    for (const i of shown) (by.get(i.session ?? "") ?? by.set(i.session ?? "", []).get(i.session ?? "")!).push(i);
    for (const [s, list] of by) { out.push(el("h3", "", s ? projectOf(s) : "other")); out.push(...list.map(feedRow)); }
    return out;
  });
}
function fillSelect(sel: HTMLSelectElement, all: string, opts: [string, string][]) {
  const sig = JSON.stringify(opts);
  if (sel.dataset.sig === sig) return;
  sel.dataset.sig = sig;
  const cur = sel.value;
  sel.replaceChildren(...[["", all], ...opts].map(([v, l]) => Object.assign(el("option", "", l), { value: v })));
  sel.value = opts.some(([v]) => v === cur) ? cur : "";
}
function bindFeed() {
  const bar = $("filters");
  const sel = (id: string, label: string, key: "session" | "kind" | "agent") => {
    const s = el("select");
    s.id = id;
    s.setAttribute("aria-label", label);
    s.addEventListener("change", () => { filter[key] = s.value; feedDirty = true; renderFeed(); });
    return s;
  };
  const group = el("input");
  group.type = "checkbox";
  group.addEventListener("change", () => { grouped = group.checked; renderFeed(); });
  const gl = el("label", "k");
  gl.append(group, document.createTextNode(" group by session"));
  const pause = btn("Pause", "Freeze the feed while you read", () => { frozen = frozen ? null : office.feed.slice(); feedDirty = true; renderFeed(); });
  pause.id = "fd-pause";
  const un = btn("Unmute all", "Show muted agents again", () => { filter.muted.clear(); feedDirty = true; renderFeed(); });
  un.id = "fd-unmute";
  un.hidden = true;
  bar.append(sel("fd-session", "Filter by session", "session"), sel("fd-kind", "Filter by kind", "kind"), sel("fd-agent", "Filter by agent", "agent"), gl, pause, un);
  office.onFeed((f) => {
    renderFeed();
    if (f.kind === "delegate" || f.kind === "report" || f.kind === "done") announce(`${whoLine(f)}${f.kind === "report" && f.outcome ? ` (${f.outcome})` : ""}`);
    if (f.kind === "done") notify.turnDone(`${f.session}:${f.t}`, f.from);
  });
}

// ---- stats / aria ----
function renderStats() {
  const e = office.getEnvelope();
  if (!e) return;
  const s = e.state, n = Object.keys(s.agents).length, ns = Object.keys(s.sessions).length, q = s.queue.length;
  $("stats").textContent = `${ns} session${ns === 1 ? "" : "s"} · ${n} agent${n === 1 ? "" : "s"}${q ? ` · ${q} queued` : ""}${e.configError ? " · config error" : ""}`;
  $("empty").style.display = ns || office.source.mode !== "live" ? "none" : "block";
  $("top").classList.toggle("priv", office.privacy || office.source.private);
  document.body.classList.toggle("priv", office.privacy || office.source.private);
}

function refresh() {
  const now = Date.now();
  renderStats();
  renderRadar(now);
  renderCard();
  renderSessions(now);
  renderRoster();
  renderFeed();
  notify.update(items);
  const c = office.snapshotCanvas();
  if (c) {
    c.setAttribute("role", "img");
    const t = summary(office.actors() as ActorInfo[], office.sessions());
    if (c.getAttribute("aria-label") !== t) c.setAttribute("aria-label", t);
  }
}

/** Wire all chrome; main.ts calls this once after the engine is up. */
export function bindUi() {
  const tools = $("tools");
  bindPanelChrome(tools);
  bindModes(tools, $("modebar"));
  bindFeed();
  bindRosterKeys();
  office.subscribe(refresh);
  office.onSelect(refresh);
  office.source.onMode(refresh);
  setInterval(refresh, 500);
  refresh();
}
