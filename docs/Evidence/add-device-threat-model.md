# Adding a device: threat model

Written 2026-10-02 for Add a device (branch `app/add-device`). It hands the account's whole key from a device that has it to one that doesn't. It reuses the shape of the QR connect flow for AI connections (`connect-qr-threat-model.md`) and is stricter everywhere, because an AI connection hands over a revocable copy and this hands over the key itself.

The requirement it serves: nobody but the person can read their notes, including us, and nobody has to write anything down. The key stays off our servers. A recovery key still works for people who saved one, but nothing depends on it.

## The flow

1. A device signs in and finds the account has a key it doesn't hold (iCloud Keychain is off, it's the Developer ID Mac build, or it's on another Apple Account). It shows "Open your notes on this Mac". It keeps checking the Keychain as before.
2. The new device makes, in memory only:
   - a P-256 key pair
   - a scan secret (16 random bytes) for the QR code
   - a typed code (60 random bits, 12 characters)
   - a pickup secret (32 bytes)
3. Each of the two pairing secrets gives two values (HKDF, salted with the account):
   - an **answer**, which the approving device later shows the server. The server stores only its SHA-256.
   - a **bind**, which is never sent anywhere.

   The typed code is stretched first (PBKDF2-HMAC-SHA256, 600 000 rounds), because it's short.
4. The new device files a request (`device_add_request`) with its public key, the two answer hashes, the pickup hash, and per secret a tag (HMAC under the bind over the request id, the device kind and the public key) and its own name sealed under the bind. It shows the QR code and the typed code.
5. On a device that has the key, the person opens Settings › Add a device. On iPhone the camera reads the QR code inside the app. On a Mac they type the code.
6. That device derives the answer and the bind, asks the server for the request the answer belongs to (`device_add_find`), and checks the tag against the public key the server returned. If the tag doesn't match, it stops: nothing is sealed.
7. It asks "Add this Mac?" with the device's name and a warning to only add a device in front of you. Add needs Face ID, Touch ID or the passcode. A device without a passcode can't add one.
8. It seals the key to the new device's public key (ECDH P-256, HKDF, AES-256-GCM), with the bind mixed into the sealing key, and stores it with the answer (`device_add_answer`).
9. The new device polls with its pickup secret (`device_add_pickup`), gets the sealed key, opens it, and uses it only if it's the account's key: its id and verifier match the server's row, and its recovery key opens the account's recovery wrap to the same key. Then it tells the server to drop the sealed copy (`device_add_done`). An answer lost on the way can be asked for again until then.
10. The new device keeps the key on itself only (a `ThisDeviceOnly` Keychain item), never as an iCloud Keychain item.

Formats: `supabase/functions/_shared/e2ee.ts` and `Pane/Model/AddDevice.swift`, pinned to each other by `e2ee-vectors.json` (`add_device`, `key_device`).

## What is stricter than connecting an AI

| | Connect an AI (scan) | Add a device |
|---|---|---|
| Who can answer | Any account that scans the code (it connects its own notes) | Only the same account. Every function works on rows of `auth.uid()`; another account's device finds nothing |
| What the code is | A link the system camera opens | Text that is not a link (`amber-notes add-device v1 <secret>`). Only the scanner inside the app reads it. The app's link handlers never see it |
| What the page proves to the server | The scan secret itself | A value derived from the secret. The secret and the bind never reach the server |
| What the sealed payload is bound to | The page's key | The new device's key and the bind, so it works in both directions (below) |
| Expiry | 10 minutes | 5 minutes |
| Wrong answers | Not counted | Five end the request |
| Rate limits | Per IP | Per account: 10 requests in 10 minutes, 20 lookups or answers in 10 minutes |
| What the receiver checks | Nothing (it gets a code) | The key against the account's verifier and recovery wrap, before using it |
| Afterwards | "Connected" notice on every device | "A device was added" notice on every device, and the device shows in Privacy & Security with Remove |

## What each property rests on

| Property | Rests on |
|---|---|
| The server never sees the key | It's sealed on the approving device to a key pair whose private half never leaves the new device's memory. The server stores ciphertext, and deletes it when the new device has the key (within the hour otherwise) |
| Only a device at the new device's screen can seal something it accepts | The bind is in the sealing key. The bind comes only from the QR code or the typed code |
| A public key swapped on the way gets nothing | The approving device checks the tag (needs the bind) before sealing. And the sealing key includes the bind, which the swapper doesn't have |
| Same account only | Server: every function filters on `auth.uid()`. Client: the answer and the bind are salted with the account id, so another account derives different values |
| Single use | `answered_at` is set once under the row lock. The sealed key goes only to the pickup secret and is nulled when the new device confirms. A new code on the same device replaces its old request |
| Short expiry | `expires_at`, five minutes, checked in find and answer. An answer that landed in time can still be picked up |
| The new device doesn't adopt a wrong key | `AccountCrypto.adopt`: key id, verifier, and the recovery wrap must all agree |
| The person meant it | The in-app scanner or typing, the question with the device's name, and Face ID or Touch ID |

## Threats

**The server, or someone who can write its tables, swaps the new device's public key.** The tag was made with the bind, which the server never had, so the approving device sees a mismatch and says "Something changed this request on the way. Nothing was sent." Tests: `aPublicKeySwappedOnTheWayIsCaughtBeforeAnythingIsSealed`.

**The server answers a request itself with a key it made**, hoping the new device will encrypt new notes with it. It can seal to the public key but not with the bind, so the box doesn't open on the new device. And a key sealed by someone who did read the screen is used only if it matches the account's key id, verifier and recovery wrap. Tests: `theNewDeviceUsesOnlyTheAccountsOwnKeySealedBySomeoneWhoReadItsScreen`.

**The server guesses the typed code.** The code has 60 bits and each guess costs 600 000 PBKDF2 rounds. To swap the public key it would need the bind while the request is open (5 minutes): about 2^79 hash operations in that time. Guessing later is useless: what was sealed needs the new device's private key, which is gone. The QR secret has 128 bits.

**Someone who knows the account's password but has no device.** They can sign in on their own device, which then shows its own code. To get the key they need the person to scan or type that code on a device that has the key. Defences: the scanner is only inside the app (a link, a web page or the system camera can't start it), the question names the device kind and warns "Only add a device that is in front of you. Never use a code that someone sent you.", Face ID or Touch ID is required, and every device gets "A device was added to your account" afterwards with the way to remove it. This is the same residual risk as WhatsApp or Signal device linking: a person who is talked into scanning a stranger's code and confirming gives access. If this happens, removing the device stops its access to new changes only after it is online; what it already downloaded is gone to the attacker. Key rotation would close that and is out of scope here.

**Someone photographs or relays the code.** They'd need a device signed in to the same account that already has the key. Such a device can read the notes anyway.

**Another account scans the code.** Nothing is found: the lookup is by account, and the derived answer differs per account. Tests: "same account only" in `device_add.pglite.test.ts`, `aCodeIsReadOnlyFromItsOwnScreen`.

**Replay.** A request answers once. The sealed key is handed only to the pickup secret, and only until the new device confirms. A reloaded code replaces the old request. Tests: "single use" in `device_add.pglite.test.ts`.

**Brute force against the server.** Lookups and answers share a bucket of 20 per account per 10 minutes, requests 10 per 10 minutes, and five wrong answers end a request. Tests: "rate limits", "five wrong answers".

**The device list is tampered with.** `key_devices` rows count in the app only when their tag verifies (an HMAC under a subkey of the key), so a session without the key can't add a made-up device to make the list look safer. A session with the password alone can still delete rows, overwrite a pending removal, or put back a row that was once real. The effect is a wrong list until the devices check in again, never a lost or leaked key. Tests: `KeyDevicesTests`.

**A device is made to throw its key away.** A removal is obeyed only when its tag verifies for the device's current epoch. The epoch is 16 random bytes the device makes when it comes to hold the key, keeps on itself, and replaces after it obeys a removal. So a session without the key can't forge a removal, and a real removal's tag, read while it was pending and replayed after the device was added again, names the old epoch and is ignored. Tests: `anOldRemovalReplayedAfterTheDeviceWasAddedAgainTakesNothing`.

**Whoever holds the key can forge list and removal tags.** The tags are HMACs under a subkey of the data key, so they prove "made by someone with the key", nothing more. That includes any device of the account, and the `mcp` function while it serves an AI request (it unwraps the key in memory; already a documented limit in the design). A server changed to misuse that moment could write a valid removal for a device, or a valid row for a device that doesn't exist. It could already read the notes at that moment, so this adds the ability to make a device-only key be thrown away. A recovery key, a second device or iCloud Keychain is the defence, and Privacy & Security says when none of them is known to exist.

**Removing a device.** Remove marks the device; the next time it's online it carries the removal out in this order (`DeviceRemoval`):

1. If it has edits that haven't synced and the server answers within 10 seconds, it pushes them. If the server can't be reached, the removal goes ahead and those edits are lost. The Remove dialog says so.
2. It writes down that it is being removed, then deletes its key.
3. It stops sync and erases its copy of the notes.
4. Its row leaves the list and its epoch changes.
5. It signs out, and says once that it was removed.

A kill between any two steps can't bring it back with its key: the key goes in step 2, and the next launch finishes from the note written there. Tests: `aRemovalDropsTheKeyBeforeAnythingElseAndAKillMidwayIsFinishedAtLaunch`, `aRemovedDevicePushesWhatHasntSyncedBeforeItErases`, `aRemovedDeviceThatCantReachTheServerErasesAnyway`.

Remove only works for a device whose key lives on that device alone (one added with this flow, or the Developer ID Mac, where every Keychain slot is on the Mac only and all of them go). A key in iCloud Keychain belongs to every device on that Apple Account at once, so those devices aren't offered Remove, and a removal aimed at one is ignored. A removed device that never comes online again, or that was modified, keeps what it has. Nothing short of rotating the key changes that, and the copy says so, in the Remove dialog and in the "A device was added" notice.

**Two devices remove each other.** A device re-reads the list right before it sends a removal. If it has itself been removed and hasn't acted on that yet, it refuses to send, and carries out its own removal instead. So of two devices that remove each other, the second one's removal is never sent and the first keeps the key. Tests: `twoDevicesRemovingEachOtherNeverLeaveNobodyWithTheKey`.

**A phone set up by transfer from an old one.** A device-to-device transfer copies the app's settings. If the device's id and epoch lived there, the new phone would list itself as the old one, and a removal meant for one would be valid on the other. They are kept in a Keychain item that stays on the device (`ThisDeviceOnly`, `DeviceIdentity`), which a transfer doesn't copy, so the new phone gets its own id and epoch. A handed-over key is `ThisDeviceOnly` too, so the new phone is added like any new device. Builds without the data protection keychain (ad-hoc and Developer ID Macs) keep the identity in the app's own file, which Migration Assistant does copy: two such Macs would share an id until one of them is removed. Tests: `aTransferredPhoneIsADeviceOfItsOwn`.

**Startup with two keys on the device.** A device can hold a stale iCloud Keychain item and the current key that was handed over. With the server's row there, the one that matches is used. Without it (offline, or the row lost), the key of the later reset generation is used, and a reset never deletes a handed-over key unless it is the one being kept aside. Tests: `startupFindsTheHandedOverKeyAndNeverPutsItInICloudKeychain`, `aResetNeverDeletesAHandedOverKeyThatIsntTheOneKeptAside`.

**Denial of service by a session with the password.** It can use up the account's rate limits for adding a device, so adding fails for a few minutes. It can't read, answer or pick up anyone's request without the code on the new device's screen.

**Device names.** The server never reads them: in a request the name is sealed under the pairing secret, and in the list it's sealed with the account's key. It sees the device kind (iPhone or Mac), a random id the device made for this purpose, and times.

## Honest limits

- If every device is gone, nothing holds the key in iCloud Keychain, and no recovery key was saved, the notes can't be opened by anyone. The "No device left?" screen says it where it applies.
- The app can't tell whether iCloud Keychain is switched on, only whether it stored the key as an iCloud Keychain item. So Privacy & Security has three states. "Safe if you lose this iPhone" needs evidence: another device that holds the key and was seen in the last 30 days, or a saved recovery key. With only a Keychain item it says "Can't confirm a backup of your key", that the key is backed up if iCloud Keychain is on for this Apple Account, that Amber Notes can't check, and where to look. With a device-only key and nothing else it warns that this device is the only way in. The recovery key reads "Optional" only in the safe state.
- "Last seen" is the server's time of a device's last check-in, which the tag doesn't cover. A session with the password can refresh it for a row it replays. The effect is a list that looks safer than it is, never a lost or leaked key.
- AI connections keep working after every device is lost, until the account starts fresh. The "No device left?" screen says so.
- Passkeys, a server-held key and key rotation are out of scope.

## Tests

- Formats, both sides against the shared vectors: `supabase/functions/_shared/e2ee.test.ts`, `PaneTests/AddDeviceTests.swift` (`AddDeviceVectorTests`).
- Server (PGlite, whole schema): `supabase/functions/mcp/device_add.pglite.test.ts`: same account, single use, expiry, wrong answers, rate limits, the device list.
- App: `AddDeviceFlowTests` (two devices end to end over a fake server), `KeyDevicesTests`, `KeyStartupTests`.
- Screens: `PaneTests/HIG/AddDeviceSnapshots.swift`, iPhone and Mac, light and dark, largest text size.
