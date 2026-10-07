# Offline

Amber Notes is local-first: notes, folders and files live in SwiftData on the device, edits are
marked dirty and go up when a sync gets through (`Pane/Sync/SyncEngine.swift`). This page records
what works with no network, how it was checked, and what changed on 2026-10-07 to close the gaps.

## How it was tested

- **Mac unit tests, network simulated down.** `PaneTests/Network/OfflineTests.swift`,
  `SyncFaultTests.swift` and `KeyStartupTests.swift` run the sync engine against `StubSupabase`
  behind `NetFault` (`-netOffline`, timeouts, dropped connections, answers lost after the server
  applied a write). `NetworkPath.force(down:)` stands in for the system saying there's no network.
- **iPhone simulator, local stack.** `PaneUITests/OfflineUITests.swift`, driven by
  `scripts/offline-ios.sh`, against a local Supabase stack (never production). The app goes
  offline and back while running through the debug toggle in `DebugOffline` (a Darwin
  notification; `-netToggle`), or launches with no network (`-netOffline`). Realtime is
  disconnected with it, so nothing arrives by a side door.
- Network Link Conditioner wasn't used: it changes the whole Mac's network, which other work on the
  same Mac shares.

## Audit (dev tip `57f0f0fb`, before the fixes)

| Case | Before | Evidence | Now |
|---|---|---|---|
| Launch offline, signed in, key on the device, access token under an hour old | Works | `KeyStartup.decide` returns `ready(verified: false)` for `.unreachable`; `offlineWithTheKeyCarriesOnAndChecksLater` | Works |
| Launch offline more than an hour after the last token refresh | **Broken: sign-in screen.** `Backend.watchAuth` treated an expired session whose refresh failed as signed out | `anExpiredSessionStaysSignedInOffline` fails on the old code | Stays signed in; a refresh token the server refuses still signs out (`aRefreshTheServerRefusesSignsOut`) |
| First launch after install, offline | Needs a network, as expected: sign-in says "Can't reach the server. Check your connection." | `SlowNetworkUITests.testSignInOffline` | Same |
| Time before notes show, airplane mode | Immediate: requests fail at once | `offlineWithTheKeyCarriesOnAndChecksLater` | Same |
| Time before notes show, network that hangs (plane Wi-Fi before paying) | **Up to 12 s** on the key screen (`fetchTimeout`) | `AccountCrypto.run` waited `fetchTimeout` whatever the Keychain held | At most 1 s with the key here (`aHungServerDoesNotHoldBackTheNotesWhenTheKeyIsHere`: 0.1 s with a 100 ms limit); 12 s only without a key |
| Create, edit, delete, restore notes | Works, synced later | `offlineEditsGoUpOnceOnline`, `aLongOfflineSessionAcrossARestartLandsWhole` | Works |
| Checklists and tables | Works: they're note text | same | Works |
| Folders: create, rename, move | Works; for a folder changed on two devices, the last to sync wins | `aLongOfflineSessionAcrossARestartLandsWhole` | Works |
| Files in folders: add | Works: kept locally, uploaded later (`uploaded = false`) | `pushFiles` | Works |
| Open a downloaded file | Works: Quick Look on the local copy | `FileDetailView.load` | Works |
| Open a file that isn't downloaded | **Misleading**: a spinner until the request failed, then "It's on its way from the device that added it" | `FileDetailView.load` | Says "Not downloaded yet … It downloads when you're back online" at once, and opens by itself when the network is back; rows show a download mark; folders can be set to Keep Files Downloaded |
| Sub-notes | Works: `parent_id` on the note | `aLongOfflineSessionAcrossARestartLandsWhole` | Works |
| Search | Works: local | `NoteListView` filters SwiftData | Works |
| Note apps | Run: bundled libraries are local, npm libraries are cached after the first download (`NotePageLibraries.npm`), app data is local and merges on sync. An app whose library was never downloaded, or that calls the network itself, can't do that part | `NotePageLibraries`, `NotePageDataStore` | Same |
| Reconnect: everything goes up, nothing lost or doubled | Works for the normal path. **Doubled conflicted copy** when the connection dropped during the "yours is newer" conflict write | `aConnectionDroppingMidConflictMakesOneCopy` fails on the old code (2 copies, 3 server rows) | One copy: its id comes from the note and the server version |
| New note whose first push landed but the answer was lost | Works: upsert with `ignoreDuplicates`, then update | `aNewNoteWhoseAnswerWasLostIsNotDoubled` | Works |
| Same note edited on two devices while offline | Works: different lines merge (`TextDiff.merge`); overlapping edits keep the older one as a conflicted copy | `editsOnBothDevicesWhileOfflineComeTogether`, `theirNewerEditKeepsYoursAsACopy` | Works |
| Edits made on another device while this one was offline | Works: the cursor pull brings them | `editsOnBothDevicesWhileOfflineComeTogether` | Works, and now right when the network returns instead of at the next poll |
| Long offline: queue size | No queue to overflow: dirty flags in SwiftData are the queue. 200 notes plus folders went up in about 0.2 s, one request each | PERF line in `aLongOfflineSessionAcrossARestartLandsWhole` | Same |
| App restarted while offline | Edits survive (SwiftData). The merge base for two-sided edits is in memory, so after a restart a two-sided edit becomes a conflicted copy instead of a merge (nothing lost) | `synced` in `SyncEngine` | Same (see below) |
| Retry loops | Not hot, but steady: realtime-down poll every 8 s (30 s when quiet), a pull every minute, the key check every 10 s, connection asks every 10 s; each failed read retried 3 times by the Supabase client (1 + 2 + 4 s). About 900 failed requests an hour in front | `realtimeDownPollsAndBacksOff`, code | No requests at all with no network (`noPollingWhileTheNetworkIsDownAndSyncAtOnceWhenBack`: 0 in 0.8 s polling every 0.1 s); typing offline sends nothing; on a network that lets nothing through the key check backs off 10, 20, 40, 60 s |
| Offline indicator | **None.** Only Settings showed "Offline" in orange | `SyncStatusLabel` | A muted line: Mac sidebar above the account; iPhone a small capsule over the folder and note lists. "Offline", "Offline · changes sync later", or "Can't reach Amber Notes" when there's a network but no answer |
| Alerts or endless spinners | No sync alerts. Connections list showed a red error; storage showed "Counting…" forever; a file showed a spinner until the request failed | code | Plain grey words instead |
| Connect an AI | Opened the guide, failed inside | `ConnectAISection` | Disabled offline with "You're offline. Connect to the internet to connect an AI." |
| Share Link | Asked for confirmation, then "Couldn't reach Amber Notes" | `ShareLinkStore` | Says at once: "You're offline. Connect to the internet to share this note." |
| Add a device | The sheet said it couldn't reach the server | `AddDeviceSheet` | Button disabled offline; Settings says why |
| Delete account | Failed after confirming | `DeleteAccountButton` | Disabled offline, with the reason under it |
| Storage meter | "Counting…" forever when launched offline | `StorageSectionBody` | "Counted when you're online." |
| Version history, notes password | Already said "You're offline…" | `HistoryError.offline`, `LockError.offline` | Same |
| Profile name and photo | Saved here, sent later | `ProfileStore` | Same |

## What changed

- `Backend.keepsSession(afterRefreshError:)`: only an answer from the auth server (a 4xx, or the
  SDK removing the session) signs out. Network errors, timeouts and a captive portal's HTML page
  keep the session.
- `AccountCrypto.quickCheck` (1 s): with the key in the Keychain, startup opens the notes after at
  most this long and checks the key once the server answers (as e2ee-design.md says: "Offline with
  a key: carry on and verify once the server answers").
- `SyncEngine.conflictCopyID(of:server:)`: one conflicted copy per note and server version.
- `NetworkPath` (NWPathMonitor): with no network nothing polls and a sync doesn't send anything;
  when it's back the engine syncs, the key is checked (`AccountCrypto.networkReturned`) and AI
  connection asks are looked at, at once.
- `SyncEngine.reach` (online, offline, unreachable) drives `OfflineLine` and the
  `networkReach` environment value that network-only controls read.
- Keep Files Downloaded (a folder's menu): its files are fetched after each sync. Per device
  (`files.keepDownloaded` in UserDefaults).

## What's left

- The merge base for two-sided edits isn't kept across a restart, so after one the result is a
  conflicted copy rather than a merge. Keeping it means storing the last synced text of dirty notes.
- A note app that loads a library it never downloaded can't run that part offline; the app could
  say so in the page.
- Folder renames on two devices while offline: the later one wins, silently.
