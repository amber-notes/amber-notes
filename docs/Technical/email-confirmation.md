# Email confirmation

An email-and-password sign-up confirms its address with a 6-digit code before the account can
be used. Sign in with Apple and Sign in with Google arrive with a confirmed email and skip it.
Accounts made while confirmation was off already have `email_confirmed_at` set, so nobody
existing is asked.

Approved by Emil on 7 October 2026. Tested end to end on staging; confirmation is switched off
there again until a beta build with the code screen is out (below). Production waits for the
checklist below.

## The flow

In the apps (Mac and iPhone, `Pane/Views/SignInView.swift`, state in
`Pane/Views/EmailSignInFlow.swift`):

1. "Sign in or sign up", "Enter your email to continue.", Email, Continue (the same from Get
   started and I already have an account). The heading then follows the
   answer: a new email shows "Create your account" and the button Create account; an existing
   account shows "Welcome back" with the address and the button Sign in. The password field
   has a show/hide eye.
2. Create account. With confirmation on, `auth.signUp` returns a user and no session
   (`Backend.signUp` returns true), and the screen becomes **Check your email**: the address,
   the code as six boxes in two groups of three (`Pane/Views/CodeBoxes.swift`: one real text
   field under the boxes, one-time-code content type, so typing, backspace, paste and iOS's
   suggestion from Mail all work; VoiceOver reads one "Verification code" field), Confirm,
   Resend code and Use a different email. A wrong or expired code shakes the boxes once
   (off with Reduce Motion), clears them and says what to do.
3. Six digits confirm on their own: `auth.verifyOTP(type: .signup)`. The session that comes back
   signs in, and the normal first run follows.
4. Resend code waits a minute after each code (Supabase sends one email a minute per address).
   It shows "Sending a new code…", then "New code sent. Only the newest one works."
5. Signing in to an account that was never confirmed (`email_not_confirmed`) opens the same
   screen and sends a new code at once.

Errors say what to do: a wrong or expired code ("Check the newest email from Amber Notes, or
press Resend code"), a resend too soon ("Wait a minute"), an email that couldn't be sent, and
no connection.

The website has no sign-up (an account's key is made on its first device). Signing in on
`/connect` with an unconfirmed account says to open the app, sign in there and type the code
(`web/lib/connect.ts`, `EMAIL_NOT_CONFIRMED`).

## The email

`supabase/templates/confirmation.html`, written by `scripts/auth-emails.ts`: "One quick check",
one sentence with the address, the code large, one grey line ("The code works for one hour").
No link: the apps ask for the code, and a link would open nowhere useful.

## Lifecycle emails

The welcome and onboarding emails go only to accounts with `email_confirmed_at`
(`supabase/migrations/20261008130000_lifecycle_confirmed_only.sql`). An account's age for those
emails counts from its confirmation when that came after sign-up, so the welcome goes a couple
of minutes after the code.

## Staging (done 7 October 2026)

Project `tswcrppnfzorhxhcnjvd`:

- Migration `20261008130000_lifecycle_confirmed_only` applied.
- Auth: the body of `deno run -A scripts/auth-emails.ts confirm "[Staging] "` (autoconfirm off,
  code length 6, one hour, the subject and the code template).
- `smtp_pass` set to the Resend key staging already uses for its lifecycle emails. Before this,
  staging had no SMTP password (the Management API never returns it, so `staging.sh auth` can't
  copy it), and every auth email from staging failed with "Error sending confirmation email".
- Then switched off again (`mailer_autoconfirm: true`) the same day: the beta build people had
  (2610070839) has no code screen, so a sign-up there would have been stuck. The template and
  SMTP stay. Once a beta build with this change is out, turn it back on with
  `deno run -A scripts/auth-emails.ts confirm "[Staging] "` as the PATCH body.
- `scripts/staging.sh auth` copies production's `mailer_` settings, so until production has
  confirmation on, running it turns autoconfirm back on for staging.

End to end on staging: `PaneUITests/EmailConfirmUITests` on the iPhone simulator, with a build
pointed at staging and `PANE_CONFIRM_EMAIL`, `PANE_CONFIRM_PASSWORD` and `PANE_CONFIRM_CODE_FILE`
passed as `TEST_RUNNER_` variables. Whoever runs it reads the code in the inbox and writes it to
the file. Screenshots of each screen, Mac and iPhone, light and dark: `docs/Evidence/email-confirm/` (the end-to-end run's own shots show a real address, so they stay out of the repository).

## Production checklist

Nothing below has been done. Each step needs Emil's go.

1. **Before anything: the apps.** Turn confirmation on only once the App Store iPhone app and
   the Mac app people have installed include this code screen. An older app shows nothing after
   Create account, and signing in later fails with "Email not confirmed" and no way to type a
   code. Accounts made in an older app in that window would need confirming by hand.
2. **Check nobody is waiting.** On 7 October 2026 production had 16 accounts, all with
   `email_confirmed_at` set. Run again just before:

       select count(*) filter (where email_confirmed_at is null) from auth.users where deleted_at is null;

   It must be 0.
3. **Migrations.** `20261008090000_lifecycle_welcome` and then `20261008130000_lifecycle_confirmed_only`
   reach production with dev's normal release to main. The second must be applied before step 4,
   or an unconfirmed account could get the welcome email.
4. **Auth settings.** Read-modify-write on
   `PATCH https://api.supabase.com/v1/projects/rodegaeruhyybqilrnpn/config/auth` with exactly the
   body from:

       deno run -A scripts/auth-emails.ts confirm > /tmp/confirm.json

   That is `mailer_autoconfirm: false`, `mailer_otp_length: 6`, `mailer_otp_exp: 3600`,
   `mailer_subjects_confirmation: "Confirm your email for Amber Notes"` and
   `mailer_templates_confirmation_content` (the code template). Nothing else changes. Production
   already sends through Resend SMTP, so no SMTP change.
5. **Smoke test.** Sign up in the released app with a new `+alias` address, get the code, confirm,
   land in the first run. Sign in with Apple and with Google still go straight in.
6. **Rollback.** `PATCH` with `mailer_autoconfirm: true`. Accounts made while it was on and never
   confirmed stay unconfirmed; confirm them with the admin API
   (`PUT /auth/v1/admin/users/<id>` with `email_confirm: true`) or let them use Resend code.

## Tests

- `PaneTests/EmailSignInFlowTests`: the code step, six digits only, the resend cooldown,
  unconfirmed sign-in, Use a different email, the error words, button titles.
- `supabase/functions/lifecycle/lifecycle.pglite.test.ts`: no welcome or ladder email before
  confirmation; the welcome follows the code; the minute check ignores unconfirmed accounts.
- `scripts/auth-emails.test.ts`: the confirmation email is a code with no link; the `confirm`
  body has only the confirmation fields.
- `web/lib/connect.test.ts`: the unconfirmed sign-in message on `/connect`.
- The local stack (`supabase/config.toml`) keeps `enable_confirmations = false`, so the local
  end-to-end scripts that sign up through the API still get a session.

## Also in this change: Open your notes on this device

The screen a new device shows when the account already has notes now says why first ("This
account already has notes on another device. Link this Mac to open them here."), and the code
under the QR code is large (monospaced, title 2, the groups set apart by kerning only, so a
selection copies exactly the code), with a Copy code button that says Copied
(`Pane/Views/AddDeviceView.swift`).
