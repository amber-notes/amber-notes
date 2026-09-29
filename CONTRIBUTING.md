# Contributing

Team members work through pull requests on `main`. Outside contributions are welcome for bug reports and small, focused fixes. For anything bigger, open an issue first so we can agree on the approach.

## Set up (about 10 minutes)

```sh
brew install xcodegen supabase/tap/supabase deno pnpm
git clone https://github.com/emilwagman/amber-notes.git && cd amber-notes
supabase start          # needs Docker
xcodegen generate
scripts/qa-test.sh      # Mac unit and interaction tests
```

Open `Pane.xcodeproj` and run the `Pane` scheme on "My Mac" or an iPhone simulator. The app uses the local stack by default. See the README for the backend and web tests.

## How we work

- **Apple Notes is the reference.** When you're unsure how something should behave or look, do what Notes does.
- **Every fix comes with a test** that fails without it. UI behaviour is tested in the offscreen editor harness (`PaneTests/Harness`).
- **Follow Apple's Human Interface Guidelines**, and check light and dark mode, the largest text sizes, and VoiceOver labels for anything you touch.
- **No secrets in the repo.** Keys and credentials live in gitignored files (`.env`, `.secrets/`, `Config/Backend.local.xcconfig`) and in GitHub Secrets. CI scans every push with gitleaks.
- **Database changes are additive** and go in a new migration with a newer timestamp than every existing one.
- Keep pull requests small and describe how you tested them. CI must pass and one review is required before merging.
