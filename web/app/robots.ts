import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { MAC_DOWNLOAD_PATH } from "@/lib/downloads";

// Crawlers may fetch everything. AI search and assistant crawlers are named so it's plain they're
// welcome: the blog and /llms.txt are written for them. Shared notes (/n/*) and report pages are kept out of search by their
// noindex header and meta tag, which a crawler can only see if it's allowed to fetch the page. The
// download counter (/download/mac) is off limits, so crawlers don't count as downloads.
export const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: MAC_DOWNLOAD_PATH },
      { userAgent: AI_CRAWLERS, allow: "/", disallow: MAC_DOWNLOAD_PATH },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
