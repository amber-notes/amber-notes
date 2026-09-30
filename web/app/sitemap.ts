import type { MetadataRoute } from "next";
import { changelog } from "@/lib/changelog";
import { published } from "@/lib/posts";
import { SITE_URL } from "@/lib/site";

// The pages meant for search. Shared notes are never listed. The changelog is one page (its
// releases have no pages of their own), last changed with the newest release. Blog posts are listed
// once they're published, with the day they were last checked.
export default function sitemap(): MetadataRoute.Sitemap {
  const released = changelog()[0]?.date;
  const page = (path: string, priority: number, lastModified?: string): MetadataRoute.Sitemap[number] => ({
    url: `${SITE_URL}${path}`,
    ...(lastModified ? { lastModified } : {}),
    priority,
  });
  return [
    page("/", 1, released),
    page("/download", 0.9, released),
    page("/help", 0.7),
    page("/blog", 0.7, published().map((p) => p.updated).sort().at(-1)),
    ...published().map((p) => page(`/blog/${p.slug}`, 0.8, p.updated)),
    page("/changelog", 0.5, released),
    page("/privacy", 0.2),
    page("/terms", 0.2),
  ];
}
