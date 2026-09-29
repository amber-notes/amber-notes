import type { NextConfig } from "next";

// Note content is sanitized; this is the second line. Next.js needs its own inline
// scripts, so scripts stay same-origin + inline, and everything else is pinned down:
// no plugins, no <base> tricks, no forms posting anywhere, no framing.
const security = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // Local development serves storage over http from the local Supabase stack.
      `img-src 'self' https: data:${process.env.NODE_ENV === "production" ? "" : " http://127.0.0.1:*"}`,
      "media-src 'self' https:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      // Only the report form posts, and only to this site.
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

// ambernotes.app is the site's address. The old vercel.app address sends the site's own pages there
// (308, path kept). Everything installed apps and links out in the world reach it for stays put on
// both hosts: the appcast and downloads (Sparkle), shared notes and their report pages, and the
// privacy, terms and support pages the apps and the App Store link to. www goes to the apex at the
// domain level, in the Vercel project.
const OLD_HOST = "amber-notes.vercel.app";
const SITE = "https://ambernotes.app";
const MOVED = ["/", "/help", "/download", "/changelog"];

const config: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return MOVED.map((source) => ({
      source,
      has: [{ type: "host" as const, value: OLD_HOST }],
      destination: `${SITE}${source}`,
      permanent: true,
    }));
  },
  async headers() {
    return [
      {
        // Shared notes (and everything else not listed) are private-by-link: never indexed.
        // The home page, download, privacy policy, terms and support pages may be indexed.
        source: "/((?!privacy|terms|support|help|download|changelog).+)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, ...security],
      },
      { source: "/", headers: security },
      { source: "/download", headers: security },
      { source: "/changelog", headers: security },
      { source: "/help", headers: security },
      { source: "/support", headers: security },
    ];
  },
};
export default config;
