import { useLayoutEffect, useRef } from "preact/hooks";
import { Button } from "./Button.jsx";

// Focus goes in when it opens and back when it closes; Escape and the scrim close it.
function useModal(open, onClose) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!open) return;
    const before = document.activeElement;
    const el = ref.current;
    const first = el && el.querySelector("input, textarea, select, button:not(.aui-modal__close), [tabindex]");
    (first || el)?.focus({ preventScroll: true });
    const key = (e) => { if (e.key === "Escape") onClose && onClose(); };
    addEventListener("keydown", key);
    return () => { removeEventListener("keydown", key); before && before.focus && before.focus({ preventScroll: true }); };
  }, [open]);
  return ref;
}

// A sheet from the bottom edge (centred on wide windows). It rides above the keyboard and
// Amber's own things (--amber-inset-bottom); actions stay pinned to its bottom.
export function Sheet({ open, onClose, title, actions, children, class: cls = "" }) {
  const ref = useModal(open, onClose);
  if (!open) return null;
  return (
    <div class="aui-modal aui-modal--sheet">
      <div class="aui-scrim" onClick={onClose} />
      <div ref={ref} class={`aui-sheet ${cls}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header class="aui-sheet__header">
          <h2 class="aui-sheet__title">{title}</h2>
          <Button variant="plain" size="small" class="aui-modal__close" onClick={onClose}>Close</Button>
        </header>
        <div class="aui-sheet__body">{children}</div>
        {actions && <footer class="aui-sheet__actions">{actions}</footer>}
      </div>
    </div>
  );
}

// A small dialog in the middle: a question and its answers.
export function Dialog({ open, onClose, title, children, actions, class: cls = "" }) {
  const ref = useModal(open, onClose);
  if (!open) return null;
  return (
    <div class="aui-modal aui-modal--dialog">
      <div class="aui-scrim" onClick={onClose} />
      <div ref={ref} class={`aui-dialog ${cls}`} role="alertdialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <h2 class="aui-dialog__title">{title}</h2>
        {children && <div class="aui-dialog__body">{children}</div>}
        <footer class="aui-dialog__actions">{actions || <Button onClick={onClose}>OK</Button>}</footer>
      </div>
    </div>
  );
}
