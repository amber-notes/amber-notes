# Auth emails

The emails Supabase Auth sends (reset, sign-in code, confirmations, invite, reauthentication, the
"password changed" notice) share the lifecycle emails' look (`docs/Technical/lifecycle-emails.md`):
the mark, cream ground, a window with a title bar, and Emil signing off. Each says as little as it
can (shortened on 6 October 2026): a headline, one sentence, the button or the code, one grey line
(how long it works, what to do if it wasn't you), "Or open:" with the link, and a short footer.
Dark mode, images blocked and phone widths are handled as in the lifecycle emails.

## Where they come from

`scripts/auth-emails.ts` holds the copy and the one layout. It writes `supabase/templates/*.html`
(never edit those by hand; `scripts/auth-emails.test.ts` fails when they differ):

    deno run -A scripts/auth-emails.ts write

| File | Supabase template | Subject | Sent today? |
| --- | --- | --- | --- |
| `recovery.html` | Reset password | Reset your Pinto Notes password | Yes, from Forgot password? |
| `password_changed.html` | Password changed notification | Your Pinto Notes password was changed | Not until the notice is turned on |
| `magic_link.html` | Magic link | Your Pinto Notes sign-in code | No UI asks for one |
| `confirmation.html` | Confirm signup | Confirm your email for Pinto Notes | On staging: a 6-digit code after an email sign-up (`docs/Technical/email-confirmation.md`). Production confirms automatically for now |
| `email_change.html` | Change email address | Confirm your new email for Pinto Notes | No UI changes an email |
| `invite.html` | Invite user | You're invited to Pinto Notes | Only from the dashboard |
| `reauthentication.html` | Reauthentication | Your Pinto Notes code | No UI asks for one |

Each keeps its Go variables and link shape. The reset link stays
`{{ .SiteURL }}/reset-password#token_hash={{ .TokenHash }}&amp;type=recovery`
(`docs/Technical/password-reset.md`). `confirmation.html` carries a code and no link. `email_change.html` keeps its
`{{ .SiteURL }}/account/confirm?...` link, but the site has no `/account/confirm` page yet: that
page has to exist before that email is turned on.

## Things that matter

- **Supabase fills the templates in with Go's `html/template`, which drops every HTML comment.**
  Outlook's conditional comments and a VML button would never arrive, so there are none. Classic
  Outlook gets the button as a coloured table cell, and only its label is pressable there.
- **The code is one string** with letter spacing, never digits split by spaces, so a long press or
  double click copies exactly the code.
- **The address in the sentence sits in a link with no target.** Gmail and Apple Mail turn a bare
  address into a blue link, but leave text that is already inside a link alone.
- **No code in the subject line.** It would show on a locked phone.
- **Pictures are the mark and Emil's photo** from `https://pintonotes.com/email/`. With pictures
  blocked, their cells show "P" on amber and "E" on brown.
- **The name is Pinto Notes** (renamed from Amber Notes on 8 October 2026), and every link is on
  `pintonotes.com`. The footer says once "Pinto Notes was called Amber Notes until October 2026.",
  for people who made their account under the old name (`RENAMED` in the script; take it out when
  the old name is forgotten). The old name is never in a subject.
- **The sender is `Pinto Notes <hello@ambernotes.app>`.** The name is new; the address stays until
  pintonotes.com is a verified sending domain in Resend, because mail from a domain that isn't
  verified is refused. Name and address are in `supabase/functions/_shared/sender.ts`.

## Production

`supabase/config.toml` drives the local stack only. What production's emails say is set through
the Management API, read-modify-write:

    scripts/auth-email-config.sh > /tmp/auth-email.json
    # PATCH https://api.supabase.com/v1/projects/rodegaeruhyybqilrnpn/config/auth with that body

That body is `site_url` (`https://pintonotes.com`, which is `{{ .SiteURL }}` in the reset link),
`smtp_sender_name` (`Pinto Notes`) and the seven `mailer_subjects_*` and
`mailer_templates_*_content` fields. It leaves SMTP, the sender address, the limits and whether
confirmation is on as they are. `deno run -A scripts/auth-emails.ts patch` prints the subjects and
templates alone. Never `supabase config push`.

Before applying it, save the same keys from `GET .../config/auth`; sending them back is the way
back. With `site_url` on pintonotes.com the project's redirect list must hold
`https://pintonotes.com/connect**` (sign-in on `/connect`, `web/lib/connect.ts`), and keep
`https://ambernotes.app/connect**` and `ambernotes://auth-callback` for the apps and pages people
already have. The reset link itself uses no redirect (`docs/Technical/password-reset.md`).

## Testing

- `deno test -A scripts/auth-emails.test.ts`: the files are current, each keeps its variables, only
  variables Supabase fills in, no comments or dashes, config.toml's subjects match.
- `scripts/password-reset-e2e.sh` against a local stack: the real reset email, opened and used.
- Rendering with Go's own `html/template` and a map of sample values, as Supabase does, catches a
  template that won't parse before it reaches the project.
