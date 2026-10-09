"use client";

import { Analytics } from "@vercel/analytics/next";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import PostHogAnalytics from "./PostHogAnalytics";
import ConsentBanner from "./ConsentBanner";
import { analyticsAllowed, analyticsEvent } from "@/lib/analytics";
import { posthogAllowed, posthogSettings } from "@/lib/posthog";
import { replayOnPage } from "./posthog-client";

/// Page views and referring sites, with Vercel Web Analytics: no cookies, nothing stored on the
/// visitor's device, nobody identified. lib/analytics.ts decides what's sent. Shared notes, the
/// connect pages, universal links and report pages don't load it at all, not even its loader script.
///
/// With a PostHog key in the build, public pages also send clicks and scroll depth to PostHog
/// (lib/posthog.ts). Shared notes, the connect pages, universal links, report pages and the
/// download redirect never load it, and don't show its cookie banner (app/ConsentBanner.tsx). A
/// visitor who accepted is also recorded, on public pages only, with every field masked.
export default function SiteAnalytics() {
  const path = usePathname();
  const posthog = posthogSettings({ key: process.env.NEXT_PUBLIC_POSTHOG_KEY, host: process.env.NEXT_PUBLIC_POSTHOG_HOST });
  // Moving within the site doesn't reload PostHog, so a replay stops on the way into a private
  // page (the connect pages, password reset, a shared note) and starts again on the way out.
  useEffect(() => replayOnPage(path), [path]);
  return (
    <>
      {analyticsAllowed(path) && <Analytics beforeSend={analyticsEvent} />}
      {posthog && posthogAllowed(path) && <PostHogAnalytics apiKey={posthog.key} host={posthog.host} path={path} />}
      {posthog && posthogAllowed(path) && <ConsentBanner apiKey={posthog.key} host={posthog.host} />}
    </>
  );
}
