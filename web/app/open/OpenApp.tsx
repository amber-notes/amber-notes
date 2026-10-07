"use client";

import { useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import s from "./open.module.css";
import { APP_SCHEME } from "@/lib/app-scheme";
import { tryApp } from "./try-app";

/// Tries the app as the page loads and gives the page its state: "trying" for about 1.5 s, then
/// "opened" if the browser left for the app, or "fallback" if it didn't. Without JavaScript the
/// page shows the fallback. `href` is built on the server from a checked slug, never from anything
/// else in the address.
/// The app links a page may try: a template or a shared note, or one of the places the
/// onboarding emails open (Pane/Model/AppPlace.swift).
export const APP_LINK = new RegExp(`^${APP_SCHEME}:\\/\\/((template|copy)\\/[A-Za-z0-9_-]{1,64}|connect-ai|import|history)$`);

export default function OpenApp({ href, children }: { href: string; children: React.ReactNode }) {
  const [state, setState] = useState<"trying" | "opened" | "fallback">("fallback");
  useEffect(() => {
    if (!APP_LINK.test(href)) return;
    setState("trying");
    return tryApp(href, 1500, (opened) => setState(opened ? "opened" : "fallback"));
  }, [href]);
  return <div className={`${ui.stage} ${ui.stageInSite} ${s.page}`} data-state={state}>{children}</div>;
}
