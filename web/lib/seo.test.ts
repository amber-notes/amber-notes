import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { MCP_URL } from "./facts";
import { guides, published } from "./guides";
import { llmsFullTxt, llmsTxt } from "./llms";

const guideSource = (slug: string) => readFileSync(new URL(`../app/guides/${slug}/page.tsx`, import.meta.url), "utf8");

describe("search and AI crawlers", () => {
  it("lets the AI search and assistant crawlers in by name", () => {
    const agents = robots().rules instanceof Array ? (robots().rules as { userAgent?: string | string[] }[]).flatMap((r) => r.userAgent ?? []) : [];
    for (const bot of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "PerplexityBot", "Google-Extended"]) {
      expect(agents).toContain(bot);
    }
  });

  it("lists published guides in the sitemap, and never drafts", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain("https://ambernotes.app/guides");
    for (const g of guides) expect(urls.includes(`https://ambernotes.app/guides/${g.slug}`)).toBe(!g.draft);
  });

  it("has a page for every guide, and a folder under /guides for no guide that isn't listed", () => {
    for (const g of guides) expect(existsSync(new URL(`../app/guides/${g.slug}/page.tsx`, import.meta.url))).toBe(true);
    const folders = readdirSync(new URL("../app/guides", import.meta.url), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(folders.sort()).toEqual(guides.map((g) => g.slug).sort());
  });

  it("takes each guide's metadata from its entry, so drafts are noindex", () => {
    for (const g of guides) expect(guideSource(g.slug)).toMatch(new RegExp(`guideMetadata\\("${g.slug}"`));
  });

  it("writes /llms.txt with the one-line description, the MCP address and the published guides only", () => {
    const txt = llmsTxt();
    expect(txt.startsWith("# Amber Notes\n\n> Amber Notes is a free, open-source notes app for iPhone and Mac")).toBe(true);
    expect(txt).toContain(MCP_URL);
    for (const g of guides) expect(txt.includes(`/guides/${g.slug})`)).toBe(!g.draft);
    expect(llmsFullTxt()).toContain("`edit_note` (write)");
    expect(published().length).toBeGreaterThan(3);
  });
});

describe("site copy", () => {
  // Plain writing rules for the pages this work added: no em dashes, and no device the app doesn't run on.
  const texts = [llmsFullTxt(), ...guides.map((g) => guideSource(g.slug)), JSON.stringify(guides)];
  it("uses no em dashes", () => { for (const t of texts) expect(t).not.toContain("—"); });
  it("names only the devices the app runs on", () => { for (const t of texts) expect(t).not.toMatch(/ipad/i); });
});
