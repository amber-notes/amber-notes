import type { NextConfig } from "next";

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

const security = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Content-Security-Policy", value: csp("'self'") },
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

// The consent page (/connect) gets its CSP, with a nonce, from middleware.ts.
const connectSecurity = security.filter((h) => h.key !== "Content-Security-Policy");

const config: NextConfig = {
  // The blog reads each post's source for its reading time (lib/blog.tsx). A server render (crawlers
  // get one) must find those files in the function bundle, or the post fails with ENOENT.
  outputFileTracingIncludes: { "/blog/*": ["./app/blog/**/page.tsx"] },
  poweredByHeader: false,
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
    ];
  },
  async headers() {
    return [
      {
        // Shared notes (and everything else not listed) are private-by-link: never indexed.
        // The home page, download, privacy policy, terms and support pages may be indexed, and
        // robots.txt, the sitemap and llms.txt are for crawlers. Blog posts carry their own robots meta
        // (drafts say noindex). A new page for search is added here too.
        source: "/((?!privacy|terms|support|help|download|changelog|blog|connect$|robots\\.txt$|sitemap\\.xml$|llms\\.txt$|llms-full\\.txt$).+)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, ...security],
      },
      { source: "/connect", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }, ...connectSecurity] },
      { source: "/", headers: security },
      { source: "/download", headers: security },
      { source: "/changelog", headers: security },
      { source: "/help", headers: security },
      { source: "/support", headers: security },
      { source: "/blog", headers: security },
      { source: "/blog/:slug", headers: security },
    ];
  },
};
export default config;
