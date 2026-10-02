# End-to-end encryption: the design as built

Status: built on `feature/e2ee`, not deployed. The migration (`supabase/migrations/20261001090000_e2ee.sql`) and the function deploys wait for the security review. This replaces the earlier design draft (password-wrapped key, device approval protocol, web approval page). Emil's final decisions override it where they differ, and they're what's below.

The requirement: we can't read anyone's notes. Everything a person writes is encrypted on their devices with a key only their devices hold. The AI connection keeps working.

## The short version

- Every account has one random 256-bit data key (DK). It seals note bodies, titles and previews, folder names, file names and file bytes, and every earlier version.
- DK lives in the Keychain as a synchronizable item, so iCloud Keychain (end-to-end encrypted by Apple) brings it to the person's other iPhone and Mac. The server has no key material.
- A device that iCloud Keychain doesn't reach gets the key from one that has it: Add a device. The new device shows a code, the other scans or types it, and the key goes over sealed to the new device (see Add a device below).
- A recovery key always exists and is optional. Any unlocked device can show it (Settings › Privacy & Security, behind Face ID or Touch ID). Nothing asks anyone to save it.
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
| Add-device secrets | QR text `amber-notes add-device v1 <22 base64url>` (16 bytes, not a link); typed code 12 Crockford characters (60 bits), stretched with PBKDF2-HMAC-SHA256, 600 000 rounds, salt `amber-notes/add-device\|<user id>`. Each gives `answer` (hex HKDF, info `add-device answer <user id>`; the server holds SHA-256 of its bytes) and `bind` (info `add-device bind <user id>`, never sent) |
| Add-device tag and name | tag: hex HMAC-SHA256(bind, `amber-notes add-device\|<request id>\|<platform>\|` ‖ public key). Name: `amb2n.<base64 nonce ‖ ciphertext ‖ tag>`, key HKDF(bind, info `add-device name`), AAD `amb2n\|<request id>\|<platform>` |
| Device key handoff | `amb2d.<base64 approving device's ephemeral P-256 public key (65) ‖ nonce ‖ ciphertext ‖ tag>`, key HKDF-SHA256(ECDH secret ‖ bind, salt `amber-notes/e2ee`, info `add-device <request id>`), AAD `amb2d\|<request id>\|<user id>`, plaintext the stored key (53 bytes) |
| Device list | name: a box with context `device:<device id>`; epoch: 16 random bytes (hex) the device makes when it comes to hold the key; tag hex HMAC-SHA256(HKDF(DK, info `devices`), `device\|<user id>\|<device id>\|<platform>\|<how>\|<1 or 0>\|<epoch>`); removal tag the same key over `remove\|<user id>\|<device id>\|<epoch>` |

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
| `device_adds` | which account and device (a random id) asked, the device kind, its public key, when | the device's name (under the pairing secret); the key sealed to the new device, until it's picked up |
| `key_devices` | which devices (random ids) hold the key, their kind, how they got it, whether it's an iCloud Keychain item, dates | the device's name |
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
3. The server has a key this device doesn't: "Open your notes on this Mac" shows at once, with a QR code and a typed code for a device that has the key (Add a device, below), while the Keychain is polled every 2 seconds behind it. Two small links sit under the code: "Use a recovery key instead", and "No device left?", which lists what can still open the notes (iCloud Keychain, a recovery key if one was saved) and ends in Start fresh. Waiting for iCloud Keychain shows a spinner for about 20 seconds, then the iCloud Keychain help ("Settings › [your name] › iCloud › Passwords and Keychain"). Polling continues. No key is made here. Unlocking with the recovery key counts as the key being saved (`mark_recovery_key_saved`; offline, the device remembers and tells the server on its next check). Startup's first read of the server gives up after 12 seconds and offers Try again.
4. The Keychain has a key that doesn't match: it's never used; the same screen shows, and polling continues in case iCloud Keychain brings the right one.
5. "None of these work": plain copy about what happens, then Start fresh with a typed confirmation. `start_fresh(key_id)` deletes the account's notes, folders, files, shares, AI connections and key (only if that key is still the account's), the app removes the account's Storage objects, and startup goes to step 2.

Offline with a key: carry on and verify once the server answers. Offline without one: retry. The server's key changing while running (Start fresh on another device) drops the key and runs startup again. Sign out keeps DK; Delete account removes it from the Keychain (and so from iCloud Keychain).

A key from Add a device is in its own slot (service `dev.emilwagman.pane.data-key.local`, `ThisDeviceOnly`); startup uses it wherever the synced item is missing or isn't the account's.

Keychain: service `dev.emilwagman.pane.data-key`, account = user id, value = version ‖ DK ‖ recovery key bytes, `kSecAttrSynchronizable`, `kSecAttrAccessibleAfterFirstUnlock`, `kSecUseDataProtectionKeychain`. No access group in queries: the default is the first of `keychain-access-groups` = `$(AppIdentifierPrefix)dev.emilwagman.pane`, the same for the iPhone app and the Mac App Store and team-signed Mac builds. Device-only items use the `ThisDeviceOnly` classes. Builds without the data protection keychain (ad-hoc dev builds, the Developer ID download, which has no provisioning profile) keep the key on that device only and get it from another device (Add a device) or the recovery key.

## Add a device

The threat model is `docs/Evidence/add-device-threat-model.md`. In short:

1. The new device makes a P-256 key pair, a scan secret (the QR code) and a typed code, files `device_add_request`, and shows both. A code lives 5 minutes and is replaced by itself a few times, then on request.
2. A device with the key opens Settings › Add a device: the camera inside the app on iPhone, the typed code on a Mac. It finds the request (`device_add_find`, this account's only), checks the new device's public key against the tag, and asks "Add this Mac?" with the device's name. Add needs Face ID, Touch ID or the passcode.
3. It seals the stored key to the new device (`amb2d`) and answers once (`device_add_answer`). Every device gets the notice "A device was added to your account".
4. The new device picks the sealed key up (`device_add_pickup`, then `device_add_done`, which deletes the server's copy), opens it, checks it against the account's key id, verifier and recovery wrap (`AccountCrypto.adopt`), and keeps it in a `ThisDeviceOnly` Keychain item (`KeySlot.local`). It never becomes an iCloud Keychain item, so removing the device removes exactly that copy.

Settings › Privacy & Security shows "Where your key is kept": this device, iCloud Keychain (worded conditionally: it brings the key to other devices if it's on for the Apple Account), and the other devices that hold the key (`key_devices`; a row counts only when its tag, made with the key, verifies), each with how and when it got the key and when it was last seen. One line on top has three states (`KeySafety`):

- **Safe if you lose this iPhone**: another device that holds the key was seen in the last 30 days, or a recovery key was saved.
- **Can't confirm a backup of your key**: the key is only stored as an iCloud Keychain item. That's a backup if iCloud Keychain is on, which the app can't check; it says so, and where to look.
- **Only this Mac can open your notes**: the key lives on this device alone and nothing else is known.

A device whose key lives on it alone can be removed. The next time it's online it pushes what hasn't synced if it can, deletes the key, erases its copy of the notes and signs out, in an order a kill midway can't undo (`DeviceRemoval`).

Which device a device is (its id in these tables, and its epoch per account) is kept in a `ThisDeviceOnly` Keychain item (`DeviceIdentity`), so a phone set up by transfer from an old one is a device of its own.

### When this ships

The privacy policy doesn't mention any of this yet, on purpose: the site deploys from `docs/privacy-policy.md`, and every sentence there must be true on the day. In the release that ships Add a device, add to the policy (and bump its date):

- Under "Your encryption key, locked": "When you add a device, one of your devices that has the key sends it to the new one, locked so that only the new device can open it. We hold that locked copy until the new device picks it up, and for an hour at most. The request holds the new device's kind (iPhone or Mac) and a public key; its name is encrypted. On iPhone the camera reads the new device's code on the device itself, and no picture is stored or sent." and "Each device that holds your key lists itself, so Settings can show where your key is kept: its kind, when it was added and last seen, how it got the key and whether it keeps it in iCloud Keychain. Its name is encrypted."
- Under retention: "Adding a device: a request expires after 5 minutes and is deleted within the hour, with the locked key if nobody picked it up. A device leaves the list of devices that hold your key when you remove it, or after 12 months without being seen."
- In "What's encrypted", after the iCloud Keychain sentence: "A device it doesn't reach gets the key from one of your devices that has it (Settings › Add a device), or from your recovery key if you saved one."

The iPhone review notes in App Store Connect need the line the Mac notes already have: tap "Use a recovery key instead" under the code.

## AI connections

Approval happens on one of the person's devices, or in the browser with the recovery key.

1. An AI starts OAuth from any browser. `/authorize` sends it to `ambernotes.app/connect?request=<id>`. The page says where access would go and what the client calls itself (`/connect/label`), and asks you to sign in, with Open Amber Notes (the universal link `https://ambernotes.app/open/connect?request=<id>`) as a shortcut when the app is on this computer.
2. The page signs in (Sign in with Apple or email) only to say whose request it is. It makes a P-256 key pair in memory, sends the public half with `/connect/ask` (at most 10 asks per account per 10 minutes), and ends the session. The answer also says where the account has the app, as two yes-or-no values (`devices: {iphone, mac}`: an iPhone seen in the last 30 days that gets the push, a Mac seen in the last 30 days), so the page names one device: "Open Amber Notes on your iPhone", or "Open Amber Notes on this Mac" with a button when the browser is on a Mac. With neither, it goes straight to step 7. "Send it again" on that page is `/connect/resend {id, pickup}`: no session, the page's pickup secret, the same push under the same collapse id, three times in ten minutes from one address.
3. `connect_asks` reaches every signed-in device of the account through realtime while the app runs, and a push (APNs, token auth with a .p8 key in the `APNS_KEY_P8`, `APNS_KEY_ID` and `APNS_TEAM_ID` function secrets) wakes the ones that don't: fixed words ("An AI connection request" / "Open Amber Notes to see it.") and the request id, nothing else. Tokens are in `device_tokens`: written only through `register_device_token` (rate-limited, at most 10 per account), removed on sign-out (or on the next launch through `forget_device_token` if that was offline), with the account, and when Apple says they're gone; only tokens seen in the last 90 days get pushes. Development builds use the sandbox, TestFlight and App Store builds production. The push only says to look: the device fetches the ask and checks it itself. In front, the app also looks every 10 seconds, and every 2 seconds while a Connect ChatGPT or Claude guide is open (realtime can miss a row), and the consent sheet shows over whatever sheet is on top (Settings, the guide), not behind it. The app asks to notify when a guide opens, so the push can show once the app is away. Without the APNs secrets the function logs `push_off` for each ask.
4. The device shows "Allow <client> to use your notes?" with the scope and when and where it started. It says the AI can read everything while connected, except locked notes. Allow needs Face ID, Touch ID or the passcode; a device without one can't allow.
5. The device makes the authorization code and sends `/connect/decide {id, allow, write, redirect_uri, code_hash, code_wrap, handoff}`. `redirect_uri` is exactly the one it displayed, and the server requires a match. `handoff` is the code sealed to the page's key: `amb2h`, ECDH P-256 plus HKDF plus AES-GCM, pinned by the vectors. The server stores only the hash, the wrap and the sealed code, never the code itself. One answer per request; requests expire after 10 minutes.
6. The page polls `/connect/status`, opens the code with its private key (handed over once), adds it to the redirect and goes on.
7. "Use your recovery key" (the link reads "No device nearby? Use your recovery key" when the server didn't say which devices the account has): the page signs in, reads `account_keys`, and in the browser parses the recovery key, unwraps DK, checks the verifier, makes the code and its wrap, and sends the same `/connect/decide`. The recovery key and DK never leave the page and aren't stored anywhere; their bytes are zeroed after use. The page says it runs our code in your browser and that approving from a device is better. App reviewers approve this way with the demo account's recovery key.
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
- If every device is gone, no iCloud Keychain item holds the key and no recovery key was saved, the notes can't be opened by anyone. There is no server-held key and no key rotation: a removed device that never comes online again keeps what it has.
- Sizes, dates, folder structure, sub-note structure, pins and which notes are locked stay readable.
- Search over very large libraries can be partial when the scan budget runs out.
- The profile name and photo and the notes-password hint are still plaintext.
