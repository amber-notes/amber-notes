// The move from ambernotes.app to pintonotes.com (October 2026): every page on the old address
// sends people to the same path and query on the new one, permanently (308, so a form post stays a
// post). A few paths keep answering on the old address, because something already out in the world
// reads them there and doesn't follow redirects, or must stay on that host:
//
// - /.well-known/: Apple fetches the app-site-association file without following redirects.
// - /updates/ and /downloads/: the Sparkle feed and DMGs that installed Mac apps read.
// - /api/: what apps and scripts call.
// - /open/: the pages behind the universal links installed apps claim on ambernotes.app only.
// - /<32 hex>.txt: the IndexNow key, which Bing reads on the host a ping names. The old address
//   keeps it so its pages can be pinged too, and search engines see where they went.
//
// The project's first address, amber-notes.vercel.app, moves the same way and keeps the same paths:
// the first Mac builds read their updates there.
//
// www.pintonotes.com is the new address spelled another way, so all of it goes to pintonotes.com.
//
// mcp.ambernotes.app is another host and never moves (middleware.ts proxies it).
import { SITE_URL } from "./site";

export const OLD_HOSTS = ["ambernotes.app", "www.ambernotes.app", "amber-notes.vercel.app"];
export const WWW_HOST = "www.pintonotes.com";
const KEPT = /^\/(?:\.well-known\/|updates\/|downloads\/|api\/|open(?:\/|$)|[0-9a-f]{32}\.txt$)/;

/// Where a request to `url` on `host` goes now, or null when it stays.
export function movedTo(host: string, url: URL): string | null {
  if (host === WWW_HOST) return `${SITE_URL}${url.pathname}${url.search}`;
  if (!OLD_HOSTS.includes(host) || KEPT.test(url.pathname)) return null;
  return `${SITE_URL}${url.pathname}${url.search}`;
}
