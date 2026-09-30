# End-to-end encryption: design

Status: design for review. Nothing here is built. No code, migration or deploy comes with this document.

The requirement, from Amber Notes users: the operator must not be able to see any of their data. Everything is encrypted with keys only the user's devices hold. The AI connection keeps working, from the Mac and iPhone apps, from ChatGPT and Claude on the web and on phones, and from Claude Code, Codex and Incredible, through the remote MCP server at https://mcp.ambernotes.app.

The short version of the design:

- Every account has one random data key. Only the user's devices hold it. The database, backups, logs and the operator see ciphertext.
- Approving an AI connection gives that connection its own copy of the data key, wrapped under a key derived from the connection's tokens. The server stores token hashes and the wrapped copy, never the token. On each MCP request the server unwraps the key with the presented token, decrypts what the request needs in memory, and drops it. Revoking the connection deletes its wrapped copy.
- During an AI request the server handles plaintext in memory. We say so publicly.
- A shared note page is the one place we store plaintext, per note, because the user chose to publish it.
- Locked notes stay a stronger tier. Their text is sealed with the notes password key, which no AI connection ever gets.

Sections 1 to 12 follow the brief. Section 13 lists every place in the current code that changes. Section 14 lists the decisions Emil has to make.

## Contents

1. Threat model
2. Keys
3. What gets encrypted, field by field
4. Sync with ciphertext
5. Search
6. The MCP path in detail
7. Sharing
8. Import, account deletion, usage counts, quota, reports
9. Migrating existing data
10. Crypto choices and formats
11. User-facing copy (drafts)
12. Build plan, tests and rollout
13. Every place in the current code that changes
14. Open decisions

---

## 1. Threat model

### Who we protect against

**An operator reading the database.** Emil, a future employee, a Supabase support engineer, or anyone compelled by a court order to hand over the database. They see ciphertext, key wraps, token hashes and the metadata listed in section 3. They cannot decrypt anything. No key that opens user data is stored anywhere on our side in a form the operator can use.

**An operator who can write the database.** This is stronger than reading, and we defend against it where it's cheap. Ciphertext is bound to its account, item and field through the AAD, so the operator can't move one note's box into another note or another account. Enrolling a new device or approving an AI from the web uses a short authentication code that both screens show, with a commitment so the server can't grind a matching key. The operator can still roll a note back to an older version of itself. That's the same thing "Restore this version" does, and we accept it. The operator can also delete data. Encryption doesn't prevent deletion.

**A leaked backup.** Backups hold the same ciphertext as the live database. Plaintext from before the migration stays in the hosting provider's backups until they roll off. Section 9 covers that.

**A database or RLS bug.** If a policy bug lets account A read account B's rows, A gets B's ciphertext and nothing more. B's data key never sits on the server.

**A compromised AI token.** This is the weak spot, so it gets the most detail.

- An access token or refresh token, used through our server, can do what the connection can do: read every note that isn't locked, and edit if the connection has Read and Edit. This is the same as today.
- The token is also the only missing piece for unwrapping that connection's copy of the data key. Someone with a token and a copy of the database can recover the data key offline and read every note, including later ones, until the key is rotated. Neither piece alone does anything.
- Locked notes are safe either way. Their key comes from the notes password and never reaches the server.
- Access tokens live one hour. Refresh tokens live 90 days and rotate on every use. Reusing an old refresh token revokes the whole connection, which already happens in `supabase/functions/mcp/oauth.ts`. Old `pane_` tokens for Claude Code and Codex don't expire, so a leaked `pane_` token is worth more. Section 6 suggests moving those clients to OAuth.
- Revoking the connection deletes every wrapped copy for it. After that, the token opens nothing, even with a database copy made later. A database copy made before the revoke still pairs with the token, which is why rotation exists (section 2).

**A stolen device.** The data key sits in the device Keychain. iOS and macOS protect it with the device passcode and Data Protection. If the thief can unlock the device, they can read the notes, same as today. The user removes the device in Settings on another device, signs out its sessions, and can rotate the data key if they believe the key was taken.

### What we don't protect against

**A malicious change to the server code.** The MCP server decrypts notes in memory to answer AI requests. A code change that logs requests, or copies the data key when a token arrives, would see everything that passes through it. The same is true for a malicious change to the web approval page, which handles the data key in the browser when someone approves with a recovery key. We state this plainly on the website and in the privacy policy.

What reduces this risk:

- The code is open source already (the repository is public), so anyone can read what the server does.
- Reproducible deploys. Today the backend is deployed by hand (`supabase functions deploy`, see `docs/RELEASING.md`). Moving it to a GitHub Actions job that deploys only tagged commits, and publishes the commit hash of each deploy, makes a quiet change harder. A later step can publish a hash of the deployed function bundle next to it.
- A transparency log of deploys: a public page listing every deploy with its commit and time, so a quiet change would be visible.
- Keeping the plaintext window small: nothing is cached between requests, and a test asserts that no function logs note text (section 12).
- Users who want AI to never see a note can lock it.

**Our hosting providers during an AI request.** The MCP function runs on Supabase Edge Functions. Today mcp.ambernotes.app is a Vercel middleware rewrite in front of it (`web/middleware.ts`), so Vercel terminates TLS and the plaintext responses pass through Vercel's edge. Both providers could in principle see what an AI request carries while it's in flight. Decision 3 in section 14 is whether to take Vercel out of that path.

**Traffic analysis.** The server sees when you sync, how big your notes are, which notes an AI reads, and the metadata in section 3.

**The AI provider.** Whatever an AI reads, its provider receives. That's the point of connecting it, and the consent screen says so.

**A user who loses every device and their recovery key.** Their data is gone. Nobody can bring it back. Section 2 covers this.

---

## 2. Keys

### The key hierarchy

```
Data key (DK)                        256-bit random, one per account, generated on the first device
 ├─ collection subkeys               HKDF(DK, "amb3 key <type>"): one per kind of item
 │    ├─ nb  note bodies
 │    ├─ nh  note heads (title, preview, links)
 │    ├─ fo  folder names
 │    ├─ fm  file metadata (name, type, size, file key)
 │    ├─ pr  profile
 │    ├─ lh  notes-password hint
 │    ├─ sh  search index shards
 │    └─ vf  the data key verifier
 └─ file keys (FK)                   256-bit random, one per file, stored inside that file's metadata box

Wraps of DK (each a separate AES-GCM box around the 32 key bytes)
 ├─ recovery wrap                    under HKDF(recovery key)
 ├─ device wraps                     sealed to each device's P-256 public key
 ├─ iCloud Keychain item             the raw DK, synced by Apple (decision 2)
 ├─ authorization-code wrap          under HKDF(code), for up to 60 seconds
 ├─ access-token wraps               under HKDF(access token), one per token, 1 hour
 ├─ refresh-token wraps              under HKDF(refresh token), one per token, until used
 └─ pane_ token wraps                under HKDF(pane_ token), until revoked

Notes password key (existing, unchanged)
 └─ locked note text (amb2)          PBKDF2 of the notes password, never wrapped for anything
```

**Why one data key and not a key per note.** Per-note random keys would only help if we could hand an AI connection a subset of notes. We can't do that yet, because the connection reads the whole library. Derived per-type subkeys give domain separation. The AAD binds every box to its item. That covers what per-note keys would buy us, with one key to wrap. Per-folder keys are the natural future step if we ever offer "this AI can see only this folder", and the format leaves room for it: the key id in every box says which key opened it.

**Why files get their own keys.** Files are large and chunked, and a file key lets the MCP server hand out a ten-minute download link that opens one file and nothing else (section 6).

**The key id.** `kid = hex(SHA-256("amb3 kid" || DK))[0:16]`. It's in every box header and in `account_keys.key_id`. DK is 256 random bits, so the hash tells nobody anything.

### Where the data key lives

- **On Apple devices.** In the Keychain, `kSecClassGenericPassword`, service `app.ambernotes.datakey`, account `<user id>`, accessibility `kSecAttrAccessibleAfterFirstUnlock` so background sync and the share extension handoff keep working. If Emil chooses iCloud Keychain sync (decision 2), the item is `kSecAttrSynchronizable = true`, and a new Mac or iPhone on the same Apple ID has the key before it asks. iCloud Keychain is end-to-end encrypted by Apple for every account, with or without Advanced Data Protection.
- **Device identity.** Each install makes a P-256 key-agreement key in the Secure Enclave (`SecureEnclave.P256.KeyAgreement.PrivateKey`), falling back to a Keychain key on Macs without one. Its public key is in `device_keys`. That lets another device, or a key rotation, seal the data key to this device without the user doing anything.
- **In the web approval page.** Only in page memory, only while approving, and only when the user types the recovery key. It's imported as a non-extractable CryptoKey where WebCrypto allows it, and the page drops it after the decision is sent.
- **In the MCP function.** Only in memory, for one HTTP request, unwrapped with the token that came with it.

### The account password doesn't decrypt anything

Sign in with Apple users have no password. Email users have one, but it goes to Supabase Auth on every sign-in, so a malicious or compelled operator could capture it at the auth endpoint and derive any key made from it. That would quietly undo the whole design. A password reset by email would also either destroy the data or need a server-side escrow. So the account password only signs you in. The data key comes from your devices, iCloud Keychain, or the recovery key.

### A new device gets the key

In order of what the app tries:

1. **iCloud Keychain** (if decision 2 says yes). The app looks for the Keychain item with the account's `key_id` and checks it against `account_keys.verifier`. If it matches, it registers the device in `device_keys` and the user never sees a key screen.
2. **Approve from another device.** The new device shows "Approve this iPhone from your Mac". Every signed-in device with the key gets a sheet through realtime on `key_requests`, or on its next launch. Both screens show the same 6-digit code. The user checks the codes and taps Approve. The protocol is below.
3. **Recovery key.** The user types the 28-character recovery key. The app unwraps `account_keys.recovery_wrap`, checks the verifier, and stores the key.

Until one of these works, the app shows the sign-in-finished screen with those three options and no notes. It never shows an empty library, because an empty library looks like data loss.

#### Device approval protocol (commitment, then a short code)

A plain 6-digit code over two public keys isn't enough. An operator who can write `key_requests` could generate about a million key pairs until one gives the same code, then swap it in. Committing first stops that: the requester fixes its key before it sees the approver's.

```
Requester R (new device or web page)       server: key_requests row        Approver A (device with DK)

1. eR = new P-256 key, nR = 32 random bytes
   post commit = SHA-256("amb3 commit" || eR.pub || nR)  ──►  row {id, commit, label}
                                                         ──►  realtime to A: "New iPhone wants your key"
2.                                                        ◄──  A posts eA.pub (fresh P-256 key)
3. R reads eA.pub, posts eR.pub and nR               ──►
4.                                                        A checks SHA-256(... eR.pub || nR) == commit
   both compute code = first 20 bits of SHA-256("amb3 sas" || id || eR.pub || eA.pub || nR), shown as 6 digits
5. The user compares the codes and taps Approve on A.
   A: s = ECDH(eA, eR.pub); k = HKDF(s, salt = id, info = "amb3 handoff")
      posts answer = AES-GCM(k, DK or the redirect URL, AAD = "amb3|handoff|<user>|<id>|<kind>")
6. R opens the answer, checks DK against account_keys.verifier, stores it, registers device_keys.
```

A man in the middle has one chance in a million per attempt, and every attempt is a visible request the user can decline. Requests expire after 10 minutes. There are at most 5 open requests per account.

### Recovery key

- 140 bits from the system random source, shown as 28 characters in 7 groups of 4, from an alphabet without look-alikes (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`). The length matches Apple's Advanced Data Protection recovery key, which people have seen before.
- It's a random secret, not a password, so no slow KDF is needed. `KEK_rk = HKDF(recovery key bytes, salt = user id, info = "amb3 wrap rk")`. The server holds `recovery_wrap` and can't brute-force 140 bits.
- Shown once at setup, with Copy, Print and Save to a file. The user can make a new one in Settings → Encryption. That needs the data key and replaces the old wrap, so the old recovery key stops working.
- Decision 1 is whether it's required, optional, or skipped for device-only accounts.

### When everything is lost

No device holds the key, iCloud Keychain doesn't have it, and there's no recovery key. The notes can't be read by anyone, including us. The app offers **Start over with an empty library**: the RPC `reset_encryption()` deletes every encrypted row, file, version, share snapshot, AI connection and device for the account, and the device creates a new data key. The account, email and subscription stay. The app requires a fresh sign-in (session younger than 5 minutes) and typing "Delete my notes".

An AI connection that's still live can read the notes through the server, because it holds a token that unwraps its copy. That doesn't recover a key for the user, but asking that AI to export the notes is a real way out. Support can mention it. We don't build anything for it.

### Rotation

**Removing a device.** Settings → Encryption → Devices → Remove. This sets `device_keys.revoked_at` and deletes the device's wrap. That's enough when the device is gone for ordinary reasons. The device still has whatever it already synced.

**Changing the data key.** For when a device, the recovery key or a token plus database copy may have leaked. Settings → Encryption → Change encryption key:

1. The device makes DK′ and a new recovery key.
2. It re-encrypts every row and file in batches through `rekey_batch(items jsonb)`, which writes only rows whose `version` matches, like the push does today. While it runs, both key ids are valid, and readers pick the key by the `kid` in each box.
3. It seals DK′ to every current device in `device_keys`, writes the new `recovery_wrap` and verifier, and sets `account_keys.key_id = kid′`.
4. It revokes every AI connection. We can't re-wrap for connections because only the AI holds their tokens, and a rotation after a suspected leak must not chain the new key to the old one. The app then shows "Reconnect your AIs".
5. Old versions sealed with DK are re-encrypted too, or deleted if the user chooses faster.

Rotation is designed here but scheduled last in the build plan (phase 10). Every format carries a key id from day one, so adding it later changes no format.

---

## 3. What gets encrypted, field by field

"Ciphertext" means an `amb3` box (section 10) under the named subkey, with AAD binding account, type and item id.

### notes

| Column | Today | After | Notes |
|---|---|---|---|
| `id` | uuid | plaintext | Needed for sync, revisions and AAD. |
| `user_id` | uuid | plaintext | RLS. |
| `body` | markdown | **removed**. `body_ct` holds ciphertext (nb) | Padded (section 10). |
| (new) `head_ct` | | ciphertext (nh) | `{"v":1,"title","preview","subs":[ids],"files":[ids]}`, written by whoever writes the body. Lets lists and the MCP read titles without opening bodies. |
| `title` | generated from body | **dropped** | The title lives in `head_ct`. |
| `search` | tsvector of body | **dropped** | Search moves to devices and MCP memory (section 5). |
| `locked_body` | amb2 | unchanged | Password-sealed. A locked note's title is in `head_ct` and `body_ct` is null. |
| `folder_id`, `parent_id` | uuid | plaintext | The folder tree and sub-note tree. Needed for foreign keys, nesting checks, cascades on delete. They show structure, not words. They could move into `head_ct` later (decision 5). |
| `is_pinned` | bool | plaintext | One bit per note. Kept so conflict rules stay as they are. Could move later (decision 5). |
| `created_at`, `updated_at`, `trashed_at`, `deleted_at`, `server_updated_at`, `version` | | plaintext | Sync depends on them. |
| `body_source`, `body_client`, `body_at` | | plaintext | "app" or "mcp", a device kind ("iPhone", "Mac") or an AI connection's name, and when. The server sets them. It knows these facts anyway because the write goes through it. |
| `ai_editor`, `ai_edited_at` | | plaintext | Same reasoning. |

### note_revisions

Same pattern: `body_ct`, `head_ct`, `locked_body`, and plaintext `version`, `source`, `client`, `created_at`, author columns. The server trigger copies the previous row's ciphertext, so it never needs plaintext (section 4).

### folders

`name` is removed and replaced by `name_ct` (fo). `parent_id`, `sort_index` and the timestamps stay plaintext. `sort_index` is a float the app sets from the order you dragged. It reveals ordering and nothing else.

### attachments and the files bucket

| Column | After |
|---|---|
| `filename`, `content_type` | removed. `meta_ct` (fm) holds `{"v":1,"name","type","size","fk","chunk":65536}` |
| `size` | the size of the stored ciphertext object, which quotas need |
| `storage_path` | `<user id>/<attachment id>`. No filename. Today the filename is in the path (`SyncEngine.storagePath`) |
| storage object | chunked ciphertext (section 4) |

### profiles and avatars

`display_name` is removed and replaced by `profile_ct` (pr). The photo moves from the public `avatars` bucket to an encrypted object in `files` under `<user id>/profile/<random>`, with its key in `profile_ct`. A plaintext copy of the name and photo is made only when you share a note, and it's kept with that share (section 7).

### note_locks

`hint` is plaintext today, and a hint is often a clue to the password. It becomes `hint_ct` (lh). Salt, iteration count, key id, verifier and proof chain aren't secret and stay as they are.

### New tables

`account_keys`, `device_keys`, `key_requests`, `search_shards`, `mcp_file_links` hold wraps, public keys and ciphertext only (section 6 and 13).

### What stays readable, stated honestly

This is the list for the privacy policy.

- Your email address, sign-in method, and when you signed up and signed in. Sign-in can't work without them.
- How many notes, folders, files and versions you have, and roughly how big each is. Sizes are rounded up by padding.
- When each note, folder and file was created, changed, deleted or restored, and which device kind or AI connection made each change.
- Which folder each note is in and which folder is inside which, which note is a sub-note of which, which notes are pinned, and the folder order. Not their names.
- Which notes are locked.
- Your AI connections: the app's name, where it returns to, read-only or read and edit, when it was last used.
- Usage counts that exist today: AI edits per day, app installs by platform, days of use, tips shown.
- Shared pages, in full, while they're shared.
- Reports about shared pages.

---

## 4. Sync with ciphertext

The sync engine (`Pane/Sync/SyncEngine.swift`) stays as it is. Encryption happens at the edge where DTOs are built and read.

### Where encryption happens

- `NoteDTO.init(_ n: Note)` encrypts: `body_ct = seal(nb, note.id, pad(body))`, `head_ct = seal(nh, note.id, head(note))`. The local SwiftData store keeps plaintext, protected by the OS the same way it is today.
- Reading a row (`merge`, `take`, `resolveConflict`, `apply`) decrypts through one function, `Vault.open(_ row: NoteDTO) throws -> PlainNote`. A row that doesn't decrypt is never applied. The engine records it as a problem ("A note couldn't be opened on this device") and skips it, the same way `refused` works for server refusals.
- `NoteDTO` drops `body` from its coding keys and adds `body_ct` and `head_ct`. `FolderDTO` swaps `name` for `name_ct`. `AttachmentDTO` swaps `filename`/`content_type` for `meta_ct`.
- Every request carries `x-amber-client: lock-aware/1 e2ee/1` (today `lock-aware/1`, set in `Pane/Sync/Backend.swift`).

### Conflicts and the merge

The merge works on plaintext on the device, as it does now:

- The base text in `synced[id]` is the decrypted body the device last had, kept in memory as it is today.
- In `resolveConflict`, the device fetches the server row, decrypts it, and runs `TextDiff.merge(base:mine:theirs:)` unchanged. The merged text is encrypted and sent with `eq("version", sv)`.
- `same()` compares decrypted fields, not ciphertext. Nonces are random, so the same text encrypts differently every time.
- A conflicted copy is a new note, encrypted like any other. Locked conflicts keep `resolveSealedConflict` as it is.

The server's version guard, `version` bumped by `pane_touch`, doesn't care what the body holds, so it works unchanged.

### Deltas

We don't add delta sync. Each push sends the whole note, as today. Pushes happen at most every 0.35 s while typing, and AES-GCM on a 50 KB note takes microseconds. The cost is bandwidth, which is the same as today plus about a third for base64. If that ever matters, a later format can add an operation log. This design doesn't need one.

**No re-encryption without a change.** If a note's text didn't change, the device and the MCP server send the old `body_ct` back unchanged. Otherwise every pin toggle would look like a new version to `pane_count_ai_edit`, `pane_mark_ai_editor` and the revision trigger, which all compare `body_ct` now.

### Realtime

Realtime carries ciphertext rows, which is fine. Rows too big for a realtime message arrive without `body_ct`. The existing fallback fetches the row by id (`received(_:)`).

### Files: chunked encryption

- Each file gets a random 256-bit key FK and an 8-byte random nonce prefix.
- The stored object is a 16-byte header (`AMB3F`, format version 1, chunk size, nonce prefix), then chunks. Each chunk holds 64 KiB of plaintext, except the last.
- Chunk i is `AES-GCM(FK, nonce = prefix || uint32be(i), AAD = "amb3|f|<user>|<attachment id>|<i>|<last ? 1 : 0>")`. The last-chunk flag stops truncation. The index stops reordering.
- The final chunk's plaintext is padded to a multiple of 4 KiB. So the stored size shows the file's size to within 4 KiB. We don't pad to a full chunk: at 10,000 small files, that would waste up to 640 MB of quota.
- Upload: `SyncEngine.pushFiles` encrypts from the local file in a stream and uploads to `<user>/<attachment id>`. Download decrypts in a stream into `FileStore`. Thumbnails and previews are made on the device, never on the server.
- The Storage size limit per upload goes up by the overhead. 50 MB of plaintext becomes at most 50 MB + 16 bytes per 64 KiB + 16 + 4 KiB.

### Version history

This part is easier than it looks. The server trigger (`pane_touch`, latest in `20260930150000_locked_notes.sql`) makes a revision by copying the **previous row** into `note_revisions`. After the change it copies `old.body_ct` and `old.head_ct` instead of `old.body`. Ciphertext in, ciphertext out. The server never needs to read a version.

- The typing throttle (one `app` revision a minute per note) works on timestamps. No change.
- Thinning (`pane_thin_revisions`) goes by age, source and `octet_length`. No change except counting `body_ct` and `head_ct` bytes.
- `restore_note_version` copies `body_ct`, `head_ct` and `locked_body` back. Restoring an old version is the same as today. AAD doesn't include the version number, which is deliberate: an old version's box is still valid for the same note.
- The app's history view (`Pane/Model/NoteHistory.swift`) fetches `body_ct` for a version and decrypts it on the device.
- The purge rule stays: a note deleted for good loses its revisions. Locking a note still deletes them.
- One check goes: `old.body <> ''` in `pane_touch`. The server can't tell if a body is empty. The revision of an empty note is about 60 bytes, so we drop the check.

---

## 5. Search

### In the apps

Local, as today. The apps search SwiftData. They don't call `search_notes`.

### For the MCP server

The server has the data key during the request, so the simplest correct search is to decrypt and scan. Phase 8 measures before we build anything cleverer.

**Version 1: scan with a budget.**

1. Fetch `id, folder_id, parent_id, is_pinned, updated_at, head_ct, body_ct` for live, unlocked notes, newest first, in pages of 500.
2. Decrypt heads and bodies in memory, match with a new `searchInMemory(query, notes)` in `supabase/functions/mcp/notes.ts`, and rank. The ranking copies today's `search_notes`: whole-word matches, a title match bonus, substring fallback with `%` and `_` taken literally, `broadenQuery` when nothing has every word, and snippets with `«»` marks like `ts_headline` produces.
3. Stop when it has scanned everything or when the budget runs out: 1.2 s of CPU or 6 s of wall time. If it stops early, the result says so: `"searched": "the 18,000 most recently edited notes of 41,000"`, so the model can narrow by folder.

**Rough cost**, to confirm in phase 8 with `scripts/stress.ts`. I estimate, not measured:

| Library | Text | Rows fetched | Decrypt | Match | Total |
|---|---|---|---|---|---|
| 1,300 notes (the demo library) | 3 MB | ~60 ms | ~40 ms | ~20 ms | ~0.15 s |
| 5,000 notes | 10 MB | ~200 ms | ~150 ms | ~80 ms | ~0.5 s |
| 20,000 notes | 40 MB | ~0.8 s | ~0.6 s | ~0.3 s | ~1.7 s |
| 50,000 notes / 100 MB, the account cap | 130 MB of base64 | ~2.5 s | ~1.5 s | ~0.8 s | over budget |

Decrypt time is mostly the per-call cost of WebCrypto's promise (roughly 20 to 30 µs a box), not the AES. Supabase documents limits of about 2 s CPU and 256 MB memory per edge function invocation. Check the current numbers before phase 8. Streaming pages of 500 and dropping each page after matching keeps memory flat.

Today's server search is about 20 to 100 ms for any library, so for most people this is slower but still fine for a tool call. For the largest libraries it's worse. That's the price of the requirement.

**Version 2 if the numbers call for it: an encrypted index the devices build.**

- `search_shards(user_id, shard smallint, key_id, ct text, watermark timestamptz, built_by uuid, updated_at)`. 32 shards per account.
- Each shard is a sealed (sh) compressed map from term to postings `[(note id prefix, term frequency, in title)]` for the terms whose `SHA-256(term) mod 32` is that shard.
- The Mac or iPhone app rebuilds changed shards after sync, at most every 10 minutes and only on power and Wi-Fi on iPhone. `watermark` is the largest `server_updated_at` the shard covers.
- The MCP server tokenizes the query, opens only the shards its terms fall in, gets candidate notes, then decrypts the notes changed after the oldest watermark (the stale set, usually small) plus the top 50 candidates for ranking and snippets.
- Substring and prefix search aren't served by the index. For those the server falls back to the version 1 scan with its budget.
- The server learns which shards a query touches. It already sees the query in the clear during the request, so that leaks nothing new.

Another route is moving the MCP function off Supabase Edge to a host with more CPU per request. That's an operations choice, and I would take it only if version 2 still isn't enough.

---

## 6. The MCP path in detail

### Tables

```sql
-- One per account. The switch that says "this account is encrypted".
create table public.account_keys (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  key_id           text not null check (key_id ~ '^[0-9a-f]{16}$'),
  verifier         text not null,         -- amb3.vf box of a fixed text, AAD binds user id
  recovery_key_id  text check (recovery_key_id ~ '^[0-9a-f]{16}$'),
  recovery_wrap    text,                  -- amb3.w box: DK under HKDF(recovery key)
  migrated_at      timestamptz,           -- set when no plaintext row remains
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.device_keys (
  user_id     uuid not null references auth.users (id) on delete cascade,
  device_id   uuid not null,              -- the same random id pane_devices uses
  platform    text not null check (platform in ('ios', 'macos')),
  public_key  text not null,              -- P-256, X9.63 raw, base64
  key_id      text,                       -- which DK dk_wrap holds
  dk_wrap     text,                       -- DK sealed to public_key (ECIES, section 10)
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  revoked_at  timestamptz,
  primary key (user_id, device_id)
);

create table public.key_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind            text not null check (kind in ('device', 'connect')),
  label           text not null check (char_length(label) <= 80),   -- "iPhone", "Chrome on a Mac"
  connect_request uuid references public.oauth_requests (id) on delete cascade,
  commit          text not null,          -- step 1
  approver_key    text,                   -- step 2
  requester_key   text,                   -- step 3
  requester_nonce text,                   -- step 3
  answer          text,                   -- step 5, sealed to the handshake key
  answered_by     uuid,
  declined_at     timestamptz,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '10 minutes'
);
alter publication supabase_realtime add table public.key_requests;

alter table public.oauth_requests add column code_wrap text;   -- DK under HKDF(code), nulled on exchange
alter table public.oauth_tokens   add column dk_wrap   text;   -- DK under HKDF(this token)
alter table public.mcp_tokens     add column dk_wrap   text,   -- pane_ tokens only
                                  add column key_id    text;

create table public.mcp_file_links (
  link_hash     text primary key,          -- SHA-256 of the link secret
  user_id       uuid not null references auth.users (id) on delete cascade,
  attachment_id uuid not null references public.attachments (id) on delete cascade,
  fk_wrap       text not null,             -- the file key under HKDF(link secret)
  expires_at    timestamptz not null
);
```

RLS: users read their own `account_keys`, `device_keys` and `key_requests`. Only definer RPCs write them. `mcp_file_links` is for the MCP function only. `revoke all ... from anon, authenticated`, as `oauth_tokens` is today.

### Approving in the app (ChatGPT, Claude, and the rest)

Steps 1 and 2 are today's flow. The change is in 3 to 7.

1. The AI client registers (`/register`), sends the browser to `/authorize`, and the server creates `oauth_requests` and redirects to `ambernotes.app/connect?request=<id>`.
2. The page opens `ambernotes://connect?request=<id>`. The app calls `GET /connect/request` and shows the consent sheet. No change.
3. The user taps Allow. The app makes the authorization code itself: `code = "amb_code_" + hex(32 random bytes)`. Then `code_wrap = seal_w(HKDF(code, "amb3 wrap code"), DK, AAD = "amb3|w|code|<user>|<request id>|<kid>")`.
4. The app sends `POST /connect/decide {id, allow, write, code_hash: sha256hex(code), code_wrap, key_id}`.
   The server checks that `key_id` is the account's current one and that the wrap has the `amb3.w` shape, and stores `code_hash`, `code_wrap` and `code_expires_at`. It creates the grant as today, and answers `{redirect}` without a code.
   The server never sees the code at this point.
5. The app appends `code=<code>` to the redirect and opens it in the browser the request came from, as `ConnectCenter.browser` does today.
6. The AI's backend calls `POST /token` with the code and PKCE verifier. The server does today's checks: hash lookup, client id, redirect, PKCE, single use. Then:
   - `DK = open_w(HKDF(code, "amb3 wrap code"), code_wrap)`
   - makes `access` and `refresh` as today
   - stores `dk_wrap = seal_w(HKDF(access, "amb3 wrap at"), DK)` on the access row and `seal_w(HKDF(refresh, "amb3 wrap rt"), DK)` on the refresh row
   - sets `oauth_requests.code_wrap = null` in the same transaction
   - drops DK and answers the client
7. If the code is presented twice, today's code revokes the grant. `revokeGrant` deletes the token rows, and with them the wraps.

For an account without `account_keys` during the rollout, `/connect/decide` keeps today's behaviour. For an encrypted account, a decide without `code_wrap`, from an old app build, gets `409 {"error": "Update Amber Notes to connect an AI."}`.

### Each MCP request

In `supabase/functions/mcp/index.ts`:

1. `tokenFrom(req)` is unchanged.
2. `resolve_oauth_token(token)` and `resolve_mcp_token(token)` also return `dk_wrap` and `key_id`.
3. If the account is encrypted and the wrap is missing or doesn't open, the answer is `401` with `error="invalid_token"`. ChatGPT and Claude respond to that by asking the user to reconnect. This is what every connection made before the migration gets once.
4. `DK = open_w(HKDF(token, "amb3 wrap at" | "pt"), dk_wrap)`. The server imports the collection subkeys it will need as non-extractable CryptoKeys, then overwrites the raw DK bytes with zeros.
5. `ToolContext` gains `vault: Vault`, which has `openHead`, `openBody`, `sealNote`, `openFolder`, `sealFolder`, `openFileMeta`. Nothing outside the request keeps a reference to it.
6. After the response, the vault goes out of scope. JavaScript can't guarantee memory is wiped. We avoid long-lived references and never log plaintext, and the public copy says the server handles plaintext in memory.

The batch loop in `index.ts` unwraps once per HTTP request, not per JSON-RPC message.

### Refresh rotation

In `token()`, the `refresh_token` branch:

1. It does today's checks: exists, not revoked, not used (reuse revokes all), not expired.
2. `DK = open_w(HKDF(refresh, "amb3 wrap rt"), row.dk_wrap)`. If it fails, `invalid_grant` "Connect again".
3. It marks the old refresh row used and sets its `dk_wrap = null` in the same statement, then issues a new pair with new wraps. DK lives only inside this call.
4. The cleanup inside `limited()` also runs `update oauth_tokens set dk_wrap = null where expires_at < now()`, so an expired access token's wrap doesn't wait a day for its row to be deleted.

### Revoking

- The app's Disconnect sets `mcp_tokens.revoked_at` as today. A new trigger branch in `mcp_token_stay_revoked` sets `new.dk_wrap = null` and deletes `oauth_tokens` rows for the grant.
- `/revoke` (RFC 7009) already deletes the token rows through `revokeGrant`.
- Account deletion cascades.

### Read only and Read and Edit

Both get the same data key. AES keys don't split into read and write. Read-only is enforced by the server, as today: `tools/list` filters on `readOnlyHint`, and `runTool` refuses write tools. The consent screen doesn't claim more. Since the server holds plaintext during the request anyway, cryptographic read-only would add nothing against the one threat that matters here, which is the server itself.

### Writes

`create_note`, `edit_note`, `append_to_note`, `replace_note_body`, `set_checklist_item`, `log_table_row`, `delete_table_row`, `create_sub_note` and `restore_revision` decrypt the body, apply the same pure functions in `notes.ts` as today, then encrypt with DK:

- `body_ct = seal(nb, id, pad(body))`
- `head_ct = seal(nh, id, {title: titleOf(body), preview: previewOf(body), subs: linkedNotes(body), files: linkedFiles(body)})`

`titleOf` and `previewOf` must give the same results as the app's `NoteText`. That's already tested for titles. Previews get the same test. Folders created by `findFolder(create: true)` get `name_ct`. If the note is shared, the same transaction updates its share snapshot (section 7).

### The tools, one by one

| Tool | What it decrypts | Change |
|---|---|---|
| `get_overview` | folder names; heads of pinned and recent notes; heads of parents for `listed()` | `listed()` moves from SQL `strpos(parent.body, ...)` to memory, using `head.subs` of the parents |
| `search_notes`, `search` | heads and bodies, streamed | section 5 |
| `list_notes` | heads of the page; all heads for `sort = title`; parents' heads | Ordering by title moves to memory |
| `read_note`, `fetch` | one body; heads of sub-notes and the parent | |
| `create_note`, `create_sub_note` | folders; parent body | encrypts |
| `edit_note` and the other edits | one body | encrypts |
| `move_note`, `pin_note`, `delete_note`, `restore_note` | heads for lookup by title | no content change, `body_ct` untouched |
| `list_folders`, `create_folder`, `rename_folder`, `delete_folder` | folder names | `findFolder` matches decrypted names in memory, which it already mostly does |
| `note_history` | revision heads, and bodies for previews, up to `limit` | |
| `restore_revision` | the revision's head, to answer with the title | copies ciphertext |
| `list_files` | file metadata; all heads for `in_notes` using `head.files` | filename filter moves to memory |
| `get_file` | the file's metadata, for FK | returns a `/files/<secret>` link (below) |
| `read_table`, `log_table_row`, `delete_table_row` | one body | |

`findNote` by title decrypts all heads, matches in memory, then re-selects the one row `for update` by id, which keeps today's locking.

Locked notes are refused the same way as today (`refuseLocked`, and the `pane_note_lock` trigger via `pane.agent`). Their title comes from `head_ct`, so the AI sees titles of locked notes as it does today.

### Files for the AI: `get_file`

Today `get_file` returns a signed Storage URL. Ciphertext is useless to the AI. Instead:

1. `get_file` opens the file's metadata, makes `L = 32 random bytes`, stores `mcp_file_links {link_hash: sha256(L), fk_wrap: seal_w(HKDF(L, "amb3 wrap fl"), FK), expires_at: now() + 10 min}`, and returns `download_url: https://mcp.ambernotes.app/files/<b64url(L)>`.
2. `GET /files/<L>` (a new path in `oauth.ts isOAuthPath` style routing and in `web/lib/mcp-proxy.ts PATHS`) looks up the hash, unwraps FK, streams the Storage object through a `TransformStream` that decrypts chunk by chunk, and sends it with the original name and type.
3. Links expire after 10 minutes, the same as today's signed URLs, and the cleanup deletes the rows.

### Old pane_ tokens (Claude Code, Codex, the connect guide)

Today `create_mcp_token` makes the token on the server (`20260927190000_mcp_tokens.sql`). The new build makes it on the device:

1. `token = "pane_" + hex(32 random)`.
2. `rpc('create_mcp_token_sealed', {token_name, write_access, token_hash: sha256hex(token), dk_wrap: seal_w(HKDF(token, "amb3 wrap pt"), DK), key_id})`.
3. The app shows or installs the token as today (`ConnectAI.swift makeToken`, `ClaudeCodeInstaller`).

The old `create_mcp_token` refuses encrypted accounts: "Update Amber Notes to make a token".

These tokens don't expire, which makes a leaked one worth more than an OAuth token (section 1). Claude Code and Codex both sign in to remote MCP servers with OAuth now. I'd move the connect guide to OAuth for them and keep `pane_` tokens for clients that can't.

### Approving on the web without the app

The browser needs either the data key or someone who has it. The page (`web/app/connect/ConnectFlow.tsx`) offers two ways once signed in:

**A. Approve on your iPhone or Mac.** This is the main path, and it works when the AI runs in a browser on a computer without the app.

1. The page makes an ephemeral P-256 key and nonce and calls `POST /connect/handoff {request, commit, label}`. The server creates a `key_requests` row with `kind = 'connect'`, claimed by the signed-in account.
2. Every device with the key sees "Chrome on a Mac is connecting ChatGPT to Amber Notes" through realtime, or when the app next opens. The page says "Open Amber Notes on your iPhone or Mac". There's no push today. Decision 9 is whether to add push.
3. The device and the page run the commitment protocol from section 2. Both show the 6-digit code.
4. The device shows the normal consent sheet (who's asking, read only or read and edit) with the code. The user checks the code and taps Allow.
5. The device does steps 3 and 4 of the app flow (makes the code, wraps DK, calls `/connect/decide`), then puts the full redirect URL, with the code, into `answer`, sealed to the handshake key.
6. The page polls `GET /connect/handoff?id=` every second, opens `answer`, and sends the browser to the redirect. The AI's callback runs in the same browser that started, which ChatGPT and Claude need.

The server stores the code only sealed to the page. So an operator reading the database during those seconds can't pair the code with `code_wrap`.

**B. Use your recovery key.**

1. The page calls `rpc('my_recovery_wrap')` with the session and shows a field for the 28 characters.
2. WebCrypto derives `KEK_rk`, opens DK and checks it against `account_keys.verifier`.
3. The page makes the code, wraps DK and calls `/connect/decide` exactly as the app does. Then it sends the browser to the redirect.
4. The page drops DK and the recovery key text and never writes them to storage.

The page's CSP (`web/lib/connect-csp.ts`) already forbids third-party scripts. Path B trusts the JavaScript we serve at that moment. That's the same trust boundary as the server code, and section 1 says so.

The page doesn't get a "remember this browser" option. The web isn't a device in this design.

---

## 7. Sharing

A shared page is public, so it has to be readable. We store a plaintext **copy** of what the page shows, made from the device (or from the MCP server during an AI write) when the user shares. The encrypted note stays encrypted.

### Schema

```sql
alter table public.note_shares
  add column title        text,          -- plaintext copy, root page
  add column body         text,
  add column shared_by    jsonb,         -- {name, avatar} copied at share time; email still comes from auth.users
  add column published_at timestamptz;

create table public.note_share_pages (      -- included sub-notes, one row per page
  slug     text not null references public.note_shares (slug) on delete cascade,
  note_id  uuid not null,
  parent   uuid,                            -- for the sub-note tree on the page
  title    text not null,
  body     text not null,
  updated_at timestamptz not null default now(),
  primary key (slug, note_id)
);

create table public.note_share_files (      -- plaintext copies of linked files
  slug          text not null references public.note_shares (slug) on delete cascade,
  attachment_id uuid not null,
  storage_path  text not null,               -- bucket 'shared', path <slug>/<attachment id>
  filename      text not null,
  content_type  text not null,
  size          bigint not null,
  primary key (slug, attachment_id)
);
```

A new private bucket, `shared`, holds file copies. `share-files` signs URLs for them as it does for `files` today.

### Flows

- **Share.** The share menu (`Pane/Views/ShareLinkMenu.swift`) asks once per note: "Sharing publishes a readable copy of this note [and its sub-notes and files] on ambernotes.app. Anyone with the link can read it. We keep that copy until you stop sharing." Then the app calls `share_note(p_note, p_include_subnotes, p_pages jsonb, p_shared_by jsonb)` and uploads file copies to `shared/<slug>/...`.
- **Editing a shared note.** The app republishes 2 seconds after the last edit through `publish_share(p_slug, p_pages)`. An AI write to a shared note republishes in the same transaction, since the server has the plaintext then. If the note is edited on a device that's offline, the page updates when that device syncs. Today the page is always live. Decision 6 accepts this difference.
- **Stop sharing.** `unshare_note` revokes the link and deletes `title`, `body`, `shared_by`, `note_share_pages` and `note_share_files` in one transaction. The app deletes the `shared/<slug>/` objects through the Storage API. A daily sweep in the `account` function's style deletes objects whose slug is revoked, in case the app didn't finish.
- **Locking a shared note.** The `pane_note_lock` trigger already revokes the link. It now also deletes the copy.
- **The page.** `shared_note(p_slug, p_sub)` reads `note_shares` and `note_share_pages` instead of `notes`. The sub-note tree check becomes "is there a page row for it", which is simpler and can't leak a note that wasn't published. `web/lib/shared.ts` and `web/app/n/[slug]` keep their types.
- **The profile on the page.** `shared_by.name` and a public avatar copy (`avatars` bucket, random name, as today) are made at share time, and only if the user has a name or photo. The email rule stays: shown unless it's an Apple relay address.

---

## 8. Import, account deletion, usage counts, quota, reports

**Apple Notes import and spreadsheets.** Both run on the Mac (`Pane/Views/AppleNotesImport.swift`, `Pane/Model/XLSXImporter.swift`) and create local notes. They go up encrypted on the next push. Nothing changes on the server. The share extension's inbox (`Pane/Model/Inbox.swift`) stays plaintext in the App Group container on the device until the app files it, protected by the OS like the rest of local storage.

**Account deletion** (`supabase/functions/account/index.ts`). Same flow. `removeFiles` also deletes `shared/<slug>/` objects for the account's shares. The new key tables cascade from `auth.users`. Deleting the account deletes every token wrap, so every AI connection dies at once.

**Usage counts.** `pane_activity` counts AI edits from `pane.source = 'mcp'` and compares `body_ct`. It works unchanged as long as unchanged text is never re-encrypted (section 4). `pane_devices`, `pane_active_days`, tips and the share ask don't touch content. `pane_adoption` is unchanged.

**The quota.** `pane_account_note` counts `octet_length` of what's stored, so it counts ciphertext. `pane_note_size(body, locked_body)` becomes `octet_length(coalesce(body_ct, '')) + octet_length(coalesce(head_ct, '')) + octet_length(coalesce(locked_body, ''))`. Base64 plus padding makes ciphertext about 1.35 times the text, so the limits move with it and users keep the same room:

| Limit | Today | After |
|---|---|---|
| per note (`note_bytes`) | 2 MB of text | 2.9 MB of ciphertext |
| per account (`notes_bytes`) | 100 MB | 140 MB |
| per file upload | 50 MB | 50 MB + chunk overhead (about 50.02 MB) |
| files per account (`files_bytes`) | 500 MB | 510 MB |

The messages in `pane_over` keep talking in plaintext sizes ("2 MB of text"), which is what people understand.

**Reports and moderation.** Reports point at slugs. The reviewer reads the shared copy, which is public anyway. `admin_take_down` revokes the link and deletes the copy the same way Stop Sharing does. We can moderate only what's shared, and only shared pages are public. Private notes can't be moderated because we can't read them. That's the point.

**Data export on request.** The privacy policy says today that we'll send everything on request. We can't anymore. The app's export is the way, and the policy changes to say that (section 11).

---

## 9. Migrating existing data

We're pre-launch with few accounts, and iOS 1.0 is in App Review without this. The migration runs on each account's first launch of the encrypted build. The server keeps serving plaintext accounts until the last one has moved.

### On the device, first launch of the new build

1. **No `account_keys` row.** This is the first encrypted device for the account.
   1. It shows the first-launch screen (section 11), then the recovery key.
   2. It makes DK and inserts `account_keys` through `create_account_keys(key_id, verifier, recovery_key_id, recovery_wrap)`. If another device won the race, this fails with `23505`, and the device goes to the new-device path.
   3. It registers itself in `device_keys` with a wrap and saves DK to the Keychain.
2. **It encrypts the library** in the background, with progress in the sync status ("Encrypting your notes: 340 of 1,284"):
   1. Folders, then notes, in batches of 200, through `encrypt_batch(p_rows jsonb)`. For each row the RPC sets `name_ct`, or `body_ct` and `head_ct`, and nulls the plaintext column, only where `version` is unchanged. A row edited meanwhile is retried after the next pull.
   2. Revisions. The device reads them page by page, encrypts them, and writes them back with `reseal_revisions(p_rows jsonb)`. That's a definer RPC that only writes rows of the caller's own notes and only replaces `body` with `body_ct`. Decision 4 is whether to keep history or delete it here.
   3. Files. It downloads each plaintext object, encrypts it, uploads to `<user>/<attachment id>`, writes `meta_ct` and the new path, then deletes the old object. It resumes after a quit, keyed by attachment id.
   4. Profile name and photo, and the notes-password hint.
   5. Shared notes. It writes the share copy for each live link, so pages keep working once `shared_note` switches to copies.
3. **It finishes** by calling `finish_migration()`. That sets `account_keys.migrated_at` only if the account has no row with plaintext left (`body is not null`, `name is not null`, `filename is not null` and so on). Otherwise it returns what's left, and the device carries on.

A second device that updates later has nothing to migrate. It enrolls as a new device and pulls ciphertext.

### What happens to AI connections

Every connection made before the migration has no wrap. Its next MCP call gets `401 invalid_token`, and ChatGPT and Claude ask the user to reconnect. After migration the app shows a card: "Your AI connections need to be approved again, because your notes are now encrypted. Reconnect ChatGPT, Claude…", with the list from `mcp_tokens`. We can't avoid this. Only the AI holds those tokens.

### Old app builds

The lock work set up a pattern we reuse: `pane_old_client()` reads the `x-amber-client` header. The encrypted build sends `lock-aware/1 e2ee/1`.

- **Writes.** For an account with `account_keys`, any API write to notes, folders, attachments, profiles or note_locks without `e2ee/` in the header fails with `42501` "Update Amber Notes to keep syncing. Your notes are now end-to-end encrypted, and this version of the app can't read them." `SyncEngine.refusal` already treats `42501` as a refusal and shows the message.
- **Reads.** The `select` policies get `and (not public.pane_e2ee_account(user_id) or public.pane_e2ee_client())`. `pane_e2ee_client()` is true when there are no request headers (realtime, the database itself, the MCP function over direct Postgres) or the header has `e2ee/`. An old build pulls nothing new and keeps its local notes as they were.
- **Realtime for old builds.** Realtime has no request headers, so it would still send ciphertext rows to an old build. The encrypted rows have `body = null`. The old `NoteDTO.body` is a non-optional `String`, so decoding fails. `received(_:)` then fetches the row by id, the gated `select` returns nothing, and the old app does nothing. It never blanks a note. The pglite and sync harness tests must pin this down, because it's the one path where an old build meets new data.

### Server purge, after every account has migrated

1. Check `select count(*) from account_keys where migrated_at is null` and `select count(*) from auth.users u where not exists (select 1 from account_keys k where k.user_id = u.id)`. Both must be 0, or the leftovers are accounts nobody has opened since, and Emil decides about them.
2. The contract migration: drop `notes.body`, `title`, `search` and their indexes, `note_revisions.body`, `folders.name`, `attachments.filename` and `content_type`, `profiles.display_name`, `note_locks.hint`. Make `account_keys` required for every write, with no plaintext mode left. `search_notes()` and `create_mcp_token()` go.
3. `vacuum full` on `notes`, `note_revisions`, `folders`, `attachments`, `profiles` and `note_locks`. That rewrites the tables so old tuple versions with plaintext don't linger in data pages.
4. Delete the old `avatars` objects that were profile photos and aren't referenced by a share copy.

### Backups, honestly

We can't edit the hosting provider's backups. Supabase's daily backups, and point-in-time recovery if it's on, keep plaintext from before the migration until they age out. On the Pro plan that's 7 days of daily backups. The migration note, the privacy policy and the first-launch screen don't claim otherwise. The policy says: "Notes you wrote before [date] can remain readable in our hosting provider's backups for up to 7 days after your notes were encrypted, then they're gone." The same is true of Postgres write-ahead logs held for replication and recovery. Check the project's actual retention settings before writing the number.

---

## 10. Crypto choices and formats

### Primitives

| Use | Primitive | Apple (CryptoKit) | Web page (WebCrypto) | MCP (Deno WebCrypto) |
|---|---|---|---|---|
| Encryption | AES-256-GCM, 96-bit random nonce, 128-bit tag | `AES.GCM` | `AES-GCM` | `AES-GCM` |
| Key derivation | HKDF-SHA256 | `HKDF<SHA256>` | `HKDF` | `HKDF` |
| Key agreement | ECDH P-256 | `P256.KeyAgreement`, `SecureEnclave.P256.KeyAgreement` | `ECDH` P-256 | `ECDH` P-256 |
| Hashes | SHA-256 | `SHA256` | `SHA-256` | `SHA-256` |
| Randomness | system CSPRNG | `SecRandomCopyBytes` | `crypto.getRandomValues` | `crypto.getRandomValues` |
| Locked notes (existing) | PBKDF2-SHA256, 600,000 rounds | CommonCrypto | not used | not used |

Why these. They're the intersection all three platforms have built in, with no third-party crypto library anywhere. XChaCha20-Poly1305 would allow longer random nonces but isn't in WebCrypto. HPKE is in CryptoKit (iOS 17 and up) but not WebCrypto, so the sealed-to-a-public-key format is a small ECIES from the same primitives, specified below. No Argon2: nothing new is derived from a human password.

**Nonce budget.** Random 96-bit nonces are safe for about 2^32 messages per key. Each collection has its own subkey. A heavy user who types all day pushes maybe 100,000 note boxes a day, which is about 115 years to 2^32 under one subkey. File chunks use a per-file key, so they don't count. Key rotation (phase 10) resets the counter anyway.

### The box format, amb3

```
amb3.<type>.<kid>.<b64url(nonce[12] || ciphertext || tag[16])>

type   nb | nh | fo | fm | pr | lh | sh | vf        (the collection)
kid    16 lowercase hex characters, the DK key id
key    K_type = HKDF-SHA256(ikm = DK, salt = "amber-notes/v3", info = "amb3 key " || type), 32 bytes
AAD    UTF-8 of "amb3|" || type || "|" || kid || "|" || user id || "|" || item id
```

- The item id is the note, folder or attachment id in lowercase. For `pr`, `lh` and `vf` it's the user id. For `sh` it's `shard:<n>`.
- The header is part of the AAD, so changing the type or key id breaks the tag.
- **Padding.** Plaintext is `data || 0x80 || 0x00…`, up to the next multiple of 256 bytes below 16 KiB, of 1 KiB below 256 KiB, then of 16 KiB. Opening strips everything from the last `0x80`. Heads and names pad to 64 bytes.
- The body plaintext is the markdown as UTF-8. The head is compact JSON with `"v":1`.
- The version is the prefix. `amb2` stays the locked-note format. A future format is `amb4`. Readers refuse prefixes they don't know, and the sync engine shows "Update Amber Notes to open this note".
- Check constraints in the migration pin the shape: `body_ct ~ '^amb3\.nb\.[0-9a-f]{16}\.[A-Za-z0-9_-]+$'` and the same for each column. This mirrors the `locked_body` constraint.

### The wrap format, for keys

```
amb3.w.<purpose>.<b64url(nonce[12] || AES-GCM(KEK, key[32]) || tag[16])>

purpose  rk | code | at | rt | pt | fl
KEK      HKDF-SHA256(ikm = secret bytes, salt = user id bytes, info = "amb3 wrap " || purpose)
         secret = the token or code string as UTF-8 (at, rt, pt, code), the 28 recovery key characters as UTF-8 (rk),
                  or the link secret (fl)
AAD      "amb3|w|" || purpose || "|" || user id || "|" || holder id || "|" || kid
         holder id = oauth_requests.id (code), mcp_tokens.id, the grant id for at and rt, attachment id (fl)
```

The server looks tokens up by `sha256hex(token)`, as today. The KEK comes from HKDF with a different salt and info, so the stored hash says nothing about the KEK. The tokens carry 256 random bits, so neither can be brute-forced.

### Sealed to a public key (device wraps, handoff answers)

```
eph      fresh P-256 key
shared   ECDH(eph.private, recipient.public)
k        HKDF-SHA256(ikm = shared, salt = eph.public || recipient.public, info = "amb3 seal " || purpose, 32)
box      "amb3.s." || purpose || "." || b64url(eph.public[65] || nonce[12] || AES-GCM(k, plaintext) || tag[16])
AAD      "amb3|s|" || purpose || "|" || user id || "|" || recipient id
```

The handoff answer from section 2 uses the handshake key directly (both sides already have ephemeral keys), with purpose `handoff`.

### Files

The format is in section 4. The header is `"AMB3F" || 0x01 || uint32be(chunk size) || prefix[8]`, 18 bytes.

### Test vectors

One file, `supabase/functions/_shared/crypto-vectors.json`, holds fixed keys, nonces, ids and expected boxes for every format above, plus failure cases (wrong AAD, wrong type, truncated file, swapped chunks). Swift tests, Deno tests and the web's vitest all read it. A box made on one platform must open on the other two. This is the single most important test in the project.

---

## 11. User-facing copy (drafts)

Drafts only. The lead ships them after the build. Written in the repo's voice: plain, sentence case, short sentences, "you".

### First-launch screen (one screen)

> **Your notes are encrypted on your devices**
>
> Your notes, folders, files and their history are encrypted with a key that only your devices have. We store them, but we can't read them.
>
> When you connect an AI like ChatGPT or Claude, that connection gets its own copy of your key. While the AI reads or changes your notes, our server decrypts what it asked for, in memory, and doesn't keep it. Disconnect the AI and its copy of the key is deleted.
>
> A note you share is the exception. Sharing publishes a readable copy until you stop sharing it.
>
> [Continue]

### Recovery key screen

> **Save your recovery key**
>
> If you lose all your devices, this key is the only way back into your notes. We can't reset it for you, because we don't have it.
>
> `7K4P-Q2WM-9XRD-HT3C-LN8F-B6YJ-M2VA`
>
> [Copy] [Print] [Save to Files]
>
> Keep it somewhere safe that isn't this device, like a password manager or on paper.
>
> [I saved it]

### Approving a new device

> On the new device: **Approve this iPhone** · Open Amber Notes on your Mac to approve it, or use your recovery key. · [Use recovery key]
>
> On the Mac: **Approve a new iPhone?** · Check that the iPhone shows the same code. · **482 913** · [Approve] [Not me]

### The web approval page

> **Finish on your iPhone or Mac** · Open Amber Notes on a device you're signed in on. Check that it shows the same code, then tap Allow. · **482 913** · Don't have your devices? [Use your recovery key]

### Website: security section (for the home page or /privacy)

> **Encrypted on your devices**
>
> Your notes, files and version history are encrypted on your iPhone and Mac before they're uploaded, with a key only your devices have. Our database, our backups and our logs hold only ciphertext. We can't read your notes, and we can't hand them to anyone.
>
> **How your AI still works.** When you connect ChatGPT, Claude, Claude Code or Codex, you approve it on one of your devices, and that device gives the connection its own copy of your key. We store it locked with a secret that only that AI has. When the AI asks for a note, our server uses that secret to decrypt the note in memory, answers, and forgets it. We never save it readable. Disconnect the AI and its copy of the key is deleted.
>
> **What that means, honestly.** While an AI is reading or changing your notes, our server handles that text in memory. If our server code were changed to copy it, it could. You don't have to trust our word on that: the code is open source, and every deploy is listed with the commit it came from. Locked notes go further. They're encrypted with your notes password, and no AI ever gets that key.
>
> **What we can see.** Your email address, how many notes and files you have and roughly how big they are, when they change, how they're arranged in folders, and which AIs you've connected. Not titles, not text, not file names.
>
> **Shared pages.** A note you share is published as a readable copy, until you stop sharing it.
>
> **If you lose everything.** If you lose all your devices and your recovery key, nobody can open your notes. Not even us.

### Privacy policy changes (`docs/privacy-policy.md`)

- **Summary bullets (lines 9 to 11).** Replace the locked-notes bullet with: "Your notes, files and version history are encrypted on your devices before they're uploaded. We can't read them. When you connect an AI, our server decrypts what that AI asks for, in memory, and doesn't keep it. Locked notes are also encrypted with your notes password, and no AI can read them."
- **What we store: notes (around line 37).** "Your notes, folder names, file names and files, earlier versions and your profile are stored encrypted with a key only your devices have (AES-256-GCM). We store which folder a note is in, which notes are pinned or locked, sizes, and when things changed, but not their contents."
- **New subsection: your encryption key.** "Your key is kept in your device's Keychain [and, if you allow it, in iCloud Keychain, which Apple encrypts end to end]. To let a new device in, we pass a copy between your devices encrypted so that we can't open it. If you save a recovery key, we store a copy of your key locked with it. We never receive the recovery key itself. If you lose your devices and your recovery key, we can't recover your notes."
- **Locked notes (lines 41 to 43).** Keep. Remove "We store that encrypted text and the note's title, which stays readable": the title is now encrypted too, readable to your AI connections but not to us. The password hint is now stored encrypted.
- **AI connections (lines 91 to 99).** Add: "When you approve a connection, your device gives it a copy of your key, locked with a secret only that connection holds. We store the locked copy and a one-way hash of the connection's tokens. When the AI makes a request, our server unlocks the key with the token it sent, decrypts only what the request needs, in memory, and discards it. Our hosting providers, Supabase [and Vercel], run that server. Disconnecting deletes the connection's copy of your key. Read only is enforced by our server."
- **Shared pages (around line 104).** "Sharing a note publishes a readable copy of it, of the sub-notes you include and of the files it links to. We keep that copy only while the note is shared. Stop Sharing deletes it."
- **Security (lines 120 and 149).** Add end-to-end encryption, and the limit from section 1 in one sentence: "While an AI request is being answered, our server handles that note's text in memory."
- **Backups (line 128).** Add the one-time pre-encryption note from section 9 with the real date and retention.
- **Your rights (line 138).** "Take it with you: export your notes from the app. They're encrypted, so we can't read them or export them for you."
- **App Store privacy answers (`docs/app-privacy-answers.md`).** "Data Not Linked to You" doesn't change, but the answers about what we can access do. Emil updates them in App Store Connect himself.

---

## 12. Build plan, tests and rollout

### Phases, each a reviewable PR or two

| # | PR | Contents | Depends on | Size |
|---|---|---|---|---|
| 0 | Crypto core | `Pane/Crypto/Envelope.swift`, `Wrap.swift`, `Seal.swift`, `FileCrypt.swift`; `supabase/functions/_shared/crypto.ts`; `web/lib/crypto.ts`; the shared vectors; tests on all three. No behaviour change. | | 3 days |
| 1 | Server expand | Migration: key tables, new columns (all nullable), gates that only act on accounts with `account_keys`, RPCs (`create_account_keys`, `encrypt_batch`, `reseal_revisions`, `finish_migration`, `create_mcp_token_sealed`, `my_recovery_wrap`, `key_request_*`, `reset_encryption`), trigger updates that copy `_ct` columns. pglite tests. | 0 | 4 days |
| 2 | MCP dual mode | `Vault` in `ToolContext`; every tool reads plaintext rows as today and encrypted rows through the vault; `/connect/decide` takes `code_hash` + `code_wrap`; `/token` and refresh wrap and unwrap; revoke deletes wraps; `/files/<secret>`; in-memory search v1; `listed()` and friends in memory. | 0, 1 | 7 days |
| 3 | App keys | Keychain store, device key, first-launch and recovery screens, new-device screen, approval sheet and protocol, Settings → Encryption (devices, new recovery key). | 0, 1 | 6 days |
| 4 | App sync | DTOs, `Vault.open`, header, conflict path, chunked files, profile, hint, history decrypt, the migration runner with progress, resume and a test library. | 3 | 8 days |
| 5 | App connect | Decide with code wrap, local `pane_` tokens, reconnect card, connect guide moves Claude Code and Codex to OAuth. | 2, 3 | 3 days |
| 6 | Web approval | `/connect/handoff` on the server, handoff and recovery paths in `ConnectFlow.tsx`, proxy paths, CSP check, vitest. | 0, 2 | 4 days |
| 7 | Share copies | Share tables and bucket, `share_note`/`publish_share`/`unshare_note`/`shared_note`, `share-files`, app publish flow and consent, MCP republish, sweep. | 1, 4 | 5 days |
| 8 | Search at scale | Measure with `scripts/stress.ts` at 1k, 5k, 20k and 50k notes. The budgeted scan ships in 2. The index only if needed: +5 days. | 2 | 2 days |
| 9 | Contract | Purge migration, `vacuum full`, drop old RPCs, copy on site and in policy. | all accounts migrated | 2 days |
| 10 | Rotation | `rekey_batch`, the Settings flow, disconnecting AIs. Later, not needed to launch. | 4 | 4 days |

### Tests

- **Cross-platform vectors** (phase 0). Swift `PaneTests/CryptoVectorTests.swift`, Deno `supabase/functions/_shared/crypto.test.ts`, web `web/lib/crypto.test.ts`, all reading one JSON file.
- **pglite** (`supabase/functions/mcp/*.pglite.test.ts`, runs in CI without Docker):
  - the gates: an old header can't read or write an encrypted account, a new header can, and no header (realtime, MCP) can read;
  - `pane_touch` copies `body_ct` and `head_ct`, and throttling and thinning work on ciphertext;
  - `restore_note_version` round-trips ciphertext;
  - revoking nulls `dk_wrap` and deletes token rows;
  - `encrypt_batch` respects `version`;
  - `finish_migration` refuses while plaintext is left;
  - share copies are deleted by unshare, lock and take-down;
  - `key_requests` RLS and expiry;
  - quota counts ciphertext.
- **Deno units.** The vault, wrap and unwrap per purpose, file chunk streaming including truncation and reordering, and `searchInMemory` against a golden set built from today's `search_notes` results on the demo library, so ranking doesn't drift unnoticed.
- **MCP end-to-end** (`scripts/mcp-e2e.sh`, local stack only):
  - a test helper plays the device: makes DK, encrypts a library, approves an OAuth request with a code wrap;
  - every tool runs on the encrypted library;
  - refresh rotation, and refresh reuse revokes everything;
  - revoke gives 401;
  - locked notes are still refused;
  - `get_file` streams the right bytes;
  - a connection without a wrap gets `invalid_token`.
- **The canary test.** The e2e seeds notes, folder names, file names, file contents, a profile name and a hint that contain a random canary string. It runs every tool, then dumps the public schema (`pg_dump --data-only`), lists storage objects and reads them, and collects the function logs. The canary must not appear anywhere except share copies of notes that were shared. This is the test that proves the requirement, and it runs in CI on the local stack.
- **Sync harness** (`PaneTests/Network/TwoDeviceLiveSyncTests.swift`, `SyncFaultTests.swift`, `StubSupabase.swift`):
  - two devices enroll with the approval protocol;
  - concurrent edits merge;
  - conflicted copies are encrypted;
  - an undecryptable row is skipped, not applied;
  - migration of a plaintext fixture, killed halfway and resumed;
  - an old-build client, meaning the old header and non-optional `body`, sees realtime rows and never blanks a note.
- **Web.** vitest for the handoff and recovery paths using the vectors, and a Playwright run of `/connect` against the local stack with a simulated device (`scripts/connect-lab.ts` extends).
- **Performance.** `scripts/stress.ts` extended for MCP search and overview timing at each library size, recorded in `docs/Evidence/`.

### Rollout order

Server, then web, then app. Nothing breaks an installed build until the contract step, and by then every account has moved.

1. **Phase 1 migration and phase 2 function deploy.** Additive and dual mode. For accounts without `account_keys` nothing changes: same flows, same tokens, same search.
2. **Web phase 6.** The `/connect` page offers the handoff and recovery paths only when the signed-in account has `account_keys`. Otherwise it stays as today.
3. **App phases 3 to 5 and 7, through TestFlight.** Emil's own account migrates first. Check that the canary test passes against a copy of that state on the local stack, not production. Then the App Store build.
4. **Watch.** `select count(*) from account_keys where migrated_at is null`, and accounts with no `account_keys` at all. Contact the few pre-launch users who haven't updated.
5. **Phase 9 contract**, once both counts are 0 or Emil decides about the stragglers.
6. **Site and policy copy go live the same day the App Store build does.** Not before: the claim has to be true when it's published.

**About iOS 1.0.** It's in review without encryption. If it's approved first, its users sign up in plaintext mode and migrate on the update. That works, but the first-launch promise can't appear until then. Emil might prefer to hold the 1.0 release until this ships. That's his call, and I list it as decision 10.

### Honest size estimate

About 50 working days of focused work at the sizes above, without rotation or the search index. Say 9 to 11 weeks for one person, including review and the TestFlight cycle. Adding rotation and the index makes it about 60. It touches roughly 40 files across the app, server and web, and I'd expect 9,000 to 13,000 changed lines, more than half of them tests. Phases 2 and 4 carry the risk: the MCP tools rewrite and the migration runner. Phase 0's vectors and the canary test are what make the rest safe to review.

---

## 13. Every place in the current code that changes

### Database (new migrations, never edits to old ones)

| Object | Defined in (latest) | Change |
|---|---|---|
| `notes.body`, `title`, `search`, `notes_search`, `notes_body_trgm`, `notes_title`, `notes_body_2mb`, `notes_locked_title_only` | `20260927180000_pane_schema.sql`, `20260928220000_note_titles_and_search.sql`, `20260929100000_limits_and_rate.sql`, `20260930150000_locked_notes.sql` | Add `body_ct`, `head_ct`; `body` nullable; drop generated columns, indexes and body checks at the contract step |
| `note_revisions.body` | `20260927180000`, `20260930150000` | Add `body_ct`, `head_ct`; `body` nullable; drop later |
| `folders.name` | `20260927180000` | Add `name_ct`; drop the length check and `name` later |
| `attachments.filename`, `content_type`, `storage_path` policy | `20260927200000_attachments.sql` | Add `meta_ct`; new path rule `<uid>/<id>` |
| `profiles.display_name`, `avatar_path`, `avatars` bucket policies | `20260929140000_profiles.sql` | `profile_ct`; photo moves to `files` |
| `note_locks.hint` | `20260930150000` | `hint_ct` |
| `pane_touch()` | `20260930150000` | Copies `_ct` columns; drop `old.body <> ''` |
| `restore_note_version()` | `20260930150000` | Copies `_ct` columns |
| `pane_note_lock()` | `20260930150000` | Drop the `strpos(old.body, ...)` check (moves to the app and MCP); delete share copies on lock |
| `pane_old_client()` | `20260930150000` | Add `pane_e2ee_client()` and `pane_e2ee_account()`; gate reads and writes |
| RLS `own notes`, `own folders`, `own attachments`, `own revisions read`, profile policies | `20260927180000`, `20260927200000`, `20260929140000` | Add the e2ee client condition to `select` |
| `pane_note_size()`, `pane_account_note()`, `pane_thin_revisions()` | `20260930150000` | Count `_ct` columns |
| `pane_limit()` | `20260929200000` | New byte limits |
| `search_notes()` | `20260930150000` | Kept for plaintext accounts during rollout, dropped at contract |
| `share_note()`, `unshare_note()`, `shared_note()`, `pane_sharer()` | `20260930150000`, `20260929140000` | Take and serve share copies |
| `admin_take_down()` | `20260929160000_share_reports.sql` | Delete the copy |
| `change_notes_password()` | `20260930150000` | Writes `head_ct` instead of `body` |
| `create_mcp_token()`, `resolve_mcp_token()`, `resolve_oauth_token()`, `mcp_token_stay_revoked()` | `20260927190000`, `20260928222800`, `20260928220500` | Sealed creation; return wraps; delete wraps on revoke |
| `pane_count_ai_edit()`, `pane_mark_ai_editor()` | `20260929170000`, `20260929210000` | Compare `body_ct` |
| New | | `account_keys`, `device_keys`, `key_requests`, `mcp_file_links`, `note_share_pages`, `note_share_files`, `search_shards` (phase 8), `shared` bucket, the RPCs in phase 1 |

### Edge functions

- `supabase/functions/mcp/index.ts`: unwrap per request, `Vault` in the context, 401 without a wrap, the `/files/` route, and the `INSTRUCTIONS` text.
- `supabase/functions/mcp/oauth.ts`: `decide` (takes `code_hash`, `code_wrap`, `key_id`, and answers without a code), `issue` (wraps), `token` (code and refresh branches), `revokeGrant`, `limited` cleanup, the `/connect/handoff` routes, and `isOAuthPath`.
- `supabase/functions/mcp/tools.ts`: every handler per the table in section 6. `listed`, `findNote`, `findFolder`, `folders`, `summary`, `save`, `list_files`, `get_file`, `search_notes`, `search`.
- `supabase/functions/mcp/notes.ts`: `searchInMemory`, `linkedNotes`, `linkedFiles`, a `previewOf` that matches the app.
- `supabase/functions/mcp/pglite.ts`: no change. The new tests use its existing stubs.
- `supabase/functions/share-files/index.ts` and `logic.ts`: read `note_share_files`, sign in the `shared` bucket, and stop parsing the body.
- `supabase/functions/account/index.ts`: remove `shared` objects too.
- New `supabase/functions/_shared/crypto.ts`.

### Apps

- `Pane/Sync/SyncEngine.swift`: DTOs, `merge`/`take`/`apply`/`same`, `resolveConflict`, `pushFiles`, `download`, `storagePath`, `refusal` for undecryptable rows.
- `Pane/Sync/Backend.swift`: the `x-amber-client` header, and key setup after sign-in.
- `Pane/Sync/NoteLockSync.swift`: `hint_ct`, `head_ct` in the password change.
- `Pane/Model/NoteLock.swift`: `NoteVault.sealedCopy` and titles go through `head_ct`. `NoteCrypto` is unchanged.
- `Pane/Model/NoteHistory.swift`: fetch `body_ct` and decrypt.
- `Pane/Model/Files.swift`: streamed encryption to and from `FileStore`.
- `Pane/Views/ConnectAI.swift`: `decide` with the code wrap, local `pane_` tokens, the reconnect card, handoff requests.
- `Pane/Views/ConnectGuide.swift`: OAuth for Claude Code and Codex.
- `Pane/Views/ShareLinkMenu.swift`: consent and publishing copies.
- `Pane/Views/Profile.swift`: encrypted profile and photo.
- `Pane/Views/LockedNotes.swift`: the hint.
- `Pane/Views/SettingsView.swift`: an Encryption section.
- `Pane/Views/SignInView.swift` and `RootView.swift`: the new-device screen.
- `Pane/Views/DeleteAccount.swift`: no change, but the copy mentions the recovery key.
- `Pane/App/PaneApp.swift`: the first-launch screen, the migration runner, capture scenes for the new screens.
- New `Pane/Crypto/`: `Envelope.swift`, `Wrap.swift`, `Seal.swift`, `FileCrypt.swift`, `Vault.swift`, `KeyStore.swift`, `DeviceApproval.swift`, `Migration.swift`.

### Web

- `web/app/connect/ConnectFlow.tsx`, `web/lib/connect.ts`: handoff and recovery paths.
- `web/lib/mcp-proxy.ts`: `connect/handoff` and `files/<secret>` in `PATHS`.
- `web/lib/connect-csp.ts`: check that nothing new is needed. WebCrypto needs nothing.
- `web/lib/shared.ts`, `web/app/n/[slug]/*`: no type change. `shared_note` returns the same shape from copies.
- `web/app/privacy`, `docs/privacy-policy.md`, `web/app/Sections.tsx`, `web/app/help/questions.ts`: the copy in section 11.
- New `web/lib/crypto.ts`.

### Tests and scripts

`scripts/mcp-e2e.sh` and the e2e tests, `scripts/stress.ts`, `scripts/connect-lab.ts`, `scripts/share-e2e.sh`, the new canary test, `PaneTests/Network/*`, `PaneTests/NoteLockTests.swift`, `PaneTests/ConnectAITests.swift`, `PaneTests/ShareLinkTests.swift`, `PaneTests/ProfileTests.swift`, `PaneTests/NoteHistoryTests.swift`, `.github/workflows/ci.yml` (add the new Deno tests).

---

## 14. Open decisions

1. **Recovery key: required, optional or none.** I recommend showing it once and requiring "I saved it", with a way to make a new one. Without it, losing your devices loses your notes. The cost is one screen at setup.
2. **iCloud Keychain sync of the data key.** I recommend yes. A new Apple device just works, and iCloud Keychain is end-to-end encrypted by Apple. The cost is that we trust Apple's keychain as one more holder of the key. Device-only is stricter and makes every new device an approval.
3. **Vercel in the MCP path.** mcp.ambernotes.app runs through Vercel middleware, so AI traffic's plaintext passes Vercel's edge. Options: keep it and name Vercel in the policy, or point the host at Supabase with its custom domain add-on and drop the proxy. I lean toward dropping it before launch if the add-on fits the plan.
4. **Version history at migration: re-encrypt or delete.** Re-encrypting keeps history and costs a day of work. Deleting is simpler. With few accounts either is fine. I'd re-encrypt.
5. **Metadata left readable.** Folder membership, the sub-note tree and pins stay plaintext in v1 (section 3). Moving them into ciphertext later is possible, but it costs server-side nesting checks and makes cascades client-side.
6. **Shared pages update from a device, not live from the database.** An edit made offline reaches the page when the device syncs. AI edits update it straight away.
7. **Every AI connection reconnects once at migration.** This can't be avoided. Confirm the reconnect card is enough.
8. **Search: ship the budgeted scan, build the index only if measurements say so.** Very large libraries get partial search results until then.
9. **Push notifications for approvals.** Without push, approving from the web means opening the app on your phone. APNs would make that a tap. It's extra infrastructure.
10. **iOS 1.0 timing.** Release 1.0 now and migrate its users on the update, or hold it so every user starts encrypted.
11. **Read only is enforced by the server, not cryptographically.** This is honest and matches the threat model. Confirm the consent screen wording stays as it is.
12. **pane_ tokens.** Keep them as an option, or move Claude Code and Codex to OAuth and retire them for new connections. I'd retire them for new connections.
