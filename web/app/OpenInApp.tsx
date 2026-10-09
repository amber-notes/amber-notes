"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OPEN_WAIT_MS, SITE_EVENT, openEvent, openRequested, validAppLink, withoutOpen } from "@/lib/open-in-app";
import type { SiteEvent } from "@/lib/posthog";
import { APP_STORE_LIVE, APP_STORE_URL } from "@/lib/site";
import { tryApp } from "./open/try-app";

const send = (e: SiteEvent | null) => { if (e) window.dispatchEvent(new CustomEvent(SITE_EVENT, { detail: e })); };

/// "Use template" or "Use this note" (lib/open-in-app.ts): a click opens Amber Notes from this page.
/// If the browser hasn't left for the app after about two seconds, a small sheet at the bottom of
/// the window offers the Mac app and another try. `href` is the universal link, kept for a copied
/// link and for a click without JavaScript; `app` is the app's own link, built from a checked slug.
/// With `auto`, the page also tries the app as it loads when its address asks (?open, from an old link).
export default function OpenInApp({ href, app, className, label, auto = false, children }: {
  href: string;
  app: string;
  className?: string;
  label?: string;
  auto?: boolean;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<"idle" | "trying" | "opened" | "fallback">("idle");
  const stop = useRef<(() => void) | undefined>(undefined);
  const link = useRef<HTMLAnchorElement>(null);

  const attempt = useCallback(() => {
    if (!validAppLink(app)) return;
    stop.current?.();
    setState("trying");
    stop.current = tryApp(app, OPEN_WAIT_MS, (opened) => {
      stop.current = undefined;
      setState(opened ? "opened" : "fallback");
      send(openEvent(app, opened ? "opened" : "not_found", window.location.pathname));
    });
  }, [app]);

  useEffect(() => {
    if (auto && openRequested(window.location.search)) {
      window.history.replaceState(window.history.state, "", withoutOpen(window.location.href));
      // After this render's other effects, so the page's analytics is listening.
      const path = window.location.pathname;
      window.setTimeout(() => send(openEvent(app, "link", path)), 0);
      attempt();
    }
    return () => stop.current?.();
  }, [auto, app, attempt]);

  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // A new tab or window gets the universal link, as before.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !validAppLink(app)) return;
    e.preventDefault();
    attempt();
  };

  const close = useCallback(() => {
    setState("idle");
    link.current?.focus();
  }, []);
  const retry = useCallback(() => {
    link.current?.focus();
    attempt();
  }, [attempt]);

  return (
    <>
      <a ref={link} className={className} href={href} aria-label={label} onClick={onClick} aria-busy={state === "trying" || undefined} data-opening={state === "trying" || undefined}>
        {children}
      </a>
      {state === "fallback" && createPortal(<OpenSheet onRetry={retry} onClose={close} />, document.body)}
    </>
  );
}

/// The sheet when Amber Notes didn't open: quiet, at the bottom of the window, never in the way of
/// the page. Escape or Close puts it away and focus goes back to the button.
function OpenSheet({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  const id = useId();
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div ref={sheet} className="open-sheet" role="dialog" aria-modal="false" aria-labelledby={id} tabIndex={-1}>
      <p className="open-sheet-title" id={id}>Didn&apos;t open?</p>
      <p className="open-sheet-text">Pinto Notes isn&apos;t on this device yet, or the browser didn&apos;t hand the link over.</p>
      <div className="open-sheet-actions">
        <a className="open-sheet-get" href="/download/mac"><AppleGlyph /> Get Pinto Notes for Mac</a>
        {APP_STORE_LIVE && <a className="open-sheet-iphone" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">Get it for iPhone</a>}
      </div>
      <p className="open-sheet-again">Already have it? <button type="button" onClick={onRetry}>Try again</button></p>
      <button type="button" className="open-sheet-close" aria-label="Close" onClick={onClose}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
      </button>
    </div>
  );
}

const AppleGlyph = () => <svg width="14" height="17" viewBox="0 0 15 18" aria-hidden="true" fill="currentColor"><path d="M12.3 9.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8C3.2 4.6 1.8 5.4 1 6.8c-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.7 2.3 2.8 2.3 1.1 0 1.6-.7 2.9-.7 1.4 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.3-3.8zM10.1 3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.6.9.1 1.9-.5 2.5-1.2z" /></svg>;
