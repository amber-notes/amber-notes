import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Crawlers may fetch everything. Shared notes (/n/*) and report pages are kept out of search by their
// noindex header and meta tag, which a crawler can only see if it's allowed to fetch the page.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
