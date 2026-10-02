// What the website sends to Vercel Web Analytics (app/SiteAnalytics.tsx). Shared notes, the
// connect pages, report pages and universal links never load it (analyticsAllowed) and are never
// counted: their addresses are private links or sign-in steps. Everything else is sent as its page address only, with no query or
// fragment, so nothing a link carries reaches the counts.
const PRIVATE = /^\/(n|connect|open|report)(\/|$)/;

/// Whether Vercel Web Analytics, its loader script included, may load on this page.
export function analyticsAllowed(path: string | null | undefined): path is string {
  return typeof path === "string" && path.startsWith("/") && !PRIVATE.test(path);
}

/// The second line: a page view that still gets here from a private page is dropped.
export function analyticsEvent<T extends { url: string }>(event: T): T | null {
  try {
    const url = new URL(event.url);
    if (PRIVATE.test(url.pathname)) return null;
    return { ...event, url: url.origin + url.pathname };
  } catch {
    return null;
  }
}
