import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";
import sitemap from "../app/sitemap";
import OpenTemplate from "../app/open/template/[slug]/page";
import OpenCopy from "../app/open/copy/[slug]/page";
import { GET } from "../app/api/templates/[slug]/route";
import { llmsTxt } from "./llms";
import { renderNote } from "./render";
import { NotePage } from "./NotePage";
import { APP_TEMPLATES, SITE_URL } from "./site";
import Gallery from "../app/templates/page";
import TemplatePage from "../app/templates/[slug]/page";
import { copyableMarkdown } from "./shared";
import { themeFor, themeScript } from "./theme";
import { existsSync } from "node:fs";
import path from "node:path";
import { COVERS, coverPath } from "./template-covers";
import { instructions, templates } from "./templates";

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("rendering a template like the app", () => {
  const md = "<!-- pane-table: Date=date; Walk=choice Yes|No; Mood=choice Good|Bad -->\n| Date | Walk | Mood |\n| --- | --- | --- |\n| 2026-09-28 | Yes | Good |\n| 2026-09-29 | No | Bad |\n";
  it("shows Yes/No columns as ticked and empty circles, keeping the answer for screen readers", () => {
    const html = renderNote(md, { files: {}, subNoteHref: () => null, typedTables: true });
    expect(html).toContain('<span class="yn yn-yes">Yes</span>');
    expect(html).toContain('<span class="yn yn-no">No</span>');
    expect(html).not.toContain("yn-good");
  });

  it("leaves share pages as they were unless asked", () => {
    expect(renderNote(md, { files: {}, subNoteHref: () => null })).not.toContain("yn");
  });

  it("tints the blocks on changed lines, and keeps checklist items checklists", () => {
    const html = renderNote("Intro\n\n- [ ] Old\n- [x] New\n", { files: {}, subNoteHref: () => null, changedLines: new Set([4]) });
    expect(html).toMatch(/<li class="task-list-item changed"><input type="checkbox" checked disabled>/);
    expect(html).not.toMatch(/<p class="changed">Intro/);
  });
});

describe("Use this note: what a copy keeps", () => {
  it("drops photos and files, and keeps sub-note names as text", () => {
    const id = "5b3e4d1c-3d9a-4e5c-9b2a-4c6d0e3f9a77";
    const body = `Packing\n\n- [ ] Passport\n\n![photo.jpg](pane-file:${id})\n[doc.pdf](pane-file:${id})\n\n[Hotel booking](pane-note:${id})\n`;
    expect(copyableMarkdown(body)).toBe("Packing\n\n- [ ] Passport\n\nHotel booking\n");
  });
});

describe("a shared page", () => {
  it("has a Use this note button to the copy link, on sub-notes too", () => {
    const note = { title: "Packing", body: "Packing\n\nHi", updated_at: "2026-09-30T10:00:00Z", include_subnotes: true, is_sub: true, root_title: "Trip", subnotes: [] };
    const html = renderToStaticMarkup(NotePage({ slug: "abcdefghijklmnopqrstuvwx", note, files: {} }));
    // Only once the app release that handles the link is out (APP_TEMPLATES).
    if (APP_TEMPLATES.live) expect(html).toContain('<a class="use-note" href="/open/copy/abcdefghijklmnopqrstuvwx">Use this note</a>');
    else expect(html).not.toContain("/open/copy/");
  });
});

describe("the gallery", () => {
  const gallery = () => renderToStaticMarkup(Gallery());

  it("filters by category in one row, without an audience filter", () => {
    const html = gallery();
    expect(html.match(/role="group"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Category"');
    expect(html).not.toContain("Who it&#x27;s for");
    expect(html).not.toContain(">Everyone<");
  });

  it("gives each category chip its colour, and no trial switches", () => {
    const html = gallery();
    const chips = html.slice(html.indexOf('aria-label="Category"'), html.indexOf("templates</p>"));
    expect(chips.match(/<button[^>]*data-ink="(dark|light)"[^>]*--fill:#[0-9a-f]{6}/g)).toHaveLength(4);
    expect(html).not.toContain("data-top");
  });

  it("has no numbered steps above the cards", () => {
    expect(gallery()).not.toContain("<ol");
  });

  it("makes every card one link that says what it opens", () => {
    const html = gallery();
    const cards = html.match(/<a class="[^"]*card[^"]*" href="\/templates\/[^"]+"[^>]*>/g) ?? [];
    expect(cards).toHaveLength(templates().length);
    expect(html.match(/>Use template</g)).toHaveLength(templates().length);
  });

  it("gives every card its own cover, with alt text, and lists them in the image sitemap", () => {
    const html = gallery();
    const listed = sitemap().find((e) => e.url.endsWith("/templates"))?.images ?? [];
    for (const t of templates()) {
      const cover = COVERS[t.slug];
      expect(cover, t.slug).toBeDefined();
      expect(cover.alt.length, t.slug).toBeGreaterThan(20);
      expect(existsSync(path.join(process.cwd(), "public", coverPath(t.slug))), t.slug).toBe(true);
      expect(html).toContain(`src="${coverPath(t.slug)}" alt="${cover.alt}"`);
      expect(listed).toContain(`${SITE_URL}${coverPath(t.slug)}`);
    }
    expect(new Set(templates().map((t) => COVERS[t.slug].ground)).size).toBe(templates().length);
  });
});

describe("a template's page", () => {
  const page = async (slug: string) => renderToStaticMarkup(await TemplatePage(params(slug)));

  it("opens on the filled example, with the AI's lines tinted", async () => {
    const html = await page("meeting-notes");
    const hero = html.slice(0, html.indexOf('id="prompt"'));
    expect(hero).toContain("30 September 2026");
    expect(hero).toContain('class="changed"');
  });

  it("has one Copy the prompt button and keeps every prompt in the page, folded away", async () => {
    for (const t of templates()) {
      const html = await page(t.slug);
      expect(html.match(/>Copy the prompt</g), t.slug).toHaveLength(1);
      expect(html).toContain("Show the full prompt");
      expect(html).not.toContain(">Tell your AI</h2>");
      const text = html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      for (const i of instructions(t)) expect(text, `${t.slug} ${i.client}`).toContain(i.prompt.slice(0, i.prompt.indexOf("```")).trimEnd());
    }
  });

  it("offers a choice of AI only where Claude Code gets its own prompt", async () => {
    expect(await page("meeting-notes")).not.toContain('role="radiogroup"');
    const standup = await page("daily-standup");
    expect(standup).toContain('role="radiogroup"');
    expect(standup).toContain(">ChatGPT or Claude<");
  });
});

describe("before the app opens template links (APP_TEMPLATES)", () => {
  it("names the release that adds them", () => expect(APP_TEMPLATES.version).toMatch(/^\d+\.\d+/));

  it.runIf(!APP_TEMPLATES.live)("offers the prompt and the markdown, never a link the installed app can't open", async () => {
    const page = renderToStaticMarkup(await TemplatePage(params("habit-tracker")));
    expect(page).toContain("Copy the prompt");
    expect(page).toContain("Copy the markdown");
    expect(page).not.toContain("/open/template/");
    expect(page).not.toContain("Use this template");
    const gallery = renderToStaticMarkup(Gallery());
    expect(gallery).not.toContain("Every shared note is a template too");
    expect(gallery).not.toContain("/open/");
  });
});

describe("the open pages", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("offers the app's scheme for a template, the download and the markdown", async () => {
    const html = renderToStaticMarkup(await OpenTemplate(params("habit-tracker")));
    expect(html).toContain('href="ambernotes://template/habit-tracker"');
    expect(html).toContain(">Open Amber Notes</a>");
    expect(html).toContain('href="/download"');
    expect(html).toContain("Copy the markdown");
    expect(html).toContain("Habit tracker\n\nOne row a day.");
  });

  it("offers the app's scheme for a shared note, with the copyable markdown", async () => {
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:9");
    vi.stubEnv("SUPABASE_ANON_KEY", "test");
    const fetch = vi.fn(async () => Response.json({ title: "Packing", body: "Packing\n\n- [ ] Passport\n", updated_at: "2026-09-30T10:00:00Z", include_subnotes: false, is_sub: false, root_title: "Packing", subnotes: [] }));
    vi.stubGlobal("fetch", fetch);
    vi.resetModules();
    const { default: Page } = await import("../app/open/copy/[slug]/page");
    const slug = "abcdefghijklmnopqrstuvwx";
    const html = renderToStaticMarkup(await Page(params(slug)));
    expect(html).toContain(`href="ambernotes://copy/${slug}"`);
    expect(html).toContain("- [ ] Passport");
    expect(html).toContain(`href="/n/${slug}"`);
  });

  it("never echoes a bad share slug, and calls nothing for it", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const html = renderToStaticMarkup(await OpenCopy(params(`"><script>alert(1)</script>`)));
    expect(html).not.toContain("alert");
    expect(html).not.toContain("ambernotes://");
    expect(html).toContain("isn&#x27;t shared anymore");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the template data and the site around it", () => {
  it("serves a template's data as JSON, and 404s anything else", async () => {
    const ok = await GET(new Request("http://x"), params("habit-tracker"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).slug).toBe("habit-tracker");
    expect((await GET(new Request("http://x"), params("nope"))).status).toBe(404);
  });

  it("routes /templates/<slug>.json to the data before the page sees it", async () => {
    const rw = (await nextConfig.rewrites!()) as { beforeFiles: { source: string; destination: string }[] };
    expect(rw.beforeFiles).toContainEqual({ source: "/templates/:slug.json", destination: "/api/templates/:slug" });
  });

  it("lets search index the template pages, but not their data", async () => {
    const rules = await nextConfig.headers!();
    const catchAll = new RegExp(`^${rules[0].source}$`);
    expect(catchAll.test("/templates")).toBe(false);
    expect(catchAll.test("/templates/habit-tracker")).toBe(false);
    expect(catchAll.test("/templates/habit-tracker.json")).toBe(true);
    expect(catchAll.test("/open/template/habit-tracker")).toBe(true);
    expect(catchAll.test("/open/copy/abc")).toBe(true);
  });

  it("lists every template in the sitemap and llms.txt", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain("https://ambernotes.app/templates");
    const txt = llmsTxt();
    for (const t of templates()) {
      expect(urls).toContain(`https://ambernotes.app/templates/${t.slug}`);
      expect(txt).toContain(`https://ambernotes.app/templates/${t.slug})`);
    }
  });

  it("gives the template and open pages the cream theme, the same before and after first paint", () => {
    for (const p of ["/templates", "/templates/habit-tracker", "/open/template/habit-tracker", "/open/copy/abc"]) {
      expect(themeFor(p)).toBe("cream");
      const html = { dataset: {} as Record<string, string> };
      new Function("location", "document", themeScript)({ pathname: p }, { documentElement: html });
      expect(html.dataset.theme, p).toBe("cream");
    }
    expect(themeFor("/n/abc")).toBeNull();
  });
});
