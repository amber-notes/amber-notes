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
      ],
    }];
  },
};
export default config;
