# Onboarding emails

Four short emails to new accounts, from Emil, each about one step. Built on
`feat/lifecycle-emails`; nothing is sent until the function is deployed, its secrets are set and
`LIFECYCLE_ENABLED` is `true`.

| Email | Subject | Goes when | Stops (never sent) once |
| --- | --- | --- | --- |
| `stuck` | Did something go wrong after signing in? | 1 to 10 days after sign-up, no note yet | the account has a note |
| `connect` | Let ChatGPT or Claude into your notes | 12 hours to 10 days, has a note | an AI was ever connected |
| `templates` | Three notes your AI can keep for you | 3 to 21 days, has a note | an AI has edited a note |
| `undo` | Every AI edit comes with Undo | 7 to 28 days, has a note | version history was opened |

At most one email in any seven days, and the first in the table wins when two are due. With the
gap, an account that never connects an AI gets `connect` on day 1, `templates` on day 8 and `undo`
on day 15. An account with no note gets `stuck` and nothing else until a note arrives. Accounts
made before `LIFECYCLE_SINCE` never get any of them.

`templates` and `undo` add a line on how to connect an AI when none is connected. That is the only
thing the wording depends on.

## What decides, and what it never reads

`public.lifecycle_facts(since)` (migration `20261006090000_lifecycle_emails.sql`) gives, per
account: the email address, the sign-up time, and yes/no for "has a note", "an AI was connected"
(`mcp_tokens`), "an AI edited a note" (`pane_activity`), "version history was opened"
(`pane_feature_use`), plus what was already sent and whether the account said stop. "Has a note" is
an `exists` on `notes.user_id`; no note's text, title or name is read, and a test checks the
function's definition for it.

## How a round works

pg_cron runs `public.lifecycle_tick()` daily at 08:00 UTC. It posts to the `lifecycle` function with
`x-lifecycle-secret`, using two vault secrets (`lifecycle_url`, `lifecycle_cron_secret`), and does
nothing while pg_net or either secret is missing.

The function (`supabase/functions/lifecycle/`):

- `logic.ts`: the schedule (`SEQUENCE`, `GAP_MS`), `decide()`, unsubscribe tokens, settings.
- `emails.ts`: the four emails as words, HTML and plain text.
- `run.ts`: for each account due an email, claims it in `email_sends` inside a transaction with a
  per-account advisory lock that re-checks the gap and unsubscribes, then sends through Resend with
  an idempotency key, then records the outcome. A refused or unanswered send keeps its row and is
  never retried; only 429 (Resend took nothing) removes the row so the next round tries again.
- `index.ts`: `POST /lifecycle` (the round) and `POST /lifecycle/unsubscribe?u=&t=`.

With `LIFECYCLE_ENABLED` anything but `true`, a round only counts what would go and answers
`{ due: {...} }`. `LIFECYCLE_ONLY` (comma-separated account ids) limits sending to those accounts,
for a first try on a test account.

## Unsubscribing

Every email has "Stop these emails" in its footer and the headers
`List-Unsubscribe: <https://ambernotes.app/unsubscribe/confirm?u=…&t=…>, <mailto:hello@ambernotes.app?subject=Unsubscribe>`
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
| `LIFECYCLE_FROM` | Optional. Default `Emil at Amber Notes <hello@ambernotes.app>`. |
| `LIFECYCLE_ONLY` | Optional. Comma-separated account ids that may get email; everyone else gets none. |

Deploy with `supabase functions deploy lifecycle --no-verify-jwt`: the round checks its own secret
and an unsubscribe link carries its own HMAC.

## Testing

`deno test -A supabase/functions/lifecycle/` runs the schedule, the emails (size, no dashes, links
in both versions, image addresses, dark mode) and the round against every migration in PGlite with
a fake Resend: never twice (including rounds at once), stops when the goal is met, respects
unsubscribe, the kill switch, the seven-day gap, `LIFECYCLE_SINCE` and `LIFECYCLE_ONLY`, failures and
429, and that clients can't reach the tables. `cd web && pnpm exec vitest run app/unsubscribe` runs
the page and the route.
