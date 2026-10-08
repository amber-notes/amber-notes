import { AUTHOR, newestFirst } from "./posts";
import { FEED_PATH, SITE_NAME, SITE_URL } from "./site";

/// The blog as an RSS 2.0 feed: every published post, newest first, with its search description.
/// Feed readers, and the search engines and AI crawlers that read feeds, learn of a new post here.

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/// Noon UTC on the post's day, so the date reads the same in every time zone.
const rfc822 = (iso: string) => new Date(`${iso}T12:00:00Z`).toUTCString();

export function feedXml(): string {
  const posts = newestFirst();
  const built = posts.map((p) => p.updated).sort().at(-1);
  const items = posts.map((p) => {
    const url = `${SITE_URL}/blog/${p.slug}`;
    return [
      "    <item>",
      `      <title>${escape(p.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${rfc822(p.date)}</pubDate>`,
      `      <dc:creator>${escape(AUTHOR.name)}</dc:creator>`,
      `      <category>${escape(p.category)}</category>`,
      `      <description>${escape(p.description)}</description>`,
      "    </item>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    `    <title>${SITE_NAME} blog</title>`,
    `    <link>${SITE_URL}/blog</link>`,
    `    <atom:link href="${SITE_URL}${FEED_PATH}" rel="self" type="application/rss+xml" />`,
    "    <description>Guides to connecting ChatGPT, Claude and Codex to your notes, Apple Notes how-tos, and fair comparisons.</description>",
    "    <language>en</language>",
    ...(built ? [`    <lastBuildDate>${rfc822(built)}</lastBuildDate>`] : []),
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
