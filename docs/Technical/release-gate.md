# Release gate

One command checks a commit before it ships: how fast it is on a real Mac with a real account, whether
it is safe, how much space it takes, and how much it asks of the network.

```sh
scripts/release-gate.sh <candidate ref> [--baseline <last release ref>]
```

It writes a short summary to `docs/Evidence/release-gate/<date>-<ref>.md` (verdict, what failed, the
headline numbers, the worst hang stacks). The full report and every number, run and stack go outside
the repository, to `~/content-tools/projects/amber-proto/release-gate/` (`AMBER_GATE_RAW` to change it);
the summary names the file. A baseline is looked up there.
Each line is **pass**, **fail** (over its budget) or **regression** (more than 15% worse than the
baseline's report, and past that metric's noise floor). Any fail or regression fails the gate.

No App Store submission, TestFlight build for users, Mac release or production server deploy goes out
without a passing report for that commit (`docs/RELEASING.md`). The `amber-release-gate` skill says
how agents run it.

## Why it exists

On 2026-10-07 the dev app froze and then crashed with one note in it. AppGate read the session from
the Keychain on every update, a MenuBarExtra label was set again on every update of the app and asked
for another layout pass each time, and the sidebar lagged. CI's performance tests passed: they run a
Debug build, ad-hoc signed, with no Keychain and no account. This gate measures what people run.

## What it measures

### The build

`scripts/release-gate/build.sh` builds the ref as the download is built: Release, the `PaneDirect`
target, archived and exported with Developer ID (team-signed; not notarized, which changes nothing at
run time). It uses the Amber Notes Beta identity (`Config/Beta.xcconfig`) so it runs on the staging
backend, sandboxed, beside the real app without touching its data or Keychain. A ref older than the
beta identity gets that commit (db66affa) applied first.

The only change to the ref's code is the probe: `scripts/release-gate/GateProbe.swift` is copied into
`Pane/App`, one line in `PaneApp.init` attaches it, and `AppNetwork.session` becomes a session that
counts requests and bytes. The probe does nothing unless the app is launched with `-gateProbe`. It
never posts input events: it acts the way the app's own controls do (the sidebar toggle action,
`NoteOpener`, `insertText` on the editor, selecting a sidebar row).

### Performance (on fleet-air)

The app is copied to the Mac and opened there the way Finder opens it. For each staging bench account
(1, 2,000 and 20,000 notes, each with the gate's short, typing and 5,000-line notes) it signs in, opens
the account's key with the recovery key and waits for the first full sync, then cold-launches the app
three times and plays the flows. Numbers are the median of the three runs.

| Line | How |
|---|---|
| Cold launch to first usable window | Process start to the notes window on screen with the key open |
| Launch to synced | Process start to the first completed sync |
| Longest frame, frames drawn, hitches | The main thread's display-link callbacks during each step: a gap is a frame the window couldn't draw. Steps: sidebar hide and show (6 toggles), opening a short note (4), the 5,000-line note (2), typing 25 keys and the save and push that follow, folder switches (6), a note arriving by sync (the gate changes a note on the server and the app pulls it) |
| Views laid out | Layout passes per view class during each step and during 20 s of idle, counted by swizzling `layout` on every view class in the windows (the status item's too). Idle must be 0: anything laid out again and again while nothing happens is a loop like the MenuBarExtra one |
| Idle CPU, wake-ups | 20 s with nothing happening, after sync: the process's CPU time and the main run loop's wake-ups, without the probe's own clocks |
| Main-thread hangs over 250 ms | A background thread pings the main thread every 50 ms. When a hang starts, the launcher on the Mac runs `sample` on the app's pid; the report shows the main thread's stack, symbolicated from the archive's dSYM |
| Crash, hang or spin reports | New files about the app in `~/Library/Logs/DiagnosticReports` on the Mac |
| Leftover folders after an account switch | Before each sign-in the probe counts folders still on the Mac that are marked deleted and waiting to be pushed, then removes the local library for real, so each account starts clean. Any count fails: those are the last account's folders, which the app would push into the next account and, when the last account signs in again, delete on the server (found 2026-10-08: `AccountLibrary.adopt` calls `context.delete(f)`, which resolves to Library's `delete(_ folder:)`) |

iPhone flows are not measured: a simulator would run on the hub Mac's screen, under its load, and its
timings are not a phone's. The iPhone app's size is measured.

### Security

| Line | How |
|---|---|
| Secret scan | `gitleaks git` with the repo's `.gitleaks.toml`, over the commits since the baseline |
| Supabase advisors | The security and performance advisors of the staging project (Management API). Errors fail; warnings are compared with the baseline |
| Row-level security | Signed in as one bench account: every public table with `user_id` returns none of the other account's rows and none that aren't its own; signed out, every table returns nothing; changing, deleting and writing over the other account's note by id all fail, and the note is still there |
| E2EE | After the app has typed known phrases into its notes and synced, every row of every public table, as text, and `storage.objects` names and metadata, are searched for them (read-only SQL on staging) |
| Dependencies | `pnpm audit --prod` in `web` and `app-stack`, `deno audit` in `cli` and `supabase/functions`. High or critical fails |
| Entitlements | The entitlements files diffed against the baseline. A change fails until someone has looked at it |
| Hosts | Every host named in the app, the site and the functions must be in `scripts/release-gate/hosts.txt`, which says which ones are called. And every host the app called while measured must be the staging backend |

### Storage

The Mac DMG and installed app, the iPhone app (Release, unsigned, zipped as a stand-in for the App
Store download), the app's local database and everything it keeps on disk after each account's first
sync (measured by the app itself, inside its container), and the server bytes of each bench account
(`pg_column_size` of its rows in every public table, plus its files in storage).

### Network

Requests and bytes the app sent and received during launch, opening a note and saving a note, and for
the first sync of each account (counted on the app's own URL session). p50 and p95 over 20 calls,
from the hub Mac, of the sync pull with nothing new, a pull of 500 notes, a push of one note,
`account-status`, the account export, and MCP initialize, list, search, fetch and edit (on the 20,000
note account, which has an MCP token in `.secrets`).

Server numbers come from staging, which runs whatever was last deployed there (the report lists the
function versions), not necessarily the candidate's server code. Deploy the candidate to staging
before the gate when its functions or migrations changed.

## Budgets

`scripts/release-gate/budgets.json`. Keys are metric keys from the report's JSON, with `*` for one part
(an account size). `max` is the budget; `floor` is the noise floor for the regression rule (a change
smaller than it is never a regression); `regression: false` turns that rule off for a line.

The first budgets were set on 2026-10-08, measured on fleet-air (MacBook Air M4, macOS 27), from
dev eb57bb1dc9 (docs/Evidence/release-gate/2026-10-08-dev-eb57bb1dc9.md), with these rules:

| Metric | Budget | Noise floor |
|---|---|---|
| Longest frame of a step | 1.5 × dev, at least 50 ms | 34 ms (two frames) |
| Views laid out in a step | 1.5 × dev + 50 | no regression rule (a frozen baseline lays out less) |
| Views laid out while idle | 0 | none |
| Hitches | 1.5 × dev + 2 | no regression rule |
| Idle CPU, wake-ups | 2%, 10 a second | 1%, 5 a second |
| Slowest key | 16 ms (one frame) | no regression rule |
| Cold launch to window, launch to synced | 1.3 × dev | 150 ms, 500 ms |
| First sync | 1.3 × dev | 2 s |
| Memory after the flows | 1.3 × dev | 20 MB |
| Hangs over 250 ms per run | dev's count (launch, and flows apart) | 1 |
| Longest hang | 1.3 × dev, at least 250 ms; 0 where dev had none | 150 ms |
| App and download sizes | 1.1 × dev | 1 MB |
| Local database, app data, server bytes | 1.3 × dev | 100 KB |
| Requests per flow | dev + 3 | 2 |
| Bytes per flow | 1.5 × dev | 10 KB |
| Server latency p50, p95 | 1.5 × dev + 100 ms, 2 × dev + 200 ms | 100 ms, 300 ms |
| Supabase advisor warnings | dev's count | 0 |

These are ceilings on today's dev, not targets: dev still has hangs of over a second, a first sync
of minutes, and a folder push the server refuses about 1,500 times a launch (see the report). Tighten a budget in its own commit when the code
behind it gets better; never loosen one to pass a run.

## Limits

- The beta build can't keep the account's key between launches (sandboxed Developer ID, no data
  protection keychain: the synced Keychain item can't be written), so each measured launch opens the
  key with the recovery key again. The report says so, and launch times include it (one request).
- No spindump: the Mac's account has no sudo. `sample` gives the main thread during each hang.
- The idle check counts layout passes, not SwiftUI body evaluations: a body that runs without
  changing any layout doesn't show up, though its CPU does.
- Frames are display-link callbacks on the main thread, so they measure the main thread's
  responsiveness, not GPU frame time.
