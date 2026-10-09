"use client";

import { useLayoutEffect, useRef, useState } from "react";
import s from "./password-input.module.css";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { id: string; ref?: React.Ref<HTMLInputElement> };

/// A password input with an eye button at its end that shows or hides what is typed. Every password
/// field on the site is one of these (Field in lib/ui.tsx makes one for type="password"). Only the
/// input's type changes, between password and text, so a password manager sees the same field.
export function PasswordInput({ id, className, ref, tabIndex, ...rest }: Props) {
  const [shown, setShown] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const caret = useRef<[number | null, number | null] | null>(null);

  // A browser may drop the selection when the type changes: put the caret back where it was.
  useLayoutEffect(() => {
    const [start, end] = caret.current ?? [null, null];
    caret.current = null;
    if (start !== null && document.activeElement === input.current) input.current?.setSelectionRange(start, end);
  }, [shown]);

  function toggle() {
    const el = input.current;
    if (el && document.activeElement === el) caret.current = [el.selectionStart, el.selectionEnd];
    setShown((v) => !v);
  }

  function setInput(el: HTMLInputElement | null) {
    input.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  }

  return (
    <div className={s.box}>
      <input
        autoCapitalize="none" autoCorrect="off" spellCheck={false} {...rest}
        ref={setInput} id={id} tabIndex={tabIndex} type={shown ? "text" : "password"} className={className ? `${className} ${s.input}` : s.input}
      />
      {/* Taking the press before it moves focus keeps the keyboard and the caret in the field. */}
      <button
        type="button" className={s.eye} tabIndex={tabIndex} onClick={toggle} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
        aria-controls={id} aria-pressed={shown} aria-label={shown ? "Hide password" : "Show password"}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1.8 10S4.8 4.4 10 4.4 18.2 10 18.2 10 15.2 15.6 10 15.6 1.8 10 1.8 10Z" />
          <circle cx="10" cy="10" r="2.5" />
          {shown && <path d="M3.4 3.4 16.6 16.6" />}
        </svg>
      </button>
    </div>
  );
}
