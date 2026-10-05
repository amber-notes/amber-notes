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
| 3 | `connect` | no AI connected (from 12 h); sorting for an imported or 20+ note library, a grocery list otherwise | an AI is connected | |
| 4 | `try` | AI connected a day ago, no AI edit: three prompts to paste | an AI edited a note | |
| 4b | `undo` | after the first AI edit | version history opened | |
| 5 | `apps` | no app note | `appNote` used | `APPS_LIVE` |
| 6 | `templates` | from day 3 | `template` used | |
| 7 | `iphone` | Mac only | an iPhone install | `APP_STORE_LIVE` |
| 8 | `share` | 3+ weeks in | `shareLink` used | `SHARING_LIVE` |

Spacing: at least 3 days apart in the first 10 days after sign-up, then at least 7. At most 6 emails,
all within the first 30 days; nothing automatic after that. Accounts made before `LIFECYCLE_SINCE`
get nothing.

The migration adds `template` and `appNote` to `pane_feature_use`. The apps don't report either
yet: until the app calls `pane_feature_used('template')` when it adds a template from a link,
every account reaching rung 6 gets the templates email once. The `apps` and `share` words must be
checked against the shipped features before their flags go on.

The `connect` email's examples use only what the MCP tools do today (`append_to_note`,
`set_checklist_item`, `create_folder`, `move_note`); `try`'s prompts use `search_notes`,
`create_note`, `append_to_note` and `edit_note`. An account whose browser connection is waiting
(`connect_asks`, which expire) gets a last line on typing the number.

## What decides, and what it never reads

`public.lifecycle_facts(since)` (migration `20261006090000_lifecycle_emails.sql`) gives, per
account: the address, the sign-up time, the number of notes (`count(*)` on `notes.user_id`, never a
column of the note), whether it imported (`pane_setup.imported_at`), its device kinds
(`pane_devices`), when an AI was first connected (`mcp_tokens`, OAuth grants included), whether a
connection is waiting (`connect_asks`), on how many days an AI edited (`pane_activity`), the
features it used (`pane_feature_use`), what was already sent and whether it said stop. A test
checks the function's definition for note columns.

## How a round works

pg_cron runs `public.lifecycle_tick()` daily at 08:00 UTC. It posts to the `lifecycle` function with
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

Each email is a note in an Amber Notes window on the cream page, as the 404 and template pages
draw notes, under a paper-cut picture cut from the template covers (`web/public/email/`). On a
phone (480 px and narrower) the card gets more inner padding, looser lines and checklist rows, and
loses the "From Emil" line. The pictures are served from `https://ambernotes.app/email/`, so the
site deploy that adds them must go out before the first email.

Checked against caniemail.com's data (16 September 2026) for Gmail (web, iOS, Android), Apple Mail
(Mac, iOS), Outlook (Windows, Outlook.com, iOS, Mac) and Yahoo:

- **Layout:** tables and inline styles; no flex, grid, background images, web fonts or SVG. The
  button is a VML shape in Outlook for Windows, which ignores `border-radius` and padding on links.
- **Shapes:** checkboxes and window dots are table cells with a background or border, so Outlook
  for Windows shows them (square there); `display:inline-block` spans would vanish.
- **Style blocks:** three of them (phone spacing; dark mode and `color-scheme`; Outlook.com's
  `[data-ogsc]`/`[data-ogsb]`), so a client that throws one away keeps the others. Gmail ignores
  `prefers-color-scheme` and attribute selectors, and its apps ignore `<style>` entirely for
  non-Google accounts; those see the light layout from inline styles, which works at any width.
- **Dark mode:** Apple Mail and the Outlook apps use the media query. Outlook.com uses the
  `[data-ogsc]` rules. Gmail's apps invert colours by themselves and never images: the page is
  `#fffdf9` and text `#1d1d1f` (no pure white or black), and the ChatGPT and Claude marks carry
  their own white tile inside the PNG so inversion can't hide them.
- **Outlook for Windows:** `mso-line-height-rule:exactly` on body text, images with width and
  height attributes, a fixed 520 px table around the layout.
- **Not fixable, acceptable:** square corners and no shadows in Outlook for Windows; no
  `line-through` on done items for Gmail with non-Google accounts.

`deno run -A scripts/lifecycle-preview.ts <folder>` writes every email (as sent, forced light,
forced dark) to a folder; it sends nothing. `scripts/lifecycle-test-send.ts` sends every variant to
up to 10 test addresses through Resend, marked "[Test n/N]", and only with `--send`; without it, it
prints what it would send.

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
