# Staging

A second Amber Notes for trying what's on `dev` with real devices and real AI connections, without
touching production: its own Supabase project, its own site, and Amber Notes Beta, an app that sits
next to the real one on the same Mac and iPhone.

| Part | Production | Staging |
|---|---|---|
| Supabase | `rodegaeruhyybqilrnpn` | `amber-staging` (ref in `.secrets/staging.env`), same org and region |
| Site | ambernotes.app (Vercel project `amber-notes`) | https://amber-notes-staging.vercel.app (Vercel project `amber-notes-staging`), kept out of search |
| MCP server | https://mcp.ambernotes.app | `https://<staging ref>.supabase.co/functions/v1/mcp`, the file tool set (`AMBER_MCP_TOOLS=files`) |
| App | Amber Notes, `dev.emilwagman.pane`, `ambernotes://` | Amber Notes Beta, `dev.emilwagman.pane.beta`, `ambernotes-beta://` |

## What keeps the beta apart from the real app

- **Its own identity.** `Config/Beta.xcconfig` sets the bundle id, name, URL scheme, App Group,
  universal-link host and update feed. They're build settings with Amber Notes' values as defaults
  (`project.yml`), and Swift reads them through `AppIdentity`. Keychain service names start with the
  bundle id, so the beta never sees the real app's session, data key or note locks.
- **Its own files on the Mac.** The Mac download isn't sandboxed and keeps `Pane.store` and its files
  in `~/Library/Application Support`. A second unsandboxed copy would open the same store. The beta
  download is sandboxed (`Pane-mac-beta.entitlements`), so everything it writes is in its own
  container. On iPhone every app is sandboxed already.
- **Its own links.** The staging site is built with `NEXT_PUBLIC_APP_SCHEME=ambernotes-beta` and
  `NEXT_PUBLIC_APP_LINK_ORIGIN`, so its Open in app buttons and connect links open the beta, and its
  `apple-app-site-association` names the beta app.
- **No updates from production.** The beta's Sparkle feed is the staging site's, which has no appcast,
  so it never offers to replace itself with the real app.

## Set it up

`scripts/staging.sh` does each step and refuses production's ref. Production is only read: `auth`
copies its auth settings and changes the copy.

```sh
scripts/staging.sh create      # once: the project (about $10 a month of compute)
scripts/staging.sh all         # migrations, functions, secrets, auth, Config/Backend.staging.local.xcconfig, site
scripts/staging.sh seed        # the test account (.secrets/staging-account.txt) and its sample notes
```

Run `db`, `functions` or `web` again after `dev` moves. Steps outside the script, done once:

- Google: the Web client (`167801936934-…`) lists `https://<staging ref>.supabase.co/auth/v1/callback`
  as an authorized redirect URI.
- Apple: the Services ID `app.ambernotes.signin` lists the same address as a return URL. The beta
  App ID `dev.emilwagman.pane.beta` has Sign in with Apple.
- App Store Connect: the app record "Amber Notes Beta" for `dev.emilwagman.pane.beta`, internal
  testing only.

## Build the beta

```sh
CHANNEL=beta scripts/release-mac.sh 1.2.0    # build/dist-beta/Amber-Notes-Beta-1.2.0.dmg, notarized
CHANNEL=beta scripts/testflight.sh ios       # TestFlight, the "Amber Notes Beta" app
```

Both build the current checkout. They need `Config/Backend.staging.local.xcconfig`
(`scripts/staging.sh app-config`).

TestFlight: the App Store Connect app "Amber Notes Beta" (6819855588) has an internal group,
Staging, that gets every build. The beta App ID needs the App Group `group.dev.emilwagman.pane.beta`
selected under App Groups in the developer portal; command-line signing can't do that. On the first
iPhone archive the API key couldn't create the share extension's profile ("Authentication failed");
archiving with the Apple ID signed into Xcode (the same `xcodebuild archive` without the
`-authenticationKey…` flags) and exporting with the key worked.

## Amber Notes Beta for daily use on a Mac

```sh
scripts/staging.sh dev-app          # build from origin/dev, install /Applications/Amber Notes Beta.app
scripts/staging.sh dev-app --wait   # the same, waiting for a running copy to quit first
```

It builds the TestFlight Mac target (sandboxed, App Store entitlements) from a clean worktree at the
tip of `origin/dev` (`../AmberNotes-devapp`), signed with the team's Apple Development certificate.
Every rebuild has the same bundle id, team and keychain group as the TestFlight build, so it opens the
same container and keychain items: no new sign-in, no new device link. It never opens the app, and
it won't replace a copy that's running. TestFlight may later install a newer TestFlight build over it.

## What staging leaves out

- Push for AI connection asks (no APNs key). Connect with the QR code or the number instead.
- Live collaboration. In the app and on the site's `/s` and `/t` pages it's still a prototype that
  talks only to the local relay (`scripts/collab-relay.ts`), not to Supabase.
- Website analytics and the `mcp.` alias.

Emails from staging come from the production senders (hello@ for sign-in, emil@ for the onboarding
emails) through the same Resend account. Their subjects start with "[Staging]".

## Onboarding emails

`scripts/staging.sh lifecycle` turns on the onboarding emails (docs/Technical/lifecycle-emails.md)
exactly as production runs them: the same hourly pg_cron tick, ladder, gaps and 9 o'clock rule.
The function reads its accounts from this project's own `auth.users`, so it can only email people
who signed up on staging. The accounts that existed before the first run (the seeded test and bench
accounts, whose addresses nobody reads) are opted out in `email_unsubscribes`. Three settings exist
for staging and are unset in production: `LIFECYCLE_SITE` (links open the staging site, so the beta
app), `LIFECYCLE_SUBJECT_PREFIX` ("[Staging] ") and `LIFECYCLE_MANUAL_ROUNDS`.

To see the series in an hour instead of a month:

```sh
scripts/staging.sh lifecycle-next you@example.com      # 3 days pass for that account, then a round
scripts/staging.sh lifecycle-next you@example.com 7    # a week
```

Each call moves that account's sign-up and its earlier emails back, then runs a round that ignores
the 9 o'clock rule. The ladder still decides: an account that does nothing between emails gets two
and then silence, as in production. Open the app or edit a note between calls to keep it going.
