"use client";

import { Analytics } from "@vercel/analytics/next";
import { usePathname } from "next/navigation";
import PostHogAnalytics from "./PostHogAnalytics";
import { analyticsEvent } from "@/lib/analytics";
import { posthogAllowed, posthogSettings } from "@/lib/posthog";

/// Page views and referring sites, with Vercel Web Analytics: no cookies, nothing stored on the
/// visitor's device, nobody identified. lib/analytics.ts decides what's sent.
///
/// With a PostHog key in the build, public pages also send clicks and scroll depth to PostHog
/// (lib/posthog.ts). Shared notes, the connect pages, universal links, report pages and the
/// download redirect never load it.
export default function SiteAnalytics() {
  const path = usePathname();
  const posthog = posthogSettings({ key: process.env.NEXT_PUBLIC_POSTHOG_KEY, host: process.env.NEXT_PUBLIC_POSTHOG_HOST });
  return (
    <>
      <Analytics beforeSend={analyticsEvent} />
      {posthog && posthogAllowed(path) && <PostHogAnalytics apiKey={posthog.key} host={posthog.host} path={path} />}
    </>
  );
}
