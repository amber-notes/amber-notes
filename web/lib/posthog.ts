import type { CaptureResult, PostHogConfig } from "posthog-js";

// Website usage with PostHog (app/PostHogAnalytics.tsx): page views, clicks on links and buttons,
// and how far a page is scrolled. On the marketing pages only (heatmapsAllowed), also where on the
// page clicks land, and rage and dead clicks, counted into heatmaps; never a recording of a visit. Only when NEXT_PUBLIC_POSTHOG_KEY is set at build time; without
// it nothing loads. Never in the apps, and never on a page that can show something private: shared
// notes, the connect pages, universal links, report pages and the download redirect. No cookies,
// nothing kept in the browser, no person profiles, no recordings; visits are told apart for a day
// only, by a hash made on PostHog's servers. Everything here is decided
// without PostHog loaded, so the tests can check it.

export const POSTHOG_DEFAULT_HOST = "https://eu.i.posthog.com";

const PRIVATE = /^\/(?:n|open|report|reset-password|account|unsubscribe|copy|go)(?:\/|$)|^\/connect|^\/download\/mac(?:\/|$)/;

/// The marketing pages, the only ones where click positions, rage clicks and dead clicks are kept:
/// home, download, the templates and each template, the blog and its posts, help, the changelog and
/// Privacy & Security.
const MARKETING = /^\/(?:|download|templates(?:\/[^/]+)?|blog(?:\/.+)?|help|changelog|privacy-security)\/?$/;

/// Whether heatmap, rage-click and dead-click data may be kept for this page.
export function heatmapsAllowed(path: string | null | undefined): path is string {
  return posthogAllowed(path) && MARKETING.test(path);
}

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
    // Nothing stored on the visitor's device. PostHog's servers tell visits apart for a day with a
    // hash of the connection details and a salt that changes daily (cookieless server hash mode,
    // turned on in the project's settings); without that setting the events are dropped.
    cookieless_mode: "always",
    persistence: "memory",
    person_profiles: "never",
    respect_dnt: true,
    capture_pageview: "history_change",
    // $pageleave carries $prev_pageview_max_scroll_percentage, as does the next $pageview.
    capture_pageleave: true,
    autocapture: { dom_event_allowlist: ["click"], element_allowlist: ["a", "button"], capture_copied_text: false },
    // Heatmaps of where clicks land, and clicks that were repeated in one spot or did nothing, kept
    // only on the marketing pages (sanitizeEvent). Counted into maps of each page; no recording.
    rageclick: true,
    capture_dead_clicks: true,
    capture_heatmaps: true,
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

// The events that say where on a page something was clicked.
const HEATMAP_EVENTS = new Set(["$$heatmap", "$rageclick", "$dead_click"]);
// Of what PostHog's heatmaps collect, clicks only: no pointer movement.
const HEATMAP_KINDS = new Set(["click", "rageclick", "deadclick"]);

/// The last word on every event: nothing from a private page, no click positions from a page that
/// isn't a marketing page, page addresses without a query or fragment, and nothing about a person.
export function sanitizeEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return null;
  const props = { ...event.properties };
  const here = typeof window === "undefined" ? undefined : window.location.pathname;
  const paths = [here, props.$pathname, pathOf(props.$current_url)].filter((p): p is string => p !== undefined);
  if (paths.some((path) => !posthogAllowed(path))) return null;
  if (HEATMAP_EVENTS.has(event.event) && event.event !== "$$heatmap" && !paths.every(heatmapsAllowed)) return null;
  if (event.event === "$$heatmap") {
    const data = heatmapData(props.$heatmap_data);
    if (!data) return null;
    props.$heatmap_data = data;
  }
  for (const [key, value] of Object.entries(props)) {
    if (URL_PROPERTY.test(key) && typeof value === "string") props[key] = withoutQuery(value);
  }
  const { $set: _set, $set_once: _once, ...rest } = event;
  return { ...rest, properties: props };
}

/// A heatmap batch, keyed by page address: only marketing pages, addresses without a query or
/// fragment, clicks only. Null when nothing is left.
function heatmapData(data: unknown): Record<string, unknown[]> | null {
  if (!data || typeof data !== "object") return null;
  const out: Record<string, unknown[]> = {};
  for (const [url, points] of Object.entries(data as Record<string, unknown>)) {
    const path = pathOf(url);
    if (!heatmapsAllowed(path) || !Array.isArray(points)) continue;
    const clicks = points.filter((p) => HEATMAP_KINDS.has((p as { type?: string })?.type ?? ""));
    if (!clicks.length) continue;
    const key = withoutQuery(url);
    out[key] = [...(out[key] ?? []), ...clicks];
  }
  return Object.keys(out).length ? out : null;
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

export type SiteEvent = { event: string; properties: Record<string, string>; leaves: boolean };

const OUTBOUND: [string, RegExp][] = [
  ["outbound_app_store_clicked", /^apps\.apple\.com$/],
  ["outbound_github_clicked", /(^|\.)github\.com$/],
  ["outbound_claude_clicked", /(^|\.)claude\.(ai|com)$/],
  ["outbound_chatgpt_clicked", /(^|\.)(chatgpt|openai)\.com$/],
];

/// The named event for a click on a link or button, or null for one we don't name. Only the page's
/// path and where the link goes are sent. `leaves` is true when the click takes the visitor off the
/// site, so the event goes out before the page unloads.
export function clickEvent(el: { tagName: string; getAttribute(name: string): string | null }, here: URL): SiteEvent | null {
  const path = here.pathname;
  const named = el.getAttribute("data-event");
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
