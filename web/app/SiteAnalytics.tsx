"use client";

import { Analytics } from "@vercel/analytics/next";

/// Anonymous, cookieless visit counts (Vercel Web Analytics). Shared notes, the connect page and
/// report pages are never counted: their addresses are private links or sign-in steps.
const PRIVATE = /^\/(n|connect|report)(\/|$)/;

export default function SiteAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        try {
          return PRIVATE.test(new URL(event.url).pathname) ? null : event;
        } catch {
          return null;
        }
      }}
    />
  );
}
