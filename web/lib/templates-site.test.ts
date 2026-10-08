import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";
import sitemap from "../app/sitemap";
import { GET } from "../app/api/templates/[slug]/route";
import { llmsTxt } from "./llms";
import { renderNote } from "./render";
import { NotePage } from "./NotePage";
import { APP_STORE_LIVE, APP_TEMPLATES, SITE_URL } from "./site";
import Gallery from "../app/templates/page";
import TemplatePage from "../app/templates/[slug]/page";
import { copyableMarkdown } from "./shared";
import { themeFor, themeScript } from "./theme";
import { existsSync } from "node:fs";
import path from "node:path";
import { COVERS, coverPath } from "./template-covers";
import { instructions, templates } from "./templates";
import Card from "../app/templates/Card";
import { templateWork } from "./structured-data";

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
  const note = { title: "Packing", body: "Packing\n\nHi", updated_at: "2026-09-30T10:00:00Z", include_subnotes: true, is_sub: true, root_title: "Trip", subnotes: [] };
  const page = () => renderToStaticMarkup(NotePage({ slug: "abcdefghijklmnopqrstuvwx", note, files: {} }));

  it("has a Use this note button to the copy link, on sub-notes too", () => {
    const html = page();
    // Only once the app release that handles the link is out (APP_TEMPLATES).
    if (APP_TEMPLATES.live) expect(html).toMatch(/<a class="[^"]+" href="\/open\/copy\/abcdefghijklmnopqrstuvwx">Use this note<\/a>/);
    else expect(html).not.toContain("/open/copy/");
  });

  it("keeps the Report this page link, the way back to the note, and who shared it under the title", () => {
    const html = page();
    expect(html).toContain('<a href="/report/abcdefghijklmnopqrstuvwx">Report this page</a>');
    expect(html).toMatch(/<a class="[^"]+" href="\/n\/abcdefghijklmnopqrstuvwx"><span aria-hidden="true">‹<\/span> Trip<\/a>/);
    expect(html).toContain("Shared by ");
    expect(html).toContain("Edited 30 September 2026");
    expect(html.indexOf("Shared by ")).toBeGreaterThan(html.indexOf("<h1"));
  });

  it("mentions the app once, after the note", () => {
    const html = page();
    expect(html.match(/Get Pinto Notes/g)).toHaveLength(1);
    expect(html.indexOf("Get Pinto Notes")).toBeGreaterThan(html.indexOf('<article class="note">'));
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

  it("shows each category chip with its templates' colours, and no trial switches", () => {
    const html = gallery();
    const chips = html.slice(html.indexOf('aria-label="Category"'), html.indexOf("templates</p>"));
    // Three dots per category chip, in its templates' cover colours; none on "All".
    expect(chips.match(/<i style="background:#[0-9a-f]{6}"/g)).toHaveLength(12);
    expect(html).not.toContain("data-top");
  });

  it("has no numbered steps above the cards", () => {
    expect(gallery()).not.toContain("<ol");
  });

  it("makes every card one link that says what it opens", () => {
    const html = gallery();
    const cards = html.match(/<article class="[^"]*card[^"]*"[\s\S]*?<\/article>/g) ?? [];
    expect(cards).toHaveLength(templates().length);
    for (const [k, t] of templates().entries()) {
      const card = cards[k];
      // One link to the template's page, one to Amber Notes, and never a link inside a link.
      expect(card.match(/<a /g), t.slug).toHaveLength((APP_TEMPLATES.live ? 2 : 1) + (t.author ? 1 : 0));
      expect(card).toContain(`href="/templates/${t.slug}">${t.title.replace("&", "&amp;")}</a>`);
      if (APP_TEMPLATES.live) expect(card).toContain(`href="/open/template/${t.slug}" aria-label="Use template: ${t.title}">Use template`);
    }
  });

  it("credits a community template's author on its card, as its own link beside Use template", () => {
    const t = { ...templates()[0], author: "arnavtambe" };
    const card = renderToStaticMarkup(Card({ t }));
    expect(card).toContain('href="https://github.com/arnavtambe">by @arnavtambe</a>');
    expect(card.match(/<a /g)).toHaveLength(APP_TEMPLATES.live ? 3 : 2);
    expect(renderToStaticMarkup(Card({ t: templates()[0] }))).not.toContain("github.com");
    expect(templateWork(t).contributor).toEqual({ "@type": "Person", name: "@arnavtambe", url: "https://github.com/arnavtambe" });
    expect(templateWork(templates()[0]).contributor).toBeUndefined();
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

  it("has a share-card copy of every cover (the share renderer can't read WebP)", () => {
    for (const t of templates()) expect(existsSync(path.join(process.cwd(), "lib/og/template-covers", `${t.slug}.jpg`)), t.slug).toBe(true);
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

describe("once the app opens template links (APP_TEMPLATES)", () => {
  it.runIf(APP_TEMPLATES.live)("leads a template's page with Use template, then Copy the prompt", async () => {
    const html = renderToStaticMarkup(await TemplatePage(params("habit-tracker")));
    const use = html.indexOf('href="/open/template/habit-tracker"'), copy = html.indexOf(">Copy the prompt<");
    expect(use).toBeGreaterThan(0);
    expect(copy).toBeGreaterThan(use);
    expect(html).toContain("Use template</a>");
  });

  it("keeps template pages in search", async () => {
    const page = await import("../app/templates/[slug]/page");
    expect(JSON.stringify(await page.generateMetadata(params("habit-tracker")))).not.toContain('"index":false');
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

describe("Use template and Use this note in a browser", () => {
  it("sends an old link's visit back to the template's or note's page, which tries the app there", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({ source: "/open/template/:slug", destination: "/templates/:slug?open=1", permanent: true });
    expect(redirects).toContainEqual({ source: "/open/copy/:slug", destination: "/n/:slug?open=1", permanent: true });
  });

  it.runIf(APP_TEMPLATES.live)("keeps Use template the universal link, with nothing of the attempt in the page as served", async () => {
    const html = renderToStaticMarkup(await TemplatePage(params("habit-tracker")));
    // The button is still the universal link, for a copied link or a click without JavaScript.
    expect(html.match(/href="\/open\/template\/habit-tracker"/g)).toHaveLength(1);
    // Nothing about the attempt is in the page as served: the sheet only appears in the browser.
    expect(html).not.toContain("open-sheet");
    expect(html).not.toContain("ambernotes://");
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
