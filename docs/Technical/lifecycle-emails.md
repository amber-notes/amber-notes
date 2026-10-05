# Onboarding emails

Short emails to new accounts from Emil, following the app's own setup card
(`Pane/Views/SetupCard.swift`: Bring your notes, Connect your AI, Try it). Built on
`feat/lifecycle-emails`; nothing is sent until the function is deployed, its secrets are set and
`LIFECYCLE_ENABLED` is `true`. They come from `Emil at Amber Notes <emil@ambernotes.app>`, and
replies go to the same address.

Which email an account gets depends on where it is in setup:

| Where the account is | Email | Subject | Never sent once |
| --- | --- | --- | --- |
| No note, 1 to 10 days after sign-up | `stuck` | Did something go wrong after signing in? | it has a note |
| Notes, no AI connected | `ai_groceries` | Your grocery list, kept by ChatGPT | an AI is connected |
| | `ai_meeting` | Turn a messy note into a to-do list | an AI is connected |
| | `ai_sort` | Let ChatGPT sort your notes into folders | an AI is connected |
| AI connected (a day after) | `templates` | Three notes your AI can keep for you | an AI edited notes on 3 days |
| | `undo` | Every AI edit comes with Undo | version history was opened |

The three AI emails each show one real before/after (made-up notes, but only what the MCP tools do
today: `append_to_note` and `set_checklist_item`, `edit_note`, `create_folder` and `move_note`),
the setup card's three steps with the first one ticked, and both ways to connect: Settings, Connect
an AI, ChatGPT in the app, or Claude's directory. An account that imported or has 20+ notes gets
the sorting email first, with its note count in the title. An account whose connection was started
from a browser but not finished in the last day or so (`connect_asks`, which expire) gets one more
line on the last step: typing the number on the iPhone or Mac.

At most one email in any seven days, and none after 45 days. Someone who never connects gets the
three AI emails on about days 1, 8 and 15; someone who connects stops getting them at once, and
gets templates a day after connecting, then Undo a week later. Accounts made before
`LIFECYCLE_SINCE` get nothing.

## What decides, and what it never reads

`public.lifecycle_facts(since)` (migration `20261006090000_lifecycle_emails.sql`) gives, per
account: the address, the sign-up time, the number of notes (`count(*)` on `notes.user_id`, never a
column of the note), whether it imported (`pane_setup.imported_at`), when an AI was first connected
(`mcp_tokens`, which also holds OAuth grants), whether a connection is waiting
(`connect_asks`), on how many days an AI edited (`pane_activity`), whether version history was
opened (`pane_feature_use`), plus what was already sent and whether the account said stop. A test
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
  never retried and counts toward the seven-day gap; only 429 (Resend took nothing) removes the row
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

## The emails

Each is a note in an Amber Notes window on the site's cream page, the way the 404 and template
pages draw notes, under a paper-cut picture from the template covers (`web/public/email/`, made from
`web/public/templates/covers/`). Tables and inline styles, the mark and Emil's photo as images,
a VML button for classic Outlook, dark mode through `prefers-color-scheme` (Apple Mail, Outlook for
Mac and iOS) and `[data-ogsc]` (Outlook.com), a plain-text twin, each HTML under 25 KB. The pictures
are served from `https://ambernotes.app/email/`, so the site deploy that adds them must go out
before the first email.

`deno run -A scripts/lifecycle-preview.ts <folder>` writes every email (and its dark version) to a
folder to open in a browser. It sends nothing.

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

Deploy with `supabase functions deploy lifecycle --no-verify-jwt`: the round checks its own secret
and an unsubscribe link carries its own HMAC.

## Testing

`deno test -A supabase/functions/lifecycle/` runs the schedule, the emails (size, no dashes, links
in both versions, image addresses, dark mode) and the round against every migration in PGlite with
a fake Resend: never twice (including rounds at once), stops when the goal is met, respects
unsubscribe, the kill switch, the seven-day gap, the series stopping when an AI connects, the
sorting email first for a big library, `LIFECYCLE_SINCE` and `LIFECYCLE_ONLY`, failures and
429, and that clients can't reach the tables. `cd web && pnpm exec vitest run app/unsubscribe` runs
the page and the route.

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
