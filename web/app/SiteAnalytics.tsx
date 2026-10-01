"use client";

import { Analytics } from "@vercel/analytics/next";
import { analyticsEvent } from "@/lib/analytics";

/// Page views and referring sites, with Vercel Web Analytics: no cookies, nothing stored on the
/// visitor's device, nobody identified. lib/analytics.ts decides what's sent.
export default function SiteAnalytics() {
  return <Analytics beforeSend={analyticsEvent} />;
}
