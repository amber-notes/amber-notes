"use client";

import { useEffect, useState } from "react";
import s from "./open.module.css";

/// Tries the app as the page loads and gives the page its state: "trying" for about 1.5 s, then
/// "opened" if the browser left for the app, or "fallback" if it didn't. Without JavaScript the
/// page shows the fallback. `href` is built on the server from a checked slug, never from anything
/// else in the address.
export default function OpenApp({ href, children }: { href: string; children: React.ReactNode }) {
  const [state, setState] = useState<"trying" | "opened" | "fallback">("fallback");
  useEffect(() => {
    if (!/^ambernotes:\/\/(template|copy)\/[A-Za-z0-9_-]{1,64}$/.test(href)) return;
    setState("trying");
    let left = false;
    const away = () => { if (document.visibilityState === "hidden" || !document.hasFocus()) left = true; };
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", away);
    window.addEventListener("pagehide", away);
    // Safari shows an "address is invalid" alert when a page itself goes to a scheme no app
    // handles, so there the attempt goes through a hidden frame; elsewhere the page navigates.
    const ua = navigator.userAgent;
    const safari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
    let frame: HTMLIFrameElement | undefined;
    if (safari) {
      frame = document.createElement("iframe");
      frame.style.display = "none";
      frame.src = href;
      document.body.appendChild(frame);
    } else window.location.href = href;
    const timer = window.setTimeout(() => setState(left ? "opened" : "fallback"), 1500);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", away);
      window.removeEventListener("pagehide", away);
      frame?.remove();
    };
  }, [href]);
  return <div className={s.page} data-state={state}>{children}</div>;
}
