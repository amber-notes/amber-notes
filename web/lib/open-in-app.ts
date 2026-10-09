import type { SiteEvent } from "./posthog";

// "Use template" and "Use this note" open Amber Notes from the page they're on (app/OpenInApp.tsx).
// Their links are still the universal links (https://ambernotes.app/open/template/<slug>,
// /open/copy/<slug>), so a copied link or a click without JavaScript reaches the app the old way;
// the browser's own visit to one is sent back to the template's or note's page with ?open, which
// tries the app there (next.config.ts). Everything here is decided without a browser, for the tests.

/// The app links these buttons may try. Anything else is never handed to the browser.
const APP_LINK = /^ambernotes:\/\/(template|copy)\/([A-Za-z0-9_-]{1,64})$/;

export const validAppLink = (href: string) => APP_LINK.test(href);

/// How long the page waits for the browser to leave for Amber Notes before saying it didn't open.
export const OPEN_WAIT_MS = 2000;

/// The query that asks a template's or note's page to try the app as it loads.
export const OPEN_QUERY = "open";

export const openRequested = (search: string) => new URLSearchParams(search).has(OPEN_QUERY);

/// The address without ?open, so a reload or a shared copy of it doesn't try the app again.
export function withoutOpen(href: string): string {
  const u = new URL(href);
  u.searchParams.delete(OPEN_QUERY);
  return u.pathname + u.search + u.hash;
}

/// The window event the page's analytics (app/PostHogAnalytics.tsx) sends on to PostHog.
export const SITE_EVENT = "amber:site-event";

/// What a template's open attempt sends: the attempt from an old link (a click is counted by its
/// link, as use_template_clicked), then whether Amber Notes opened. Shared notes send nothing:
/// their pages never load analytics.
export function openEvent(app: string, step: "link" | "opened" | "not_found", path: string): SiteEvent | null {
  const m = APP_LINK.exec(app);
  if (!m || m[1] !== "template") return null;
  const template = m[2];
  if (step === "link") return { event: "use_template_clicked", properties: { path, template, source: "link" }, leaves: false };
  return { event: step === "opened" ? "use_template_opened" : "use_template_not_found", properties: { path, template }, leaves: false };
}
