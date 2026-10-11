// UI craft audit of the live page against docs/craft-rubric.md section A (A1 A4 A6 A7 A15 A19).
// Usage: PW_PATH=<path to playwright-core/index.mjs> [PW_EXE=<chromium>] node scripts/ui-audit.mjs <url> [--scheme dark|light] [--size 1300x760] [--wait 6000] [--strict] [--json]
// Prints a table and JSON; exits non-zero only with --strict and findings. Playwright is not a dependency of this repo.
// Observer only: it opens the page, opens Settings / Help / the palette / a selected agent, and reads computed styles.
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const url = args.find((a, i) => !a.startsWith("--") && !["--scheme", "--size", "--wait"].includes(args[i - 1]));
if (!url || !process.env.PW_PATH) { console.error("usage: PW_PATH=<playwright-core/index.mjs> node scripts/ui-audit.mjs <url> [--scheme dark|light] [--size WxH] [--wait ms] [--strict] [--json]"); process.exit(2); }
const [W, H] = opt("--size", "1300x760").split("x").map(Number);
const { chromium } = await import(pathToFileURL(process.env.PW_PATH).href);
const browser = await chromium.launch({ executablePath: process.env.PW_EXE || undefined, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, colorScheme: opt("--scheme", "dark") })).newPage();
await page.goto(url);
await page.waitForTimeout(Number(opt("--wait", 6000)));

/** Runs in the page: returns raw findings for what is visible right now. */
const scan = () => {
  const onScale = (v) => v % 4 === 0; // 4 px grid (rubric A1 lists 4-32; larger multiples of 4 are allowed)
  const cx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  cx.canvas.width = cx.canvas.height = 1;
  const rgba = (css) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (f, b) => { const a = f[3] + b[3] * (1 - f[3]); return a ? [0, 1, 2].map((i) => (f[i] * f[3] + b[i] * b[3] * (1 - f[3])) / a).concat(a) : [0, 0, 0, 0]; };
  const lum = (c) => { const l = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const sel = (e) => e.tagName.toLowerCase() + (e.id ? `#${e.id}` : "") + [...e.classList].slice(0, 3).map((c) => `.${c}`).join("");
  const path = (e) => { const p = []; for (let n = e; n && p.length < 3; n = n.parentElement) p.unshift(sel(n)); return p.join(" > "); };
  const visible = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !e.closest("[hidden],.sr,[aria-hidden=true]") && r.bottom > 0 && r.right > 0; };
  const all = [...document.querySelectorAll("body *")].filter((e) => !["SCRIPT", "STYLE", "CANVAS", "OPTION", "svg", "path", "circle", "polyline"].includes(e.tagName) && !(e instanceof SVGElement) && visible(e));
  const out = { fonts: {}, sizes: {}, spacing: {}, contrast: [], small: [], colourOnly: [], noFocus: [], longMs: [] };
  const bump = (o, k, who) => { (o[k] ??= { n: 0, ex: who }).n++; };
  // the page background under a node: first ancestor chain of painted backgrounds, else body, else the canvas default
  const backdrop = (e) => {
    const stack = [];
    for (let n = e; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= 1) break; }
    let b = [20, 18, 31, 1];
    for (const c of stack.reverse()) b = over(c, b);
    return b;
  };
  for (const e of all) {
    const s = getComputedStyle(e), own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own) {
      bump(out.fonts, s.fontFamily.split(",")[0].replace(/["']/g, "").trim(), path(e));
      bump(out.sizes, `${Math.round(parseFloat(s.fontSize) * 10) / 10}px`, path(e));
      if (!e.disabled && !e.closest(":disabled")) {
        let op = 1;
        for (let n = e; n; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
        const bg = backdrop(e), fgRaw = rgba(s.color), fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * op], bg);
        const r = ratio(fg, bg), size = parseFloat(s.fontSize), large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700), need = large ? 3 : 4.5;
        if (r < need) out.contrast.push({ sel: path(e), text: e.textContent.trim().slice(0, 28), ratio: Math.round(r * 100) / 100, need, fg: s.color, bg: `rgb(${bg.slice(0, 3).map(Math.round)})` });
      }
    }
    for (const p of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "rowGap", "columnGap", "marginTop", "marginBottom"]) {
      const v = parseFloat(s[p]);
      if (!Number.isFinite(v) || onScale(Math.round(v * 2) / 2)) continue;
      if (p.startsWith("margin") && (e.parentElement && getComputedStyle(e.parentElement).display.includes("flex") || v > 40)) continue; // auto margins resolve to px
      bump(out.spacing, `${p.replace(/Top|Right|Bottom|Left/, "")} ${Math.round(v * 10) / 10}px`, path(e));
    }
    // a checkbox's real target is its label (clicking it toggles the box)
    const r = (e.matches("input[type=checkbox],input[type=radio]") && e.closest("label") || e).getBoundingClientRect();
    if (e.matches("button,a[href],input:not([type=hidden]),select,textarea,[role=button],summary,[role=separator][tabindex]") && (r.width < 24 || r.height < 24) && !e.matches(":disabled"))
      out.small.push({ sel: path(e), size: `${Math.round(r.width)}x${Math.round(r.height)}`, text: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 24) });
    if (!e.textContent.trim() && !e.children.length && r.width <= 16 && r.height <= 16 && rgba(s.backgroundColor)[3] > 0.3
      && !e.getAttribute("aria-label") && !e.title && !(e.parentElement?.textContent || "").trim() && !e.closest("[aria-label],[title]"))
      out.colourOnly.push({ sel: path(e), size: `${Math.round(r.width)}x${Math.round(r.height)}` });
    const ms = Math.max(...[s.transitionDuration, s.animationDuration].flatMap((x) => x.split(",").map((t) => (t.trim().endsWith("ms") ? parseFloat(t) : parseFloat(t) * 1000))));
    if (ms > 500) out.longMs.push({ sel: path(e), ms });
  }
  // focus ring: focus each distinct control kind once with :focus-visible semantics
  const seen = new Set();
  for (const e of document.querySelectorAll("button,input,select,summary,a[href],[tabindex]:not([tabindex='-1'])")) {
    const key = sel(e);
    if (seen.has(key) || !visible(e)) continue;
    seen.add(key);
    e.focus({ focusVisible: true });
    const s = getComputedStyle(e), ring = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 && s.outlineColor !== "rgba(0, 0, 0, 0)";
    if (document.activeElement === e && !ring && s.boxShadow === "none") out.noFocus.push({ sel: path(e) });
    e.blur();
  }
  return out;
};

const merged = { fonts: {}, sizes: {}, spacing: {}, contrast: [], small: [], colourOnly: [], noFocus: [], longMs: [] };
const mergeIn = (r) => {
  for (const k of ["fonts", "sizes", "spacing"]) for (const [n, v] of Object.entries(r[k])) { const m = (merged[k][n] ??= { n: 0, ex: v.ex }); m.n += v.n; }
  for (const k of ["contrast", "small", "colourOnly", "noFocus", "longMs"]) for (const v of r[k]) if (!merged[k].some((x) => x.sel === v.sel && x.text === v.text)) merged[k].push(v);
};
const step = async (name, fn) => { try { await fn(); await page.waitForTimeout(400); mergeIn(await page.evaluate(scan)); } catch (e) { console.error(`state "${name}" skipped: ${e.message.split("\n")[0]}`); } };
await step("default", async () => {});
await step("settings", async () => { await page.getByRole("button", { name: "Settings", exact: true }).click(); });
await page.keyboard.press("Escape");
await step("help", async () => { await page.getByRole("button", { name: "Help", exact: true }).click(); });
await page.keyboard.press("Escape");
await step("palette", async () => { await page.keyboard.press("Control+k"); });
await page.keyboard.press("Escape");
await step("selected agent", async () => { await page.locator("#roster button.r").first().click(); });
await step("wall", async () => { await page.getByRole("button", { name: "Wall", exact: true }).click(); });
await step("timeline", async () => { await page.getByRole("button", { name: "Timeline", exact: true }).click(); });
await browser.close();

const top = (o, n = 8) => Object.entries(o).sort((a, b) => b[1].n - a[1].n).slice(0, n).map(([k, v]) => `${k} (${v.n}) e.g. ${v.ex}`);
const summary = {
  url, scheme: opt("--scheme", "dark"), viewport: `${W}x${H}`,
  fontFamilies: { count: Object.keys(merged.fonts).length, limit: 2, values: top(merged.fonts) },
  fontSizes: { count: Object.keys(merged.sizes).length, limit: 6, values: top(merged.sizes, 12) },
  offScaleSpacing: { count: Object.keys(merged.spacing).length, values: top(merged.spacing, 12) },
  contrast: { count: merged.contrast.length, items: merged.contrast.sort((a, b) => a.ratio - b.ratio).slice(0, 15) },
  smallTargets: { count: merged.small.length, items: merged.small.slice(0, 15) },
  colourOnlyStatus: { count: merged.colourOnly.length, items: merged.colourOnly.slice(0, 10) },
  missingFocusRing: { count: merged.noFocus.length, items: merged.noFocus.slice(0, 10) },
  longTransitions: { count: merged.longMs.length, items: merged.longMs.slice(0, 10) },
};
const fails = (summary.fontFamilies.count > 2) + (summary.fontSizes.count > 6) + summary.contrast.count + summary.smallTargets.count + summary.colourOnlyStatus.count + summary.missingFocusRing.count + summary.longTransitions.count;
if (args.includes("--json")) console.log(JSON.stringify(summary, null, 1));
else {
  console.log(`UI audit ${summary.url} (${summary.scheme}, ${summary.viewport})`);
  console.table([
    ["font families", summary.fontFamilies.count, "<= 2"], ["font sizes", summary.fontSizes.count, "<= 6"], ["off-scale spacing values", summary.offScaleSpacing.count, "report"],
    ["contrast failures", summary.contrast.count, "0"], ["targets < 24px", summary.smallTargets.count, "0"], ["colour-only status", summary.colourOnlyStatus.count, "0"],
    ["no focus ring", summary.missingFocusRing.count, "0"], ["transitions > 500 ms", summary.longTransitions.count, "0"],
  ].map(([check, found, want]) => ({ check, found, want })));
  for (const [k, v] of Object.entries(summary)) if (v?.items?.length || v?.values?.length) console.log(`\n${k}:`, ...(v.items ?? v.values).map((x) => `\n  ${typeof x === "string" ? x : JSON.stringify(x)}`));
}
if (args.includes("--strict") && fails) process.exit(1);
