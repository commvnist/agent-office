// Focus management for the small popover dialogs (#162): focus in, Tab trap, Escape / outside click close, focus restored.
const FOCUSABLE = "button,input,select,textarea,a[href],[tabindex]:not([tabindex='-1'])";

export function modal(dlg: HTMLElement, trigger: HTMLElement, onOpen?: () => void) {
  dlg.tabIndex = -1;
  const items = () => Array.from(dlg.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => !x.hasAttribute("disabled"));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; } // top layer only: the Esc stops here
    if (e.key !== "Tab") return;
    const f = items();
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (e.shiftKey && (a === first || a === dlg)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  };
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!dlg.contains(t) && !trigger.contains(t)) close();
  };
  function open() {
    onOpen?.();
    dlg.hidden = false;
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    (items()[0] ?? dlg).focus({ preventScroll: true });
  }
  function close() {
    if (dlg.hidden) return;
    dlg.hidden = true;
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onDown);
    trigger.focus();
  }
  return { open, close, toggle: () => (dlg.hidden ? open() : close()) };
}
