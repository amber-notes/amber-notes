# End-to-end encryption: the design as built

Status: built on `feature/e2ee`, not deployed. The migration (`supabase/migrations/20261001090000_e2ee.sql`) and the function deploys wait for the security review. This replaces the earlier design draft (password-wrapped key, device approval protocol, web approval page). Emil's final decisions override it where they differ, and they're what's below.

The requirement: we can't read anyone's notes. Everything a person writes is encrypted on their devices with a key only their devices hold. The AI connection keeps working.

## The short version

- Every account has one random 256-bit data key (DK). It seals note bodies, titles and previews, folder names, file names and file bytes, and every earlier version.
- DK lives in the Keychain as a synchronizable item, so iCloud Keychain (end-to-end encrypted by Apple) brings it to the person's other iPhone and Mac. The server has no key material.
- A recovery key always exists. Any unlocked device can show it (Settings › Privacy & Security, behind Face ID or Touch ID). It's the fallback between devices; there's no pairing protocol.
- Passwords and Sign in with Apple only sign you in. They have nothing to do with the key, and a password reset is the normal email reset.
- An AI connection gets DK wrapped under a secret derived from its own token, which only the AI holds. During an AI request the server unwraps it, decrypts what the request needs in memory, and drops it. Disconnecting deletes the wrap.
- A shared page shows a readable copy the device publishes, kept only while the note is shared.
- No backward compatibility and no migration: there were no users. The migration wipes the dummy notes and drops the plaintext columns. Builds from before it can't sync.

## Formats

One module per side, pinned to each other by `supabase/functions/_shared/e2ee-vectors.json`: `supabase/functions/_shared/e2ee.ts` (server, scripts) and `Pane/Model/E2EE.swift` (apps). `PaneTests/E2EETests.swift` and `supabase/functions/_shared/e2ee.test.ts` both check every vector.

| What | Format |
|---|---|
| Box | The locked-note box (`NoteCrypto`): `amb2.<key id>.<base64 nonce(12) ‖ ciphertext ‖ tag(16)>`, AES-256-GCM, AAD `amb2.<key id>\|<context>` |
| Key id | First 16 hex digits of SHA-256(DK) |
| Contexts | `body:<note id>`, `head:<note id>`, `folder:<id>`, `file-meta:<id>`, `file:<id>`, `wrap:<purpose>:<user id>` (ids lowercase) |
| Head | JSON `{"title","preview"}`; a locked note's head is `{"title"}` only |
| File metadata | JSON `{"name","type","size"}` |
| File bytes | `AMB2F ‖ key id (16 ASCII) ‖ nonce ‖ ciphertext ‖ tag`, context `file:<id>` |
| Verifier | hex HMAC-SHA256 under HKDF-SHA256(DK, salt `amber-notes/e2ee`, info `verifier`) of `amber-notes verifier\|<user id>` |
| Recovery key | 16 random bytes. Text: 28 Crockford base32 characters in seven groups of four, the 128 bits then a 12-bit check (first bits of SHA-256 of the key). Read back uppercase, separators stripped, O as 0, I and L as 1; a typo fails the check before the server is asked |
| Recovery wrap | DK sealed under HKDF-SHA256(recovery key bytes, salt `amber-notes/e2ee`, info `recovery <user id>`), context `wrap:recovery:<user id>` |
| Token wraps | DK sealed under HKDF-SHA256(the code or token as UTF-8, salt `amber-notes/e2ee`, info `wrap <purpose>`), purposes `code`, `access`, `refresh`, `pane` |
| Code handoff | `amb2h.<base64 device ephemeral P-256 public key (65) ‖ nonce ‖ ciphertext ‖ tag>`, key HKDF-SHA256(ECDH secret, salt `amber-notes/e2ee`, info `handoff <request id>`), AAD `amb2h\|<request id>` |

Unchanged text keeps its box: the apps cache the last box per context by a hash of the plaintext, and the MCP server doesn't write text it didn't change. The database treats a new box as a change (a new version, an AI edit count), so this matters.

## What the server holds

| Table | Readable | Sealed |
|---|---|---|
| `notes` | ids, folder, parent, pinned, dates, version, which device or AI wrote it, size | `body_ct` (null for a locked note, which keeps `locked_body` under the notes password), `head_ct` |
| `note_revisions` | the same metadata | `body_ct`, `head_ct` (copied by the database, never read) |
| `folders` | parent, order, dates | `name_ct` |
| `attachments` | size of the sealed object, dates; path `<user id>/<attachment id>` | `meta_ct`; the object in Storage |
| `account_keys` | `key_id`, `verifier`, `recovery_saved_at` | `recovery_wrap` |
| `mcp_tokens`, `oauth_tokens`, `oauth_requests` | token hashes, names, scopes | `dk_wrap`, `code_wrap` |
| `connect_asks` | which account asked, when, the browser's description and public key | the code sealed to the browser, until it's picked up |
| `note_shares`, `note_share_pages`, `note_share_files` | the published copy of a shared note, its included sub-notes and embedded files, while shared | |

Still readable and not covered by this work: the profile name and photo (shown on shared pages), and the notes-password hint.

Guards in the database:
- The plaintext columns are gone, so nothing readable can be written.
- `pane_sealed_guard`: every sealed write must carry the account's key id, and nothing can be written before the account has a key. A device holding a stale key (after Start fresh elsewhere) is refused.
- `account_keys` is written only by definer functions, and its key, verifier and wrap can't change (no rotation in v1).

## Device startup

`KeyStartup.decide` (pure) and `AccountCrypto` (carries it out) in `Pane/Model/E2EE.swift`, tested in `PaneTests/KeyStartupTests.swift` with a fake Keychain and a fake server.

1. DK in the Keychain matches the server's key id and verifier: ready.
2. The server has no key: make one (DK, recovery key, verifier, wrap) and call `create_account_key`, an insert-if-absent. This is the only place a key is made. The new key stays in a device-only Keychain slot until the server has taken it, so a device that loses the race never overwrites the synced key, and one that crashes mid-way still has the key the server took.
3. The server has a key this device doesn't: the recovery key screen shows at once ("Your key isn't on this device yet. If iCloud Keychain brings it, your notes open by themselves."), with the hint "Find it on your other device in Amber Notes › Settings › Privacy & Security", while the Keychain is polled every 2 seconds behind it. "Wait for iCloud Keychain instead" shows a spinner for about 20 seconds (none on a device whose Keychain doesn't sync), then the iCloud Keychain help ("Settings › [your name] › iCloud › Passwords and Keychain"); Use recovery key stays on that screen. Polling continues. No key is made here. Unlocking with the recovery key counts as the key being saved (`mark_recovery_key_saved`; offline, the device remembers and tells the server on its next check). Startup's first read of the server gives up after 12 seconds and offers Try again.
4. The Keychain has a key that doesn't match: it's never used; the recovery screen shows, and polling continues in case iCloud Keychain brings the right one.
5. "I don't have my key": plain copy about what happens, then Start fresh with a typed confirmation. `start_fresh(key_id)` deletes the account's notes, folders, files, shares, AI connections and key (only if that key is still the account's), the app removes the account's Storage objects, and startup goes to step 2.

Offline with a key: carry on and verify once the server answers. Offline without one: retry. The server's key changing while running (Start fresh on another device) drops the key and runs startup again. Sign out keeps DK; Delete account removes it from the Keychain (and so from iCloud Keychain).

Keychain: service `dev.emilwagman.pane.data-key`, account = user id, value = version ‖ DK ‖ recovery key bytes, `kSecAttrSynchronizable`, `kSecAttrAccessibleAfterFirstUnlock`, `kSecUseDataProtectionKeychain`. No access group in queries: the default is the first of `keychain-access-groups` = `$(AppIdentifierPrefix)dev.emilwagman.pane`, the same for the iPhone app and the Mac App Store and team-signed Mac builds. Device-only items use the `ThisDeviceOnly` classes. Builds without the data protection keychain (ad-hoc dev builds, the Developer ID download, which has no provisioning profile) keep the key on that device only and get it from the recovery key.

## AI connections

Approval happens on one of the person's devices, or in the browser with the recovery key.

1. An AI starts OAuth from any browser. `/authorize` sends it to `ambernotes.app/connect?request=<id>`. The page names the client (`/connect/label`) and says "Check your iPhone or Mac to approve", with Open Amber Notes (the universal link `https://ambernotes.app/open/connect?request=<id>`) as a shortcut when the app is on this computer.
2. The page signs in (Sign in with Apple or email) only to say whose request it is. It makes a P-256 key pair in memory, sends the public half with `/connect/ask` (at most 10 asks per account per 10 minutes), and ends the session.
3. `connect_asks` reaches every signed-in device of the account through realtime while the app runs, and a push (APNs, token auth with a .p8 key in the `APNS_KEY_P8`, `APNS_KEY_ID` and `APNS_TEAM_ID` function secrets) wakes the ones that don't: fixed words ("An AI connection request" / "Open Amber Notes to see it.") and the request id, nothing else. Tokens are in `device_tokens`: written only through `register_device_token` (rate-limited, at most 10 per account), removed on sign-out (or on the next launch through `forget_device_token` if that was offline), with the account, and when Apple says they're gone; only tokens seen in the last 90 days get pushes. Development builds use the sandbox, TestFlight and App Store builds production. The push only says to look: the device fetches the ask and checks it itself. In front, the app also looks every 10 seconds, and every 2 seconds while a Connect ChatGPT or Claude guide is open (realtime can miss a row), and the consent sheet shows over whatever sheet is on top (Settings, the guide), not behind it. The app asks to notify when a guide opens, so the push can show once the app is away. Without the APNs secrets the function logs `push_off` for each ask.
4. The device shows "Allow <client> to use your notes?" with the scope and when and where it started. It says the AI can read everything while connected, except locked notes. Allow needs Face ID, Touch ID or the passcode; a device without one can't allow.
5. The device makes the authorization code and sends `/connect/decide {id, allow, write, redirect_uri, code_hash, code_wrap, handoff}`. `redirect_uri` is exactly the one it displayed, and the server requires a match. `handoff` is the code sealed to the page's key: `amb2h`, ECDH P-256 plus HKDF plus AES-GCM, pinned by the vectors. The server stores only the hash, the wrap and the sealed code, never the code itself. One answer per request; requests expire after 10 minutes.
6. The page polls `/connect/status`, opens the code with its private key (handed over once), adds it to the redirect and goes on.
7. "No device nearby? Use your recovery key": the page signs in, reads `account_keys`, and in the browser parses the recovery key, unwraps DK, checks the verifier, makes the code and its wrap, and sends the same `/connect/decide`. The recovery key and DK never leave the page and aren't stored anywhere; their bytes are zeroed after use. The page says it runs our code in your browser and that approving from a device is better. App reviewers approve this way with the demo account's recovery key.
8. `/token` unwraps DK with the code and wraps it under the new access and refresh tokens; refresh rotation moves the wrap and deletes the old one. Revoking a connection deletes its wraps (trigger on `mcp_tokens`).
9. Each MCP request unwraps DK once with the presented token into a `Vault` that lives for that request. A connection without a wrap that opens gets `401 invalid_token`, which makes the AI ask to connect again.

Claude Code and Codex use `pane_` tokens, now made on the device (`create_mcp_token(name, write, hash, wrap)`) and only ever sent in an Authorization header. A token in the address is refused.

The security review's requirements, and where they're met:

| Requirement | Where |
|---|---|
| The app sends the exact redirect_uri it displayed; the server requires a match | `oauth.ts` decide, `ConnectAI.swift` |
| No tokens or secrets in URL paths; refuse `pane_` URL tokens | `mcp/server.ts`; `get_file` returns content inline instead of a link |
| Log an allowlist of fields only | `_shared/log.ts`, used by every function log line in `mcp/` |
| Canary test | `mcp/canary.pglite.test.ts` |
| A locked note's head is its title only | apps and server; vectors `locked_head` |
| Full-scan tools: per-account CPU budget and concurrency 1 | `pane_scan_budget` (20 s, refilling 20 ms a second), an advisory lock per account, at most 1.5 s per call |
| Shared-page copies deleted under every slug on lock, trash, delete or move | trigger `pane_note_forget_copies`; file copies are rows, so they go in the same transaction |
| `AfterFirstUnlock` for synced items, `ThisDeviceOnly` for device-only ones | `KeychainAccountKeyStore` |

## Search and full scans

The server can't index ciphertext. Search, lookups by title, sorting by title, "which notes embed this file" and the sub-note counts decrypt in memory, newest first, under the scan budget. When the time runs out the result says how much was searched. The apps search their local library as before.

## Sharing

The device publishes `{title, body, pages, files}` with `share_note` or `publish_share` (2 seconds after a pushed change to a shared note or anything in its page tree), and uploads each embedded file up to 10 MB with `publish_share_file`. Only devices publish: a share counts only when its tag (an HMAC under a subkey of DK) verifies, the page tree comes from sealed links that match parent_id, and stopped links are remembered in a synced Keychain item. The AI server never writes a copy; an AI edit of a shared note reaches the page on the owner's device's next sync. `shared_note()` serves only copies; `share-files` streams file copies from `shared_file()`. Stop sharing, locking, trashing, deleting, moving a sub-note to another parent, three reports and a takedown all delete the affected copies.

## Data export

The server can't read notes, so export happens on the device: markdown per note in its folders, with the files, zipped.

## Operating it

Before deploying, in this order, after the security review:

1. Apply `20261001090000_e2ee.sql` to `rodegaeruhyybqilrnpn`.
2. `scripts/e2ee-wipe-storage.ts` (the files and shared buckets; `--dry-run` first).
3. Deploy the `mcp`, `share-files` and `account` functions, then the site.
4. `scripts/review-account.py seed` makes the App Review account's key and saves its recovery key to `.secrets/appreview.txt`; the reviewer needs it in the review notes, since their device will ask for it.
5. Ship app builds. Every AI connection has to be made again.

The privacy policy, the website and the App Store privacy answers still describe the old model and need updating the day the build ships.

## Known limits

- The server handles plaintext in memory during AI requests. A malicious server change could copy it. Locked notes stay out of reach (their key comes from the notes password).
- iCloud Keychain is one more holder of the key, by design.
- Sizes, dates, folder structure, sub-note structure, pins and which notes are locked stay readable.
- Search over very large libraries can be partial when the scan budget runs out.
- The profile name and photo and the notes-password hint are still plaintext.
