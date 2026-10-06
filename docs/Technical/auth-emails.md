# Auth emails

The emails Supabase Auth sends (reset, sign-in code, confirmations, invite, reauthentication, the
"password changed" notice) share the lifecycle emails' look (`docs/Technical/lifecycle-emails.md`):
the mark, cream ground, a window with a title bar, and Emil signing off. Each says as little as it
can (shortened on 6 October 2026): a headline, one sentence, the button or the code, one grey line
(how long it works, what to do if it wasn't you), "Or open:" with the link, and a one-line footer.
Dark mode, images blocked and phone widths are handled as in the lifecycle emails.

## Where they come from

`scripts/auth-emails.ts` holds the copy and the one layout. It writes `supabase/templates/*.html`
(never edit those by hand; `scripts/auth-emails.test.ts` fails when they differ):

    deno run -A scripts/auth-emails.ts write

| File | Supabase template | Subject | Sent today? |
| --- | --- | --- | --- |
| `recovery.html` | Reset password | Reset your Amber Notes password | Yes, from Forgot password? |
| `password_changed.html` | Password changed notification | Your Amber Notes password was changed | Not until the notice is turned on |
| `magic_link.html` | Magic link | Your Amber Notes sign-in code | No UI asks for one |
| `confirmation.html` | Confirm signup | Confirm your email for Amber Notes | No: email addresses are confirmed automatically |
| `email_change.html` | Change email address | Confirm your new email for Amber Notes | No UI changes an email |
| `invite.html` | Invite user | You're invited to Amber Notes | Only from the dashboard |
| `reauthentication.html` | Reauthentication | Your Amber Notes code | No UI asks for one |

Each keeps its Go variables and link shape. The reset link stays
`{{ .SiteURL }}/reset-password#token_hash={{ .TokenHash }}&amp;type=recovery`
(`docs/Technical/password-reset.md`). `confirmation.html` and `email_change.html` keep their
`{{ .SiteURL }}/account/confirm?...` links, but the site has no `/account/confirm` page yet: that
page has to exist before either email is turned on.

## Things that matter

- **Supabase fills the templates in with Go's `html/template`, which drops every HTML comment.**
  Outlook's conditional comments and a VML button would never arrive, so there are none. Classic
  Outlook gets the button as a coloured table cell, and only its label is pressable there.
- **The code is one string** with letter spacing, never digits split by spaces, so a long press or
  double click copies exactly the code.
- **The address in the sentence sits in a link with no target.** Gmail and Apple Mail turn a bare
  address into a blue link, but leave text that is already inside a link alone.
- **No code in the subject line.** It would show on a locked phone.
- **Pictures are the mark and Emil's photo** from `https://ambernotes.app/email/`. With pictures
  blocked, their cells show "A" on amber and "E" on brown.

## Production

`supabase/config.toml` drives the local stack only. Production's subjects and templates are set
through the Management API, read-modify-write, with only the `mailer_subjects_*` and
`mailer_templates_*_content` fields:

    deno run -A scripts/auth-emails.ts patch > /tmp/auth-templates.json
    # PATCH https://api.supabase.com/v1/projects/rodegaeruhyybqilrnpn/config/auth with that body

Never `supabase config push`. The reset link also needs the project's `site_url` set to
`https://ambernotes.app` (`docs/Technical/password-reset.md`).

## Testing

- `deno test -A scripts/auth-emails.test.ts`: the files are current, each keeps its variables, only
  variables Supabase fills in, no comments or dashes, config.toml's subjects match.
- `scripts/password-reset-e2e.sh` against a local stack: the real reset email, opened and used.
- Rendering with Go's own `html/template` and a map of sample values, as Supabase does, catches a
  template that won't parse before it reaches the project.
