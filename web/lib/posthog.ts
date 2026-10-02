import type { CaptureResult, PostHogConfig } from "posthog-js";

// Website usage with PostHog (app/PostHogAnalytics.tsx): page views, clicks on links and buttons,
// and how far a page is scrolled. Only when NEXT_PUBLIC_POSTHOG_KEY is set at build time; without
// it nothing loads. Never in the apps, and never on a page that can show something private: shared
// notes, the connect pages, universal links, report pages and the download redirect. No cookies,
// nothing kept in the browser, no person profiles, no recordings. Everything here is decided
// without PostHog loaded, so the tests can check it.

export const POSTHOG_DEFAULT_HOST = "https://eu.i.posthog.com";

const PRIVATE = /^\/(?:n|open|report)(?:\/|$)|^\/connect|^\/download\/mac(?:\/|$)/;

/// Whether PostHog may load, or send anything, on this page.
export function posthogAllowed(path: string | null | undefined): path is string {
  return typeof path === "string" && path.startsWith("/") && !PRIVATE.test(path);
}

/// The project key and host from the build's environment, or null when there's no key.
export function posthogSettings(env: { key?: string; host?: string }): { key: string; host: string } | null {
  const key = env.key?.trim();
  if (!key) return null;
  return { key, host: env.host?.trim() || POSTHOG_DEFAULT_HOST };
}

/// Do Not Track or Global Privacy Control: PostHog isn't even fetched.
export function visitorOptedOut(nav: { doNotTrack?: string | null; globalPrivacyControl?: boolean } | undefined, win?: { doNotTrack?: string | null }): boolean {
  const dnt = nav?.doNotTrack ?? win?.doNotTrack;
  return dnt === "1" || dnt === "yes" || nav?.globalPrivacyControl === true;
}

export function posthogOptions(host: string): Partial<PostHogConfig> {
  return {
    api_host: host,
    // Nothing stored on the visitor's device: a new anonymous id on every full page load.
    persistence: "memory",
    person_profiles: "never",
    respect_dnt: true,
    capture_pageview: "history_change",
    // $pageleave carries $prev_pageview_max_scroll_percentage, as does the next $pageview.
    capture_pageleave: true,
    autocapture: { dom_event_allowlist: ["click"], element_allowlist: ["a", "button"], capture_copied_text: false },
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_session_recording: true,
    session_recording: { maskAllInputs: true },
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    // No feature flags or remote config, and no scripts fetched from PostHog: the page talks to
    // the capture endpoint only.
    advanced_disable_flags: true,
    disable_external_dependency_loading: true,
    // Ad click ids (gclid, fbclid and the like) are masked in the page address.
    mask_personal_data_properties: true,
    before_send: sanitizeEvent,
  };
}

// $current_url, $referrer, $session_entry_url, $initial_referrer and the like.
const URL_PROPERTY = /(?:url|referrer)$/i;

/// The last word on every event: nothing from a private page, page addresses without a query or
/// fragment, and nothing about a person.
export function sanitizeEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return null;
  const props = { ...event.properties };
  const here = typeof window === "undefined" ? undefined : window.location.pathname;
  for (const path of [here, props.$pathname, pathOf(props.$current_url)]) {
    if (path !== undefined && !posthogAllowed(path)) return null;
  }
  for (const [key, value] of Object.entries(props)) {
    if (URL_PROPERTY.test(key) && typeof value === "string") props[key] = withoutQuery(value);
  }
  const { $set: _set, $set_once: _once, ...rest } = event;
  return { ...rest, properties: props };
}

function pathOf(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try { return new URL(url).pathname; } catch { return "/"; }
}

function withoutQuery(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url === "$direct" ? url : "";
  }
}

/// How many visitors on Windows, Android or Linux want Amber Notes there (app/PlatformInterest.tsx):
/// the ask was on the page, and its button was clicked. Both carry the platform and the page only.
export const INTEREST_SHOWN = "platform_interest_shown";
export const INTEREST_CLICKED = "platform_interest_clicked";

/// <html>'s data-platform, and data-as when the site's owner is previewing another platform
/// (?as=windows, lib/platform.ts). A preview is never a visitor, so it counts nothing.
export type Visitor = { platform?: string; as?: string };

/// "The ask was on the page", once per page view: only while it's visible to a real visitor.
export function interestShown(visitor: Visitor, asking: boolean, path: string): SiteEvent | null {
  if (!asking || !visitor.platform || visitor.as) return null;
  return { event: INTEREST_SHOWN, properties: { platform: visitor.platform, path }, leaves: false };
}

export type SiteEvent = { event: string; properties: Record<string, string>; leaves: boolean };

const OUTBOUND: [string, RegExp][] = [
  ["outbound_app_store_clicked", /^apps\.apple\.com$/],
  ["outbound_github_clicked", /(^|\.)github\.com$/],
  ["outbound_claude_clicked", /(^|\.)claude\.(ai|com)$/],
  ["outbound_chatgpt_clicked", /(^|\.)(chatgpt|openai)\.com$/],
];

/// The named event for a click on a link or button, or null for one we don't name. Only the page's
/// path and where the link goes are sent. `leaves` is true when the click takes the visitor off the
/// site, so the event goes out before the page unloads. `visitor` is what lib/platform.ts put on
/// <html>; only the platform interest button sends the platform, and not in a preview.
export function clickEvent(el: { tagName: string; getAttribute(name: string): string | null }, here: URL, visitor: Visitor = {}): SiteEvent | null {
  const path = here.pathname;
  const named = el.getAttribute("data-event");
  if (named === INTEREST_CLICKED) return visitor.as || !visitor.platform ? null : { event: named, properties: { platform: visitor.platform, path }, leaves: false };
  if (named) return { event: named, properties: { path }, leaves: false };
  if (el.tagName.toLowerCase() !== "a") return null;
  const href = el.getAttribute("href");
  if (!href) return null;
  let to: URL;
  try { to = new URL(href, here); } catch { return null; }
  if (to.origin === here.origin) {
    // The step a landing-page-to-download funnel ends on.
    if (to.pathname === "/download/mac") return { event: "download_mac_clicked", properties: { path }, leaves: false };
    const template = /^\/open\/template\/([^/]+)$/.exec(to.pathname)?.[1];
    if (template) return { event: "use_template_clicked", properties: { path, template }, leaves: false };
    return null;
  }
  if (to.protocol !== "https:" && to.protocol !== "http:") return null;
  const match = OUTBOUND.find(([, host]) => host.test(to.hostname));
  if (!match) return null;
  return { event: match[0], properties: { path, destination: to.origin + to.pathname }, leaves: el.getAttribute("target") !== "_blank" };
}

export const SCROLL_MARKS = [25, 50, 75, 100] as const;

/// How far down the page the bottom of the window is, 0 to 100. A page that fits in the window
/// has nothing to scroll and reports null.
export function scrolledPercent(scrollY: number, viewport: number, height: number): number | null {
  if (height <= viewport) return null;
  return Math.min(100, Math.max(0, Math.round(((scrollY + viewport) / height) * 100)));
}

/// The marks this scroll reached that haven't been sent for this page yet.
export function newScrollMarks(percent: number | null, sent: ReadonlySet<number>): number[] {
  if (percent === null) return [];
  return SCROLL_MARKS.filter((mark) => percent >= mark && !sent.has(mark));
}
