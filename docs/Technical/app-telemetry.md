# App telemetry

What the iPhone and Mac apps report about themselves: errors and crashes, a few product events,
and performance numbers. This page lists every event and everything an event can carry.
`PaneTests/TelemetryTests.swift` checks it against the code, so an event or a value that isn't
written here fails the tests.

Why it exists: the 1.1.2 Mac download never saved the account's key. A Keychain write failed with
-34018 on every save, the result was ignored, and every relaunch asked for the recovery key. Nothing
in the app reported it, and it went unnoticed for more than a week.

## Where it goes, and when

- **Destination:** the PostHog project the website uses, in the EU (`https://eu.i.posthog.com`,
  the `batch/` endpoint). The app has its own small client (`Pane/Telemetry/Telemetry.swift`): no
  PostHog SDK, no autocapture, no session replay, no screen recording.
- **Which builds send:** the released app and Pinto Notes Beta, and only when the build was given
  a project key (`PANE_POSTHOG_KEY` in `Config/Backend.local.xcconfig`; empty in the checked-in
  `Config/Backend.xcconfig`). Debug and QA builds, unit and UI tests, capture runs, `-local`
  launches and the Simulator never send (`TelemetryGate`).
- **The switch:** Settings › General › Share diagnostics and usage, on by default. Off, nothing is
  kept or sent, and what was waiting is dropped.
- **Who an event is from:** the account's id once signed in, so "this account is stuck on the key
  screen" can be answered. Before sign-in, a random id made for the install. Signing out replaces
  the install id with a new one. Delete Account does too, and drops what was waiting unsent.
- **No profile:** every event says `$process_person_profile: false`, so PostHog keeps no person
  profile, and `$geoip_disable: true`, so it works out no location from the request.
- **The queue:** events wait in `Application Support/Pane/telemetry-queue.jsonl`, at most 200;
  more are dropped. They go out in batches of up to 50: two seconds after an error, within a
  minute otherwise, when the app leaves the front, and at the next launch for whatever a crash
  or a missing connection left behind.

## What is never sent

Note text, titles, folder names, file names, search terms, anything an AI wrote, share link ids,
email addresses, recovery keys or any key material, access tokens, device names, and the name or
address of an AI app.

This is enforced by the types, not by care at each call:

- `Telemetry.record` takes a `TelemetryEvent` and nothing else.
- A value (`TelemetryValue`) is a number, a yes or no, a case of a closed enum (`TelemetryWord`),
  a UUID, or a version number that is only digits and dots (`VersionNumber`). There is no way to
  make one from other text.
- Errors are mapped to a kind and codes (`Pane/Telemetry/TelemetryFailure.swift`). An error's
  description or message is never read: it can hold a file name or a title.
- Tests: every string in a batch must be on the list of words below, a UUID, a version number or
  a timestamp (`everyStringInABatchIsOnTheList`), and sample note text pushed through every
  place that takes a string from outside never shows up in a batch (`noteTextNeverReachesABatch`).

## On every event

| Property | Values |
|---|---|
| `app_version`, `app_build`, `os_version` | Version numbers |
| `platform` | `ios`, `macos` |
| `device_class` | `iphone`, `ipad`, `mac` (never the model) |
| `channel` | `release`, `beta` (`debug` builds never send) |
| `distribution` | `app_store` (App Store and TestFlight), `direct` (the Mac download) |

## Product events

| Event | When | Properties |
|---|---|---|
| `app_opened` | At launch, and once for each new day (UTC) the app is still running | `launch`, `signed_in` (yes or no) |
| `signed_in` | A sign-in worked | `method`: `apple`, `google`, `email` |
| `signed_up` | A sign-in worked for an account made in the last five minutes, or an email sign-up was confirmed | `method` |
| `key_ready` | The account's key arrived on this device while the app was running | `how`: `created`, `recovery_key`, `linked` (Add a device), `icloud_keychain`, `start_fresh` |
| `gate_shown` | A screen between signing in and the notes was shown (once a launch for each) | `screen`: `welcome`, `add_device`, `no_device`, `waiting`, `recovery`, `start_fresh`, `unreachable`, `checking` |
| `first_note_created` | The first note made with New Note on this install | |
| `first_sync` | The first sync that finished on this install | `duration_ms` |
| `ai_connected` | An AI connection was approved, or a token was made for one | `kind`: `claude`, `chatgpt`, `other` |
| `first_ai_edit_seen` | The first time a note an AI changed was opened on this install | |

## Error reports

| Event | When | Properties |
|---|---|---|
| `keychain_failed` | A Keychain read or write failed | `item`: `key_synced`, `key_pending`, `key_previous`, `key_local`, `device_identity`, `session`, `notes_lock`; `operation`: `save`, `read`, `probe_read`, `probe_write`; `status` (the OSStatus) |
| `key_startup` | Startup decided what to do about the account's key | `outcome`: `ready`, `ready_unverified`, `create`, `reregister`, `replace`, `wait`, `mismatch`, `unreachable`; `had_key` (the key was open on this device before); `store`: `keychain`, `file`, `memory` |
| `sync_failed` | Syncs have failed for a minute, over at least three tries | `kind`, `status`, `code`, `hint`, `runs` |
| `upload_refused` | The server refused a row or a file for good | `what`: `note`, `folder`, `file`; `kind`, `status`, `code`, `hint` |
| `row_unreadable` | A row that came down didn't open with this device's key | `what` |
| `file_download_failed` | A file couldn't be fetched | `kind`, `status`, `code`, `hint` |
| `sign_in_failed` | A sign-in or sign-up didn't work (not one the person closed) | `method`; `kind`: `network`, `server`, `wrong_credentials`, `email_not_confirmed`, `rate_limited`, `not_allowed`, `already_exists`, `weak_password`, `bad_code`, `other`; `status` |
| `store_open_failed` | The library couldn't be opened at launch (the app then stops, as before) | `domain`: `cocoa`, `swift_data`, `sqlite`, `posix`, `other`; `code` |
| `store_save_failed` | A save of the library failed | `domain`, `code` |
| `crash` | MetricKit delivered a crash report from an earlier run | `exception_type`, `exception_code`, `signal`, `crashed_version`, `crashed_build`, `binary` (the app binary's build UUID), `frames`, `frame_0` to `frame_7` (offsets into the app's own binary) |
| `hang` | MetricKit delivered a hang report | `duration_ms`, `crashed_version`, `crashed_build`, `binary`, `frames`, `frame_0` to `frame_7` |

A failure's `kind` is one of `offline`, `timeout`, `network`, `cancelled`, `http`, `database`,
`storage`, `auth`, `decoding`, `crypto`, `file`, `other`. `status` is an HTTP status or the
system's own error number. `code` is one of the database's refusal codes the app knows (`PT413`,
`PT429`, `PT403`, `42501`, `23514`, `23503`, `23505`, `22001`, `22P02`, `22P05`, `22021`,
`54000`), or `none` or `other`. `hint` is `wrong_key`, `no_key`, `not_yours`, `none` or `other`.

Each of these, except `crash`, `hang`, `sign_in_failed` and `store_open_failed`, is sent once for
each launch however often it happens.

Crashes and hangs come from Apple's MetricKit, which hands them over at the next launch. No crash
SDK is linked. The system's report also holds a termination reason in words and the names of
other binaries; neither is sent. At most five crashes and five hangs are sent from one delivery.

## Performance

| Event | When | Properties |
|---|---|---|
| `cold_launch` | The notes were drawn after a launch that went straight to them | `duration_ms`, from the start of the app's own code |
| `sync_durations` | When the app quits, or once 20 syncs are counted | How many syncs took `under_250ms`, `under_1s`, `under_4s`, `under_15s`, `over_15s`, and how many `failed` |
| `library_size` | After the first sync of a launch | `notes`: `0`, `1_10`, `11_100`, `101_1000`, `over_1000` |
| `hangs` | With a MetricKit delivery that holds hangs | `count` |

Durations are rounded to 10 ms.

## Deleting what PostHog holds

The app never calls PostHog's API except to send events. Deleting an account's events there is
done by hand: in PostHog, delete the events whose `distinct_id` is the account's id (Data
management, or the persons and events deletion API with a personal API key). With no person
profiles there is no person to delete, only events. If this should happen on every Delete Account,
the `account` server function would need to ask PostHog for it with a private key; that isn't built.
