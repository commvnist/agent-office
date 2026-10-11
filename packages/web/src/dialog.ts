// Focus management for the small popover dialogs (#162): focus in, Tab trap, Escape / outside click close, focus restored.
const FOCUSABLE = "button,input,select,textarea,a[href],[tabindex]:not([tabindex='-1'])";

/** Open dialogs, oldest first: only the newest (top layer) reacts to Escape, so one Esc never closes two. */
const stack: (() => void)[] = [];

export function modal(dlg: HTMLElement, trigger: HTMLElement, onOpen?: () => void, onClose?: () => void) {
  dlg.tabIndex = -1;
  const items = () => Array.from(dlg.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => !x.hasAttribute("disabled"));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (stack[stack.length - 1] !== close) return; // a dialog opened after this one is on top and gets the Esc
      e.preventDefault(); e.stopPropagation(); close(); return;
    }
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
  let back: HTMLElement | null = null;
  function open() {
    back = document.activeElement as HTMLElement | null;
    onOpen?.();
    dlg.hidden = false;
    stack.push(close);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    (items()[0] ?? dlg).focus({ preventScroll: true });
  }
  function close() {
    if (dlg.hidden) return;
    dlg.hidden = true;
    const at = stack.indexOf(close);
    if (at >= 0) stack.splice(at, 1);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onDown);
    onClose?.();
    (trigger.isConnected ? trigger : back)?.focus(); // a trigger that is not on the page (the palette's): back to where focus was
  }
  return { open, close, toggle: () => (dlg.hidden ? open() : close()) };
}
