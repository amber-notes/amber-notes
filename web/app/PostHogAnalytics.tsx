"use client";

import { useEffect } from "react";
import type { PostHog } from "posthog-js";
import { clickEvent, INTEREST_CLICKED, interestShown, newScrollMarks, posthogAllowed, posthogOptions, scrolledPercent, visitorOptedOut } from "@/lib/posthog";

let loading: Promise<PostHog | null> | undefined;

/// PostHog is fetched and started once, the first time a public page asks for it, and not at all
/// for a visitor who sends Do Not Track or Global Privacy Control.
function start(key: string, host: string): Promise<PostHog | null> {
  loading ??= visitorOptedOut(navigator as Navigator & { globalPrivacyControl?: boolean }, window as Window & { doNotTrack?: string | null })
    ? Promise.resolve(null)
    : import("posthog-js").then(({ default: posthog }) => posthog.init(key, posthogOptions(host)) ?? posthog).catch(() => null);
  return loading;
}

/// Website usage with PostHog (lib/posthog.ts). SiteAnalytics renders this only on public pages,
/// and only when the build has a key. Named clicks, scroll depth and "the platform ask was shown"
/// are sent from here; page views,
/// page leaves and other link and button clicks by PostHog itself.
export default function PostHogAnalytics({ apiKey, host, path }: { apiKey: string; host: string; path: string }) {
  useEffect(() => {
    let posthog: PostHog | null = null;
    let gone = false;
    const sent = new Set<number>();

    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest("a, button") : null;
      if (!posthog || !el || !posthogAllowed(window.location.pathname)) return;
      const named = clickEvent(el, new URL(window.location.href), document.documentElement.dataset);
      if (named) posthog.capture(named.event, named.properties, named.leaves ? { transport: "sendBeacon" } : { send_instantly: true });
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
      // Once per page view, when the page is asking this visitor whether they want Amber Notes on
      // their platform (not after they've said yes, and not where the ask is hidden).
      const asking = Array.from(document.querySelectorAll(`[data-event="${INTEREST_CLICKED}"]`)).some((el) => el.getClientRects().length > 0);
      const shown = interestShown(document.documentElement.dataset, asking, path);
      if (shown) ph.capture(shown.event, shown.properties);
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
