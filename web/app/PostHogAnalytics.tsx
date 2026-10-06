"use client";

import { useEffect } from "react";
import type { PostHog } from "posthog-js";
import { clickEvents, newScrollMarks, posthogAllowed, posthogOptions, scrolledPercent, visitorOptedOut } from "@/lib/posthog";

let loading: Promise<PostHog | null> | undefined;

/// PostHog is fetched and started once, the first time a public page asks for it, and not at all
/// for a visitor who sends Do Not Track or Global Privacy Control.
function start(key: string, host: string): Promise<PostHog | null> {
  loading ??= visitorOptedOut(navigator as Navigator & { globalPrivacyControl?: boolean }, window as Window & { doNotTrack?: string | null })
    ? Promise.resolve(null)
    // Dead clicks are a PostHog extension it would otherwise fetch from its own servers; it comes
    // with the site instead, so the page still talks to the capture endpoint only.
    : import("posthog-js/dist/dead-clicks-autocapture")
      .then(() => import("posthog-js"))
      .then(({ default: posthog }) => posthog.init(key, posthogOptions(host)) ?? posthog).catch(() => null);
  return loading;
}

/// Website usage with PostHog (lib/posthog.ts). SiteAnalytics renders this only on public pages,
/// and only when the build has a key. Named clicks and scroll depth are sent from here; page views,
/// page leaves and other link and button clicks by PostHog itself.
export default function PostHogAnalytics({ apiKey, host, path }: { apiKey: string; host: string; path: string }) {
  useEffect(() => {
    let posthog: PostHog | null = null;
    let gone = false;
    const sent = new Set<number>();

    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest("a, button") : null;
      if (!posthog || !el || !posthogAllowed(window.location.pathname)) return;
      for (const named of clickEvents(el, new URL(window.location.href))) {
        posthog.capture(named.event, named.properties, named.leaves ? { transport: "sendBeacon" } : { send_instantly: true });
      }
    };
    // Measured on each scroll event, not in an animation frame: a background tab runs none.
    const onScroll = () => {
      if (!posthog || !posthogAllowed(window.location.pathname)) return;
      const doc = document.documentElement;
      for (const mark of newScrollMarks(scrolledPercent(window.scrollY, window.innerHeight, doc.scrollHeight), sent)) {
        sent.add(mark);
        posthog.capture("scroll_depth", { percent: mark, path });
      }
    };

    start(apiKey, host).then((ph) => {
      if (gone || !ph) return;
      posthog = ph;
      document.addEventListener("click", onClick, true);
      window.addEventListener("scroll", onScroll, { passive: true });
    });
    return () => {
      gone = true;
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", onScroll);
    };
  }, [apiKey, host, path]);
  return null;
}
