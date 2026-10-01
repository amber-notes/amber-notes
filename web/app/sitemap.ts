import type { MetadataRoute } from "next";
import { changelog } from "@/lib/changelog";
import { categories, categoryPath, newestFirst, pageCount, pageOf, pagePath, published } from "@/lib/posts";
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
    // The index and each category, page by page: each page is its own canonical list of posts, and
    // its date is the newest change among the posts it shows.
    ...[{ base: "/blog", posts: newestFirst() }, ...categories().map((c) => ({ base: categoryPath(c), posts: newestFirst().filter((p) => p.category === c) }))]
      .flatMap(({ base, posts }) => Array.from({ length: pageCount(posts) }, (_, i) => {
        const shown = pageOf(posts, i + 1);
        return page(pagePath(base, i + 1), base === "/blog" && i === 0 ? 0.7 : 0.5, shown.map((p) => p.updated).sort().at(-1));
      })),
    ...published().map((p) => page(`/blog/${p.slug}`, 0.8, p.updated)),
    page("/changelog", 0.5, released),
    page("/privacy-security", 0.5),
    page("/privacy", 0.2),
    page("/terms", 0.2),
  ];
}
