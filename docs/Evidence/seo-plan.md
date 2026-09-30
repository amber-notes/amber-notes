# SEO and AI-answer plan, 30 September 2026

The working plan for ambernotes.app: where to look for trends, what is trending now, the queries worth
winning, fixes to existing posts, and what to publish over the next 14 days. It builds on
[seo-aeo-research-2026-09-30.md](seo-aeo-research-2026-09-30.md), which covers the AI and MCP queries in
more depth. Everything here was checked on 30 September 2026 with web search and page fetches.

## Limits of this research

- **Google Trends returned HTTP 429** (blocked), as it did in the earlier research. There are no volume
  numbers. Google autocomplete (suggestqueries.google.com, US English) stands in as a weak demand signal.
- **openai.com and help.openai.com returned 403.** OpenAI news comes from the developer docs, the ChatGPT
  changelog on learn.chatgpt.com, the OpenAI community forum and press coverage.
- **Reddit search was blocked** (JSON and `site:` searches returned nothing). Check Reddit in a real browser.
- Search results give domains and titles, not positions. "Who ranks" lists the first five that came back.
- ChatGPT, Claude and Perplexity weren't asked directly. "AI cites" says whether the query is a
  how-to or definition question that AI answers usually cite a page for.

## Trend sources and how to check each quickly

| Source | Check | How |
|---|---|---|
| Google Trends | Weekly | `https://trends.google.com/trends/explore?q=<query>&date=today%203-m` in a real browser (automated fetches get 429) |
| Google autocomplete | Weekly, per seed | `curl 'https://suggestqueries.google.com/complete/search?client=firefox&q=apple%20notes%20export'` |
| OpenAI | Weekly | [ChatGPT and Codex changelog](https://learn.chatgpt.com/docs/changelog); [developers.openai.com](https://developers.openai.com); [community forum](https://community.openai.com) for pain points; TechCrunch for launches |
| Anthropic | Weekly | [Claude release notes](https://support.claude.com/en/articles/12138966-release-notes); [anthropic.com/news](https://www.anthropic.com/news); [platform release notes](https://platform.claude.com/docs/en/release-notes/overview) |
| Google | Weekly | [Workspace Updates blog](https://workspaceupdates.googleblog.com/); 9to5Google; [Search Engine Roundtable monthly report](https://www.seroundtable.com/) for AI Overviews and ranking updates |
| Apple Notes | At every iOS/macOS release and point release | [Notes on Mac guide](https://support.apple.com/guide/notes/welcome/mac) and [iPhone guide](https://support.apple.com/guide/iphone/welcome/ios) (the version picker shows what's current); MacRumors and 9to5Mac "everything new in Notes" roundups; the Notes app's own strings (`/System/Applications/Notes.app/Contents/Resources/Localizable.loctable`, `Base.lproj/MainMenu.nib`) to confirm menu names on this Mac |
| MCP ecosystem | Every two weeks | [MCP blog](https://blog.modelcontextprotocol.io/) for spec releases and the roadmap; the official registry |
| Hacker News | Weekly | `https://hn.algolia.com/api/v1/search_by_date?query=apple%20notes&tags=story` (also `notes%20mcp`, `markdown%20notes`) |
| Reddit | Weekly, by hand | r/applenotes, r/ChatGPT, r/ClaudeAI, r/mcp, r/ObsidianMD in a browser; search "apple notes" sorted by new |

## What is trending now (late September 2026)

| Trend | Evidence (dated) | What we can catch this week |
|---|---|---|
| **iOS 27 and macOS 27 (Golden Gate) shipped** with Notes changes: Markdown paste and Copy as Markdown, divider lines, section links, trackpad handwriting on Mac | [MacRumors: iOS 27 released](https://www.macrumors.com/2026/09/14/apple-releases-ios-27/) (14 Sep); [iOS 27.0.1](https://www.macrumors.com/2026/09/28/apple-releases-ios-27-0-1/) (28 Sep); [9to5Mac: everything new in Apple Notes in iOS 27](https://9to5mac.com/2026/09/28/heres-everything-new-for-apple-notes-in-ios-27/) (28 Sep); [9to5Mac: section links](https://9to5mac.com/2026/09/21/apple-notes-adds-a-power-user-feature-in-ios-27-thats-rare-in-other-apps/) (21 Sep); [Apple: Notes on Mac guide, macOS 27](https://support.apple.com/guide/notes/import-export-and-print-notes-not201900c07/mac) (menu is now File, Export To) | The Markdown export post (published today); an "Apple Notes in iOS 27" post with an honest "what AI still can't do" section; refresh the Apple Notes comparisons |
| **Siri in iOS 27 can hand off to ChatGPT; Claude and Gemini extensions aren't live** | [MacRumors](https://www.macrumors.com/2026/09/14/siri-can-be-swapped-out-for-chatgpt-claude/) (14 Sep) | "Can Claude read Apple Notes on iPhone in iOS 27? Not yet": add to claude-and-apple-notes |
| **Apple MCP support is unconfirmed.** Code appeared in the macOS 26.1 beta; nothing shipped in iOS 27 | [9to5Mac](https://9to5mac.com/2025/09/22/macos-tahoe-26-1-beta-1-mcp-integration/) (22 Sep 2025); [WWDC 2026 developer recap](https://www.macrumors.com/2026/06/09/apple-outlines-major-ai-and-developer-tool-updates/) (9 Jun 2026) doesn't mention MCP | Say plainly that it hasn't shipped, wherever we discuss Apple Notes and AI |
| **OpenAI DevDay: plugins get app-like UIs, a Plugin Creator, a new directory submission flow, and support for the proposed MCP Events spec** | [TechCrunch](https://techcrunch.com/2026/09/29/openai-expands-chatgpts-plugins-with-app-like-interfaces-and-automations/) (29 Sep) | Refresh the ChatGPT posts with the current vocabulary; consider submitting to the plugin directory |
| **"Create MCP App" is missing from ChatGPT's Plugins menu until Developer mode is on** | [OpenAI community thread](https://community.openai.com/t/create-mcp-app-missing-from-plugins-menu-on-personal-chatgpt-accounts/1401436) (28 Sep) | A troubleshooting answer in connect-chatgpt-to-your-notes (verify in a Plus account first) |
| **Claude Marketplace launched, with 2,000+ connectors and plugins, and a developer portal for directory submissions** | [gHacks](https://www.ghacks.net/2026/09/27/anthropic-launches-claude-marketplace-with-more-than-2000-connectors-and-plugins/) (27 Sep); [BleepingComputer](https://www.bleepingcomputer.com/news/artificial-intelligence/anthropic-turns-claude-into-an-ai-marketplace-with-2-000-plus-plugins-and-connectors/) (27 Sep); [Claude release notes](https://support.claude.com/en/articles/12138966-release-notes) (25 Sep entry) | Submit Amber Notes to the directory; a "Claude connectors for notes" comparison |
| **Gemini takes custom MCP servers** (Custom apps for Spark: personal accounts, US, 18+, English, Google AI Pro or Ultra); Workspace got MCP integrations with named partners | [9to5Google](https://9to5google.com/2026/06/30/gemini-spark-apps-more/) (30 Jun); [Gemini help](https://support.google.com/gemini/answer/17209137) (undated); [usecarly guide](https://www.usecarly.com/blog/gemini-mcp/) (27 Aug); [Workspace Updates](https://workspaceupdates.googleblog.com/2026/09/connect-to-more-tools-with-gemini-in-Google-Workspace.html) (15 Sep) | "Connect your notes to Gemini": steady demand ("gemini mcp support", "gemini mcp connection", "gemini mcp notion" in autocomplete); needs a real test with a Pro account |
| **MCP spec 2026-07-28** (stateless core, extensions) | [MCP blog](https://blog.modelcontextprotocol.io/) (28 Jul); [Claude blog](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude) (28 Jul) | Developer note on the MCP server page once the server's spec support is checked |
| **Codex CLI MCP changes**: OAuth client secrets (0.158.0, 28 Sep), MCP status (0.159.0, 29 Sep) | [Codex changelog](https://learn.chatgpt.com/docs/changelog) | Small update to notes-in-claude-code-and-codex |
| **Apple Notes clones with MCP keep launching on Show HN** | [Beauty](https://news.ycombinator.com/item?id=49866597) (27 Sep, 69 points); [Notes Plus](https://news.ycombinator.com/item?id=49529608) (1 Sep); [EtherPK](https://news.ycombinator.com/item?id=49907737) (30 Sep) | A Show HN for Amber Notes once the iPhone app is live |
| **Google AI Overviews now expand into AI Mode-style answers** | [Search Engine Roundtable](https://www.seroundtable.com/sept-2026-google-webmaster-report-41979.html) (1 Sep) | Keep the answer in the first paragraph and in the FAQ, where these answers quote from |

Autocomplete signals (30 Sep): "apple notes export" suggests *to markdown*, *export all*, *to obsidian*,
*to pdf only one page*, *github apple notes exporter*; "claude apple notes" suggests *connector*,
*connector not working*, *mcp*; "apple notes mcp" suggests *icloud notes mcp* and *ios notes mcp*;
"chatgpt in apple notes" suggests *apple notes connector*.

## Keyword map

Strength: **H** = Apple, OpenAI or a big publisher holds the top; **M** = mid-size blogs and forums;
**L** = thin, old, vendor spam or AI-written. Priority: **P1** this fortnight, **P2** this month, **P3** later,
**Skip**. "New" means a page we'd write; otherwise the existing post to extend.

### (a) Apple Notes how-tos

| # | Query | Intent | Who ranks (strength) | AI cites | Target page | Priority |
|---|---|---|---|---|---|---|
| 1 | export apple notes to markdown | How-to | support.apple.com, AppleInsider, MacRumors, iwl.me, storizzi on GitHub (H) | Yes | **New: /blog/export-apple-notes-to-markdown** (published today) | P1 |
| 2 | export all apple notes | How-to | TidBITS forum, How-To Geek, kzaremski on GitHub, Exporter on the App Store, Six Colors 2021 (M) | Yes | Same post, "Export every note at once" section | P1 |
| 3 | apple notes export to obsidian | How-to | Obsidian help, Obsidian forum, AI-written pages (M) | Yes | apple-notes-vs-obsidian, plus a section linking the export post | P2 |
| 4 | apple notes copy as markdown / paste markdown | How-to | Apple guide, iOS 27 roundups (H) | Yes | Export post (covered) and the iOS 27 post | P1 |
| 5 | apple notes ios 27 new features | News | 9to5Mac, MacRumors, Geeky Gadgets, AppleMagazine (H) | Yes | New: "Apple Notes in iOS 27 and macOS 27: what's new, and what AI still can't do" | P1 (trend) |
| 6 | apple notes section links | How-to | 9to5Mac, Mac Observer, The Apple Post (H) | Yes | The iOS 27 post, one section | P2 |
| 7 | forgot apple notes password / lock notes password reset | Problem | Apple Community, unlock-tool spam (L-M) | Yes | New: "Forgot your Apple Notes password? What works" | P1 |
| 8 | recover deleted apple notes (after 30 days) | Problem | support.apple.com, recovery-tool vendors, forums (M-H) | Yes | New: "Recover deleted Apple Notes, including after 30 days" | P1 |
| 9 | recently deleted notes missing iphone | Problem | Old iDownloadBlog, vendors (M) | Yes | Same post | P1 |
| 10 | apple notes backup / backup folder | How-to | Android Police, forums, MacMost (M) | Yes | New: "How to back up Apple Notes" | P1 |
| 11 | move notes from on my iphone to icloud | How-to | Old How-To Geek, CopyTrans, EaseUS (L-M) | Yes | New: "Move Apple Notes between accounts (On My iPhone, Gmail, iCloud)" | P1 |
| 12 | move notes from gmail to icloud | How-to | Not covered by any strong page (L) | Yes | Same post | P1 |
| 13 | apple notes on windows | Problem | Apple Community, AI-written pages, Wikipedia (L) | Yes | New: "Apple Notes on Windows: what works" (honest: iCloud.com; Amber Notes has no Windows app) | P2 |
| 14 | apple notes windows alternative | Commercial | Listicles (L-M) | Likely | Same post | P3 (we don't run on Windows) |
| 15 | apple notes to notion | How-to | GitHub gists, Zapier, Geeky Gadgets (L-M) | Yes | New: "Move Apple Notes to Notion" via the Markdown export | P2 |
| 16 | apple notes to google keep | How-to | Guiding Tech, 2019 pages (L) | Yes | New, combined with 15 as "Move Apple Notes to Notion, Obsidian or Google Keep" | P3 |
| 17 | apple notes export to pdf only one page | Problem | Forums (M) | Yes | Export post FAQ, once verified | P3 |
| 18 | apple notes tags not working / tags vs folders | Problem | Medium, Reddit, Apple (H for basics, L for the problem) | Yes | New: "Apple Notes tags and smart folders: how they work and when they don't" | P2 |
| 19 | apple notes smart folders not working | Problem | Forums, Reddit (L-M) | Yes | Same post | P2 |
| 20 | apple notes table column width / sum | How-to | Apple Community, thin answers (L-M) | Yes | New: "Tables in Apple Notes: what you can and can't do" (verify iOS 27 first) | P2 |
| 21 | apple notes sync not working | Problem | Setapp, forums (M) | Yes | New troubleshooting post | P3 |
| 22 | apple notes api | Informational | Wikipedia, Apple forums (M) | Yes | apple-notes-api (update for macOS 27 and the Markdown Shortcuts actions) | P2 |
| 23 | apple notes share folder | How-to | Apple (H) | Yes | Skip |
| 24 | apple notes checklist move to bottom | How-to | Apple (H) | Yes | Skip |
| 25 | apple notes collaborate | How-to | Apple (H) | Yes | Skip |
| 26 | icloud.com notes / apple notes on web | How-to | Apple (H) | Yes | Skip; mention in 13 |
| 27 | apple notes math notes / transcription / links between notes | How-to | Apple and big publishers (H) | Yes | Skip |

### (b) AI + notes

| # | Query | Intent | Who ranks (strength) | AI cites | Target page | Priority |
|---|---|---|---|---|---|---|
| 28 | claude apple notes connector (not working) | Problem | GitHub plugins, Medium, mcpmarket (L-M) | Yes | claude-and-apple-notes: new section on the Mac-only connector and iOS 27 | P1 (trend) |
| 29 | can claude read apple notes on iphone | Question | Claude help, usecarly (M) | Yes | claude-and-apple-notes | P1 |
| 30 | chatgpt in apple notes / apple notes connector chatgpt | Mixed | AppleInsider, MacRumors (2024), Tom's Guide (M) | Yes | chatgpt-and-apple-notes (draft): publish once checked in a ChatGPT account | P1 |
| 31 | chatgpt create mcp app missing / chatgpt developer mode mcp | Problem | OpenAI docs and forum (H) | Yes | connect-chatgpt-to-your-notes: troubleshooting FAQ | P1 (trend) |
| 32 | chatgpt plugins mcp 2026 | Informational | coworker.ai, peliqan, hjarni.com (M) | Yes | notes-apps-that-work-with-chatgpt refresh | P2 |
| 33 | gemini mcp / connect notes to gemini | How-to | usecarly, Gemini help, GitHub (M) | Yes | New: "Connect your notes to Gemini with MCP" (Spark custom apps and Gemini CLI) | P1, after a real test |
| 34 | gemini cli mcp server notes | How-to | GitHub, Google docs (M-H) | Yes | Same post | P1 |
| 35 | chatgpt memory vs notes | Comparison | MindStudio, hjarni.com, Simon Willison (M) | Yes | New: "ChatGPT memory vs a notes app ChatGPT can read" | P1 |
| 36 | claude connectors for notes / claude connectors list | Commercial | Awesome lists, listicles (M) | Yes | New: "Claude connectors for notes, compared" (rides the Marketplace launch) | P2 |
| 37 | remote mcp server notes | Developer | Directories and GitHub only (L-M) | Yes | mcp-server (title and intro say "remote MCP server for notes") | P2 |
| 38 | perplexity mcp notes | How-to | Perplexity docs, hjarni.com (M) | Yes | New section in notes-apps-with-mcp, after a real test | P3 |
| 39 | icloud notes mcp / ios notes mcp | Developer | GitHub repos (L-M) | Yes | apple-notes-mcp: a section answering it (none reach iCloud or iPhone) | P2 |
| 40 | connect google keep to chatgpt | How-to | Make, viaSocket, thin pages (L) | Yes | New section in notes-apps-that-work-with-chatgpt | P2 |
| 41 | connect notion to chatgpt | How-to | OpenAI help, Zapier (H) | Yes | Skip; link from comparisons |
| 42 | apple intelligence summarize notes | How-to | Apple, Tom's Guide (H) | Yes | Skip |

### (c) Workflows

| # | Query | Intent | Who ranks (strength) | AI cites | Target page | Priority |
|---|---|---|---|---|---|---|
| 43 | claude code work log / daily notes | How-to | GitHub repos only (L) | Likely | work-log-with-claude-code: a "daily notes" section and a copyable instruction | P1 |
| 44 | claude code notes | Mixed | Plugin repos, MakeUseOf (M) | Yes | notes-in-claude-code-and-codex | P2 |
| 45 | meeting notes to action items chatgpt | How-to | ClickUp, Tactiq, Fireflies, OpenAI help (H) | Yes | New: "Turn meeting notes into action items with ChatGPT, saved to your notes" (angle: the result lands in a checklist) | P2 |
| 46 | chatgpt meeting notes template | Template | Prompt listicles (M) | Yes | Same post, with the template | P2 |
| 47 | weekly review template notes | Template | NotePlan, Amymind, Etsy (M) | Yes | New: "A weekly review in your notes, with ChatGPT or Claude" | P2 |
| 48 | chatgpt daily journal prompts | Template | AI-written listicles (L-M) | Yes | New, later: "A journal ChatGPT can read" | P3 |
| 49 | second brain with claude (not obsidian) | Mixed | Substack, Every, Obsidian-focused posts (M) | Yes | New: "A second brain Claude can read, on your iPhone" | P2 |
| 50 | chatgpt to-do list iphone | How-to | Covered | Yes | chatgpt-to-do-list-on-iphone | Done |

### Hub page

The blog's categories are hash filters on /blog, not pages, and a test keeps every folder under
/blog a post. So a real "Apple Notes guides" landing page doesn't fit the blog cleanly yet. What this
branch does instead: a new **Apple Notes** category in the filters, holding the Apple Notes how-tos
(the Markdown export post, Can Claude read your Apple Notes, How to move from Apple Notes, Apple Notes
API). Comparisons stay in Comparisons.

Proposal: once there are six or more Apple Notes how-tos (about day 10 of the plan below), add an
indexable **/apple-notes** page outside /blog: a short intro, the guides grouped by task (export and
backup, recovery and passwords, accounts and sync, AI), its own entry in the sitemap and /llms.txt, and
CollectionPage plus ItemList JSON-LD. Each guide links back to it from the breadcrumb.

## Existing posts: gaps worth fixing

| Post | Improvement |
|---|---|
| connect-chatgpt-to-your-notes | Add "Create MCP App isn't in the menu": turn on Developer mode at Settings, Security (OpenAI forum, 28 Sep). Use DevDay's vocabulary (plugins). Verify in a Plus account. |
| claude-and-apple-notes | Add an iOS 27 section: Claude's Siri extension isn't live and Apple hasn't shipped MCP; answer "connector not working". |
| notes-apps-with-mcp | Add Gemini (custom apps for Spark, US only) and Perplexity rows, and Hjarni, which now ranks for our queries. |
| apple-notes-mcp | Answer "iCloud notes MCP" and "iOS notes MCP": no Apple Notes server reaches iCloud or iPhone. |
| obsidian-mcp | No real gap. |
| move-from-apple-notes | Linked to the export post in this branch. Once the iPhone app is live, switch the iPhone section. |
| notes-in-claude-code-and-codex | Note Codex 0.158's support for pre-registered OAuth clients if it changes the setup. |
| amber-notes-vs-apple-notes | Update Apple Notes' side for iOS 27 (Markdown paste and Copy as Markdown, section links, divider lines), so the comparison stays fair. |
| mcp-server | Title and intro should say "remote MCP server for notes"; add the Gemini setup once tested. |
| apple-notes-api | Add macOS 27's File, Export To and Copy as Markdown, and the Shortcuts actions Create Note from Markdown and Append Markdown to Note (seen in the Notes app on macOS 26.5). This branch adds a link to the export post. |
| notes-apps-that-work-with-chatgpt | Refresh for DevDay (plugins, the directory); add a Google Keep row (no ChatGPT connector). |
| best-notes-app-for-ai-agents | Add MCP Events and automations as a criterion to watch. |
| apple-notes-vs-notion | Minor: iOS 27 Notes features on Apple Notes' side. |
| apple-notes-vs-obsidian | Add "Move from Apple Notes to Obsidian" with the Markdown export, for the "export to obsidian" query. |
| chatgpt-to-do-list-on-iphone | No real gap; link the memory-vs-notes post when it exists. |
| work-log-with-claude-code | Add a "daily notes" heading and a copyable instruction; only GitHub repos rank for "claude code daily notes". |
| chatgpt-and-apple-notes (draft) | Publish after checking ChatGPT's current Apple Notes paths (Work with Apps, the iOS 27 Siri handoff) in a real account. |

## Publishing order, 1 to 14 October

Trends first, then weak-competition Apple Notes how-tos, then workflows. A post that needs a real
account test (ChatGPT, Gemini) waits for that test rather than shipping unverified.

| Day | Date | Post | Why now |
|---|---|---|---|
| 0 | 30 Sep | **Export Apple Notes to Markdown** (new, published in this branch) | Evergreen, macOS 27 renamed the menu, top results are pre-27 |
| 1 | 1 Oct | **Apple Notes in iOS 27 and macOS 27: what's new, and what AI still can't do** (new) | Released 14 Sep; roundups from 28 Sep; the AI angle is ours |
| 1 | 1 Oct | Refresh **connect-chatgpt-to-your-notes**: DevDay plugins, "Create MCP App" missing | DevDay 29 Sep; forum pain point 28 Sep |
| 2 | 2 Oct | Refresh **claude-and-apple-notes**: iOS 27, "connector not working" | Siri extensions news 14 Sep; Claude Marketplace 23 Sep |
| 3 | 3 Oct | **ChatGPT memory vs a notes app ChatGPT can read** (new) | Winnable, fits the product, a competitor is already there |
| 4 | 4 Oct | **Connect your notes to Gemini with MCP** (new; Gemini CLI steps plus Spark custom apps once tested) | Steady "gemini mcp" demand |
| 5 | 5 Oct | **Forgot your Apple Notes password? What works** (new) | Results are unlock-tool spam |
| 6 | 6 Oct | **Recover deleted Apple Notes, including after 30 days** (new) | Results are recovery-tool spam |
| 7 | 7 Oct | **How to back up Apple Notes** (new) | Forums only; links the export post |
| 8 | 8 Oct | **Move Apple Notes between accounts** (On My iPhone, Gmail, iCloud) (new) | Old and vendor-written results |
| 9 | 9 Oct | **Claude connectors for notes, compared** (new) and the Claude directory submission | Rides the Marketplace launch |
| 10 | 10 Oct | **/apple-notes hub page** (see Hub page) | Six Apple Notes how-tos by then |
| 11 | 11 Oct | Refresh **work-log-with-claude-code** for "Claude Code daily notes" | Only GitHub repos rank |
| 12 | 12 Oct | **Turn meeting notes into action items with ChatGPT, saved to your notes** (new) | Workflow cluster |
| 13 | 13 Oct | **Apple Notes tags and smart folders: how they work and when they don't** (new) | Problem queries are weakly served |
| 14 | 14 Oct | **A weekly review in your notes, with ChatGPT or Claude** (new) | Workflow cluster; template pages win here |

Next after that: Apple Notes on Windows, tables in Apple Notes, move Apple Notes to Notion, Obsidian or
Google Keep, publishing the ChatGPT and Apple Notes draft, and a second brain Claude can read.

## How to measure

- Search Console, weekly: impressions and position for each P1 query, and indexing of new posts.
- Once a month, ask ChatGPT, Claude, Gemini and Perplexity the P1 questions and note whether ambernotes.app is cited.
- Re-run the autocomplete seeds above every two weeks and note new variants.
