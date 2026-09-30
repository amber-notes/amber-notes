import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { MCP_URL } from "./facts";
import { llmsFullTxt, llmsTxt } from "./llms";
import { categories, morePosts, posts, published } from "./posts";

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
    expect(urls.some((u) => u.includes("/guides"))).toBe(false);
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
    for (const p of posts) expect(txt.includes(`/blog/${p.slug})`)).toBe(!p.draft);
    expect(llmsFullTxt()).toContain("`edit_note` (write)");
  });
});

describe("the blog", () => {
  it("has a page for every post, and no folder under /blog that isn't a post", () => {
    for (const p of posts) expect(existsSync(new URL(`../app/blog/${p.slug}/page.tsx`, import.meta.url))).toBe(true);
    const folders = readdirSync(new URL("../app/blog", import.meta.url), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(folders.sort()).toEqual(posts.map((p) => p.slug).sort());
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

  it("gives every published post its own cover: a different ground and a different lead picture, from files that exist", () => {
    const pub = published();
    expect(new Set(pub.map((p) => p.cover.ground)).size).toBe(pub.length);
    expect(new Set(pub.map((p) => p.cover.layers[0].src)).size).toBe(pub.length);
    for (const p of posts) for (const l of p.cover.layers) expect(existsSync(new URL(`../public${l.src}`, import.meta.url)), l.src).toBe(true);
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

  it("only offers categories that have posts", () => {
    for (const c of categories()) expect(published().some((p) => p.category === c)).toBe(true);
  });
});

describe("site copy", () => {
  // Plain writing rules for the blog: no em dashes, and no device the app doesn't run on.
  const texts = [llmsFullTxt(), ...posts.map((p) => postSource(p.slug)), JSON.stringify(posts)];
  it("uses no em dashes", () => { for (const t of texts) expect(t).not.toContain("—"); });
  it("names only the devices the app runs on", () => { for (const t of texts) expect(t).not.toMatch(/ipad/i); });
});
