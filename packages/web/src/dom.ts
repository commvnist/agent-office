// Tiny DOM helpers shared by the chrome modules. Text is always set with textContent (event text is untrusted).
export const $ = (id: string) => document.getElementById(id)!;
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
export function download(blob: Blob, name: string) {
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
