import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { MCP_URL } from "./facts";
import { postShots } from "./post-images";
import { DEFAULT_SHARE_IMAGE, pageMetadata } from "./site";
import { feedXml } from "./feed";
import { llmsFullTxt, llmsTxt } from "./llms";
import { PER_PAGE, categories, categoryAnchor, categoryPath, morePosts, newestFirst, pageCount, pageOf, pagePath, posts, published } from "./posts";

const INDEX_FOLDERS = ["page", "category", "feed.xml"];

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
    expect(urls).toContain("https://pintonotes.com/blog");
    expect(urls.some((u) => new URL(u).pathname.startsWith("/guides"))).toBe(false);
    for (const p of posts) expect(urls.includes(`https://pintonotes.com/blog/${p.slug}`)).toBe(!p.draft);
  });

  it("lists every capture a post shows in the image sitemap, each with alt text and a file", () => {
    const entries = sitemap();
    for (const p of published()) {
      const src = postSource(p.slug);
      // Every figure names its capture from SHOTS, so the sitemap can find it.
      expect([...src.matchAll(/<Figure\b/g)].length, p.slug).toBe([...src.matchAll(/<Figure\s+shot=\{SHOTS\.\w+\}/g)].length);
      const shots = postShots(p.slug);
      const images = entries.find((e) => e.url === `https://pintonotes.com/blog/${p.slug}`)?.images ?? [];
      expect(shots.length, p.slug).toBeGreaterThan(0);
      for (const s of shots) {
        expect(s, p.slug).toBeDefined();
        expect(images, p.slug).toContain(`https://pintonotes.com${s.src}`);
        expect(s.alt.trim(), s.src).not.toBe("");
        expect(existsSync(new URL(`../public${s.src}`, import.meta.url)), s.src).toBe(true);
      }
    }
  });

  it("gives every card picture short alt text", () => {
    for (const p of published()) {
      expect(p.thumb.alt.trim(), p.slug).not.toBe("");
      expect(p.thumb.alt.length, p.slug).toBeLessThanOrEqual(100);
    }
  });

  it("sends the old /guides addresses to the blog for good", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({ source: "/guides", destination: "/blog", permanent: true });
    expect(redirects).toContainEqual({ source: "/guides/:slug", destination: "/blog/:slug", permanent: true });
  });

  it("sends a stray-ampersand address to the home page for good, and nothing else", async () => {
    // The matcher Next.js itself compiles redirect sources with (it ships without types).
    const compiled = "next/dist/compiled/path-to-regexp";
    const { pathToRegexp } = (await import(compiled)) as { pathToRegexp: (source: string, keys: unknown[]) => RegExp };
    const redirect = (await nextConfig.redirects!()).find((r) => r.destination === "/" && !r.has);
    expect(redirect?.permanent).toBe(true);
    const re = pathToRegexp(redirect!.source, []);
    for (const path of ["/&", "/&amp;", "/&utm_source=x&utm_medium=y"]) expect(re.test(path), path).toBe(true);
    for (const path of ["/", "/blog", "/blog/a&b", "/n/x&y"]) expect(re.test(path), path).toBe(false);
  });

  it("writes /llms.txt with the one-line description, the MCP address and the published posts only", () => {
    const txt = llmsTxt();
    expect(txt.startsWith("# Pinto Notes\n\n> Pinto Notes is a free, open-source notes app for iPhone and Mac")).toBe(true);
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
    const searchTitle = (slug: string, title: string) => postSource(slug).match(/postMetadata\("[^"]+", \{\s*title: "([^"]+)"/)?.[1] ?? `${title} · Pinto Notes`;
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
    const urls = sitemap().map((e) => e.url.replace("https://pintonotes.com", ""));
    for (let i = 1; i <= pageCount(all); i++) expect(urls).toContain(pagePath("/blog", i));
    for (const c of categories()) expect(urls).toContain(categoryPath(c));
    expect(urls.some((u) => u.endsWith("/page/1"))).toBe(false);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("redirects /page/1 to the list's own address", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({ source: "/blog/page/1", destination: "/blog", permanent: true });
  });

  it("redirects a guessed post address that 404ed to the real post", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({ source: "/blog/obsidian-mcp-servers-compared", destination: "/blog/obsidian-mcp", permanent: true });
  });
});

describe("the rename from Amber Notes", () => {
  it("keeps the comparison's old address working, and links only to the new one", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({ source: "/blog/amber-notes-vs-apple-notes", destination: "/blog/pinto-notes-vs-apple-notes", permanent: true });
    expect(posts.some((p) => p.slug === "pinto-notes-vs-apple-notes")).toBe(true);
    for (const p of posts) expect(postSource(p.slug), p.slug).not.toContain("/blog/amber-notes-vs-apple-notes");
  });

  it("has a page for the old name that search may index, listed in the sitemap and /llms.txt", async () => {
    const page = await import("../app/amber-notes/page");
    expect(page.metadata.title).toBe("Amber Notes is now Pinto Notes");
    expect(page.metadata.alternates?.canonical).toBe("/amber-notes");
    expect(page.metadata.robots).toEqual({ index: true, follow: true });
    const description = String(page.metadata.description);
    expect(description.length).toBeGreaterThanOrEqual(70);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(sitemap().map((e) => e.url)).toContain("https://pintonotes.com/amber-notes");
    expect(llmsTxt()).toContain("https://pintonotes.com/amber-notes");
    // The catch-all noindex header leaves this page out, and only this page.
    const noindex = (await nextConfig.headers!()).find((h) => h.headers.some((x) => x.key === "X-Robots-Tag" && h.source.startsWith("/((?!")))!;
    const re = new RegExp(`^${noindex.source}$`);
    expect(re.test("/amber-notes")).toBe(false);
    expect(re.test("/amber-notes/x")).toBe(true);
    expect(re.test("/n/abc")).toBe(true);
  });
});

describe("the blog's feed", () => {
  it("lists every published post, newest first, at its address on pintonotes.com", () => {
    const xml = feedXml();
    const links = [...xml.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/g)].map((m) => m[1]);
    expect(links).toEqual(newestFirst().map((p) => `https://pintonotes.com/blog/${p.slug}`));
    for (const p of posts.filter((x) => x.draft)) expect(xml).not.toContain(`/blog/${p.slug}<`);
    expect(xml).toContain('<atom:link href="https://pintonotes.com/blog/feed.xml" rel="self" type="application/rss+xml" />');
    expect(xml).not.toContain("ambernotes.app");
  });

  it("escapes titles and descriptions, so the feed stays well-formed", () => {
    const xml = feedXml();
    expect(xml.replace(/&(?:amp|lt|gt|quot);/g, "")).not.toContain("&");
    for (const body of xml.matchAll(/<(?:title|description)>([^<]*)<\/(?:title|description)>/g)) expect(body[1]).not.toMatch(/[<>]/);
  });

  it("is named on every page, so feed readers find it", () => {
    const m = pageMetadata({ title: "x", description: "y", path: "/z" });
    expect(m.alternates?.types).toEqual({ "application/rss+xml": [{ url: "/blog/feed.xml", title: "Pinto Notes blog" }] });
  });
});

describe("share images", () => {
  it("gives every published post its own share card, and every other page the site's", async () => {
    const { postMetadata } = await import("./PostPage");
    const route = await import("../app/og/blog/[slug]/route");
    expect(route.generateStaticParams()).toEqual(published().map((p) => ({ slug: p.slug })));
    for (const p of posts) {
      const m = postMetadata(p.slug);
      const og = (m.openGraph as { images: { url: string }[] }).images[0].url;
      const tw = (m.twitter as { images: { url: string }[] }).images[0].url;
      expect(og, p.slug).toBe(p.draft ? DEFAULT_SHARE_IMAGE.url : `/og/blog/${p.slug}`);
      expect(tw, p.slug).toBe(og);
    }
    // Pages with a card of their own keep it.
    for (const page of ["help", "download"]) {
      const src = readFileSync(new URL(`../app/${page}/page.tsx`, import.meta.url), "utf8");
      expect(src, page).toContain(`url: "/${page}/opengraph-image"`);
    }
    const index = pageMetadata({ title: "x", description: "y", path: "/z" });
    expect((index.openGraph as { images: { url: string }[] }).images[0].url).toBe(DEFAULT_SHARE_IMAGE.url);
  });

  it("has a JPEG copy of every published post's cover for its share card", () => {
    for (const p of published()) {
      const name = p.thumb.src.replace(/^\/blog\//, "").replace(/\.webp$/, "");
      expect(existsSync(new URL(`./og/covers/${name}.jpg`, import.meta.url)), name).toBe(true);
    }
  });
});

describe("site copy", () => {
  // Plain writing rules for the blog: no em dashes, and no device the app doesn't run on.
  const texts = [llmsFullTxt(), ...posts.map((p) => postSource(p.slug)), JSON.stringify(posts)];
  it("uses no em dashes", () => { for (const t of texts) expect(t).not.toContain("—"); });
  it("names only the devices the app runs on", () => { for (const t of texts) expect(t).not.toMatch(/ipad/i); });
});
