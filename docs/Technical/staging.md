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

## What staging leaves out

- Lifecycle emails: the function isn't deployed and the vault has no address for the hourly tick.
- Push for AI connection asks (no APNs key). Connect with the QR code or the number instead.
- Live collaboration. In the app and on the site's `/s` and `/t` pages it's still a prototype that
  talks only to the local relay (`scripts/collab-relay.ts`), not to Supabase.
- Website analytics and the `mcp.` alias.

Emails from staging come from the production sender, hello@ambernotes.app, through the same Resend
account. Their subjects start with "[Staging]".
