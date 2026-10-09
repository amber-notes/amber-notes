# Emails after the rename to Pinto Notes (9 October 2026)

Every email the app sends, before and after: the seven account emails (Supabase Auth) at phone
width (390) and desktop width (1100), and the emails from Emil at phone width.

- "Before" is `main` on 9 October 2026, which is what production sent. "After" is this change. The
  welcome emails have no "before": they are not on `main` yet.
- Made with headless Chrome. The account templates have their Go variables filled with sample
  values (`sara.lind@example.com`, code `482913`, a made-up token); the emails from Emil come from
  `scripts/lifecycle-preview.ts`.
- `auth-recovery-blocked-*` and `lc-welcome-blocked-phone` show a mail app that blocks pictures:
  the mark's cell says P. The small broken-picture sign is Chrome's and isn't in a mail app.
