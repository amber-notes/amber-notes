# Password reset

Built on `feature/password-reset`. A person who forgot the password of an email account asks for a
link in the app or on the site, opens it on any device, and chooses a new password on
`pintonotes.com/reset-password`. The audit before it is `docs/Technical/account-emails.md`.

## What a reset changes, and what it doesn't

**The password wraps nothing.** The account password only signs you in. Nothing is encrypted with it (`docs/Technical/e2ee-design.md`,
`Pane/Model/E2EE.swift`): the data key lives in the Keychain and iCloud Keychain, the recovery wrap is
sealed under the recovery key, an AI connection's wrap under its own token, and the one key made from
a password is the separate notes password for locked notes (`Pane/Model/NoteLock.swift`).

A reset changes:

- the password (`auth.users.encrypted_password`);
- the sessions: Supabase ends every other session of the account when the password changes, so
  each signed-in iPhone and Mac is signed out at its next token refresh (within the hour) and signs
  in again with the new password. Sign out keeps the data key, so the notes open as before;
- nothing else.

A reset doesn't touch the data key, `account_keys` (key id, verifier, recovery wrap), the notes,
files, shares, devices, AI connections (`mcp_tokens` and their wraps are not Supabase sessions), the
notes password or locked notes. `scripts/password-reset-e2e.test.ts` compares those rows byte for
byte before and after.

What it means for safety: someone who can read a person's email can set a new password, or sign in
with an emailed link, as with any email account. They still can't read the notes without the key (a
new device needs Add a device or the recovery key). They could have deleted every note, with Start
fresh or Delete Account, so both are paused for 72 hours
(`supabase/migrations/20261002200000_start_fresh_after_reset.sql`), and the "password changed"
email tells the owner at once.

The pause starts only when something happened, never on a request, so nobody can keep an account's
owner from Start fresh by asking for links. It starts when the password changes (a trigger on
`auth.users.encrypted_password`) or when a session is made from an emailed link: reset links and
magic links both sign in with the `otp` method, which Supabase writes to `auth.mfa_amr_claims` (a
second trigger; checked on the local stack, GoTrue 2.186). Asking only stamps
`auth.users.recovery_sent_at`, which isn't read; Supabase also clears it when the password changes.
The moment goes in `public.account_recoveries`, which no client can read or write, and
`public.pane_reset_pause_until` is the one place that decides. `start_fresh` refuses with hint
`paused_after_reset` and the time it opens again as the detail; `DELETE /functions/v1/account`
answers 403 with the same hint and `until` (`supabase/functions/account/pause.ts`). The apps say
"Start fresh is paused for 72 hours after a password reset, to protect your notes. Try again on
<date>." and "Deleting your account is paused for 72 hours after a password reset, to protect your
notes. Try again on <date>." Magic links matter here: email sign-in links work for every email
account today, reset or not, and the pause covers them too.

## The flow

1. **Ask.** "Forgot password?" sits under the password on the app's sign-in card (iPhone and Mac,
   `Pane/Views/SignInView.swift`, the steps in `EmailSignInFlow.swift`) and on `/connect`'s password
   step (a new tab to `/reset-password#email=…`). The app asks Supabase directly
   (`Backend.requestPasswordReset`); the site asks through `web/app/reset-password/request/route.ts`.
   Both send `POST /auth/v1/recover` with only the email: no PKCE challenge and no redirect.
2. **Answer.** Always "If an account uses this email, we've sent it a link." The route turns every
   answer from Supabase into `{ sent: true }`, because a known address can get 429 or 500 where an
   unknown one gets 200. The app treats any answer as sent too. Only "couldn't reach the server" is
   said.
3. **Email.** `supabase/templates/recovery.html`: one button to
   `{{ .SiteURL }}/reset-password#token_hash={{ .TokenHash }}&type=recovery`, valid one hour, once.
   The token is in the fragment, so it never reaches Vercel, a proxy or a log.
4. **Page.** `web/app/reset-password/` with the decisions in `web/lib/password-reset.ts`. Opening the
   link only reads it: the page keeps the token in memory and clears the fragment from the address
   bar and history at once, so a reload shows the request form (send a new link) rather than the
   token. A token in the query is refused. Save checks the password (12 to 72 characters), then spends the token
   (`POST /auth/v1/verify`), sets the password (`PUT /auth/v1/user`) and ends that session
   (`POST /auth/v1/logout?scope=local`). Then: "Your password is changed. Sign in with it on your
   iPhone or Mac." A used, expired or refused link shows "This link no longer works" with an email
   field to send a new one. With no link, the page is the request form. If the page is closed after
   the token was spent but before the password was set (a refused password, then leaving), it ends
   that session on `pagehide`, sent with `keepalive`.

The page has the connect pages' strict CSP (nonce scripts, `connect-src` this site and the Supabase
project, `form-action 'none'`), no referrer, `no-store`, `noindex`, no site header, and is on both
analytics exclusion lists (`web/lib/analytics.ts`, `web/lib/posthog.ts`).

## Pitfalls this avoids (learned on Incredible)

- **Mail scanners spend links.** Microsoft Defender Safe Links and others open links in a real
  browser that runs scripts. A page that redeems the token on load uses it up and the person sees an
  expired link. Here only Save redeems it. Tested with a fetch and with headless Chrome.
- **Token hash, not ConfirmationURL or PKCE.** Supabase's default link spends the token on Supabase's
  own page (a scanner's GET is enough) and puts the session in the fragment. A PKCE link can only be
  redeemed in the browser that asked for it, so a reset asked from the app or opened on the phone
  would never work. The Swift client's `resetPasswordForEmail` adds a PKCE challenge, which is why the
  app sends the request itself.
- **A rejected password must not burn the link.** The password is checked before the token is spent,
  and after it is spent the session is kept in memory, so "that's your current password" can be
  fixed and saved again. A double press spends it once.
- **Outlook.** The button is a table cell with the colour on the cell, plus a VML shape for classic
  Outlook, which draws mail with Word and ignores padding and radius on links.
- **Production templates aren't deployed from the repo.** `supabase/config.toml` drives the local
  stack only, and `scripts/deploy-backend.sh` (which runs `supabase config push`) must not be used
  for this. The production template, subject, site URL and SMTP are set through the Management API
  (below).
- **Supabase's built-in mailer is for testing:** a couple of emails an hour, from a Supabase address.
  Production needs custom SMTP.
- **The page doesn't work under `pnpm dev`.** The strict CSP blocks the dev build's `eval`, as on
  `/connect`. Try it with `pnpm build && pnpm start`.
- **`recovery_sent_at` is not evidence** that a mail went out, or of a reset after the fact:
  Supabase clears it when the password is changed. Delivery is checked in the mail provider's log;
  the pause keeps its own record.

## Limits

Supabase's own: one email a minute per address (`smtp_max_frequency`, set to 60 s) and a cap per
project per hour (`rate_limit_email_sent`). The route adds none, because the public key can call
`/auth/v1/recover` directly; a captcha would be the next step if the hourly cap is ever used up on
purpose.

## Production setup, in this order

The production project is `rodegaeruhyybqilrnpn`. On 2 October 2026 it had no custom SMTP,
`site_url` `http://127.0.0.1:3000`, `smtp_max_frequency` 1 s, `rate_limit_email_sent` 2 and Supabase's
stock recovery template.

1. Merge, apply `supabase/migrations/20261002200000_start_fresh_after_reset.sql` to the project (the
   Start fresh and Delete Account pause; it must be live before reset emails go out) and deploy the
   `account` function (its half of the pause), and deploy the site, so
   `/reset-password` exists before any email points at it.
2. DNS for sending. `ambernotes.app` was added to the Resend account on 2 October 2026 (domain id
   `74963381-a703-4813-b926-836bae40677c`, region eu-west-1, not verified yet). Add at GoDaddy, then
   press Verify in Resend (or `POST /domains/<id>/verify`):

   | Type | Host (GoDaddy "Name") | Value | Priority | TTL |
   |---|---|---|---|---|
   | TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC2KR3FD5PjNr3lhG978D2KEDzIjIa+iiv3HB1W6pu7uAqBH/ubmAbA6Hh12oTGQTs1LkAr0x7pJAQ9fx9k1kzDSQhhXlFOQHtCDGXDxCrtEjpCkGHHXhIAM/wUhBQ/F6CDOvgRajypQItjXjghqkumnVB25fLTq8/F7/LCYQvhxQIDAQAB` | | 1 hour |
   | MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` | 10 | 1 hour |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` | | 1 hour |
   | CNAME | `rsend` | `send.forge.rmta.net` | | 1 hour |

   None of them touch the root MX (forwardemail.net, which receives hello@) or the existing DMARC
   record (`p=quarantine`, relaxed alignment), which the DKIM signature on `ambernotes.app` passes.
3. Make a Resend API key with sending access to that domain only. It is the SMTP password.
4. `scripts/auth-email-config.sh > /tmp/auth-email.json`, add the key as `smtp_pass`, and
   `PATCH https://api.supabase.com/v1/projects/rodegaeruhyybqilrnpn/config/auth` with it. That sets
   the site URL, the recovery subject and template, one hour validity, the per-address minute, and
   SMTP from `hello@ambernotes.app` ("Amber Notes"). (Since the rename the script prints what the
   emails say, for every template, with the site URL `https://pintonotes.com` and the sender name
   "Pinto Notes"; `scripts/auth-email-config.sh --setup` adds these first-time SMTP settings and
   limits. See `docs/Technical/auth-emails.md`.) It also fixes `smtp_max_frequency` (1 s today,
   so no per-address limit) to 60 s, and raises the hourly cap from 2 to 30, which only custom SMTP
   allows. The redirect list needs no change: the reset uses no redirect.

   Changing `site_url` from `http://127.0.0.1:3000` to `https://ambernotes.app` was checked against
   every sign-in that redirects: the Mac download's Sign in with Apple and Connect Apple ID pass
   `redirect_to=ambernotes://auth-callback` (`Backend.swift`), and `/connect` passes
   `redirect_to=https://ambernotes.app/connect?…` (`lib/connect.ts`). Both are on the redirect list, so
   Supabase uses them and never the site URL. The App Store apps sign in with Apple's id token and
   email with a password, with no redirect at all. The site URL is only the fallback for a missing or
   refused `redirect_to`, which today lands on a dead `127.0.0.1` page, and what `{{ .SiteURL }}` is in
   templates.

   The site moved to `https://pintonotes.com` on 8 October 2026, and `site_url` moves with it. The
   reset page is the same page on the new address: it reads the token from the fragment in the
   browser and calls the Supabase project directly, so nothing in it depends on the host. A link
   in an email sent before the change still works: `ambernotes.app/reset-password` answers 308 to
   the same path on pintonotes.com, and browsers carry the fragment across a redirect. The
   redirect list must hold `https://pintonotes.com/connect**` (for `/connect`), and keeps
   `https://ambernotes.app/connect**` and `ambernotes://auth-callback`.
5. Ask for a reset for a test account on the live site and check it arrives, opens and saves.
6. Ship the app build with Forgot password?.

The same PATCH turns on the "password changed" notice (`supabase/templates/password_changed.html`,
same look as the reset email): every password change emails the account, with a link to the reset
page and hello@. It isn't in the local config because the installed CLI (2.75) resolves its
template path differently from the other templates.

## Testing

- `cd web && pnpm test`: `lib/password-reset.test.ts` (link reading, Save's order and its guards,
  the Auth calls), `app/reset-password/ResetPassword.test.tsx` (every screen, that loading spends
  nothing), `app/reset-password/request/route.test.ts` (one answer for every Supabase reply, no
  address in logs, same origin only), the CSP and header tests in `middleware.test.ts`.
- `scripts/qa-test.sh PaneTests/EmailSignInFlowTests`: the app's steps and its request.
- `scripts/password-reset-e2e.sh` against the local stack (`supabase start`): ask, the email from the
  local mail catcher, open (with `RESET_SITE` set, in headless Chrome too), Save, the new password
  signs in and the old one doesn't, the link works once, other sessions end, the key, notes and AI
  connection are unchanged.
- `PaneUITests/PasswordResetUITests` (iPhone simulator, a build pointed at the local stack, a local
  account in `PANE_RESET_EMAIL`): Forgot password?, Email Me a Link, the sent message.
