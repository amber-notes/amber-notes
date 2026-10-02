# Contributing

Amber Notes is built in the open, and I'd love your help with it. The most useful thing you can bring is an idea of your own: something you want from a notes app your AI can use. Bug reports and fixes are welcome too.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md), not in an issue.

## Bring your own idea

Open a post in [Ideas](https://github.com/amber-notes/amber-notes/discussions/categories/ideas). Say what you were trying to do and where the app got in your way. You don't need a design or a plan. I reply within a day.

Good ideas become issues, credited to you, and you're first in line to build it if you want to. If you'd rather just build, say so in the post and we'll agree on the approach before you spend time on it.

## Where to start

- [**help wanted**](https://github.com/amber-notes/amber-notes/labels/help%20wanted): real features with a short spec, where the code lives, how to test it and a size. Comment on one to claim it.
  - [Shortcuts actions: add to a note, and create a note](https://github.com/amber-notes/amber-notes/issues/131) (Swift, M)
  - [Let an AI update any table row](https://github.com/amber-notes/amber-notes/issues/132) (TypeScript, M)
  - [Import Notion databases as tables](https://github.com/amber-notes/amber-notes/issues/133) (Swift, M)
  - [Import from Day One](https://github.com/amber-notes/amber-notes/issues/134) (Swift, M)
  - [Import Bear backups](https://github.com/amber-notes/amber-notes/issues/139) (Swift, S)
  - [Translate the app, starting with Swedish](https://github.com/amber-notes/amber-notes/issues/135) (Swift, L)
  - [Write a template for the gallery](https://github.com/amber-notes/amber-notes/issues/136) (JSON, S)
- [**good first issue**](https://github.com/amber-notes/amber-notes/labels/good%20first%20issue): small, well-scoped fixes for a first pull request.
- **A template** for the [template gallery](https://ambernotes.app/templates): no Swift needed, see [Add a template](#add-a-template).

## What you can expect from me

- A first review within two days. If I'm going to say no, I'll say so early, before you've done the work.
- Help when you're stuck. Ask in the issue or the pull request; there are no silly questions about a codebase you've never seen.
- Credit. Everyone with a merged pull request is listed under [Thanks](README.md#thanks) in the README and named in the release notes of the version that ships their work. Community templates show "by @you" on the website.

## Set up (about 10 minutes)

You need macOS 26 with Xcode 26, Homebrew, and Docker (for the local backend).

```sh
brew install xcodegen supabase/tap/supabase deno pnpm
git clone https://github.com/amber-notes/amber-notes.git && cd amber-notes
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

## Add a template

A [template](https://ambernotes.app/templates) is a note plus the instructions that let ChatGPT, Claude or Claude Code fill it in. Each one is a JSON file in `web/content/templates/`, and it gets its own page on ambernotes.app with your name on it.

**The bar.** A template earns its place when someone would use it every week:

- **Useful.** It does a job people repeat: a log, a tracker, a plan they keep coming back to. Not a one-off document.
- **Real content.** The example reads like a real person's note, with plausible names, numbers and dates. No lorem ipsum, no "Item 1".
- **No brand names** in the title, the note or the example. "Workout log", not "Strava log". (ChatGPT, Claude and Claude Code are fine, since the prompt is written for them.)
- **Sentence case** titles, no em dashes, and no promises that the AI acts on its own on a schedule. It acts when you talk to it.
- **Not a near-copy** of a template we have. Check the gallery first.

**Steps.**

1. Copy the existing template closest to yours to `web/content/templates/<slug>.json` and rewrite it. The fields are documented on the `Template` type in `web/lib/templates.ts`.
2. Add `"author": "your-github-handle"` (without the @). That's what puts "by @you" on the card and the page.
3. Add your slug to `ORDER` in `web/lib/templates.ts`. If the note has no table, also add it to `SLICE_FROM` with the heading the card should start at.
4. Write the `demo` calls: the MCP tool calls an AI would make for your `asks`. Then let the test write the example from them. The tests also check the card has at least five lines to show, so give the example a few rows:

   ```sh
   cd web && FILL_EXAMPLES=1 pnpm vitest run lib/templates.test.ts && pnpm vitest run lib/templates.test.ts
   ```

5. Open a pull request. Skip the cover: I draw every cover in the gallery's paper-cut style and push it to your branch. Until it's there, the site tests and the build fail on the missing cover, and that's expected.

A small example, trimmed (a real one has three `asks` and a few `demo` calls):

```json
{
  "slug": "plant-care",
  "title": "Plant care",
  "category": "Home and life",
  "audiences": ["Personal"],
  "audience": "For anyone whose plants are either drowning or thirsty.",
  "description": "A plant care log your AI keeps: tell it what you watered or repotted, and ask what's due before you leave for a week.",
  "tagline": "Every plant, watered on time.",
  "folder": "Home",
  "note": "Plant care\n\nWhat each plant needs and when it last got it.\n\n<!-- pane-table: Date=date; Plant=text; Did=choice Watered|Fed|Repotted -->\n| Date | Plant | Did |\n| --- | --- | --- |\n",
  "prompt": {
    "default": "Use my Amber Notes note \"Plant care\". When I tell you I watered, fed or repotted a plant, add a row with log_table_row. When I ask what's due, read the table with read_table and tell me which plants haven't been watered in over a week."
  },
  "asks": ["Watered the fiddle leaf and the monstera.", "What needs water before I leave on Friday?"],
  "demo": [
    { "tool": "log_table_row", "args": { "values": { "Date": "2026-09-28", "Plant": "Monstera", "Did": "Watered" } } }
  ],
  "example": "",
  "related": ["home-maintenance", "habit-tracker", "meal-plan"],
  "updated": "2026-10-02",
  "author": "your-github-handle"
}
```

Not sure your idea fits? Open a [Template idea](https://github.com/amber-notes/amber-notes/issues/new?template=template-idea.md) issue first and I'll tell you before you write it.

## Pull requests

- **Apple Notes is the reference.** When you're unsure how something should behave or look, do what Notes does.
- **Every fix comes with a test** that fails without it. Editor and UI behaviour is tested in the offscreen harness (`PaneTests/Harness`).
- **Follow Apple's Human Interface Guidelines.** Check light and dark mode, the largest text sizes, and VoiceOver labels for anything you touch.
- **Copy:** sentence case, short sentences, "you". Buttons start with a verb.
- **No secrets in the repo.** Keys and credentials live in gitignored files (`.env`, `.secrets/`, `Config/Backend.local.xcconfig`) and in GitHub Secrets. CI scans every push with gitleaks.
- **Database changes are additive** and go in a new migration with a newer timestamp than every existing one.
- Keep pull requests small, and say how you tested them. CI must pass and one review is required before merging.
