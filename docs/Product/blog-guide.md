# How to write a blog post

How posts on ambernotes.app/blog are written and built. Each post is its own page source under
`web/app/blog/<slug>/page.tsx`, listed in `web/lib/posts.ts` and rendered by `web/lib/PostPage.tsx`.

## Principles (2026-10-06)

Emil's bar: posts should be charming and really good, not a wall of boring text, and they should
give more than they take.

- **Answer first.** Someone from a search result should have the answer on the first screen at
  390 px. Keep the intro to one or two sentences, then put the short answer in an `Answer` block with
  links that jump to the sections.
- **Give something to keep.** Every post gives the reader something useful beyond the answer. For
  example:
  - a copyable checklist, cheat sheet, script or prompt that works in any AI (`Keep`);
  - a small helper that picks the right path for them (`ResetChooser` is the pattern);
  - a comparison table worth bookmarking;
  - a link to a free template at `/templates` where one fits.
- **Make it scannable.** Write steps as a numbered list (`Steps`) and menu paths as chips (`Path`,
  `Paths`). Give every section an `id`, so the short answer and other posts can link to it.
- **Charm without fluff.** Each post opens with a paper-cut banner (`art`, above the intro) in the
  style of the email heroes (`web/public/email/hero-*.jpg`), so the first screen isn't only text.
  Small warm details carry it further: the leaf on the short answer, checklists drawn with Notes'
  round boxes.
- **Say each thing once.** Don't repeat a list as an answer box, then steps, then a checklist, then
  a table. Pick the one form that suits it and link to it. Write warmly and specifically: real menu names, real
  numbers, first person where Emil built something. Cut filler sentences.
- **Real visuals only where they show a product.**
  - Screenshots and loops of Apple Notes or Amber Notes must be real captures.
  - Caption a capture with the OS version it came from. Never let a macOS 26 capture pass for iOS 27.
  - For a feature you can't capture, use numbered steps plus Apple's own wording, linked to Apple's
    support page.
  - For Apple's own apps, capture them in a throwaway macOS VM with no account (tart's vanilla
    image for the current macOS, on the fleet Air), never on anyone's real Mac or iCloud. Delete the
    VM after. There's no honest way to capture a new iOS's Notes this way, so don't put a Mac
    capture in a phone frame; say the same option is in the iPhone menu, in Apple's words.
  - A real capture beats decoration: put the best one where the banner would go (`hero`).
  - Generated art is decoration only (`alt=""`), and never a picture of an app's screen.
- **The Amber Notes section comes last, and stays honest and modest.**
  - It starts only once the reader has been helped.
  - It says what Amber Notes does and what it doesn't.
  - It ends with the post's one call to action (`PostCta`). No pop-ups and no second ask.
- **Check the facts.**
  - Apple's documentation for Apple features.
  - `Pane/` for anything Amber Notes does.
  - iPhone and Mac only.
  - Nothing about unreleased Amber Notes features.
  - The iPhone app is "coming soon" until `APP_STORE_LIVE` is on.
- **Write plainly.** No em or en dashes, and no AI tells. Sentence case.
- **Keep pages light.**
  - Images are WebP or AVIF, under about 150 KB each, with width and height set.
  - Anything below the fold loads lazily.
  - A loop is a few seconds of muted MP4 that loads near the screen and plays only while visible.
  - No layout shift.
  - Check at 390 px and on desktop before opening the PR.

## Design tells to avoid (2026-10-06)

Emil called these "the basic AI tell of design". Don't use them on the blog, or anywhere else on the
site:

- A card with rounded corners and a coloured stripe down its left side. Emphasise the short answer
  with type instead: a small label, slightly larger text, and the blog's dashed rule under it.
- Rows of pills, such as "jump to" chips. Use plain inline links, separated by a dot.
- Stacks of identical cards. Numbered steps are a list with amber numbers, not a card per step.
- Gradient cards, icon-plus-heading grids, decorative stripes and emoji.
- A label like "Keep this" repeated on every block. Let the title say what the block is.

Before opening a PR, look at every scroll frame at 390 px and 1440 px, one viewport at a time, as
someone who just arrived from Google. Check that each frame makes sense on its own, and that nothing
is cramped, cut off, repeated or generic. The blog pages are always cream (`lib/theme.ts`), so there
is no dark version to check.

## The parts

| Part | File | What it's for |
|---|---|---|
| `Answer` | `web/lib/PostParts.tsx` | The short answer under the intro, with jump links (`answer` prop of `PostPage`) |
| `Banner` | `web/lib/PostParts.tsx` | The paper-cut art above the intro (`art` prop of `PostPage`: `/blog/art/<slug>`, `.avif` and `.webp`, 1200×480) |
| `Steps`, `Path`, `Paths` | `web/lib/PostParts.tsx` | Numbered steps, and menu paths as keycap-like chips, per device |
| `Keep` | `web/lib/PostParts.tsx` | Something to copy: a cheat sheet, script or prompt |
| `Checklist` | `web/lib/PostParts.tsx` | A checklist to copy, drawn like a Notes checklist, copied as lines that become one with a tap |
| `ResetChooser` | `web/lib/ResetChooser.tsx` | A question-by-question helper; copy its shape for other choosers |
| `Loop` | `web/lib/Loop.tsx` | A short muted loop of the real app, from `web/public/blog/loops/` |
| `Capture` | `web/lib/PostParts.tsx` | A real capture of Apple's apps from `web/public/blog/macos27/`, AVIF and WebP, captioned with its OS; `hero` puts one above the intro |
| `Figure` | `web/lib/blog.tsx` | A real capture in a window or phone frame |
| `PostCta` | `web/lib/PostCta.tsx` | The one call to action, at the end of the Amber Notes section |

## What's measured

All of it is in `docs/Evidence/website-posthog.md`.

- `blog_cta_clicked` (with `slug`, `position` and `action`) for the call to action.
- `blog_copy_clicked` for a `Keep` copy.
- `blog_helper_used` for a chooser answer.
- `download_mac_clicked`, with the page's `path`, for a download.
