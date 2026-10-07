# Onboarding emails

Short emails from Emil to new accounts, as a next-step ladder. Built on `feat/lifecycle-emails`;
nothing is sent until the function is deployed, its secrets are set and `LIFECYCLE_ENABLED` is
`true`. They come from `Emil at Amber Notes <emil@ambernotes.app>`, and replies go to emil@.

Each round, an account gets the first rung it hasn't done and hasn't been sent. Every email goes
once at most, and is never sent once its step is done. A rung that applies but isn't ready yet (too
soon after sign-up or after connecting) holds the ladder: nothing further up jumps it.

| # | Email | For | Never sent once | Flag |
| --- | --- | --- | --- | --- |
| 1 | `stuck` | no note, a day after sign-up | a note exists | |
| 2 | `import` | Mac, fewer than 5 notes, never imported (from 12 h) | imported, or 5+ notes | |
| 3 | `connect` | no AI connected (from 12 h); sorting into folders when 20+ notes sit mostly (70%+) in one folder or none, a grocery list otherwise | an AI is connected | |
| 4 | `try` | AI connected a day ago, no AI edit: three prompts to paste | an AI edited a note | |
| 4b | `undo` | after the first AI edit | version history opened | |
| 5 | `apps` | no app note | `appNote` used | `APPS_LIVE` |
| 6 | `templates` | from day 3 | `template` used | |
| 7 | `iphone` | Mac only | an iPhone install | `APP_STORE_LIVE` |
| 7b | `mac` | iPhone only | a Mac install | |
| 8 | `share` | 3+ weeks in | `shareLink` used | `SHARING_LIVE` |

Spacing: at least 3 days apart in the first 10 days after sign-up, then at least 7. Silence: an account
with no sign of life since our last email (the app opened or synced, a note changed, an AI
connected, used or editing, a click on one of these emails, or a reply noted in `email_replies`)
gets at most one more email, after the long 7-day gap even in the first 10 days. After two emails in
a row with nothing in between, the emails stop until the person comes back, and then the normal
gaps apply again. `lifecycle_facts` gives the time of the last sign of life (`last_active_at`) and
how many emails went out since (`sent_since_active`). Replies aren't seen automatically: insert a
row into `email_replies` when someone writes back. At most 6 emails,
all within the first 30 days; nothing automatic after that. Accounts made before `LIFECYCLE_SINCE`
get nothing.

The migration adds `template` and `appNote` to `pane_feature_use`. The apps don't report either
yet: until the app calls `pane_feature_used('template')` when it adds a template from a link,
every account reaching rung 6 gets the templates email once. The `apps` and `share` words must be
checked against the shipped features before their flags go on.

The `connect` email's examples use only what the MCP tools do today (`append_to_note`,
`set_checklist_item`, `create_folder`, `move_note`); `try`'s prompts use `search_notes`,
`create_note`, `append_to_note` and `edit_note`. "Mostly in one folder" comes from folder ids alone
(folder names are encrypted), and no email ever says a number about the person's notes. An account whose browser connection is waiting
(`connect_asks`, which expire) gets a last line on typing the number.

## The welcome

One email a couple of minutes after an account is made, whichever way it was made (email, Apple,
Google): from Emil, what Amber Notes is (notes on iPhone and Mac that ChatGPT and Claude can read and
edit, end-to-end encrypted, free), one next step, and "Just reply, I read every email."

- **The step fits where the person is** (`welcomeStep` in `logic.ts`): no AI yet, Connect ChatGPT or
  Claude (`/open/connect-ai`); an AI but no app, which is someone who signed up through ChatGPT or
  Claude, Get the app (`/download`); both, one ask to try with Ask ChatGPT and Ask Claude.
- **When.** `lifecycle_welcome_tick` runs every minute and calls the function's `/welcome` only when
  an account made 2 to 60 minutes ago has no welcome row and hasn't unsubscribed. The two minutes let
  the app report its device and an AI connection made while signing up land, so the step is right.
  An account the function missed within the hour (off or down) never gets one.
- **Once.** Its `email_sends` row (kind `welcome`) is unique per account, like every other email, and
  Resend gets the idempotency key `lifecycle-welcome-<account>`.
- **The same rules otherwise:** LIFECYCLE_ENABLED, LIFECYCLE_SINCE, LIFECYCLE_ONLY, the unsubscribe
  link and headers, and the staging subject prefix. It ignores the 9 o'clock rule.
- **With the ladder.** The welcome counts for spacing: the ladder's first email waits its usual 3
  days after it, so it comes on day 3 instead of day 1, and never the day after the welcome. It isn't
  counted toward the 6-email cap, and an unanswered welcome isn't part of the silence rule.

## Where each button goes

Every button leads somewhere specific: into the app through a universal link under `/open/` (the
site's apple-app-site-association claims `/open/*`), a section of the site, or a store. Each
`/open/` place has a page at the same address (`web/app/open/`) that tries the app and otherwise
says how to do it by hand, with Open in Amber Notes and the download.

| Email | Button | Goes to | In the app (`Pane/Model/AppPlace.swift`) |
| --- | --- | --- | --- |
| stuck | Reply to Emil | `mailto:emil@ambernotes.app` | |
| import | Import my Apple Notes | `/open/import` | Mac: Import from Apple Notes; iPhone: says to do it on the Mac |
| connect | Connect in a few minutes | `/open/connect-ai` | Settings at Connect an AI |
| try | Ask ChatGPT / Ask Claude | `chatgpt.com/?q=` / `/copy/<id>` | |
| undo | See your note's history | `/open/history` | version history of the note an AI changed last, or the notes |
| apps | See apps you can start from | `/templates?category=apps` | |
| templates | Use the … template / See all templates | `/open/template/<slug>` / `/templates` | adds the template note |
| iphone | Get it on the App Store | the App Store listing | |
| mac | Download for Mac | `/download` | |
| share | How sharing works | `/help#share` | when sharing with people ships: `/open/share-help` or its own help section |

## What decides, and what it never reads

`public.lifecycle_facts(since)` (migration `20261006090000_lifecycle_emails.sql`) gives, per
account: the address, the sign-up time, the number of notes (`count(*)` on `notes.user_id`, never a
column of the note), whether it imported (`pane_setup.imported_at`), its device kinds
(`pane_devices`), when an AI was first connected (`mcp_tokens`, OAuth grants included), whether a
connection is waiting (`connect_asks`), on how many days an AI edited (`pane_activity`), the
features it used (`pane_feature_use`), what was already sent and whether it said stop. A test
checks the function's definition for note columns.

## How a round works

pg_cron runs `public.lifecycle_tick()` every hour; each account's email goes in the round where it's 9 in its morning. It posts to the `lifecycle` function with
`x-lifecycle-secret`, using two vault secrets (`lifecycle_url`, `lifecycle_cron_secret`), and does
nothing while pg_net or either secret is missing.

The function (`supabase/functions/lifecycle/`):

- `logic.ts`: the schedule (`SEQUENCE`, `GAP_MS`), `decide()`, unsubscribe tokens, settings.
- `emails.ts`: the four emails as words, HTML and plain text.
- `run.ts`: for each account due an email, claims it in `email_sends` inside a transaction with a
  per-account advisory lock that re-checks the gap and unsubscribes, then sends through Resend with
  an idempotency key, then records the outcome. A refused or unanswered send keeps its row, is
  never retried and counts toward the spacing and the limit; only 429 (Resend took nothing) removes the row
  so the next round tries again.
- `index.ts`: `POST /lifecycle` (the round) and `POST /lifecycle/unsubscribe?u=&t=`.

With `LIFECYCLE_ENABLED` anything but `true`, a round only counts what would go and answers
`{ due: {...} }`. `LIFECYCLE_ONLY` (comma-separated account ids) limits sending to those accounts,
for a first try on a test account.

## Unsubscribing

Every email has "Stop these emails" in its footer and the headers
`List-Unsubscribe: <https://ambernotes.app/unsubscribe/confirm?u=…&t=…>, <mailto:emil@ambernotes.app?subject=Unsubscribe>`
and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), which Gmail and Yahoo ask of
bulk senders. `t` is an HMAC of the account id under `LIFECYCLE_UNSUBSCRIBE_SECRET`.

- The footer link opens `ambernotes.app/unsubscribe`, which changes nothing until its one button is
  pressed (mail scanners open links). The button posts to `/unsubscribe/confirm`.
- A mail app's own unsubscribe button posts `List-Unsubscribe=One-Click` to the same address.
- `/unsubscribe/confirm` (`web/app/unsubscribe/confirm/route.ts`) passes it to the function, which
  checks the HMAC and writes `email_unsubscribes`. GET does nothing.

A reply saying "stop" is handled by hand: add the account to `email_unsubscribes` with source
`link`.

## The emails, and real mail apps

Each email is a note from Emil, drawn the way the site draws notes (the 404 and template pages): a
paper-cut picture on top, then an Amber Notes window with "From Emil", the title, one paragraph, a
button, a line and the sign-off. The pictures are for warmth; where a real capture of the app
explains something, it goes inside the note as proof. On a phone the "From Emil" line is hidden.

Paper-cut pictures (`web/public/email/hero-*.jpg`): stuck, import, try, undo, sorting and templates
are cut from the template covers in `web/public/templates/covers/`; connect, apps, iPhone, Mac and
share were made for these emails in the same style (prompts and the candidates in
`~/content-tools/projects/amber-emails-art`, outside this repository).

Real captures inside the note:

| File | Email | From |
| --- | --- | --- |
| `connect.jpg` | connect (grocery list) | `web/public/blog/amber-notes-iphone-chatgpt-edited-checklist.webp` and the receipt `web/public/demo/720/pill-chatgpt-5-lines@2x.png` |
| `receipt.png` | undo | the same receipt |
| `tc-*.jpg` | templates | each template's paper-cut cover from `web/public/templates/covers/`, cropped like the site's cards |
| `app-habits.jpg`, `app-budget.jpg` | apps | the app-notes prototype's habit tracker and budget, generic data |
| `share.jpg` | share | collab-design's still of a shared note: two avatars and a named cursor |

`supabase/functions/lifecycle/assets.test.ts` fails if any email, in any variant, points at a picture that
isn't in `web/public/email/`.

The connect email has no capture of a ChatGPT conversation about groceries: none exists, and making
one means a real ChatGPT account. The ask is in the words instead.

**Try this first** shows each prompt as you'd type it, with "Ask ChatGPT" and "Ask Claude" under it.
Checked on 5 October 2026 (from published sources; both sites block automated browsers, so neither
was opened):

- `https://chatgpt.com/?q=<prompt>` fills ChatGPT's composer. Since OpenAI's fix of April 2025
  (Tenable TRA-2025-22) a link from another site no longer sends it by itself. The person still has
  to add Amber Notes from the tools menu, which the email says.
- `https://claude.ai/new?q=<prompt>` stopped filling the composer on claude.ai around 3 October 2025
  (anthropics/claude-code#8827, closed as not planned) and isn't documented. Claude documents
  `claude://claude.ai/new?q=` for the desktop app and `claude.ai/code/new?q=` for Claude Code only.
  So "Ask Claude" goes to `ambernotes.app/copy/<id>`: one button copies the prompt, says so, and
  opens claude.ai/new to paste it. The page only knows the emails' own prompts
  (`supabase/functions/lifecycle/prompts.json`, the same list as `web/lib/try-prompts.json`).

Checked against caniemail.com's data (16 September 2026) for Gmail (web, iOS, Android), Apple Mail
(Mac, iOS), Outlook (Windows, Outlook.com, iOS, Mac) and Yahoo:

- **Layout:** tables and inline styles; no flex, grid, background images, web fonts or SVG. The
  button is a VML shape in Outlook for Windows, which ignores `border-radius` and padding on links.
- **Shapes:** checkboxes are table cells with a background or border, so Outlook
  for Windows shows them (square there); `display:inline-block` spans would vanish.
- **Style blocks:** three of them (phone spacing; dark mode and `color-scheme`; Outlook.com's
  `[data-ogsc]`/`[data-ogsb]`), so a client that throws one away keeps the others. Gmail ignores
  `prefers-color-scheme` and attribute selectors, and its apps ignore `<style>` entirely for
  non-Google accounts; those see the light layout from inline styles, which works at any width.
- **Dark mode:** Apple Mail and the Outlook apps use the media query. Outlook.com uses the
  `[data-ogsc]` rules. Gmail's apps invert colours by themselves and never images: the page is
  `#fffdf9` and text `#1d1d1f` (no pure white or black), and the light captures keep a hairline
  edge on a dark page.
- **Outlook for Windows:** `mso-line-height-rule:exactly` on body text, images with width and
  height attributes, a fixed 520 px table around the layout.
- **Not fixable, acceptable:** square corners and no shadows in Outlook for Windows; no
  `line-through` on done items for Gmail with non-Google accounts.

`deno run -A scripts/lifecycle-preview.ts <folder>` writes every email (as sent, forced light,
forced dark) to a folder; it sends nothing. `scripts/lifecycle-test-send.ts` sends every variant to
up to 10 test addresses through Resend, marked "[Test n/N]", and only with `--send`; without it, it
prints what it would send.

## Open and read rates: the plan

What to count, from most to least useful:

1. **The step got done.** Each rung's goal is already the measure: did the person import, connect,
   try, use a template after the email? `POST /lifecycle/stats` gives, per email and subject line,
   how many went out and how many of those accounts have done the step since.
2. **Replies.** Every email is from Emil and asks for a reply. Count them by hand in Gmail (a label
   per email) until there are enough to matter.
3. **Clicks.** With `LIFECYCLE_TRACK_CLICKS=true`, links to ambernotes.app, ChatGPT, Claude and the
   App Store go through `ambernotes.app/go`, which tells the function which email and which link
   (host and path, never the query) and sends the reader on within a moment. No third party, no
   cookie, no address. The unsubscribe and privacy links are never wrapped. Microsoft's Safe Links
   and similar scanners open links, so clicks run a little high, and more so for work addresses.
4. **Opens: not measured.** Apple Mail Privacy Protection loads every image for a large share of
   iPhone and Mac readers, so opens are noise there, and a tracking pixel in email from an
   encrypted-notes app says the wrong thing about it. There's no pixel.

**Subject lines.** Each email has two subjects and previews. With `LIFECYCLE_SUBJECT_TEST=true`,
each account gets one of the two, fixed by its id, and the row keeps which (`email_sends.variant`).
Compare by "step done" first and clicks second, per email, once each side has about 50 sends; below
that, differences are noise. Keep the winner as the first line, write a new challenger, repeat.

**Sender name.** Today `Emil at Amber Notes`. Next test: `Emil from Amber Notes`, the same way,
through `LIFECYCLE_FROM`, one month each, compared on replies and steps done.

**Send time.** The round runs every hour, and each account gets its email in the round where it's
9 in the morning on its device. That needs the device's UTC offset in `pane_devices.utc_offset_minutes`,
which the apps don't send yet (`pane_seen_device` needs a third argument; not built). Until they do,
every account is treated as Central European time: 08:00 UTC.

## Settings

| Secret | What |
| --- | --- |
| `LIFECYCLE_ENABLED` | `true` to send. Anything else, or unset, sends nothing. |
| `LIFECYCLE_SINCE` | ISO date. Accounts made before it get nothing. |
| `RESEND_LIFECYCLE_KEY` | A Resend API key, sending access, ambernotes.app only, from the Amber Notes Resend account. |
| `LIFECYCLE_UNSUBSCRIBE_SECRET` | 32+ random characters. Changing it breaks the links in emails already sent. |
| `LIFECYCLE_CRON_SECRET` | 32+ random characters, the same value as the vault's `lifecycle_cron_secret`. |
| `LIFECYCLE_FROM` | Optional. Default `Emil at Amber Notes <emil@ambernotes.app>` (replies go to emil@ too). |
| `LIFECYCLE_ONLY` | Optional. Comma-separated account ids that may get email; everyone else gets none. |
| `APPS_LIVE`, `APP_STORE_LIVE`, `SHARING_LIVE` | `true` turns on the apps, iPhone and sharing rungs, once those features ship. |
| `LIFECYCLE_SUBJECT_TEST`, `LIFECYCLE_TRACK_CLICKS` | `true` turns on the subject-line comparison and click counting. |

Deploy with `supabase functions deploy lifecycle --no-verify-jwt`: the round checks its own secret
and an unsubscribe link carries its own HMAC.

## Testing

`deno test -A supabase/functions/lifecycle/` runs the ladder (order, each rung's goal, the flags,
spacing, the limit of 6, the 30 days), the emails (size, no dashes, links in both versions, one
paragraph before the button, image addresses and sizes, no flex, grid, background images, pure
white or black, three style blocks) and the round against every migration in PGlite with a fake
Resend: never twice (including rounds at once), a Mac account walked up the ladder, stops at the
goal, flags, the limit, unsubscribe, the kill switch, `LIFECYCLE_SINCE` and `LIFECYCLE_ONLY`,
failures and 429, and that clients can't reach the tables. `cd web && pnpm exec vitest run
app/unsubscribe` runs the page and the route.

## The same steps in the app (not built)

Places the app could say the same thing at the same step, with the same words, so an email never
tells someone something the app doesn't:

- **Bring your notes.** The setup card already has it. On the Mac, the idea in the strategy doc (a
  reminder when Apple Notes opens, for accounts that never imported) is the in-app twin of the
  stuck email.
- **Connect your AI.** Under the card's Connect your AI step, rotate the three examples the emails
  use (the grocery list, the messy note, sorting into folders) instead of one fixed line.
- **Sorting.** When Notes holds many notes and the account has no AI, a tip in the tips system
  (`pane_tip_activity`): "Ask your AI to sort these into folders", with Connect an AI.
- **A connection that didn't finish.** The app sees `connect_asks` in realtime. When one expires
  unanswered, a card: "Finish connecting ChatGPT", with the number step explained.
- **Try it.** The card says "Ask your AI to add "Call mom" to To-do". The emails' grocery example
  is the same kind of first task; keep the two close.
- **Templates.** A "New from Template" picker (proposed in the strategy doc), shown once an AI is
  connected, with the same three templates the email uses.
- **Undo and history.** After the first AI edit, the receipt already offers Undo. A one-time tip
  pointing at More, then Show Version History, is the twin of the Undo email.
