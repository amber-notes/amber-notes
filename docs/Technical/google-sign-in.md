# Sign in with Google

Status: built on `feat/google-sign-in`, not live. It needs the Google provider turned on in the
Supabase project first (setup steps are kept outside the repository, with the maintainer).

## Where it's offered

| Place | Order |
| --- | --- |
| iPhone and Mac sign-in (`SignInView`, inside the welcome flow) | Sign in with Apple, then Sign in with Google directly under it, then "or" and the email |
| Start fresh, when the server wants a recent sign-in (`KeyGateView`) | The buttons for the ways this account signs in: Apple, Google, or the password |
| ambernotes.app/connect, both versions (`ConnectFlow`, `ConnectFlowV1`) | Sign in with Apple, then Sign in with Google, then "or with email" |

Sign in with Apple stays offered and first everywhere Google is (App Review guideline 4.8).

## How it works

Both the app and the website use Supabase's OAuth flow for Google, with PKCE:

1. The app (or page) makes a PKCE verifier and sends its S256 challenge to
   `https://<project>.supabase.co/auth/v1/authorize?provider=google&prompt=select_account`.
2. Supabase sends the browser to Google with its own `state` and OIDC nonce, and Google comes
   back to `https://<project>.supabase.co/auth/v1/callback`. Supabase checks the state, the ID
   token and its nonce there.
3. Supabase sends the browser to the `redirect_to` address with a one-time code:
   `ambernotes://auth-callback?code=...` for the app, `https://ambernotes.app/connect?request=...&code=...`
   for the website.
4. The app or page swaps the code and its verifier for a session (`grant_type=pkce`).

The app runs the Google page in `ASWebAuthenticationSession` (`Pane/Sync/WebAuthSession.swift`),
which catches the `ambernotes://` return itself, on iPhone, the Mac App Store build and the Mac
download alike. It shares Safari's cookies, so someone signed in to Google picks an account
instead of typing a password; iOS first asks "Amber Notes wants to use supabase.co to sign in".

**Why not Google's GoogleSignIn SDK.** On iPhone and Mac the SDK also opens Google in
`ASWebAuthenticationSession`, so the person sees the same thing. It would add a dependency, an
iOS and a macOS OAuth client, a reversed-client-id URL scheme per platform, and its ID tokens
would need those client ids listed in Supabase next to the Web client's (and a nonce passed
through the SDK). The OAuth flow needs one Web client and nothing else, and the website uses the
same one.

**Nonce.** In this flow the app never sees Google's ID token: Supabase makes the OIDC nonce and
checks it, and the app's side of the round trip is protected by PKCE (a stolen code is useless
without the verifier, which never leaves the device). The app's own nonce code
(`AppleSignIn.makeNonce`) is only for Apple's native ID token.

**Start fresh.** It needs a sign-in from the last 10 minutes. A Google sign-in adds an `oauth`
entry to the token's `amr`, which `SignInRecency` counts. Google's chooser can pick any Google
account, which may be a different Amber Notes account, so the app checks that the account after
the sign-in is the one that asked. If not, it signs that one out and deletes nothing.

## Accounts and linking

Supabase links identities by email: a Google sign-in whose verified email matches an existing
user joins that user instead of making a new one. Google only says an email is verified when the
person has proven it to Google.

| The email already has | Result |
| --- | --- |
| Nothing | A new account. Its key is made on this device, as for any new account. |
| A Sign in with Apple account (the Apple ID shares its real address) | Google joins that account. Both providers vouched for the address. |
| An email and password account | Google joins that account, the password stops working, and every earlier session ends (below). |
| An Apple account behind a private relay address | Nothing in common: a separate, new account. |

**Why the password stops working.** Sign-up here doesn't confirm addresses (`enable_confirmations
= false`), so a password account proves nothing about its address. Without a guard, someone could
sign up with another person's Gmail address and a password, wait for that person to choose Sign in
with Google (which would land them in the same account), and keep signing in with the password.
`pane_google_joins_account` (migration `20261005120000_google_sign_in.sql`) runs when a Google
identity is added to an account that has a password: it clears the password and deletes the
account's earlier sessions, in the same transaction, before Supabase makes the Google session.
Supabase does the same on its own only for unconfirmed addresses; here every address is
effectively unconfirmed.

What the person sees: nothing changes on the device they used. Their other devices are signed out
and sign in again with Google. "Forgot password?" sets a new password through the same inbox
Google vouched for. Because clearing the password is a password change, the 72-hour pause on
Start fresh and Delete account starts too (`20261002200000_start_fresh_after_reset.sql`).

The notes themselves were never at risk from the sign-in method: they're sealed with the
account's data key, which lives in iCloud Keychain and on devices that hold it
(`docs/Technical/e2ee-design.md`). Google, Apple and passwords only sign in.

**Email-first sign-in.** `account-status` still only says whether an account exists and has a
password. An account without one now gets "This email signs in with Apple or Google. Use one of
the buttons above." in the app and on /connect; which provider isn't said.

**The sign-up hook** (`hook_before_user_created`, off by default) now lets Google make accounts
the same way it lets Apple.

## The button

Drawn to Google's branding guidelines (developers.google.com/identity/branding-guidelines):

- The standard four-colour "G" (`Pane/Resources/Assets.xcassets/GoogleG.imageset`, and inline SVG
  on the web), never recoloured or stretched; 12 pt between it and the words on iPhone.
- "Sign in with Google", next to "Sign in with Apple".
- Light: white fill, `#747775` 1 pt border, `#1F1F1F` text. Dark: `#131314` fill, `#8E918F` border,
  `#E3E3E3` text.
- Height, corner radius and title size match Sign in with Apple's at the same height: the form's
  row (`SignInView.Row`); the title is the Mac's row title, and on iPhone 18 pt medium, which is what
  Apple's own button draws at the 48 pt row (`GoogleAuthButton.titleFont`).

One deliberate difference: the title is in the system font, as on Apple's button above it, not
Google Sans. Google's page names Google Sans Medium; matching Apple's title size and face was the
brief for the form. Switching means bundling the font and changing one line in
`GoogleAuthButton`.

## Configuration

- Supabase: Authentication > Providers > Google, with the Web client's id and secret. The redirect
  list already has `ambernotes://auth-callback` and `https://ambernotes.app/connect**`.
- `supabase/config.toml` has `[auth.external.google]` off for the local stack. A
  `supabase config push` from that file (`scripts/deploy-backend.sh` runs one) would turn Google off
  on the live project, as it would overwrite other auth settings
  (`docs/Technical/account-emails.md`).
- Website: `GOOGLE_ON_WEB` in `web/lib/connect.ts`. App: `SignInView.offersGoogle`.

## Tests

- `PaneTests/GoogleSignInTests.swift`: Google's query (chooser, hint), the return address, cancel
  handling, error wording, the same-account rule for Start fresh, the button's colours and logo
  size, and that the Google row folds away with Apple's for a password.
- `PaneUITests/SignInLayoutUITests.swift`: on iPhone, Google sits directly under Apple at the same
  size, folds away for the password and comes back.
- `PaneTests/HIG/WelcomeSnapshots.swift`: the Mac sign-in screens with both buttons, light and dark.
- `web/app/connect/ConnectFlow.test.tsx` and `web/lib/connect.test.ts`: the button order, the
  authorize URL, what the page stores, and the error naming Google.
- Not tested end to end: the real Google round trip needs the provider configured. The linking
  guard and the sign-up hook are tested on the whole schema in PGlite
  (`supabase/functions/account/google.pglite.test.ts`); not yet on the local stack or a hosted
  project, where the roles that own `auth` tables differ.
