# Growth log

What was measured and what changed, to get more people to Pinto Notes (Amber Notes until 8 October 2026) from search and from AI
assistants. Newest first. Research behind it: [seo-aeo-research-2026-09-30.md](seo-aeo-research-2026-09-30.md).

`docs/` had no README naming a folder for evidence, so this and the research live in `docs/Evidence/`.

## 8 October 2026: the site moved to pintonotes.com, audited and tightened

The app was renamed from Amber Notes to Pinto Notes on 8 October, and the site moved from ambernotes.app to pintonotes.com (PR 312). This is the audit of the live move, and what the follow-up branch `site/seo-move-pinto` changes.

### Measured (live, 8 October about 20:30 UTC)

- **Old addresses:** all 69 sitemap pages on ambernotes.app answer one 308 to the same path on pintonotes.com, query kept, and end on a 200. http and www variants arrive too, with one extra hop each that Vercel adds before our code runs (http to https, www.ambernotes.app to ambernotes.app).
- **Kept on ambernotes.app on purpose:** /.well-known/apple-app-site-association, /updates/, /downloads/, /api/ and /open/ answer 200 there.
- **pintonotes.com:** every sitemap page has a self canonical, og:url equal to it, og:site_name "Pinto Notes", a 1200 by 630 share image on pintonotes.com, twitter summary_large_image, one h1, and no noindex. robots.txt names the new sitemap. No title, description or share title says Amber Notes. Internal links: 160 distinct, none broken, none to ambernotes.app.
- **JSON-LD:** SoftwareApplication "Pinto Notes" with alternateName "Amber Notes", WebSite with alternateName "Amber Notes" and "ambernotes.app", sameAs the GitHub repo.
- **Where "Amber Notes" still shows, on purpose:** the lines that tell people what to search for in Claude's connector directory and in Incredible's Apps (those listings still carry the old name), the 1.0 and 1.1 changelog entries, and the "was called Amber Notes until October 2026" lines in /llms.txt, the privacy policy and the terms.
- **PostHog (EU project 291184), last 24 hours:** pintonotes.com 32 page views (first at 15:54 UTC on 8 October), www.pintonotes.com 8, ambernotes.app 39 (last at 19:35 UTC, before the redirect). The new address records.

### Found

- **www.pintonotes.com served the whole site with a 200**, a second copy of every page (the canonical pointed at pintonotes.com, so it was a soft duplicate, and 8 page views landed there).
- **amber-notes.vercel.app** redirected only /, /help, /download, /changelog and /connect; /blog, the posts and the templates answered 200 there.
- **No feed.** /blog/feed.xml, /feed.xml and /rss.xml were 404.
- **No page for the old name.** A search for "amber notes" (5 impressions in the week to 3 October, our only brand query) had nothing that says the app is Pinto Notes now.
- **`scripts/indexnow.sh` still named ambernotes.app** as host and key location, so the ping after the deploy offered pintonotes.com addresses under the wrong host.
- **One post address had the old name:** /blog/amber-notes-vs-apple-notes.

### Changed (branch `site/seo-move-pinto`)

- www.pintonotes.com answers a 308 to pintonotes.com for every path, and amber-notes.vercel.app moves like ambernotes.app does: every page to the same path on pintonotes.com, with the same kept paths (`web/lib/site-move.ts`, `web/middleware.ts`).
- New page [/amber-notes](https://pintonotes.com/amber-notes), "Amber Notes is now Pinto Notes": what changed, what stayed the same, why. Indexable, in the sitemap and /llms.txt, linked from the footer ("Formerly Amber Notes"). /ambernotes redirects to it.
- New feed at /blog/feed.xml (RSS 2.0, every published post), named in every page's head.
- /blog/amber-notes-vs-apple-notes is now /blog/pinto-notes-vs-apple-notes, with a 308 from the old address. The post was 9 days old, its title already says Pinto Notes, and nothing outside the site links to it yet. Picture file names that start with amber-notes- stay: a picture's address isn't shown to anyone, and renaming would only break hot links.
- /download carries the SoftwareApplication JSON-LD too.
- `scripts/indexnow.sh` pings pintonotes.com, and with `--moved` also the same pages on ambernotes.app, which keeps serving the IndexNow key for that.
- IndexNow was pinged for the 69 pintonotes.com pages on 8 October (HTTP 202).

### Still to do by hand

- Search Console: Domain property for pintonotes.com, the sitemap, and Change of Address from ambernotes.app. Bing Webmaster Tools the same. Steps are with the maintainer.
- After this branch is live: `scripts/indexnow.sh --moved`.
- In Vercel, www.ambernotes.app is set to redirect to ambernotes.app, which makes two hops for www links. Setting it to serve the project directly makes it one (our middleware already sends it to pintonotes.com).

### To watch for four weeks (to 5 November)

- **Week 1 (to 15 October):** Search Console, pintonotes.com: pages indexed rising from 0, the sitemap read with 70 addresses found. ambernotes.app: "Page with redirect" growing under Pages. No "Redirect error". PostHog: no page views on ambernotes.app or www.pintonotes.com at all.
- **Week 2 (to 22 October):** impressions on pintonotes.com passing ambernotes.app. Clicks for the two properties added together should be no lower than the last week before the move (6 clicks, 319 impressions in the week to 3 October). A dip of a week or two is normal in a move.
- **Week 3 (to 29 October):** the query "amber notes" showing /amber-notes or the home page of pintonotes.com. "pinto notes" showing the home page at position 1 to 3. The site name in results reading "Pinto Notes".
- **Week 4 (to 5 November):** most of the 69 pages indexed on pintonotes.com, ambernotes.app impressions near zero. If more than a third of the pages are still not indexed on pintonotes.com, use URL Inspection on the home page, /blog and the five posts with the most impressions, and ask for indexing.
- **Every week:** 404s in PostHog (pathname of page views on the not-found page) for an old address nobody redirected; Bing Webmaster Tools, Site Explorer, for pintonotes.com pages found.
- **Keep for good:** ambernotes.app registered with auto-renew, and its redirects in place. Google asks for at least a year; links and installed apps need it longer.

## 6 October 2026: a week of PostHog, Search Console, and "One memory for Claude Code, Codex and your other agents"

### Measured

- **PostHog (EU project 291184), 30 September to 6 October 09:00 UTC.** Data starts 2 October, when the key went live. Page views: 148 on 2 October, 39, 53, 90 on 5 October, 6 so far on 6 October; 336 in all.
- **Top pages:** / 152, /templates 60, /blog 27, /changelog 17, /help 13, /download 12, /blog/apple-notes-ios-27 6.
- **Where landings came from:** Google 14 (/blog/apple-notes-ios-27 5, / 3, /blog/apple-notes-api 3, /download, /blog/forgot-apple-notes-password and /blog/best-notes-app-for-ai-agents 1 each), github.com 10 (/ 6, /download 4), Bing 2 (/templates), Facebook 1. Everything else was direct.
- **Named clicks:** `download_mac_clicked` 7 (4 on /download, 2 on /, 1 on /templates; 2 on 2 October, 1 on 3 October, 3 on 5 October, 1 on 6 October; six from macOS, which includes our own checks), `outbound_github_clicked` 25 (17 on /), `use_template_clicked` 3, `copy_prompt_clicked` 1, `outbound_claude_clicked` 1.
- **Home page:** 126 page loads began on /, and 102 of them (81%) saw no second page; across all landings it's 160 of 191 (84%). The site keeps no id between full page loads, so a reload counts as a new visitor and these numbers overstate bounce.
- **404s:** /& 3 (two on 3 October, one on 5 October at 10:46 UTC, before the redirect from PR 192 was live; it answers 308 now), /blog/obsidian-mcp-servers-compared 1 (5 October, direct, a guessed address; no link of ours uses it), /L9cu 1, /test 1.
- **Google Search Console: reached** this time, in Chrome. Last 7 days (Google's data runs to 3 October): 6 clicks, 319 impressions, 1.9% click rate, average position 9.7, 35 queries. Top queries by impressions: "forgot notes password" 8, "amber notes" 5, "apple notes api" 4, "icloud notes api" 4, "apple notes mcp" 3, and five more forgotten-password variants with 2 or 3 each.

Reading: GitHub and Google send about the same number of landings, and GitHub's go to the home page and /download, where most download clicks start. The forgotten-password post earns the most impressions and no clicks yet.

### Picked

- A developer came to Amber Notes this week for shared memory across several coding agents that they can read themselves. No post answers that; the closest, `/blog/notes-in-claude-code-and-codex`, only connects one agent at a time.

### Changed (branch `site/blog-agent-memory`)

- New post `/blog/shared-memory-for-coding-agents`, in Guides. Search title "Shared memory for Claude Code and Codex". Covers why a note works as shared memory, connecting both agents with an access token each, a pinned Project memory note with Decisions, Conventions and a Handoff log, the lines to put in `CLAUDE.md` and `AGENTS.md`, who changed what (Edited by, the tinted lines with Undo, version history, `note_history`), and what the encryption covers. Checked on main:
  - Tokens are named after the agent they were made for (`ConnectAI.swift`, `ConnectTokens.create(name: guide.title)`), and that name goes on every edit (`pane.client` in `tools.ts`, the `ai_editor` trigger). A browser sign-in from a terminal (loopback redirect) is named "An app on this computer" (`displayName` in `oauth.ts`), so two agents signed in that way look the same. The post recommends a token per agent for that reason.
  - Add to Claude Code shows only where the app can run a shell; the post says "if your copy shows it".
  - `get_overview` lists pinned notes; `append_to_note` takes `under_heading`; each tool call locks the note row (`findNote`, `for update`), so two appends at once both land; `edit_note` with `expected_version` fails if the note changed.
  - The bar text "Codex changed 2 lines" and Undo's merge, which fails when you changed the same lines (`AIEdit.swift`).
  - Encryption wording follows `lib/facts.ts`. The iPhone lines follow `APP_STORE_LIVE`.
- The card is a new crop of the existing iPhone note list capture (Standup notes Edited by Claude Code, Lisbon Edited by Claude) on a new denim ground.
- `/blog/obsidian-mcp-servers-compared` now redirects to `/blog/obsidian-mcp` with a 308 (`next.config.ts`, tested in `seo.test.ts`).

### To measure next

- Search Console: impressions for "claude code codex shared memory", "shared memory for ai agents" and "claude code memory" once the post is indexed.
- PostHog: landings on the new post, and `download_mac_clicked` by page.

## 5 October 2026: status, "Apple Notes not syncing between iPhone and Mac", and the /& redirect

### Measured

- **Google Search Console: not reached.** The Chrome extension this loop uses wasn't connected, so whether hello@ambernotes.app or emil@incredible.one has been given access couldn't be checked. Nothing below comes from Search Console.
- **PostHog (EU project 291184), page views on ambernotes.app, UTC days:** 39 on 3 October, 53 on 4 October, 33 on 5 October by about 09:00 UTC. 71 of the 86 views on 4 and 5 October came from macOS, which includes our own checks.
- **Where views came from (4 and 5 October):** direct 77, google.com 7, github.com 2.
- **Search landings:** Google sent /blog/apple-notes-ios-27 (3), / (2), /blog/apple-notes-api (1) and /blog/best-notes-app-for-ai-agents (1, a first). Bing sent none.
- **Top pages:** / 49, /templates 11, /blog 6, /help 4, /changelog 4, /blog/apple-notes-ios-27 3, /templates/trip-plan 2.
- **Named clicks:** `use_template_clicked` 3 (grocery-list, trip-plan, meeting-notes), `copy_prompt_clicked` 1 (grocery-list), `outbound_github_clicked` 5, `outbound_claude_clicked` 1 (the Claude directory listing). `download_mac_clicked`: 0.
- **/&:** two views at 22:41 and 22:42 UTC on 3 October, direct, from Linux and Windows, both on the 404 page. The likely source is a link with "&" where its "?" should be.

Reading: the iOS 27 post is still the only post with repeat Google clicks, and the first template clicks arrived. Search Console access remains the most useful missing piece.

### Picked

- Autocomplete on 5 October: "apple notes not syncing" suggests *across devices*, *between iphone and mac*, *on mac*, *when shared*, *with collaborator*; "apple notes not syncing after update" suggests *force apple notes to sync*, *why are my notes not syncing between devices*; "iphone notes not syncing to mac" and "icloud notes not syncing" have eight to ten suggestions each. "apple notes ios 27" suggests *new features*, *markdown*, *section links*, which the iOS 27 post already covers. No existing post covers sync failures.

### Changed (branch `site/apple-notes-not-syncing`)

- New post `/blog/apple-notes-not-syncing`, in Apple Notes. Search title "Apple Notes not syncing between iPhone and Mac? Fixes". Six checks in order (iCloud for Notes on each device, the same Apple Account, which account the note is in, icloud.com/notes and System Status, iCloud storage, a Mac behind the iPhone after iOS 27), shared notes that won't update, notes gone from every device, and four FAQ answers. Checked on 5 October:
  - Apple Support 121669 (If you don't see your iCloud notes, March 2025): Sync this iPhone, then restart.
  - Apple Support 108922 (Manage your iCloud storage, 14 September 2026): with full storage, iCloud apps don't stay up to date across devices.
  - Apple Support 102462 (If you can't collaborate in the Notes app, 23 September 2026) and the iPhone guide's Share notes and collaborate (iOS 27): Share a Link or Send a Copy, People you choose can edit, no collaborating on locked notes.
  - iCloud User Guide, Set up iCloud for Notes (macOS 15 or later: Saved to iCloud, Notes, Sync this Mac), and the Notes User Guide for Mac, About using iCloud Notes (upgraded notes and OS X 10.11 or iOS 9).
  - iCloud Notes is its own row on Apple's System Status page (read from its status data).
  - Notes' Localizable.loctable on macOS 26.5: "This note uses unsupported features", a shared note's changes waiting while the owner's storage is full, and the account security upgrade for real-time edits.
  - Amber Notes: the Sync row in Settings with its status and Sync Now (`SettingsView.swift`), and conflicted copies (`SyncEngine.swift`). The iPhone line follows `APP_STORE_LIVE`.
- Left out because I couldn't check them: per-app cellular data for Notes, Low Power Mode, and whether a specific iOS 27 feature (divider lines, section links) is what triggers the unsupported-features message on macOS 26.
- The first picture reuses the Notes Settings capture (Default account: iCloud). The card is a new crop of the same capture, the Default account row alone, on a new lagoon ground.
- `/blog/move-apple-notes-to-icloud` links the new post.
- `/&`, and any path that starts with "&", now redirects to / with a 308 (`next.config.ts`, tested in `seo.test.ts` with the matcher Next.js compiles redirects with). Checked with `next start`: /&, /&amp; and /&utm_source=x answer 308 to /.

## 4 October 2026: "Tables in Apple Notes: what you can and can't do"

### Why

- Item 20 of the keyword map ("apple notes table column width / sum", P2). Google autocomplete for "apple notes table" on 4 October: *change column width*, *sum*, *add column*, *column width*, *resize column*, *formula*, *sum column*, *adjust column width*. Each is a problem query whose honest answer is "you can't, and here's what works instead". The results are Apple Community threads and thin how-to pages.

### Changed (branch `site/apple-notes-tables`)

- New post `/blog/apple-notes-tables`, in Apple Notes. Search title "Apple Notes tables: column width, sums and formulas". It covers adding a table, rows and columns, column width, sums and Math Results, bringing data in, and Amber Notes' typed tables. Checked on 4 October:
  - Apple, Add a table in Notes on Mac (macOS 27 and 26): the two-by-two default, Tab or Return in the last cell adds a row, the row and column handles, Convert to Text from Table Actions, pasting drops named styles, tables copied from Safari or Pages.
  - Apple, Create and format notes on iPhone (iOS 27): the Add Table button. Apple's iPhone guide says nothing more about tables, so the steps in the post are the Mac's.
  - Apple, Solve math in Notes on Mac: Math Results in the note body, variables, Format, Math Results. Apple says nothing about table cells, and the post says so.
  - Notes on macOS 26.5: the Format menu read by loading MainMenu.nib with AppKit (Move Item, Table with Option-Command-T, Convert to Text, Reverse Table Direction, Show Note As Light Background); no width, sort or formula item anywhere in Localizable.loctable; the Shortcuts action Add Table to Note, which takes CSV, from the app's App Intents metadata.
  - Amber Notes: column types and the column menu (`TableGrid.swift`), Show Trend (`TableChart.swift`), File, Import Spreadsheet as Table (`XLSXImporter.swift`, formulas keep their last value), the Apple Notes import keeping tables on the Mac (`RichTextToMarkdown.swift`), and `read_table` and `log_table_row` in the MCP tools.
- Left out because I couldn't check them: whether Math Results work inside a table cell, whether the Markdown export keeps tables, iOS 27 Markdown paste of tables, and the iPhone steps for rows and columns.
- The cover is the Format menu of Notes at Table, drawn in HTML at 2x and 2.5x with the items and order read from the nib, on a new lemon ground. The post's second picture is the existing Evening tracker capture.
- `/blog/apple-notes-ios-27` links to the new post from its divider-lines section.
## 4 October 2026: three new templates (Cornell notes, daily journal, grocery list)

### Why

- The template library (strategy 6c) had 20 templates and none for three note structures people search for by name. Google autocomplete on 4 October:
  - "cornell notes template" suggests *word*, *docs*, *google docs*, *printable*, *onenote*, *notion*;
  - "daily journal template" suggests *pdf*, *google docs*, *obsidian*, *notion*, *ideas*;
  - "apple notes grocery list" suggests *template*, *template free*, *organize grocery list*, *sort grocery list*.
- Each one is a structure an AI does the dull part of: writing the cue questions and summary, turning a ramble into a dated entry, sorting items by aisle.

### Changed (branch `site/templates-cornell-journal-grocery`)

- `/templates/cornell-notes` (Learning): a section per lecture with a Cue and Notes table and a summary line; the AI quizzes from the cues and keeps a "Cues to revisit" checklist.
- `/templates/daily-journal` (Habits and health): four questions, entries newest first under a weekday heading. It's prose with labels; the mood and energy log stays the table version.
- `/templates/grocery-list` (Home and life): one standing list under aisle headings; the AI files items from a sentence, skips duplicates and removes ticked lines after the shop. The meal plan stays the weekly dinners plus their list, and the two link each other.
- Examples are replayed from the demo calls with the server's own note functions, as for the other 20 (`FILL_EXAMPLES=1`). One real behaviour shows in the grocery example: ticking an item moves it to the end of its list.
- Related links: study notes and flashcards now points to Cornell notes, weekly review to the daily journal, meal plan to the grocery list.
- Covers: paper-cut, same kit and style key as the first 20, in three new colours (petrol slate, plum, tomato red), placed so no grid neighbour shares a hue. The grocery cover was regenerated once (its trolley handle was malformed) and darkened 10% so cream text reaches 4.8:1. QC notes are in the cover kit, outside the repo.

### To measure next

- Search Console: impressions for "cornell notes template", "daily journal template" and "apple notes grocery list template" once the pages are indexed.
- PostHog: `use_template_clicked` and `copy_prompt_clicked` on the three pages.
## 4 October 2026: status, and "Apple Notes tags and Smart Folders"

### Measured

- **Google Search Console: not reached.** The browser profile this loop uses is signed in to hello@ambernotes.app and emil@incredible.one, and neither has access to the ambernotes.app property (domain or URL prefix). Impressions, clicks and positions by query, and the index coverage report, need Emil's account. Nothing below comes from Search Console.
- **PostHog (EU project 291184, live since 2 October), page views on ambernotes.app:** 148 on 2 October, 39 on 3 October, 12 on 4 October by about 13:00 CEST. The id is per page load (nothing is stored), so "visitors" can't be counted. 157 of 199 views came from macOS, which includes our own checks.
- **Where views came from (2 to 4 October):** direct 186, google.com 6, github.com 4, bing.com 2, facebook.com 1.
- **Search landings:** Google sent /blog/apple-notes-ios-27 (2), /, /blog/apple-notes-api, /download and /blog/forgot-apple-notes-password (1 each). Bing sent /templates (2). So at least those five pages are in Google's index and /templates is in Bing's.
- **Top pages:** / 88, /templates 35, /blog 20, /changelog 10, /help 9, /download 7. One template page was viewed once (meeting-notes). `download_mac_clicked`: 3. No `use_template_clicked` or `copy_prompt_clicked`.
- **Web search (Claude's backend), `site:ambernotes.app`:** the home page, connect-chatgpt-to-your-notes, claude-cowork-apple-notes and claude-and-apple-notes. On 30 September it returned no site pages.
- **Bing and IndexNow:** the sitemap lists 61 URLs and the IndexNow key file answers 200. Bing Webmaster Tools needs a login, so crawl and index numbers there weren't read.
- **Not indexed, as far as can be seen:** no template page has had a search visit, and neither have most posts. Without Search Console it's unknown whether they're unindexed or indexed without clicks.

Reading: search traffic is a handful of clicks a day, mostly to Apple Notes problem posts (iOS 27, API, forgotten password). That supports writing more Apple Notes problem posts and template pages for searched note structures. Getting Search Console access for this loop is the most useful next step: without it, picks rest on autocomplete and competitors, not our own impressions.

### Picked

- Autocomplete on 4 October: "apple notes tags" suggests *not working*, *vs folders*, *not showing*, *nested tags*. "apple notes smart folders" suggests *not working*, *how do smart folders work*, *subfolder*. "apple notes table" suggests *change column width*, *sum*, *formula*, *add column*. Template seeds: "cornell notes template" (*notion*, *onenote*, *google docs*), "daily journal template" (*obsidian*, *notion*), "apple notes grocery list template", "apple notes sort grocery list".
- Two posts: Apple Notes tags and Smart Folders (plan item 18 and 19, this branch) and tables in Apple Notes (plan item 20, its own branch). Three templates: Cornell notes, daily journal, grocery list (one branch).
- Skipped: "Apple Notes on Windows" from the plan, since the site is iPhone and Mac only; meeting notes to action items, since the meeting-notes template already targets it.

### Changed (branch `site/apple-notes-tags-smart-folders`)

- New post `/blog/apple-notes-tags-smart-folders`, in Apple Notes: how tags and Smart Folders work on iPhone and Mac, tags versus folders, nine "when tags don't work" cases, the Shortcuts actions, and an FAQ.
- Facts were checked on 4 October against Apple Support 102288 (published 22 May 2026) and the Notes User Guide for Mac pages "Use tags" and "Use Smart Folders" (macOS 27 back to 15). The Mac app's own messages come from Notes' Localizable.loctable on macOS 26.5: tags need an iCloud account; IMAP and Exchange refuse tags; tagged notes can't be locked; the Convert to Smart Folder limits; a Smart Folder that uses only a deleted tag is deleted too; the unsupported Smart Folder message. The rule menu and its options come from SmartFolderFilterRow.nib, SmartFolderTagFilterView.nib, SmartFolderDateFilterView.nib and SmartFolderChecklistsFilterView.nib. The Shortcuts actions come from Notes' App Intents metadata.
- Left out because I couldn't check them: whether On My iPhone takes tags, whether the Mac has its own Auto Convert to Tag switch, and how Amber Notes' import treats Apple Notes tags.
- The Amber Notes section says plainly that Amber Notes has no tags or Smart Folders, and what ChatGPT or Claude can do instead with search_notes and move_note. The iPhone line follows `APP_STORE_LIVE`.
- The cover is the first pop-up menu of a Smart Folder rule, open with Tags checked. It's drawn in HTML at 4x, with item names and order read from SmartFolderFilterRow.nib, and sits on a new coral ground. The card crops it at the bottom, so the menu text matches the size on the export-menu cover. Checked on /blog at 1440 next to the sky and mint covers. move-apple-notes-to-icloud now links the post from its IMAP paragraph.

## 2 October 2026: "How to move Apple Notes from On My iPhone or Gmail to iCloud"

### Why

- Item 9 of the plan, approved on 2 October. The queries "move notes from on my iphone to icloud" and "move notes from gmail to icloud" mostly lead to old How-To Geek pages and vendor tools, according to the 30 September research.

### Changed (branch `site/move-apple-notes-to-icloud`, stacked on `site/back-up-apple-notes`)

- New post `/blog/move-apple-notes-to-icloud`, in Apple Notes. Every step was checked on 2 October against Apple's guides for iOS 26 and 27 and macOS 26 and 27, and against Apple Support 118442, 102476, 102537 and 108770. The post covers locked notes, attachments, shared notes and Gmail's IMAP limits.
- Some claims come from the Mac app itself, read from Notes' Localizable.loctable on macOS 26.5:
  - only iCloud notes can be shared;
  - IMAP accounts refuse tags and pinning;
  - On My Mac can't be turned off while it holds notes.
  Claims I couldn't check were left out. Those include moving whole folders between accounts on iPhone, and any limit on selecting notes from more than one account.
- The cover is Notes' own General settings with Default account set to iCloud. AppKit rendered it offscreen at 4x from the Settings storyboard inside Notes.app, so the controls and wording are the app's own. It sits on a new sky ground. The settings rows are wide, so the crop runs off the right edge to keep the text the size of the other covers. Fitting the whole rows into 85% of the panel made the text too small to read on a card.
- I checked it at 1440 and 390 next to the first 8 covers. The share card uses a JPEG copy.

## 2 October 2026: "How to back up Apple Notes"

### Why

- Item 8 of the plan, held until today. People search "back up Apple Notes" because they assume iCloud is a backup. It isn't: a delete reaches every device, and iCloud Backup leaves out notes already in iCloud (Apple, 108770).

### Changed (branch `site/back-up-apple-notes`)

- New post `/blog/back-up-apple-notes`, in Apple Notes. It covers what iCloud protects you from, a table of the four options (export a note, an exporter on the Mac, iPhone backup, Time Machine), a routine with two steps, locked notes, and an FAQ. Facts were checked on 2 October against these sources:
  - Apple 108770: iCloud Backup excludes notes already in iCloud.
  - Apple's delete and recover pages: Recently Deleted keeps notes for 30 days.
  - Apple's export pages: on macOS 26 it's File > Export as > Markdown, on macOS 27 it's Export To, and on iPhone it's Share > Export as Markdown.
  - Apple 102307: Time Machine.
  - The kzaremski/apple-notes-exporter README: GPL, keeps folders and attachments, needs Full Disk Access.
- The cover is the Apple Notes File menu, open at Export as, with Markdown selected. It's drawn in HTML at 4x, and every item's wording is read from Notes' own MainMenu.nib on macOS 26.5. The nib also has an Archive item under Export as, but Apple's pages document only PDF and Markdown, so Archive is left out. The menu fills about 67% of the panel and ends above the fade. It's on a new mint ground, which differs from its neighbours. There's no Amber screenshot, because this is an Apple Notes post.
- I checked the cover at 1440 and 390 next to the first 8 covers on /blog (`first8-1440.png`, `first8-390.png`). The share card uses a JPEG copy of the cover.
- "How to recover deleted Apple Notes" now links here from its prevention list.

## 1 October 2026: the Claude Cowork cover fills its card

- Emil flagged that the prompt sat small in the middle third of its panel. The other covers fill theirs.
- It's now drawn at 4x, cropped to the title, message and buttons, and downsampled so it stays sharp. It spans about 65% of the panel width, with the same top padding as Groceries.
- At card size the message text matches the Groceries body line. The title is a little smaller than "Groceries", because a macOS alert's title is only slightly bigger than its message.
- The buttons end above the card's usual fade, so the fade shows under them like on the other covers. (A first pass at 85% was too big, and needed a special fade.)
- Compared at the same size beside the Groceries and Gemini cards (`compare-1440.png`).
- The blue Allow, the rose ground and the share card carry over.

## 1 October 2026: the Claude Cowork cover, redrawn

- The first Cowork cover was a status infographic with system-coloured icons, and it echoed the stepped list on "Can Claude read your Apple Notes?". It's replaced with a real moment: the macOS prompt that asks you to let Claude control Notes. The extension needs that permission the first time.
- How it was drawn:
  - AppKit drew it offscreen with NSAlert, so it never appears on screen.
  - The wording is macOS's own, from TCC.framework's Localizable.loctable (`REQUEST_ACCESS_SERVICE_kTCCServiceAppleEvents`, "Don't Allow", "Allow").
  - The icon is Claude's own app icon from /Applications/Claude.app.
- Nothing about Claude's own UI is invented. I couldn't verify Claude Desktop's extension settings screen without driving the app, so I didn't draw it.
- The cover crops the prompt's title, message and buttons, in the same panel shape, padding and fade as the approved covers. It stays on the rose ground, which differs from its neighbours (night, linen and dusk).
- The full prompt, with the icon, is the post's first picture. The share card uses the new cover.
- Allow is the default button (keyEquivalent Return), filled with the system accent colour, as it is in the real prompt. AppKit only draws that fill in the front window, and the offscreen window never is one, even when it's reported as key. So the render fills that one button itself: a capsule at the button's own frame, in `NSColor.controlAccentColor` (system blue, #007AFF in the light appearance), with the button's own font in white.

## 1 October 2026: "How to use Claude Cowork with Apple Notes"

### Why

- People ask this in r/AppleNotesGang ("AppleNotes & Claude Cowork?", 34 comments) and r/ClaudeAI ("Is Claude allergic to Apple ecosystem?"). Answers there split between "use the Mac connector" and "impossible". Emil approved the post on 1 October.

### Changed (branch `site/claude-cowork-apple-notes`)

- New post `/blog/claude-cowork-apple-notes`, in Apple Notes, with an exact-match title. Every claim comes from Anthropic's own pages, read on 1 October:
  - Cowork on web, desktop and mobile (support article 15520349): where it runs, the cloud change on 6 October, and that local connectors need Claude Desktop open.
  - Desktop vs web connectors (11725091): desktop extensions aren't on web or mobile.
  - Custom connectors (11175166): available in Cowork, Free gets one, they run from Anthropic's cloud.
  - The Read and Write Apple Notes listing (claude.com/connectors): four tools, macOS automation.
  - The checklist limitation (anthropics/claude-ai-mcp#29).
- Not tested hands-on in Cowork, and the post says so.
- Structure follows the audit's template:
  - a short answer first, then where Cowork runs
  - option 1, the extension, with steps and limits
  - when the extension is enough
  - option 2, a connector (Amber Notes): steps, Undo and version history, what moving means
  - troubleshooting, then the FAQ
- It links the Apple Notes import guide and /templates. The move guide links back.
- The cover is a diagram rather than an Amber capture: Mac ✓ / Cowork on web or phone, only through the open Mac / Mac asleep ✕. It's drawn at card width, padded to the same shape as the approved covers, on a new ground, rose. It has its own share card at /og/blog/claude-cowork-apple-notes.
- The Reddit reply drafts for both threads are in the private strategy folder (`strategy/reddit-drafts.md`, never pushed), for Emil to post.

## 1 October 2026: accuracy and sharing fixes from the blog audit

### Changed (branch `site/accuracy-sharing`)

- **Share images.** Every post now has its own 1200 × 630 card at /og/blog/<slug>: the title beside the post's cover, in the site's card look. It's rendered by `renderCard` at build time, one per published post. `pageMetadata` now always sets og:image and twitter:image. Posts use their own card. Help and download keep theirs. Every other page uses the site's card. Before this, no blog page had a share image, because the page metadata replaced the root Open Graph object.
  - The renderer can't read WebP, so the covers have small JPEG copies in `web/lib/og/covers`. A test checks that each published post has one.
- **Claude and Apple Notes.** Anthropic's Read and Write Apple Notes extension reads and writes notes on a Mac. The rows and paragraphs that called this read-only or "community tools" are corrected in notes-apps-with-mcp, amber-notes-vs-apple-notes, best-notes-app-for-ai-agents, apple-notes-vs-notion and apple-notes-vs-obsidian. claude-and-apple-notes now says a Mac-hosted server exposed through a tunnel can reach Claude on iPhone, with the caveats.
- **ChatGPT, web only.** OpenAI documents custom apps on the web, so every claim that they work in the ChatGPT phone app now says to use chatgpt.com. This covers the to-do FAQ, connect-chatgpt's "What you need", notes-apps-that-work-with-chatgpt, help and the draft. The plan lines now say "check what your plan allows; OpenAI's pages differ" on editing.
- **iOS 27.** Siri AI can add to and reformat notes (9to5Mac, 28 September). The post's title is now "What's new in Apple Notes in iOS 27, and how to use it". Its angle and the Siri section were rewritten, and its AI table's Claude row is corrected.
- **Availability.** The hard-coded "iPhone coming soon" lines in amber-notes-vs-apple-notes, apple-notes-vs-obsidian, apple-notes-vs-notion, best-notes-app-for-ai-agents, notes-apps-with-mcp, the to-do post and help now follow `APP_STORE_LIVE`. There's a new `DEVICES` helper.
- **Codex.** The guide leads with `codex mcp add amber_notes --url https://mcp.ambernotes.app` and its sign-in. The token setup comes second, with a line on what `pane_` means.
- **Nits:**
  - Apple Notes API: the Shortcuts names are corrected against the Notes app's own actions on macOS 26.5. "Append Checklist Item" does exist; "Pin Notes" is really "Pin or Unpin Notes".
  - ChatGPT memory: "Free gets a lighter version" became "what memory does can differ by plan".
  - Encrypted notes: "a secret only the AI holds" became the exact mechanism. The key is derived from the connection's token, we keep only the token's hash, and the token arrives with each request.
  - The move cover's "612" is not a mismatch. It's the Notes folder within the 1,284-note library on the same sheet, so the cover is unchanged.
- **Dates.** The updated date on every post changed here is now 1 October.

## 1 October 2026: blog pagination and category pages

### Changed (branch `site/blog-pagination`)

- **/blog** shows the 12 newest posts. Later pages are at /blog/page/2 and on, all built at build time; /blog/page/1 redirects (308) to /blog.
- **Categories are pages now.** /blog/category/apple-notes and the others replace the old #anchor filters. The filters only hid cards on the page in front of you, which pagination would have broken, and they never covered Apple Notes. Each category page has its own title, description and canonical, and is paged the same way (/blog/category/<name>/page/2 when it grows past 12). This is the indexable Apple Notes hub the plan proposed.
- **At the bottom of each page:** Previous, the page numbers and Next, each with a hit area of at least 44 by 44 px. The current page is marked with aria-current.
- **Head tags:** `<link rel="prev">` and `<link rel="next">` (React puts them in the head). Each page is its own canonical, and page 1 stays /blog. Titles: "Blog · Amber Notes", "Blog, page 2 · Amber Notes", "Apple Notes · Blog · Amber Notes".
- **Sitemap:** every page of the index and of each category, with the newest date among the posts that page shows. Google treats paginated pages as ordinary, self-canonical pages, and listing them costs nothing. Every post is listed too, so no post depends on a list page to be found.
- **Posts:** breadcrumbs, the category link under the title and the grouped "All posts" headings now go to the category pages instead of /blog#category.
- **Tests (`lib/seo.test.ts`):**
  - newest first, and every post on exactly one page
  - full pages except the last, and no empty page
  - page 1 at the list's own address, and the /page/1 redirect
  - static params for every page and category
  - every page in the sitemap, with no /page/1 and no duplicates
  - no post may take the slugs "page" or "category"

## 1 October 2026: covers redone to the approved standard

Emil flagged the newer covers: captures pinned to the top with empty ground below, text too small to read, content cut mid-line, and a Codex row on the Gemini card.

### What the approved covers (PRs #32 and #34) do

- A source about 700 to 860 px wide (2x), so text shows near full size on a card about 330 px wide.
- One meaningful moment, with about 24 px of the panel's own colour around it at card size.
- A picture about two thirds as tall as it is wide, so it fills the card's picture and fades out at the bottom.

### Changed (branch `site/covers-redo`)

- New offscreen renders in `PaneTests/HIG/BlogSnapshots.swift`:
  - `notesForCards`: the Welcome, Food and Places notes at 352 pt (704 px), so lines wrap at card width.
  - `chatGPTEditForCard`: Lisbon just after ChatGPT added a line.
  - `consentForCommandLine`: the consent sheet for an app on this computer, as Gemini CLI sees it.
  - `notesPasswordSheet` is now drawn at 440 pt.
- Every cover is cut at a clean content boundary, ends above the fade, and sits in an even 48 px (2x) margin of its own panel colour, two thirds as tall as wide:

  | Post | Cover |
  |---|---|
  | Recover deleted Apple Notes | dark version history: "2 lines differ", Groceries |
  | Gemini | "Allow an app on this computer to use your notes?" (was a Codex row) |
  | Forgot password | the password sheet's title and fields |
  | Encrypted notes | ChatGPT consent, down to "except locked notes" |
  | ChatGPT memory | Lisbon's plan with ChatGPT's tinted line |
  | iOS 27 | the Food table |
  | Markdown export | the Welcome note's title and its markdown line (no dangling heading) |
  | Obsidian MCP | the Places list and the Hotel booking sub-note |

- The two older covers that sat short at the top of the card, Apple Notes API (The basics) and the Claude Code work log (Standup), are padded to the same shape in their own background.
- Checked: /blog at 1440 px and at a true 390 px viewport (Chrome DevTools device metrics), every card, with lazy images loaded.

## 1 October 2026: blog quality pass

Audited the built pages (`next build`, then every `/blog/*.html`, `/help`, `/llms.txt` and `/llms-full.txt`).

### Found and fixed (branch `site/blog-quality`)

- **Search titles over 60 characters** on seven posts (66 to 88 with " · Amber Notes"). Each now has a shorter search title; the page headline stays as it was: Apple Notes API, Apple Notes in iOS 27, Apple Notes vs Notion, ChatGPT as a to-do list, the encrypted notes post, the forgotten password post and the recover post.
- **Meta descriptions over 160 characters** on two posts (iOS 27 and encrypted notes), shortened.
- **The same FAQ question on two posts**, which confuses FAQ rich results: "Is there an official Apple Notes MCP server?" (Apple Notes MCP and Claude and Apple Notes; the Claude post now asks "Does Apple make a way for Claude to use Apple Notes?", and its answer names Anthropic's extension) and "Which notes app works best with ChatGPT?" (the MCP comparison now asks "Which of these notes apps can ChatGPT reach?").
- **Dates**: the encrypted notes post went live on 1 October, so it's dated that day; Amber Notes vs Apple Notes and the MCP server page were updated for encryption and the new approval flow on 1 October, so their "updated" (and the sitemap's lastmod) say so. Posts that only gained a link keep their date.
- **Tests** in `lib/seo.test.ts` keep it that way: search titles at most 60 characters and unique, descriptions 70 to 160 and unique, "updated" never before "published", and no FAQ question repeated across posts or the help page.

### Checked, nothing to fix

- Internal links: every `/blog/<slug>` link points at a published post, and every `#anchor` link exists on its target page.
- FAQ JSON-LD: every post's FAQPage parses, each item is a Question with an accepted answer; Article has headline, dates and author; 86 distinct questions in all.
- /llms.txt and /llms-full.txt list all 23 published posts, each with its one-line description, and leave out the draft.

## 1 October 2026: round 15, "How to recover deleted Apple Notes"

### Query

- "recover deleted apple notes", "recently deleted notes iphone", "no recently deleted folder", "recover deleted notes after 30 days". Apple Support ranks, then recovery-software vendors (iMyFone, Syncios) and old pages; an honest "after 30 days" answer is the gap.

### Changed (branch `site/recover-deleted-notes`)

- New post `/blog/recover-deleted-apple-notes`, in Apple Notes:
  - checks first, from Apple's [missing notes article](https://support.apple.com/en-us/102476) (published 12 May 2026): search all accounts, account settings, other folders
  - Recently Deleted on iPhone, Mac and iCloud.com, from Apple's guides for each, and why the folder may not show
  - Gmail and Yahoo notes go to that account's Trash in Mail
  - after 30 days: Apple says permanently removed notes can't be recovered, and [iCloud Backup doesn't include notes already in iCloud](https://support.apple.com/en-us/108770); On My iPhone notes are in iPhone backups (restoring replaces the phone's data), On My Mac notes in Time Machine; shared notes you don't own reopen from the link
  - recovery apps: no claims about specific products, a warning about any that ask for the Apple Account password
  - Amber Notes' Recently Deleted (30 days, purged on the server too) and up to 100 earlier versions per note, from `docs/privacy-policy.md`
  - four FAQ answers
- A new capture: the version history sheet in dark mode, rendered offscreen by the existing `VersionHistorySnapshots` test; the card shows "Restore This Version" on a new ground, night.
- The forgot-password post links the new one.

## 1 October 2026: round 14, "Connect your notes to Gemini with MCP"

### Query

- "gemini mcp", "gemini mcp support", "gemini mcp connection", "gemini cli mcp server" (autocomplete). Official docs and GitHub rank; no notes app has a Gemini guide.

### Changed (branch `site/gemini-mcp`)

- New post `/blog/connect-notes-to-gemini`, in Guides:
  - the main how-to is Gemini CLI: `gemini extensions install https://github.com/amber-notes/amber-notes`, then `/mcp auth amber-notes`, the approval with the two-digit number, and `/mcp`; or `gemini mcp add --scope user --transport http amber-notes https://mcp.ambernotes.app`. Checked against Google's [MCP servers with Gemini CLI](https://geminicli.com/docs/tools/mcp-server/) and [extensions](https://geminicli.com/docs/extensions/) docs, and the install path in `web/lib/agent-installs.ts`, which was run end to end on 30 September
  - the Gemini app's custom apps, in a section labelled "not yet tested", from Google's [Connect & manage custom apps](https://support.google.com/gemini/answer/17209137): personal account, 18 or over, US, Keep Activity on, English, set up on gemini.google.com; the plan requirement (Google AI Pro or Ultra) is only in third-party guides, and the post says so
  - what Gemini can do with the tools, and that locked notes stay out of reach
  - three FAQ answers
- A new ground, linen, and a card cropped from the Connect an AI capture's promises ("You approve every AI.").
- The Claude Code and Codex post links the new one.

## 1 October 2026: round 13, "Forgot your Apple Notes password?"

### Query

- "forgot apple notes password", "lock notes password reset", "apple notes password reset" (autocomplete). The top results are Apple Community threads and unlock-tool vendors (Wondershare, Tenorshare, vocal.media); a factual page is the opening.

### Changed (branch `site/forgot-notes-password`)

- New post `/blog/forgot-apple-notes-password`, in Apple Notes:
  - why nobody can open a locked note (Apple's security guide: the key is derived from the passphrase; Apple's support article: Apple has no access)
  - what to try first: Face ID or Touch ID, the hint, the device passcode or Mac login password, older passwords, a password manager; and why not to reset first
  - resetting on iPhone and Mac, step by step from Apple's iPhone article (published 11 December 2025) and the Mac guide, and Change Password when you still know it
  - unlock apps can only guess passwords; prevention; and that imports, Amber Notes' included, leave locked notes behind, with Amber Notes' own locked notes described from `web/lib/privacy.ts`
  - five FAQ answers
- A new capture: Amber Notes' "Create a password for your locked notes" sheet, rendered offscreen by a new `BlogSnapshots.notesPasswordSheet` test; the card is cropped from it on a new ground, pearl.
- The move-from-Apple-Notes post links the new one where it says locked notes stay behind, and the new post links the encrypted-notes post (round 12).

## 30 September 2026: round 12, "An encrypted notes app that ChatGPT and Claude can use"

### Why

- End-to-end encryption for every note shipped in #52 (in production 30 September). That changes what the site can honestly claim, and "encrypted notes app" plus "ChatGPT" or "Claude" is a combination no other notes app can answer the same way.

### Changed (branch `site/encrypted-notes-ai`)

- New post `/blog/encrypted-notes-app-for-ai`, the first in Building Amber Notes. Every claim about Amber Notes comes from `web/lib/privacy.ts`, `docs/privacy-policy.md` and `docs/Technical/e2ee-design.md`:
  - what's encrypted, the key in iCloud Keychain, the recovery key, locked notes, signing in
  - how an AI reads encrypted notes: the approval on your device with the two-digit number and Face ID, Touch ID or passcode; the connection's wrapped copy of the key; unlocked in memory per request; deleted on disconnect
  - the limits from privacy.ts: AI requests (and Vercel and Supabase carrying the text), the recovery key in the browser, no key rotation, the database, shared notes; and what stays readable (from `READABLE`, so it can't drift)
  - a comparison: Apple Notes (Advanced Data Protection; locked notes always), Standard Notes (a community MCP server that decrypts locally), Notesnook (no official MCP server), Obsidian (local files, Obsidian Sync end to end), Notion (not end to end, official hosted MCP), each with its source
  - the iPhone app is in App Store review (from `APP_STORE_LIVE`)
- A new capture: the consent sheet as it ships now ("While it's connected, it can read everything you keep here except locked notes"), rendered offscreen by `ConnectSnapshotTests`; the card is cropped from it on a new ground, dusk.
- Sweep of outdated privacy and approval lines:
  - Help: connecting (approve on your iPhone or Mac by typing the number, or the recovery key), Incredible, "Can my AI see all my notes?" (the server opens what it asks for, in memory; not locked notes), and "Where are my notes stored?" (end-to-end encrypted, what stays readable), which now links the new post
  - `/blog/mcp-server`: the OAuth approval step and the install paragraph follow the new flow, and a paragraph explains the per-connection key and in-memory decryption
  - `/blog/amber-notes-vs-apple-notes`: an end-to-end encryption row
  - `web/lib/facts.ts`: one quotable encryption fact, which /llms.txt and /llms-full.txt pick up
  - no post said only locked notes were end-to-end encrypted; the older consent capture (`consent.webp`) still appears in three posts, and its captions stay true

## 30 September 2026: round 11, "ChatGPT memory vs notes"

### Query

- "chatgpt memory vs notes" and "chatgpt memory vs notes app". Results: MindStudio, Hjarni (a notes app with an MCP server), Simon Willison, ContextBolt, OpenAI. A fair explainer from a notes app that ChatGPT can reach fits it exactly.

### Changed (branch `site/chatgpt-memory-vs-notes`)

- New post `/blog/chatgpt-memory-vs-notes`, "ChatGPT memory vs a notes app ChatGPT can read", in Comparisons:
  - what memory is (saved memories and chat history, Settings, Personalization, the 30-day deletion when chat history is turned off, a lighter version on Free), from OpenAI's Memory in ChatGPT help page and "Memory and new controls" as quoted in search results; help.openai.com answers 403 to fetches, and the Chrome extension wasn't connected, so the page itself wasn't read
  - a side-by-side table, when memory is enough, when you want notes, and using both (memory keeps the instruction, notes keep the text)
  - no claims about unannounced memory changes: third-party posts describe a June 2026 "Dreaming" update that couldn't be checked against OpenAI, so the post only says memory changes often and links OpenAI's page
  - four FAQ answers with FAQPage JSON-LD
- A new ground, fog, and a card cropped from the Groceries version-history capture.

## 30 September 2026: round 10, Claude and Apple Notes after iOS 27

### Query

- "claude apple notes connector", "claude apple notes connector not working" (both in autocomplete), "can claude read apple notes on iphone". Results: GitHub repos, Medium, usecarly (July), Geeky Gadgets.

### Changed (branch `site/claude-apple-notes-ios27`)

- `/blog/claude-and-apple-notes`:
  - the desktop extension is named as what it is, Anthropic's Read and Write Apple Notes, with its read, add and update tools (the post said read only), and its checklist limit: checkboxes become plain bullets on update ([anthropics/claude-ai-mcp#29](https://github.com/anthropics/claude-ai-mcp/issues/29), January 2026, closed as not planned)
  - "If the Apple Notes connector isn't working": desktop app on a Mac only, the Automation permission, quit and reopen, synced and unlocked notes
  - "What changed in iOS 27": Siri AI searches notes itself; Claude isn't a Siri extension (MacRumors, 14 September); no MCP in iOS 27; Claude on iPhone reaches only internet servers
  - FAQ: a "connector not working" answer; the iPhone answer covers iOS 27
  - the Amber Notes bullets follow the new approval flow (type the number on your device) and say checklists stay checklists
  - link budget: the Apple Notes API link made way for the iOS 27 post (six links, the cap)

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
- The approval steps now match the connect flow that shipped with end-to-end encryption (#52), read from `web/app/connect/ConnectFlow.tsx` and `Pane/Views/ConnectAI.swift`: sign in on ambernotes.app, the page says Approve on your iPhone or Mac and shows a two-digit number, you type it in Amber Notes and choose Allow; "No device nearby? Use your recovery key" is the fallback. The Incredible-on-Windows line and "You stay in control" say the same.
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
