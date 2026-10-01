import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { MCP_URL } from "./facts";
import { llmsFullTxt, llmsTxt } from "./llms";
import { PER_PAGE, categories, categoryAnchor, categoryPath, morePosts, newestFirst, pageCount, pageOf, pagePath, posts, published } from "./posts";

const INDEX_FOLDERS = ["page", "category"];

const postSource = (slug: string) => readFileSync(new URL(`../app/blog/${slug}/page.tsx`, import.meta.url), "utf8");

describe("search and AI crawlers", () => {
  it("lets the AI search and assistant crawlers in by name", () => {
    const agents = (robots().rules as { userAgent?: string | string[] }[]).flatMap((r) => r.userAgent ?? []);
    for (const bot of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "PerplexityBot", "Google-Extended"]) {
      expect(agents).toContain(bot);
    }
  });

  it("lists published posts in the sitemap, and never drafts", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain("https://ambernotes.app/blog");
    expect(urls.some((u) => new URL(u).pathname.startsWith("/guides"))).toBe(false);
    for (const p of posts) expect(urls.includes(`https://ambernotes.app/blog/${p.slug}`)).toBe(!p.draft);
  });

  it("sends the old /guides addresses to the blog for good", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({ source: "/guides", destination: "/blog", permanent: true });
    expect(redirects).toContainEqual({ source: "/guides/:slug", destination: "/blog/:slug", permanent: true });
  });

  it("writes /llms.txt with the one-line description, the MCP address and the published posts only", () => {
    const txt = llmsTxt();
    expect(txt.startsWith("# Amber Notes\n\n> Amber Notes is a free, open-source notes app for iPhone and Mac")).toBe(true);
    expect(txt).toContain(MCP_URL);
    expect(txt).toContain("Incredible");
    expect(txt).toContain("https://emilwagman.com");
    for (const p of posts) expect(txt.includes(`/blog/${p.slug})`)).toBe(!p.draft);
    expect(llmsFullTxt()).toContain("`edit_note` (destructive)");
  });
});

describe("the blog", () => {
  it("has a page for every post, and no folder under /blog that isn't a post or the index's pages", () => {
    for (const p of posts) expect(existsSync(new URL(`../app/blog/${p.slug}/page.tsx`, import.meta.url))).toBe(true);
    const folders = readdirSync(new URL("../app/blog", import.meta.url), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(folders.sort()).toEqual([...posts.map((p) => p.slug), ...INDEX_FOLDERS].sort());
    // A post can never take the index's addresses.
    for (const f of INDEX_FOLDERS) expect(posts.some((p) => p.slug === f)).toBe(false);
  });

  it("takes each post's metadata from its entry, so drafts are noindex", () => {
    for (const p of posts) expect(postSource(p.slug)).toMatch(new RegExp(`postMetadata\\("${p.slug}"`));
  });

  it("gives every post a real capture that exists, with alt text and its size", () => {
    for (const p of posts) {
      expect(existsSync(new URL(`../public${p.image.src}`, import.meta.url))).toBe(true);
      expect(p.image.alt.length).toBeGreaterThan(20);
      expect(p.image.width * p.image.height).toBeGreaterThan(0);
    }
  });

  it("gives every published post its own card picture: a different ground and capture, from files that exist", () => {
    const pub = published();
    expect(new Set(pub.map((p) => p.thumb.ground)).size).toBe(pub.length);
    expect(new Set(pub.map((p) => p.thumb.src)).size).toBe(pub.length);
    for (const p of posts) expect(existsSync(new URL(`../public${p.thumb.src}`, import.meta.url)), p.thumb.src).toBe(true);
  });

  it("crops card pictures sharp enough for 2x screens (at least 640 px wide for a card about 330 px wide)", () => {
    for (const p of published()) expect(p.thumb.width, p.slug).toBeGreaterThanOrEqual(640);
  });

  it("links every published post to two to six other posts in its text, and never to a draft", () => {
    const drafts = posts.filter((p) => p.draft).map((p) => p.slug);
    for (const p of published()) {
      const linked = new Set([...postSource(p.slug).matchAll(/href="\/blog\/([a-z0-9-]+)"/g)].map((m) => m[1]).filter((s) => s !== p.slug));
      expect(linked.size, p.slug).toBeGreaterThanOrEqual(2);
      expect(linked.size, p.slug).toBeLessThanOrEqual(6);
      for (const d of drafts) expect(linked.has(d), `${p.slug} links draft ${d}`).toBe(false);
    }
  });

  it("offers two more posts to read, never the post itself or a draft", () => {
    for (const p of published()) {
      const more = morePosts(p.slug);
      expect(more).toHaveLength(2);
      expect(more.every((m) => m.slug !== p.slug && !m.draft)).toBe(true);
    }
  });

  it("gives every published post a unique search title of at most 60 characters and a unique description of 70 to 160", () => {
    const pub = published();
    const searchTitle = (slug: string, title: string) => postSource(slug).match(/postMetadata\("[^"]+", \{\s*title: "([^"]+)"/)?.[1] ?? `${title} · Amber Notes`;
    const titles = pub.map((p) => searchTitle(p.slug, p.title));
    for (const [i, t] of titles.entries()) expect(t.length, pub[i].slug).toBeLessThanOrEqual(60);
    for (const p of pub) {
      expect(p.description.length, p.slug).toBeLessThanOrEqual(160);
      expect(p.description.length, p.slug).toBeGreaterThanOrEqual(70);
      expect(p.updated >= p.date, p.slug).toBe(true);
    }
    expect(new Set(titles).size).toBe(pub.length);
    expect(new Set(pub.map((p) => p.description)).size).toBe(pub.length);
  });

  it("never asks the same FAQ question on two posts or on the help page", () => {
    const seen = new Map<string, string>();
    const sources = [...published().map((p) => [p.slug, postSource(p.slug)] as const), ["help", readFileSync(new URL("../app/help/questions.ts", import.meta.url), "utf8")] as const];
    for (const [where, src] of sources) {
      for (const m of src.matchAll(/\bq: "([^"]+)"/g)) {
        const q = m[1].toLowerCase().replace(/[?.]$/, "");
        expect(seen.get(q), `"${m[1]}" on ${where}`).toBeUndefined();
        seen.set(q, where);
      }
    }
  });

  it("only offers categories that have posts", () => {
    for (const c of categories()) expect(published().some((p) => p.category === c)).toBe(true);
  });
});

describe("blog pages", () => {
  const all = newestFirst();

  it("puts the newest post first, and every post on exactly one page", () => {
    const dates = all.map((p) => p.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(pageOf(all, 1)[0].date).toBe(dates[0]);
    const shown = Array.from({ length: pageCount(all) }, (_, i) => pageOf(all, i + 1)).flat().map((p) => p.slug);
    expect(shown.sort()).toEqual(published().map((p) => p.slug).sort());
  });

  it("fills every page but the last, and never makes an empty one", () => {
    const n = pageCount(all);
    expect(n).toBe(Math.ceil(all.length / PER_PAGE));
    for (let i = 1; i < n; i++) expect(pageOf(all, i)).toHaveLength(PER_PAGE);
    expect(pageOf(all, n).length).toBeGreaterThan(0);
    expect(pageOf(all, n + 1)).toHaveLength(0);
    expect(pageCount([])).toBe(1);
  });

  it("keeps page 1 at the list's own address", () => {
    expect(pagePath("/blog", 1)).toBe("/blog");
    expect(pagePath("/blog", 2)).toBe("/blog/page/2");
    expect(pagePath("/blog/category/guides", 3)).toBe("/blog/category/guides/page/3");
  });

  it("builds a static page for every page after the first, and a page for every category", async () => {
    const index = await import("../app/blog/page/[n]/page");
    expect(index.generateStaticParams()).toEqual(Array.from({ length: pageCount(all) - 1 }, (_, i) => ({ n: String(i + 2) })));
    const cat = await import("../app/blog/category/[category]/page");
    expect(cat.generateStaticParams()).toEqual(categories().map((c) => ({ category: categoryAnchor(c) })));
  });

  it("lists every page of the index and of each category in the sitemap, and never /page/1", () => {
    const urls = sitemap().map((e) => e.url.replace("https://ambernotes.app", ""));
    for (let i = 1; i <= pageCount(all); i++) expect(urls).toContain(pagePath("/blog", i));
    for (const c of categories()) expect(urls).toContain(categoryPath(c));
    expect(urls.some((u) => u.endsWith("/page/1"))).toBe(false);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("redirects /page/1 to the list's own address", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({ source: "/blog/page/1", destination: "/blog", permanent: true });
  });
});

describe("site copy", () => {
  // Plain writing rules for the blog: no em dashes, and no device the app doesn't run on.
  const texts = [llmsFullTxt(), ...posts.map((p) => postSource(p.slug)), JSON.stringify(posts)];
  it("uses no em dashes", () => { for (const t of texts) expect(t).not.toContain("—"); });
  it("names only the devices the app runs on", () => { for (const t of texts) expect(t).not.toMatch(/ipad/i); });
});
