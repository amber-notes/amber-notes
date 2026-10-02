# Account emails: what exists, and a proposal

Audit of 2 October 2026, made from the repository and from the project's public auth settings
(`GET /auth/v1/settings`). Nothing in the Supabase project was changed, and nothing here is
turned on. The templates and pages below are proposals.

## What exists today

**No account email is sent in normal use.**

| Email | What triggers it | Today |
| --- | --- | --- |
| Sign-up confirmation | `signUp(email:password:)` in the app (`Pane/Sync/Backend.swift`) | Not sent. The project confirms email addresses automatically (`mailer_autoconfirm: true`), and `supabase/config.toml` says the same (`enable_confirmations = false`). The new account is signed in at once. |
| Password reset | Nothing | No "Forgot password" in the iPhone app, the Mac app or on `/connect`. Nothing calls `resetPasswordForEmail`. |
| Email change | Nothing | No screen changes an account's email. |
| Magic link, code, invite, reauthentication | Nothing | Not used. |

Sign in with Apple sends no email of ours.

**Where the templates live:** nowhere in the repository. There is no `supabase/templates`
before this change and no `[auth.email.template.*]` section in `supabase/config.toml`, so the
project uses Supabase's stock templates ("Confirm your signup", "Reset Password", a plain link,
no Amber Notes name or mark) unless they were edited by hand in the dashboard. The dashboard's
templates, sender address and SMTP setting can't be read from the repository.

**Where a link would land.** The stock templates link to
`https://<project>.supabase.co/auth/v1/verify?...`, which then sends the browser to the
project's Site URL. That was reported as still `http://127.0.0.1:3000` on 2 October 2026 (the
same value as `supabase/config.toml`), with `ambernotes://auth-callback` and
`https://ambernotes.app/connect**` on the redirect list. So a link from an account email ends
on a page that doesn't load.

Neither landing place on the redirect list can take an email link either:

- `ambernotes://auth-callback` is only read by the Mac download's Sign in with Apple window
  (`Pane/Sync/WebAuthSession.swift`). The app's own URL handlers (`ConnectCenter.receive`,
  `RootView`) drop it, so on iPhone or Mac the app would come forward and do nothing.
- `/connect` needs a connect request id. Without one it says "This link isn't complete".
- The site has no page that reads `token_hash`, `type=recovery` or `#access_token`.

## What a person sees, end to end

**Sign-up, iPhone and Mac.** Type an email, "New here? We'll create your account", choose a
password of 12 or more characters, Create Account. The app opens signed in. No email arrives,
and the address is never checked. A typo in the address makes an account nobody can receive
mail for.

**Sign-up, web.** `/connect` only signs in. There is no sign-up on the site.

**Forgot the password, iPhone, Mac and web.** There is no way to reset it. The sign-in screen
says the password is wrong and offers nothing else; the person has to write to
hello@ambernotes.app. `docs/Technical/e2ee-design.md` says "a password reset is the normal
email reset", but that reset was never built. The notes themselves would survive a reset: they
are locked with the key in iCloud Keychain, not with the password.

**If someone calls the reset endpoint directly** (the public key allows it), Supabase would send
its "Reset Password" email, and the link ends on `127.0.0.1`. Not tried here: it would send a
real email from the live project.

**If "Confirm email" were switched on today**, sign-up would return no session and the app
has no "check your email" screen: the person would stay on the sign-in card with no message.

## One thing to fix before anything else

`scripts/deploy-backend.sh` runs `supabase config push`. `supabase/config.toml` still has the
local values (`site_url = "http://127.0.0.1:3000"`, no `ambernotes.app` redirect), so a push
would put those on the live project and drop `https://ambernotes.app/connect**`, which breaks
Sign in with Apple on `/connect`. Either the production values go into `config.toml`, or the
push stays out of the script.

## Proposal

### Templates (`supabase/templates/`)

Four emails in the site's look: cream ground, the leaf mark and name, one card, one dark
button, the address in full under it, and a line saying why the person got it. Light only,
table layout, inline styles, no images but the mark, no tracking.

| File | Subject | When |
| --- | --- | --- |
| `confirmation.html` | Confirm your email for Amber Notes | Sign-up, once "Confirm email" is on |
| `recovery.html` | Reset your Amber Notes password | "Forgot password" |
| `email_change.html` | Confirm your new email for Amber Notes | Changing the sign-in email |
| `password_changed.html` | Your Amber Notes password was changed | After a password change (security notice, no link) |

They are not referenced from `config.toml`, so nothing uses them until someone wires them.

The links go to `https://ambernotes.app/account/...?token_hash=...&type=...` instead of
Supabase's `ConfirmationURL`. Two reasons: the address in the email is ours, and the page can
wait for a button press before it spends the token. Mail scanners open links; with the stock
link a scanner uses the token up and the person gets "link expired".

### Landing pages

Drawn, not wired: `/dev/account?screen=confirm|confirmed|expired|reset|reset-error|reset-done`
on a local or preview build shows each one (`web/app/dev/account/page.tsx`), built from the
same parts as the other functional pages (`web/lib/ui.tsx`).

| Page | Says | Does |
| --- | --- | --- |
| `/account/confirm` | Confirm your email, with the address | One button. Pressing it verifies the token, then: "Your email is confirmed", Open Amber Notes. |
| `/account/reset` | Choose a new password | Two fields and Save password. Then: "Your password is changed", Open Amber Notes. |
| Either, with an old link | This link has expired | Says to ask for a new one from the sign-in screen. |

The same pages work from an iPhone, a Mac and any other browser, because the link is an
ordinary web address. Nothing has to open the app; the last screen offers to.

### To turn it on, in this order

1. Build `/account/confirm` and `/account/reset` for real: verify the `token_hash`
   (`POST /auth/v1/verify`), set the password (`PUT /auth/v1/user`), sign out. They need the
   connect pages' strict CSP and `Referrer-Policy: no-referrer`, and they join the list of
   pages analytics never loads on (`web/lib/analytics.ts`, `web/lib/posthog.ts`).
2. Add "Forgot password?" to the app's sign-in card and to `/connect`
   (`resetPasswordForEmail` with no redirect; the template carries the address).
3. In the Supabase project: set the Site URL to `https://ambernotes.app`, add
   `https://ambernotes.app/account/**` to the redirect list, paste the four templates and
   subjects, and set a sender on the ambernotes.app domain through custom SMTP. Supabase's
   built-in mailer is meant for testing: it is limited to a few emails an hour and sends from a
   Supabase address. Whether custom SMTP is already set couldn't be read from the repository.
4. Only then consider "Confirm email" for sign-up, and only together with a "check your email"
   screen in the app. Until that screen exists, confirmation would lock new people out.

Changing an account's email needs a screen in Settings first; the template is ready for it.
