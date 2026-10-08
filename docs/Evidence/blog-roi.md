# Blog ROI

What each blog post brings in, per post, so the next post or upgrade goes where it pays. Updated by
the daily growth loop; the dated reading of each day is in [growth-log.md](growth-log.md).

## How it's counted

- **Source:** PostHog EU project 291184 (ambernotes.app). The site is cookieless until someone
  accepts the banner, so one visitor on one day is one `distinct_id`; a "visit" below is one
  visitor-day that viewed the post.
- **Google landings:** visits whose first page view of the day was the post, with google in the
  referring domain.
- **Read 75%:** visits whose deepest `scroll_depth` on the post was 75% or more.
- **Actions:** `blog_cta_clicked`, `blog_copy_clicked`, `blog_helper_used`, `copy_prompt_clicked`,
  `use_template_clicked` and `outbound_claude_clicked` in the same visit, on any page.
- **Downloads:** visits with a `download_mac_clicked` the same day.
- Our own checks are in these numbers (most of them from macOS). Numbers this small move a lot from
  one person.

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
- Search Console wasn't reached this time (see the 8 October log).

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
