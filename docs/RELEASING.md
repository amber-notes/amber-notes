# Releasing

Releases are cut from a version tag. GitHub Actions (`.github/workflows/release.yml`) builds both apps from that tag.

## Cut a release

```sh
git checkout main && git pull
git tag -a v1.0.1 -m "Checklists sink faster
Fixed the bullet alignment in long notes"
git push origin v1.0.1
```

The tag message becomes the release notes, one line per item. End it with a line that thanks everyone whose pull request is in the release, by GitHub handle: `Thanks to @arnavtambe and @wufangyong973`. List them with `git log --format='%an' <last tag>..HEAD | sort -u`, and add anyone new to Thanks in the README.

The changelog (web/content/changelog.json, shown at /changelog and in the apps) lists only major and minor releases (1.0, 1.1, 1.2). Patch releases (1.1.1, 1.1.2) get release notes and an App Store "What's New", but no changelog entry; anything worth telling people goes into the next minor release's entry. You can also start the workflow by hand from the Actions tab (**release → Run workflow**) with a version and notes.

What happens:

| Job | Result |
|---|---|
| **iOS** | Archives the app, signs it through App Store Connect, and uploads it. The build appears in App Store Connect within about 15 minutes. **Nothing is submitted for review.** Open the version page, select the build, and press **Add for Review** yourself. |
| **Mac** | Builds the Developer ID app, notarizes and staples it, makes the DMG, signs it for Sparkle, writes the appcast, and deploys the site. ambernotes.app/download then serves the new DMG, and installed copies offer the update within a day. A GitHub Release is created with the DMG attached. |

Version numbers: the tag sets the marketing version (`1.0.1`). Build numbers are UTC timestamps, so they always increase.

## One-time setup

The release jobs run in the GitHub environment **release**. Its secrets:

| Secret | What it is | Where it comes from |
|---|---|---|
| `ASC_KEY_ID` | App Store Connect API key id | App Store Connect → Users and Access → Integrations → Team Keys |
| `ASC_ISSUER_ID` | Issuer id shown above that table | Same page |
| `ASC_KEY_P8` | The key file's contents (`AuthKey_….p8`) | Downloaded once when the key was created |
| `SPARKLE_PRIVATE_KEY` | EdDSA private key that signs Mac updates | `generate_keys -x` from Sparkle; the public half is in `Info-Direct.plist` |
| `SUPABASE_URL` | The production Supabase URL | Supabase dashboard → Project Settings → API |
| `SUPABASE_ANON_KEY` | The production anon key (public by design, kept out of the repo anyway) | Same page |
| `VERCEL_TOKEN` | Token that can deploy the share site | vercel.com → Account Settings → Tokens |
| `VERCEL_ORG_ID` | The Vercel team id | `web/.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | The `amber-notes` project id | Same file |

And one variable: `SHARE_URL` (`https://ambernotes.app`).

The API key needs the **Admin** role, so Xcode can create and use the signing certificates in the cloud. No certificate files live in GitHub.

To rotate a key: create the new one, update the secret with `gh secret set NAME --env release < file`, then revoke the old one.

## Release from a Mac instead

The same scripts run locally, reading keys from the gitignored `.secrets/`:

- `scripts/release-mac.sh 1.0.1 "notes"`: the Mac DMG and update
- `scripts/testflight.sh ios`: the iOS upload

## What the site holds back until a release is public

The site reads the public version from `web/content/release.json`, which `scripts/release-mac.sh` (and the release workflow's Mac job) writes. Two things follow it by themselves, with no flag to flip:

- **/changelog** shows no entry newer than that version (`web/lib/changelog.ts`). Add the entry when you cut the release; it appears when the Mac release is public.
- **/connect** shows the QR code page only from 1.2 (`qrConnectLive` in `web/lib/connect.ts`). Apps before 1.2 can't scan the code or answer "Open Amber Notes on this Mac" from that page, so until then /connect shows the page before it (`ConnectFlowV1`: sign in, a notification, a number to type, or the recovery key). To test the QR page with a TestFlight build, add `&qr=1` to the connect address: `https://ambernotes.app/connect?request=<id>&qr=1`.

So the Mac release of 1.2 turns the QR page on for everyone, iPhone included. Run it only once iPhone 1.2 is approved and released on the App Store, or people on iPhone 1.1.2 get a code they can't scan (the page's "Get a notification instead" still works for them). If the App Review notes describe the connect page, update them for the QR page at the same time.

## Copy to change with the next release

Text outside the app that names a Settings path the app changed. It describes the app people have now, so change it once the new app is public, then delete the item here.

- **Settings tabs (#255):** the Privacy & Security section is now the Security tab, and Export Your Notes moved to Account.
  - `web/content/privacy-policy.md` and `docs/privacy-policy.md`, two places: "Settings → Privacy & Security (→ Export Your Notes)" becomes "Settings → Account → Export Your Notes". This is the privacy policy: show Emil, and update its "Last updated" date.
  - `web/app/privacy-security/page.tsx`, Export: "Settings → Account → Export Your Notes".
  - `web/app/blog/back-up-apple-notes/page.tsx` (Export: Settings, Account), `web/app/blog/connect-chatgpt-to-your-notes/page.tsx` and `web/app/blog/encrypted-notes-app-for-ai/page.tsx` (recovery key: Settings, Security).
  - `supabase/functions/account/export.ts`: the README in the data export says "Settings > Privacy & Security > Export Your Notes"; it becomes "Settings > Account > Export Your Notes" (a function deploy).

## Backend changes

The functions reach Postgres through Supabase's transaction pooler, so a burst of requests can't use up the database's 60 connections (`supabase/functions/_shared/db.ts`, and what happened without it in `docs/Evidence/db-connections.md`). That needs one secret per project, set once: `supabase secrets set DB_POOLER_HOST=<host> --project-ref <ref>`, with the host from Project Settings > Database > Connection pooling (for production, `aws-1-eu-central-1.pooler.supabase.com`). After a deploy, the function's log says `{"event":"db","mode":"pooled","count":3,"ssl":true,"tls":"verify"}`. `"direct"` means the secret is missing. The pooled connection is TLS, checked against Supabase's root certificate, which is pinned in `supabase/functions/_shared/supabase-ca.ts` (valid until April 2031). If database calls start failing with a certificate error (Supabase rotated the root, or the runtime changed), `supabase secrets set DB_POOLER_TLS=off` turns TLS off without a deploy while the certificate is replaced; the log then says `"ssl":false,"tls":"off"`, and that is an incident to fix, not a setting to leave.

The functions do their work in one region. Supabase runs a function nearest its caller and has no setting to pin it, so a function that lands elsewhere hands the request to itself in the home region (`supabase/functions/_shared/region.ts`; what was measured is in `docs/Evidence/function-region.md`). One secret per project, set once: `supabase secrets set FUNCTION_REGION=eu-central-1 --project-ref <ref>` (the database's region). It needs `MCP_PROXY_SECRET` too, which carries the caller's address across. Give the site the same value so its own calls go straight there: `FUNCTION_REGION=eu-central-1 scripts/deploy-web.sh`. Every answer says where the work ran in `x-amber-region`.

The Supabase database and Edge Functions are not part of the app release. Deploy them separately with `supabase db push` and `supabase functions deploy`, before shipping an app version that depends on them. Migrations must be additive, so older app versions keep working.
