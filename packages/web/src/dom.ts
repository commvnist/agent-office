// Tiny DOM helpers shared by the chrome modules. Text is always set with textContent (event text is untrusted).
export const $ = (id: string) => document.getElementById(id)!;
export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
export function btn(label: string, title: string, fn: (b: HTMLButtonElement) => void, cls = "b"): HTMLButtonElement {
  const b = el("button", cls, label);
  b.type = "button";
  b.title = title;
  b.addEventListener("click", () => fn(b));
  return b;
}
export const store = {
  get(k: string): string | null { try { return localStorage.getItem("ao." + k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem("ao." + k, v); } catch { /* private window: setting just won't persist */ } },
};
export async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
/** Re-render only when the signature changed, so focus and scroll survive the 500 ms refresh. */
export function renderIf(target: HTMLElement, sig: string, build: () => Node[]) {
  if (target.dataset.sig === sig) return;
  target.dataset.sig = sig;
  target.replaceChildren(...build());
}
/**
 * Keyed reconcile: keep (and reorder) the existing node per key, build only new ones, drop the rest.
 * Focus, scroll and hover survive because nodes are never recreated. Returns the nodes in order.
 */
export function sync<T extends HTMLElement>(parent: HTMLElement, cache: Map<string, T>, keys: string[], make: (key: string) => T): T[] {
  const live = new Set(keys);
  for (const [k, n] of cache) if (!live.has(k)) { n.remove(); cache.delete(k); }
  return keys.map((k, i) => {
    let n = cache.get(k);
    if (!n) { n = make(k); cache.set(k, n); }
    if (parent.children[i] !== n) parent.insertBefore(n, parent.children[i] ?? null);
    return n;
  });
}
export function download(blob: Blob, name: string) {
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// One serialized queue per live region: ui.ts and keys.ts both announce here, so one flush never overwrites another's text.
const queues = { "live-region": [] as string[], "alert-region": [] as string[] };
let ticking = false;
/** `urgent` goes to the assertive region. `cap` drops polite lines when that many are already waiting. */
export function announce(text: string, urgent = false, cap = Infinity) {
  const q = queues[urgent ? "alert-region" : "live-region"];
  if (!urgent && q.length >= cap) return;
  q.push(text);
  if (ticking) return;
  ticking = true;
  setInterval(() => {
    for (const [id, list] of Object.entries(queues)) {
      if (!list.length) continue;
      const n = list.splice(0);
      $(id).textContent = n.slice(0, 3).join(". ") + (n.length > 3 ? `. and ${n.length - 3} more` : "");
    }
  }, 1500);
}
