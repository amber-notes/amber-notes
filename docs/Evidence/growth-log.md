# Growth log

What was measured and what changed, to get more people to Amber Notes from search and from AI
assistants. Newest first. Research behind it: [seo-aeo-research-2026-09-30.md](seo-aeo-research-2026-09-30.md).

`docs/` had no README naming a folder for evidence, so this and the research live in `docs/Evidence/`.

## 30 September 2026: round 9, ChatGPT after DevDay

### Query

- "chatgpt create mcp app missing", "chatgpt developer mode mcp", "chatgpt plugins mcp 2026". OpenAI's DevDay was on 29 September; a forum thread from 28 September asks why Create MCP App is missing.

### Changed (branch `site/chatgpt-devday`)

- `/blog/connect-chatgpt-to-your-notes`:
  - the steps now name Create MCP App, the connection field, and adding Amber Notes from the tools menu in a new chat, as OpenAI's Developer mode guide and Connect and test your plugin describe
  - "If Create MCP App isn't there": turn on Developer mode at chatgpt.com/settings/security. This fix is labelled as coming from a Pro user on OpenAI's forum (28 September), not from OpenAI; workspace policy can also turn Developer mode off
  - "What changed at DevDay 2026", from TechCrunch (29 September): plugin sidebar homes, panels, file viewers, Plugin Creator, directory submissions, per-plugin permissions, proposed MCP Events; no dates given, and none of it changes the setup
  - OpenAI's "elevated risk" warning, and how approval, Read Only and version history answer it
  - FAQ: a new "Why don't I see Create MCP App?" answer; the plans answer adds the workspace-policy caveat; the phone-app answer is now labelled unverified, since OpenAI's docs describe the web only
- Not checked: nothing here was tried in a ChatGPT Plus account, and the post says so.
## 30 September 2026: round 8, "Apple Notes in iOS 27"

### Query

- "apple notes ios 27", "apple notes new features", "apple notes section links", "apple notes divider line". iOS 27 and macOS 27 shipped on 14 September; the results are publisher roundups (9to5Mac 28 September, MacRumors, Geeky Gadgets). None of them says what ChatGPT and Claude can and can't do with Apple Notes now, which is the angle.

### Changed (branch `site/ios27-notes`)

- New post `/blog/apple-notes-ios-27`, "Apple Notes in iOS 27 and macOS 27: what's new, and what AI still can't do", in Apple Notes:
  - a table of the new features on iPhone and Mac, then divider lines, section links, Markdown paste and Copy as Markdown, the renamed File, Export To menu, and Siri AI searching notes
  - every step from Apple's own guides for iOS 27 and macOS 27 (Create and format notes, Add links in Notes, Format notes on Mac, Use Notes on your iPhone, Use Siri to get answers from ChatGPT), including Siri AI's limits: beta, English first, iPhone 15 Pro and later, not in the EU at first, daily limits
  - what AI still can't do: the ChatGPT extension (Settings, Siri) passes a request with content you choose; Claude isn't offered as an extension (MacRumors, 14 September); Apple MCP support hasn't shipped; Claude on iPhone and the web can't reach Apple Notes
  - four FAQ answers with FAQPage JSON-LD
- A new ground, wheat, and a card cropped from the Lisbon capture's Food heading and table.
- The Markdown export post links the new one.

## 30 September 2026: round 7, SEO plan and "Export Apple Notes to Markdown"

### Research

- [seo-plan.md](seo-plan.md): trend sources and how to check each, what's trending in late September (iOS 27 and macOS 27 shipped on 14 September with Markdown paste and Copy as Markdown in Notes; OpenAI DevDay on 29 September; the Claude Marketplace on 23 September; Gemini custom MCP apps), a 50-query keyword map in three clusters, gaps in every existing post, and a publishing order for 1 to 14 October.
- Google Trends answered 429 again, openai.com 403, and Reddit search was blocked; autocomplete stood in as the demand signal.

### Query

- "export apple notes to markdown" and "export all apple notes". Apple's own guides rank first but cover one note at a time and predate macOS 27's renamed menu; the bulk-export results are old or tool-led.

### Changed (branch `site/seo-plan`)

- New post `/blog/export-apple-notes-to-markdown`, "How to export Apple Notes to Markdown":
  - the steps on Mac (File, Export as, Markdown on macOS 26; File, Export To on macOS 27) and iPhone (Share, Export as Markdown, or View More first), from Apple's guides for both versions; Copy as Markdown and Markdown paste in iOS 27 and macOS 27
  - a table of what to check in the file, since Apple doesn't say what survives (checklists, tables, pictures, drawings, locked notes)
  - bulk export: Apple documents none, so two open-source exporters, checked against their READMEs (kzaremski/apple-notes-exporter, GPL; storizzi/notes-exporter, MIT)
  - Amber Notes' import as it really works: the notes you pick, in their folders, with checklists and tables; images, attachments and locked notes stay in Apple Notes
  - five FAQ answers with FAQPage JSON-LD
- Fact checks: menu names in the Notes app on this Mac (macOS 26.5.1: File, Export as, Markdown / PDF; Import Markdown), and its Shortcuts actions Create Note from Markdown and Append Markdown to Note, read from the app's own strings; Apple's Mac guide for macOS 26 and 27, and its iPhone guide.
- A new **Apple Notes** category in the blog filters, holding the Markdown export post, Can Claude read your Apple Notes, How to move from Apple Notes and Apple Notes API. A real hub page is proposed in the plan for when there are six such guides, since the blog's categories aren't pages.
- A new ground, blush, for the post's cover and first picture (every other ground was taken). The card shows the Welcome note's title and its "Write in markdown" line, cropped at 2x.
- Links in: Apple Notes API and How to move from Apple Notes now link the new post.

## 30 September 2026: round 6, "Obsidian MCP"

### Query

- "Obsidian MCP", "Obsidian MCP server" and "connect Obsidian to ChatGPT / Claude". Results are GitHub repositories, directory listings and older guides built on servers that the Local REST API plugin has since made unnecessary.

### Changed (branch `site/growth-6`)

- New post `/blog/obsidian-mcp`, "Obsidian MCP servers compared (2026)", in Comparisons:
  - how Obsidian works with AI (a vault is local Markdown; plugin-based vs file-based servers); no official MCP server, only Obsidian CLI (1.12)
  - a table of seven, each checked against its README, releases and GitHub page on 30 September: Local REST API with MCP (built-in server since 4.0, May 2026; 5.3.1), MarkusPfundstein/mcp-obsidian, cyanheads/obsidian-mcp-server, bitbonsai/mcpvault, StevenStavrakis/obsidian-mcp, Semantic Notes Vault MCP (aaronsb), and jacksteamdev/obsidian-mcp-tools (archived)
  - setup for the Local REST API plugin in Claude Code and Claude Desktop (through mcp-remote), with the certificate fallbacks from its README
  - the limits they share, and where Amber Notes fits: a different app, not a plugin, iPhone and Mac only, no Obsidian import
  - an FAQ with FAQPage JSON-LD
- Fact found while writing: the Local REST API plugin now ships its own MCP server and its README says third-party servers are no longer necessary, so it, not mcp-obsidian, is the recommendation.
- Card picture: the Places list and Hotel booking sub-note link from the Lisbon capture, on a new "heather" ground.
- Links in from apple-notes-vs-obsidian, mcp-server, notes-apps-with-mcp (dropped its connect-chatgpt-to-your-notes link to stay at six) and apple-notes-mcp (dropped notes-in-claude-code-and-codex to stay at six). The new post links those four.
- Sitemap, /llms.txt and "All posts" pick it up from `web/lib/posts.ts`.

### To measure

- Search Console: impressions and position for "obsidian mcp", "obsidian mcp server" and "obsidian claude mcp", weekly from when the page is indexed.
- Whether the page is indexed within a week of deploy (`site:ambernotes.app/blog/obsidian-mcp`).
- Ask ChatGPT, Claude and Perplexity "what's the best Obsidian MCP server?" once a month and note whether the post is cited.

## 30 September 2026: round 5, "Apple Notes MCP"

### Query

- "Apple Notes MCP" and "Apple Notes MCP server". Google shows only GitHub repositories and MCP directory listings; no guide compares them.

### Changed (branch `site/growth-5`)

- New post `/blog/apple-notes-mcp`, "Apple Notes MCP servers compared (2026)", in Comparisons:
  - a table of four servers (sweetrb/apple-notes-mcp, RafalWilinski/mcp-apple-notes, sirmews/apple-notes-mcp, supermemoryai/apple-mcp), each checked against its README and GitHub page on 30 September: how it reaches Notes, what the AI can do, setup, AI apps, and whether it's maintained or archived
  - setup for sweetrb's server in Claude Code and Claude Desktop
  - the limits they share, and where Amber Notes fits (remote server, approval, Undo and history, one-time import)
  - an FAQ with FAQPage JSON-LD
- Fact corrections made while writing: attachments are not unavailable everywhere (sweetrb's server lists, saves and adds them; the other three don't), and AppleScript can't tick a checklist item. sirmews (Python) and sweetrb (Node.js) both publish as `apple-notes-mcp`, which the post points out.
- Card picture: the Version History list from the Mac history capture, on a new "sage" ground.
- Links in from claude-and-apple-notes, apple-notes-api, mcp-server and notes-apps-with-mcp (which swapped its Claude and Apple Notes link for this one, to stay at six), and from the chatgpt-and-apple-notes draft. The new post can't link that draft until it's published.
- Sitemap, /llms.txt and "All posts" pick it up from `web/lib/posts.ts`.

### To measure

- Search Console: impressions and position for "apple notes mcp", "apple notes mcp server" and "apple notes mcp claude", weekly from when the page is indexed.
- Whether the page is indexed within a week of deploy (`site:ambernotes.app/blog/apple-notes-mcp`).
- Ask ChatGPT, Claude and Perplexity "what's the best Apple Notes MCP server?" once a month and note whether the post is cited.

## 30 September 2026 (late): round 4

### Measured

- `site:ambernotes.app`: still no pages from the site itself. The results are the repo's GitHub pull requests (#8, #20, #23, #25), then the name collisions (Google Play AmberNotes, app.ambernotes.eu, ambernotes.ai). The search summary now quotes the new repo description ("a free, open-source notes app for iPhone and Mac that ChatGPT and Claude can use (MCP)") and the blog's posts, through GitHub.
- `ambernotes.app blog`: again only GitHub pull requests plus the collisions.
- Reading: the site isn't crawled into this index yet, about 12 hours after Search Console verification. GitHub is carrying the brand in the meantime, and the new repo description is working.

### Changed (branch `site/growth-4`)

- Four posts:
  - `/blog/apple-notes-vs-notion`: a table, plus where each wins and where AI fits
  - `/blog/apple-notes-vs-obsidian`: fair about local files, plugins and every platform
  - `/blog/chatgpt-to-do-list-on-iphone`: a checklist note, prompts, the tools behind them, and sharing
  - `/blog/work-log-with-claude-code`: a CLAUDE.md block, the standup, a daily log and the tracker
- Each post has an FAQ with FAQPage JSON-LD.
- New real captures:
  - a Mac "Standup notes" note just after a Claude Code edit, from a new offscreen snapshot test
  - the Mac Lisbon note
  - an iPhone "Trip documents" note in dark mode, and the iPhone Groceries checklist after a ChatGPT edit, from a temporary simulator that was deleted afterwards
- Card pictures: the bottom fade is now sized to the picture, so a short capture shows whole instead of fading its last line.
- Index: 14 posts, filtered as Guides (8) and Comparisons (6). "All posts" at the bottom of each post stays grouped by category.
- `updated` dates: unchanged on older posts, except those that gained a link to a new post; every post's date is still today.

## 30 September 2026 (night): card pictures redone

- Every card now shows one focal capture of what the post is about: the connect steps, a tinted AI edit, the import list, a consent sheet, a tracker table and so on. Each capture is cropped from a full-resolution source at about the card's width, so it shows near full size and is sharp on 2x screens. The picture runs edge to edge under the card's corners, on a quiet tint, and fades out at the bottom.
- The iPhone pictures are new simulator captures at 3x (the note list with "Edited by ChatGPT / Claude / Claude Code", and version history). The 480 px App Store art, and the phones cut through their frames, are gone.
- Tests: every published card has its own ground and capture, at least 640 px wide.

## 30 September 2026 (evening): round 3, and the first measurement

### Measured

Web search (the backend Claude's answers use; US English), about 12 hours after the blog went live and Search Console was verified.

| Query | ambernotes.app in the results? | Who ranks |
|---|---|---|
| `site:ambernotes.app` | No site pages | GitHub pull requests of the repo, then the name collisions (Google Play AmberNotes, ambernotes.ai, app.ambernotes.eu, ambernotes.com) |
| apple notes claude connector | No | Medium, upGrowth, Geeky Gadgets, GitHub plugins, mcpmarket, usecarly, aiagentskit |
| can claude read my apple notes | No | Medium (Mac O'Clock, twice), sirmews repo, Claude help, byburk, mcpmarket, usecarly, Glama |
| notes app with mcp server | No | MCPNotes, sweetrb, mcpservers.org, Glama category, Inkdrop docs, devas.life, aibase |
| codex notes mcp | No | UpNote fork, Amplenote help, Composio, OpenAI Codex docs |
| notes app that works with chatgpt | No | SourceForge, fritz.ai, App Store junk apps, Zoho |
| apple notes mcp server | No | GitHub repos, PyPI, mcpservers.org, Augment, PulseMCP, mcpmarket, Glama |
| apple notes api | No | Wikipedia, OpenAI forum, Elephas, Medium, HN, Apple developer forums, Glama |
| claude code notes app | No | ALucek plugin, Medium, inc.com, makeuseof, devas.life, tomkrush |
| claude connector notes | No | Fellow, XDA, Substack, tactiq, Claude help, meetingnotes.com, Evernote |
| best notes app for AI agents | No | Lindy, Tana, Zapier, Metaview, Digital PM, Laxis, Toolradar |
| "Amber Notes" notes app iPhone Mac ChatGPT Claude | Only through GitHub | The repo and its pull requests; the repo's own description ("Apple notes clone with MCP support, Markdown support, and more") is what gets quoted |

Reading: nothing from the site is in this index yet, which is expected on day one. The GitHub repository is already the page that answers for the brand, so its description and README carry weight until the site is crawled.

### Changed (branch `site/growth-3`)

- Three new posts:
  - `/blog/apple-notes-api`, Apple Notes API: what exists and what to use instead
  - `/blog/notes-apps-that-work-with-chatgpt`, a comparison table
  - `/blog/best-notes-app-for-ai-agents`, with criteria and a table
- Each post has its own cover and lead image, from real captures: the Welcome note's markdown on ink, the iPhone "Edited by ChatGPT" art on peach, and the Evening tracker table on cream.
- Contextual links were added in and out of the new posts. The "All posts" list is now grouped by category, since the blog has more than six posts.

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
