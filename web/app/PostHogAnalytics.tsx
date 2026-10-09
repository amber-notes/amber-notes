"use client";

import { useEffect } from "react";
import type { PostHog } from "posthog-js";
import { SITE_EVENT } from "@/lib/open-in-app";
import { clickEvents, newScrollMarks, posthogAllowed, scrolledPercent, type SiteEvent } from "@/lib/posthog";
import { startPostHog } from "./posthog-client";

/// Website usage with PostHog (lib/posthog.ts). SiteAnalytics renders this only on public pages,
/// and only when the build has a key. Named clicks and scroll depth are sent from here; page views,
/// page leaves and other link and button clicks by PostHog itself. Events the page names itself, such
/// as whether Use template opened Amber Notes (app/OpenInApp.tsx), arrive as a window event.
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
    // Kept until PostHog has loaded: an old link's attempt is sent as the page loads.
    const early: SiteEvent[] = [];
    const capture = (named: SiteEvent) => posthog?.capture(named.event, named.properties, { send_instantly: true });
    const onSiteEvent = (e: Event) => {
      const named = (e as CustomEvent<SiteEvent>).detail;
      if (!named || !posthogAllowed(window.location.pathname)) return;
      if (posthog) capture(named);
      else early.push(named);
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

    window.addEventListener(SITE_EVENT, onSiteEvent);
    startPostHog(apiKey, host).then((ph) => {
      if (gone || !ph) return;
      posthog = ph;
      document.addEventListener("click", onClick, true);
      early.splice(0).forEach(capture);
      window.addEventListener("scroll", onScroll, { passive: true });
    });
    return () => {
      gone = true;
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(SITE_EVENT, onSiteEvent);
      window.removeEventListener("scroll", onScroll);
    };
  }, [apiKey, host, path]);
  return null;
}
