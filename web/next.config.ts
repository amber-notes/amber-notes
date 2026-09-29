import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      // Shared notes are never indexed; the privacy policy may be.
      source: "/((?!privacy).*)",
      headers: [
        // Shared notes are private-by-link: never indexed, never framed, never leak the URL onward.
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        // Note content is sanitized; this is the second line. Next.js needs its own inline
        // scripts, so scripts stay same-origin + inline, and everything else is pinned down:
        // no plugins, no <base> tricks, no forms posting anywhere, no framing.
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' https: data:",
            "media-src 'self' https:",
            "font-src 'self'",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'none'",
          ].join("; "),
        },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
      ],
    }];
  },
};
export default config;
