# Settings in tabs (2026-10-07)

Settings was one long scroll: 1,709 pt in a 560 pt window, and more for accounts with
Privacy & Security. The Mac now has toolbar tabs and iPhone has a row for each page.

| Tab | What's on it | Mac window height |
|---|---|---|
| General | Menu bar item (iPhone: Show Setup Guide), API keys, About, terms and privacy | 511 pt |
| Account | Name and photo, email, Sync with Sync Now, Sign in with Apple, Export Your Notes, Sign Out, Delete Account | 622 pt |
| AI | Connect an AI (ChatGPT, Claude, Claude Code, Codex, Incredible), connected AIs, Apps in Notes previews | 670 pt |
| Privacy & Security | Encryption summary, where your key is kept, Add a device, recovery key, Locked Notes | 741 pt |
| Storage | Usage meter and breakdown | 401 pt |

Heights are for the sample account below. The window takes each tab's height.

## How the pictures were made

All of them come from tests that draw offscreen. Nothing was shown on a screen.

- Mac: `TEST_RUNNER_AMBER_HIG_SHOTS=<dir> TEST_RUNNER_PANE_CI_WINDOWS=1 scripts/qa-test.sh 'PaneTests/AppSnapshotTests/settingsTabs(dark:)'`,
  on a CI runner only: it orders a titled window in, which would show on a developer's Mac.
  Each tab's real page is drawn in a window with AppKit toolbar tabs (`NSTabViewController`,
  `.toolbar` style), which is how the Settings scene draws them. The selected tab's glass
  capsule can't be drawn offscreen (it samples the screen behind it and comes out as a white
  block), so it is left out. The selected tab still shows by its darker label.
- iPhone: `TEST_RUNNER_AMBER_HIG_SHOTS=<dir> xcodebuild test -scheme Pane -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:'PaneTests/ListLayoutSnapshots/settingsPages(dark:)' CODE_SIGNING_ALLOWED=NO`.
  Each page is opened the way a link opens it (`SettingsRoute.open`).
- Before: the previous `SettingsView` (origin/dev at 57f0f0fb), drawn at its full height.
  The account had no key ready, so Privacy & Security is missing from it; real accounts
  have that section as well.

Sample account: Sara Lind, two AIs connected, the key on this device plus a MacBook Air and
an iPhone, 1.15 GB of 2 GB used.

## Files

- `before-after-mac-{light,dark}.jpg`: the old window next to the five tabs.
- `mac-settings-<tab>-{light,dark}.jpg`: each Mac tab.
- `iphone-settings-{light,dark}.jpg`: the first iPhone screen. `iphone-settings-<tab>-{light,dark}.jpg`: each page.
