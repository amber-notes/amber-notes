import type { NextConfig } from "next";
import { posthogSettings } from "./lib/posthog";

// Note content is sanitized; this is the second line. Next.js needs its own inline
// scripts, so scripts stay same-origin + inline, and everything else is pinned down:
// no plugins, no <base> tricks, no forms posting anywhere, no framing.
const csp = (connect: string) => [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Local development serves storage over http from the local Supabase stack.
  `img-src 'self' https: data:${process.env.NODE_ENV === "production" ? "" : " http://127.0.0.1:*"}`,
  "media-src 'self' https:",
  "font-src 'self'",
  `connect-src ${connect}`,
  "object-src 'none'",
  "base-uri 'none'",
  // Only the report form posts, and only to this site.
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// With a PostHog key in the build, public pages may also send website usage to PostHog
// (lib/posthog.ts). Its scripts are bundled with the site; only the capture endpoint is called.
const posthog = posthogSettings({ key: process.env.NEXT_PUBLIC_POSTHOG_KEY, host: process.env.NEXT_PUBLIC_POSTHOG_HOST });

const security = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Content-Security-Policy", value: csp(posthog ? `'self' ${new URL(posthog.host).origin}` : "'self'") },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

// ambernotes.app is the site's address. The old vercel.app address sends the site's own pages there
// (308, path kept). Everything installed apps and links out in the world reach it for stays put on
// both hosts: the appcast and downloads (Sparkle), shared notes and their report pages, and the
// privacy, terms and support pages the apps and the App Store link to. www goes to the apex at the
// domain level, in the Vercel project.
const OLD_HOST = "amber-notes.vercel.app";
const SITE = "https://ambernotes.app";
const MOVED = ["/", "/help", "/download", "/changelog", "/connect"];

// The connect pages (/connect, /open/connect) and /reset-password get their CSP, with a nonce, from middleware.ts.
const connectSecurity = security.filter((h) => h.key !== "Content-Security-Policy");

const config: NextConfig = {
  // The blog reads each post's source for its reading time (lib/blog.tsx). A server render (crawlers
  // get one) must find those files in the function bundle, or the post fails with ENOENT.
  outputFileTracingIncludes: { "/blog/*": ["./app/blog/**/page.tsx"] },
  poweredByHeader: false,
  // The MCP proxy (middleware.ts) forwards the query exactly as sent. Without this, req.url in
  // middleware has 127.0.0.1 and [::1] turned into "localhost", query included.
  skipMiddlewareUrlNormalize: true,
  async redirects() {
    return [
      ...MOVED.map((source) => ({
        source,
        has: [{ type: "host" as const, value: OLD_HOST }],
        destination: `${SITE}${source}`,
        permanent: true,
      })),
      // The guides became the blog on 30 September 2026.
      { source: "/guides", destination: "/blog", permanent: true },
      { source: "/guides/:slug", destination: "/blog/:slug", permanent: true },
      // Page 1 of the blog and of each category lives at the list's own address.
      { source: "/blog/page/1", destination: "/blog", permanent: true },
      { source: "/blog/category/:category/page/1", destination: "/blog/category/:category", permanent: true },
      // A link with "&" where its "?" should be (ambernotes.app/&utm_source=…) lands on /&…, a 404.
      { source: "/:junk(&.*)", destination: "/", permanent: true },
      // "Use template" and "Use this note" open Amber Notes from the template's or note's page
      // (lib/open-in-app.ts). Their universal links reach the app directly where it's installed; a
      // browser that visits one goes to that page, which tries the app as it loads.
      { source: "/open/template/:slug", destination: "/templates/:slug?open=1", permanent: true },
      { source: "/open/copy/:slug", destination: "/n/:slug?open=1", permanent: true },
      // A guessed address for the Obsidian MCP post (one visit on 5 October, no link of ours).
      { source: "/blog/obsidian-mcp-servers-compared", destination: "/blog/obsidian-mcp", permanent: true },
    ];
  },
  async rewrites() {
    return {
      // /templates/<slug>.json is the template's data (app/api/templates/[slug]), checked before the
      // template's page so the page's [slug] never sees the ".json".
      beforeFiles: [{ source: "/templates/:slug.json", destination: "/api/templates/:slug" }],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        // Shared notes (and everything else not listed) are private-by-link: never indexed.
        // The home page, download, privacy policy, terms and support pages may be indexed, and
        // robots.txt, the sitemap and llms.txt are for crawlers. So are the templates' pages; their
        // .json data isn't. Blog posts carry their own robots meta
        // (drafts say noindex). A new page for search is added here too.
        source: "/((?!privacy|terms|support|help|download|changelog|blog|templates(?!/[^/]+\\.json$)|connect$|open/connect$|reset-password$|\\.well-known/apple-app-site-association$|robots\\.txt$|sitemap\\.xml$|llms\\.txt$|llms-full\\.txt$).+)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, ...security],
      },
      { source: "/connect", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }, ...connectSecurity] },
      { source: "/reset-password", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }, ...connectSecurity] },
      { source: "/open/connect", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }, ...connectSecurity] },
      // Apple's servers fetch this for the app's universal links (https://ambernotes.app/open/…):
      // JSON, straight from ambernotes.app, no redirect. The file is public/.well-known/.
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }, { key: "Cache-Control", value: "public, max-age=3600" }, { key: "X-Content-Type-Options", value: "nosniff" }],
      },
      { source: "/", headers: security },
      { source: "/download", headers: security },
      { source: "/changelog", headers: security },
      { source: "/help", headers: security },
      { source: "/support", headers: security },
      { source: "/blog", headers: security },
      { source: "/blog/:slug", headers: security },
      // Sealed links and shared templates (prototype) show a note's page in a frame from the
      // user-content origin, never this one; everything else stays as strict as the rest.
      ...["/s/:id", "/t/:id"].map((source) => ({ source, headers: [...security.filter((h) => h.key !== "Content-Security-Policy"),
        { key: "Content-Security-Policy", value: csp("'self'") + `; frame-src ${process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN ?? "http://127.0.0.1:56481"}` }] })),
      { source: "/templates", headers: security },
      { source: "/templates/:slug", headers: security },
      // The template data the app fetches: public and read-only, so any origin may read it.
      {
        source: "/templates/:slug.json",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }, { key: "Cache-Control", value: "public, max-age=300, s-maxage=3600" }],
      },
    ];
  },
};
export default config;
