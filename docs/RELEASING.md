# Releasing

Releases are cut from a version tag. GitHub Actions (`.github/workflows/release.yml`) builds both apps from that tag.

## Cut a release

```sh
git checkout main && git pull
git tag -a v1.0.1 -m "Checklists sink faster
Fixed the bullet alignment in long notes"
git push origin v1.0.1
```

The tag message becomes the release notes, one line per item. You can also start the workflow by hand from the Actions tab (**release → Run workflow**) with a version and notes.

What happens:

| Job | Result |
|---|---|
| **iOS** | Archives the app, signs it through App Store Connect, and uploads it. The build appears in App Store Connect within about 15 minutes. **Nothing is submitted for review.** Open the version page, select the build, and press **Add for Review** yourself. |
| **Mac** | Builds the Developer ID app, notarizes and staples it, makes the DMG, signs it for Sparkle, writes the appcast, and deploys the site. amber-notes.vercel.app/download then serves the new DMG, and installed copies offer the update within a day. A GitHub Release is created with the DMG attached. |

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

And one variable: `SHARE_URL` (`https://amber-notes.vercel.app`).

The API key needs the **Admin** role, so Xcode can create and use the signing certificates in the cloud. No certificate files live in GitHub.

To rotate a key: create the new one, update the secret with `gh secret set NAME --env release < file`, then revoke the old one.

## Release from a Mac instead

The same scripts run locally, reading keys from the gitignored `.secrets/`:

- `scripts/release-mac.sh 1.0.1 "notes"`: the Mac DMG and update
- `scripts/testflight.sh ios`: the iOS upload

## Backend changes

The Supabase database and Edge Functions are not part of the app release. Deploy them separately with `supabase db push` and `supabase functions deploy`, before shipping an app version that depends on them. Migrations must be additive, so older app versions keep working.
