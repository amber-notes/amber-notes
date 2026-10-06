"use client";

import { useEffect } from "react";
import type { PostHog } from "posthog-js";
import { clickEvent, newScrollMarks, posthogAllowed, scrolledPercent } from "@/lib/posthog";
import { startPostHog } from "./posthog-client";

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
      const named = clickEvent(el, new URL(window.location.href));
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

    startPostHog(apiKey, host).then((ph) => {
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
