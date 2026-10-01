# Contributing

Bug reports and small, focused fixes are welcome. For anything bigger, open an issue first so we can agree on the approach before you spend time on it. Issues labelled [good first issue](https://github.com/emilwagman/amber-notes/labels/good%20first%20issue) are small and well scoped.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md), not in an issue.

## Set up (about 10 minutes)

You need macOS 26 with Xcode 26, Homebrew, and Docker (for the local backend).

```sh
brew install xcodegen supabase/tap/supabase deno pnpm
git clone https://github.com/emilwagman/amber-notes.git && cd amber-notes
supabase start          # local Postgres, Auth, Storage and Functions (needs Docker)
xcodegen generate       # makes Pane.xcodeproj from project.yml
```

The app talks to the local stack by default. Nothing you do here touches anyone's real notes.

## The Mac and iPhone app

Open `Pane.xcodeproj` and run the `Pane` scheme on "My Mac" or an iPhone simulator. From the command line:

```sh
scripts/qa-test.sh                                   # Mac unit and interaction tests
scripts/qa-test.sh PaneTests/ShareAskTests           # one suite

# iPhone build check (CI doesn't build for a device, so run this before you open a PR)
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project Pane.xcodeproj \
  -scheme Pane -destination 'generic/platform=iOS' -derivedDataPath build/ios CODE_SIGNING_ALLOWED=NO build
```

The interaction tests drive the real editor in an offscreen window. They never move your mouse or take focus.

## The backend and the AI server

```sh
deno test --allow-all supabase/functions/_shared/ supabase/functions/mcp/*.pglite.test.ts supabase/functions/mcp/notes.test.ts
```

The `*.pglite.test.ts` tests run every migration in an in-process Postgres, so they don't need Docker. The `*.e2e.test.ts` tests need the local stack (`scripts/mcp-e2e.sh`).

## The website

```sh
cd web && pnpm install && pnpm typecheck && pnpm test && pnpm build
```

`pnpm dev` runs it locally. Most pages work without it; the shared-note, report and connect pages need `web/.env.local` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the local stack). See [web/README.md](web/README.md).

## Pull requests

- **Apple Notes is the reference.** When you're unsure how something should behave or look, do what Notes does.
- **Every fix comes with a test** that fails without it. Editor and UI behaviour is tested in the offscreen harness (`PaneTests/Harness`).
- **Follow Apple's Human Interface Guidelines.** Check light and dark mode, the largest text sizes, and VoiceOver labels for anything you touch.
- **Copy:** sentence case, short sentences, "you". Buttons start with a verb.
- **No secrets in the repo.** Keys and credentials live in gitignored files (`.env`, `.secrets/`, `Config/Backend.local.xcconfig`) and in GitHub Secrets. CI scans every push with gitleaks.
- **Database changes are additive** and go in a new migration with a newer timestamp than every existing one.
- Keep pull requests small, and say how you tested them. CI must pass and one review is required before merging.
