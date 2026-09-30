# Growth log

What was measured and what changed, to get more people to Amber Notes from search and from AI
assistants. Newest first. Research behind it: [seo-aeo-research-2026-09-30.md](seo-aeo-research-2026-09-30.md).

`docs/` had no README naming a folder for evidence, so this and the research live in `docs/Evidence/`.

## 30 September 2026: blog polish

- The index and posts now use the changelog and help pages' system: the same 760 px column, title scale, lede and spacing, and the help page's soft cards (20 px corners around an 8 px inset). Card text is smaller (19 px titles, 15 px excerpts, 13 px bylines).
- Every post has its own cover: a different ground (paper, soft, a warm tint, amber, leaf brown, the app's dark look, the home page's dunes) and a different composition of real captures (a detail with the "ChatGPT changed 5 lines · Undo" pill, iPhone App Store art, two overlapping windows, the import sheet with its progress bar, the dark Settings window, just the consent sheet). A test keeps grounds and lead pictures unique. The picture after each post's intro sits on that post's ground.
- Header: "Blog" next to Changelog and Help. Home: Apple Notes' icon on the import card.

## 30 September 2026: the guides became a blog

- Posts live at `/blog/<slug>`; `/guides` and `/guides/<slug>` answer 308 to them. The sitemap, /llms.txt and the footer ("Blog") use /blog.
- `web/lib/posts.ts` is the one list (was `lib/guides.ts`), now with a date, a category, an excerpt and a picture per post.
- Index: title, intro and category filters on the left; a two-column grid of cards (one on phones).
- Each post opens with the date and category, the title, Emil's byline and reading time, an intro, and a real capture of the app on the home page's desk. It has a share rail (X, LinkedIn, email; plain share links), a breadcrumb with BreadcrumbList JSON-LD, "More posts", and an "All posts" list. Every published post links two to six others in its text, and never a draft; a test checks it.
- Captures come from the app's own offscreen snapshot tests (`PaneTests/HIG`, plus a new `BlogSnapshots` for the Connect ChatGPT and Connect Claude guides), cropped so no local server address shows, in `web/public/blog/`. Emil's avatar is `web/public/emil-wagman.jpg`, from GitHub.
- Incredible (incredible.one) is named wherever the site lists the assistants, as connecting like any MCP client, and the maker `worksFor` Incredible in the JSON-LD.
- Help answers link the post that covers them.

## 30 September 2026: baseline and round 1

### Baseline

- `site:ambernotes.app` returns nothing: the site isn't indexed yet. Google Search Console is being set up.
- `/llms.txt` returned 404.
- `robots.txt` was the Next.js default (`User-Agent: *`, `Allow: /`).
- Only `/`, `/download`, `/help`, `/changelog`, `/privacy` and `/terms` could be indexed. Everything else
  got `X-Robots-Tag: noindex` from `next.config.ts`, which would also have hidden any new page.
- JSON-LD: SoftwareApplication, Person and WebSite on the home page; FAQPage on /help. No Organization.
- The name is shared with at least four other products (see the research).
- Three draft guides existed at /guides, noindex and unlinked.

### What changed (branch `site/growth`)

- **Guides published** (index, sitemap, footer link "Guides", Article JSON-LD, FAQPage where the page has real questions, a "checked against the app" date):
  - `/guides/connect-chatgpt-to-your-notes` (fixed against the app's own connect guide)
  - `/guides/move-from-apple-notes` (fixed against the import sheet)
  - `/guides/amber-notes-vs-apple-notes`
  - `/guides/claude-and-apple-notes` (new)
  - `/guides/notes-apps-with-mcp` (new)
  - `/guides/notes-in-claude-code-and-codex` (new)
  - `/guides/mcp-server` (new; the server address, sign-in and every tool)
- **Draft** (noindex, not listed): `/guides/chatgpt-and-apple-notes`. Which apps and plans ChatGPT's Work
  with Apps supports today couldn't be checked without a ChatGPT account.
- **/llms.txt and /llms-full.txt**: a plain description, the facts, the MCP connection, and the published guides; the full version adds the help answers and the tool list.
- **robots.txt** names GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, Claude-SearchBot, PerplexityBot, Perplexity-User, Google-Extended and Applebot-Extended as allowed.
- **Quotable facts**: one list in `web/lib/facts.ts`, shown on the home page ("Amber Notes in short"), in the help page's lede, and in /llms.txt. Two new help questions: "What is Amber Notes?" and "Can ChatGPT or Claude use my notes in Apple Notes?".
- **JSON-LD**: an Organization with `sameAs` the GitHub repository (and the App Store once `APP_STORE_LIVE` is on), used as publisher of the site, app and guides.
- **Tests**: robots names the AI crawlers; the sitemap lists published guides and never drafts; every guide has a page and takes its robots setting from `lib/guides.ts`; /llms.txt content; no em dashes, and no device the app doesn't run on, in the new copy; the MCP tool list on the site matches `supabase/functions/mcp/tools.ts`.

### Fact checks made

- Sync region: the privacy policy says Frankfurt, and `supabase projects list` shows the production project in "Central EU (Frankfurt)". The comparison table now says "on servers in Frankfurt, Germany (EU)".
- Menu names and steps checked in `Pane/`: File, Import from Apple Notes; the Keep Apple Notes folders and Also bring over pinned notes options; Already imported; Settings, Connect an AI; the consent sheet's Read and Edit / Read Only and Allow; Add to Claude Code; the Codex config lines; File, Show Version History.
- Corrected: Codex gets config lines, not a one-line command. The import doesn't bring images, attachments or locked notes. The iPhone app isn't out yet, so the move guide says so until `APP_STORE_LIVE` is on.

### To measure next

- Search Console: indexed pages, and impressions for the shortlist queries, weekly.
- Ask ChatGPT, Claude and Perplexity the shortlist questions once a month and note whether ambernotes.app is cited.
