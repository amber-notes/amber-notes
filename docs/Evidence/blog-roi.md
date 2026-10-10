# Blog ROI

What each blog post brings in, per post, so the next post or upgrade goes where it pays. Updated by
the daily growth loop; the dated reading of each day is in [growth-log.md](growth-log.md).

## How it's counted

- **Source:** PostHog EU project 291184 (ambernotes.app, and pintonotes.com from 8 October). The site is cookieless until someone
  accepts the banner, so one visitor on one day is one `distinct_id`; a "visit" below is one
  visitor-day that viewed the post.
- **Google landings:** visits whose first page view of the day was the post, with google in the
  referring domain.
- **Read 75%:** visits whose deepest `scroll_depth` on the post was 75% or more.
- **Actions:** `blog_cta_clicked`, `blog_copy_clicked`, `blog_helper_used`, `copy_prompt_clicked`,
  `use_template_clicked` and `outbound_claude_clicked` in the same visit, on any page.
- **Downloads:** visits with a `download_mac_clicked` the same day.
- No bot filter: cookieless events carry no user agent, so PostHog's `isLikelyBot` marks all of them
  as bots and would drop most real visitors.
- Our own checks are in these numbers (most of them from macOS). Numbers this small move a lot from
  one person.

## 2 to 10 October 2026 (to 09:00 UTC on 10 October)

Both hosts together. Every visit since 8 October 15:54 UTC is on pintonotes.com.

| Post | Visits | Google landings | Avg. depth | Read 75% | Actions | Downloads |
|---|---|---|---|---|---|---|
| /blog/apple-notes-ios-27 | 10 | 5 | 71% | 3 | 0 | 0 |
| /blog/apple-notes-api | 7 | 3 | 79% | 4 | 0 | 0 |
| /blog/forgot-apple-notes-password | 4 | 2 | 50% | 1 | 1 | 0 |
| /blog/notes-apps-with-mcp | 3 | 0 | 50% | 1 | 0 | 0 |
| /blog/apple-notes-not-syncing | 3 | 0 | 83% | 2 | 1 | 0 |
| /blog/connect-chatgpt-to-your-notes | 3 | 0 | 38% | 0 | 0 | 0 |
| /blog/best-notes-app-for-ai-agents | 2 | 1 | 50% | 1 | 0 | 0 |
| /blog/move-apple-notes-to-icloud | 1 | 0 | 75% | 1 | 0 | 0 |
| /blog/apple-notes-tags-smart-folders | 1 | 0 | 75% | 1 | 1 | 0 |
| /blog/export-apple-notes-to-markdown | 1 | 0 | 25% | 0 | 0 | 0 |
| /blog/claude-and-apple-notes | 1 | 0 | 25% | 0 | 0 | 0 |
| /blog/notes-in-claude-code-and-codex | 1 | 0 | | 0 | 0 | 0 |
| /blog/apple-notes-mcp | 1 | 0 | | 0 | 0 | 0 |
| /blog/obsidian-mcp-servers-compared | 1 | 0 | | 0 | 0 | 0 |
| Every other post | 0 | 0 | | | | |

- New since 9 October: six post visits (notes-apps-with-mcp 2, apple-notes-not-syncing, best-notes-app-for-ai-agents,
  claude-and-apple-notes, notes-in-claude-code-and-codex), all on pintonotes.com, none from search. The MCP and
  Claude posts fit the visitors who came from claude.ai and GitHub on the Mac 1.2 release day.
- The action on apple-notes-not-syncing is two chooser answers from a Mac that opened the post directly, 17
  seconds apart, on the afternoon the upgrade went live. Most likely our own check.
- /blog/obsidian-mcp-servers-compared is an old address that now redirects to /blog/obsidian-mcp; the one view is
  from before 9 October.
- Still no post visit followed by Download for Mac the same day. `blog_cta_clicked` and `blog_copy_clicked`
  haven't fired.
- Search Console has published nothing after 6 October for ambernotes.app, and the pintonotes.com property is
  still "Processing data", so the per-post impressions are the same as in the 9 October reading below.

## 2 to 9 October 2026 (to 09:15 UTC on 9 October)

Both hosts together. Since 8 October 15:54 UTC every visit is on pintonotes.com.

| Post | Visits | Google landings | Avg. depth | Read 75% | Actions | Downloads |
|---|---|---|---|---|---|---|
| /blog/apple-notes-ios-27 | 10 | 5 | 71% | 3 | 0 | 0 |
| /blog/apple-notes-api | 7 | 3 | 79% | 4 | 0 | 0 |
| /blog/forgot-apple-notes-password | 4 | 2 | 50% | 1 | 1 | 0 |
| /blog/connect-chatgpt-to-your-notes | 3 | 0 | 38% | 0 | 0 | 0 |
| /blog/apple-notes-not-syncing | 2 | 0 | 75% | 1 | 0 | 0 |
| /blog/best-notes-app-for-ai-agents | 1 | 1 | 75% | 1 | 0 | 0 |
| /blog/notes-apps-with-mcp | 1 | 0 | 100% | 1 | 0 | 0 |
| /blog/move-apple-notes-to-icloud | 1 | 0 | 75% | 1 | 0 | 0 |
| /blog/apple-notes-tags-smart-folders | 1 | 0 | 75% | 1 | 1 | 0 |
| /blog/export-apple-notes-to-markdown | 1 | 0 | 25% | 0 | 0 | 0 |
| /blog/notes-in-claude-code-and-codex | 1 | 0 | | 0 | 0 | 0 |
| /blog/apple-notes-mcp | 1 | 0 | | 0 | 0 | 0 |
| Every other post | 0 | 0 | | | | |

- New since 8 October: three post visits, all on pintonotes.com, none from search. The apple-notes-mcp
  one was followed 14 seconds later by a view of www.pintonotes.com, so it is most likely our own
  check of the move.
- The connect-chatgpt-to-your-notes visit was on an iPhone, came from the home page, reached the middle
  of the post and logged one dead click and two dead swipes. Worth a look at that post on a phone.
- No Google landing on either host since 8 October 10:00 UTC. Search Console's numbers end on
  6 October, so whether clicks fell with the move can't be read yet.
- Still no post visit followed by Download for Mac the same day. `blog_cta_clicked` and
  `blog_copy_clicked` haven't fired.
- Search Console, last 7 days of Google's data (to 6 October), impressions and clicks per post:
  forgot-apple-notes-password 190 and 1, move-apple-notes-to-icloud 109 and 0, apple-notes-not-syncing
  92 and 1, apple-notes-ios-27 91 and 3, connect-chatgpt-to-your-notes 68 and 0, apple-notes-api 57 and
  3, apple-notes-tables 55 and 0, best-notes-app-for-ai-agents 10 and 1.

## 2 to 8 October 2026 (to 10:00 UTC on 8 October)

"Actions" is now the number of visits with at least one action, not the number of events.

| Post | Visits | Google landings | Avg. depth | Read 75% | Actions | Downloads |
|---|---|---|---|---|---|---|
| /blog/apple-notes-ios-27 | 10 | 5 | 71% | 3 | 0 | 0 |
| /blog/apple-notes-api | 7 | 3 | 79% | 4 | 0 | 0 |
| /blog/forgot-apple-notes-password | 4 | 2 | 50% | 1 | 1 | 0 |
| /blog/apple-notes-not-syncing | 2 | 0 | 75% | 1 | 0 | 0 |
| /blog/connect-chatgpt-to-your-notes | 2 | 0 | 25% | 0 | 0 | 0 |
| /blog/best-notes-app-for-ai-agents | 1 | 1 | 75% | 1 | 0 | 0 |
| /blog/notes-apps-with-mcp | 1 | 0 | 100% | 1 | 0 | 0 |
| /blog/move-apple-notes-to-icloud | 1 | 0 | 75% | 1 | 0 | 0 |
| /blog/apple-notes-tags-smart-folders | 1 | 0 | 75% | 1 | 1 | 0 |
| /blog/export-apple-notes-to-markdown | 1 | 0 | 25% | 0 | 0 | 0 |
| Every other post | 0 | 0 | | | | |

- New since 7 October: the first `blog_helper_used` from a real visitor. Someone from Google on
  forgot-apple-notes-password answered the chooser four times in 20 seconds, then left after 37
  seconds without reaching the call to action.
- The blog's list pages get read too: /blog/page/3 had 4 visits and /blog/page/2 had 3, mostly read
  to the end. Each had one visit that also clicked Download for Mac that day, possibly the same
  visitor.
- Still no visit that read a post clicked Download for Mac the same day. `blog_cta_clicked` and
  `blog_copy_clicked` haven't fired yet.
- Search Console, last 7 days of Google's data (to 5 October): 674 impressions, 13 clicks. The same
  posts lead (forgot-apple-notes-password, apple-notes-api, recover-deleted-apple-notes,
  apple-notes-mcp). /blog/apple-notes-not-syncing is "Crawled, currently not indexed".

## 2 to 7 October 2026 (to 09:00 UTC on 7 October)

| Post | Visits | Google landings | Avg. depth | Read 75% | Actions | Downloads |
|---|---|---|---|---|---|---|
| /blog/apple-notes-ios-27 | 10 | 5 | 71% | 3 | 0 | 0 |
| /blog/apple-notes-api | 6 | 3 | 79% | 4 | 0 | 0 |
| /blog/forgot-apple-notes-password | 3 | 1 | 62% | 1 | 0 | 0 |
| /blog/apple-notes-not-syncing | 2 | 0 | 75% | 1 | 0 | 0 |
| /blog/connect-chatgpt-to-your-notes | 2 | 0 | 25% | 0 | 0 | 0 |
| /blog/best-notes-app-for-ai-agents | 1 | 1 | 75% | 1 | 0 | 0 |
| /blog/notes-apps-with-mcp | 1 | 0 | 100% | 1 | 0 | 0 |
| /blog/move-apple-notes-to-icloud | 1 | 0 | 75% | 1 | 0 | 0 |
| /blog/apple-notes-tags-smart-folders | 1 | 0 | 75% | 1 | 2 | 0 |
| Every other post | 0 | 0 | | | | |

- No visit that read a post clicked Download for Mac the same day. All 10 `download_mac_clicked`
  of the week started on /, /download or /templates.
- `blog_cta_clicked`, `blog_copy_clicked` and `blog_helper_used` (live since PR 201 on 6 October)
  haven't fired yet.
- Search Console, last 7 days of Google's data (to 4 October): the posts behind the top queries are
  forgot-apple-notes-password ("forgot notes password" and four variants), apple-notes-api ("apple
  notes api", "icloud notes api"), recover-deleted-apple-notes ("how to restore deleted notes",
  position 32) and apple-notes-mcp ("apple notes mcp", position 52).
