# Collaboration: shared notes, edited together, still end-to-end encrypted

Status: design and prototype (branch `proto/collaboration`, 5 October 2026). Nothing here is live. The prototype runs two iPhone simulators against a local stand-in for the backend.

What Emil asked for: colleagues editing the same note, including notes with pages, and seeing who is in the note with a little avatar.

## The short version

- **Keys.** Every account gets an identity key pair (P-256). The private half is sealed under the account's data key and kept on the server, so any device that can open the notes can share. A shared note gets its own random note key. Inviting someone seals that key to their public key; accepting re-seals it under their own data key. The server never holds a key that opens anything.
- **Proving who sent the key.** The wrap mixes in the sender's identity key, so a server can't slip someone a key of its own. People can compare a 12-digit safety code if they want to be sure the server gave them each other's real keys.
- **Editing at the same time.** The note's text becomes an Automerge document (a text CRDT). Each keystroke burst is a small change, sealed with the note key, stored and relayed by the server, merged on each device. Devices write sealed snapshots now and then and the server drops the changes they cover.
- **Presence.** A private Realtime channel per note carries who's here, where their caret is and whether they're typing, all sealed with the note key. Avatars sit in the note's toolbar; other people's carets show in the text with a name flag; "Sara is editing" shows under the toolbar.
- **AI.** Your AI connection already opens your data key; through it, it opens the note keys you hold. It reads and writes the shared note like your device does. Its edits are marked as yours and its own, so the note says "Sara's Claude".
- **Permissions.** Owner, can edit, can view. Per note first; folders later.
- **Recommendation:** build it this way. About 55 to 70 agent hours to a shippable first version, in the order under Plan.

## 1. Keys

### Identity keys

Each account has one identity key pair, P-256 (the curve the app already uses for Add a device and the connect handoff, and the only one every browser's WebCrypto has).

- The private half is the 32-byte scalar, sealed under the data key as an ordinary `amb2` box with context `identity:<user id>`, stored in `identity_keys.private_wrap`. Any device that holds the data key (iCloud Keychain, Add a device, the recovery key) can open it. So recovery for sharing is the same as recovery for the notes: nothing new to back up.
- The public half (`identity_keys.public_key`) is readable through `collab_find_person` and `collab_members`.
- It is made once, on the first device that shares or is shared with, and never changes. `collab_publish_identity` refuses a different key for an account that has one. Start fresh deletes it with everything else, and that is the one way an identity key changes.

### The note key

A shared note has a note key (NK), 32 random bytes, per **epoch**. Epoch 1 is made by the owner when they share. Each member has a row in `note_members` with:

- `key_wrap`: NK sealed to the member's identity key, by `wrapped_by` (`amb3k`).
- `self_wrap`: NK sealed under the member's own data key (`amb2`, context `notekey:<note>:<epoch>`), written when they accept. Their other devices and their AI open this one.

Formats (`Pane/Collab/CollabCrypto.swift`, `supabase/functions/_shared/collab.ts`, pinned to each other by `_shared/collab-vectors.json`):

| What | Format |
|---|---|
| Note key wrap | `amb3k.<b64 ephemeral public (65) ‖ nonce ‖ ct ‖ tag>`. Key: HKDF-SHA256(ECDH(ephemeral, recipient) ‖ ECDH(sender identity, recipient)), salt `amber-notes/e2ee`, info `notekey <note> <epoch> <from> <to>`. AAD `amb3k\|<note>\|<epoch>\|<from>\|<to>` |
| Change | `amb3u.<epoch>.<b64 nonce ‖ ct ‖ tag>`, AES-256-GCM under NK, AAD `amb3u\|<note>\|<epoch>\|<author id>` |
| Snapshot | `amb3s.<epoch>.…`, AAD `amb3s\|<note>\|<epoch>\|<upto>` |
| Presence | `amb3p.<epoch>.…`, AAD `amb3p\|<note>\|<epoch>\|<user id>` |
| Head (title, preview for lists) | `amb3h.<epoch>.…`, AAD `amb3h\|<note>\|<epoch>` |
| Safety code | 12 digits from SHA-256 of `amber-notes safety v1` and both public keys in a fixed order; the same on both phones |

The second ECDH in the wrap is what makes it authenticated: only the holder of the sender's identity key could have produced it. The recipient checks it against the public key of the member named in `wrapped_by`. The author id in a change's AAD means the server can't pass Sara's change off as Emil's.

### Inviting by email

1. The owner types an address. `collab_find_person(email)` returns the account's id, name, photo and public key, or nothing. It is rate limited (it tells you whether an address has an account).
2. The owner's device seals NK to that key and calls `collab_invite(note, user, role, wrap, epoch)`.
3. The invitee's devices see the new row (Realtime on `note_members`, a push in the product). The app asks: "Emil Wagman shared "Team offsite" with you", with the safety code, Not now and Open.
4. Open: the device checks the wrap against Emil's public key, opens NK, seals it under its own data key (`collab_accept`) and pulls the document.

Someone without an account gets an email with a link to the App Store and a join link (below). The note isn't shared with them until they have an account and an identity key.

### Verifying it's really them

The weak point of any server-run key directory is that the server could hand out its own public key for an address and read what's shared. Two defenses:

- **Safety code.** The people sheet and the invitation show a 12-digit code made from both public keys. Read it out in person or on a call; if it matches, the server gave each of you the other's real key. This is optional, like Signal's safety numbers. Most people won't, and that's fine for a notes app.
- **Key change warnings.** The app remembers each person's public key the first time it sees it (trust on first use). Since identity keys never change except through Start fresh, a different key for the same person is shown plainly: "Sara's key changed. If she didn't start fresh, don't share with her until you've checked the code."

Key transparency (a public log of identity keys) would close the gap entirely. It is not worth it before there are users who need it.

### Join links

`https://ambernotes.app/join/<link id>#<secret>`. The secret lives in the fragment, which browsers never send to a server.

- The owner's device derives two values from the secret with HKDF: an answer (the server keeps its SHA-256) and a key that NK is sealed under (`note_invite_links.key_wrap`). The server can open neither.
- Whoever opens the link proves they have the secret (`collab_open_link`), gets the sealed NK, opens it, seals it to their own identity and data keys, and joins with the link's role (`collab_join_link`).
- Links expire after 7 days, stop working when the note key changes, and the owner sees who joined and can remove them. A link makes a member of whoever holds it, as "anyone with the link" does everywhere. The app says so when making one.
- The universal link opens the app; without the app, the page offers the App Store. Joining happens in the app, never on the web page.

### Removing someone, and leaving

Removing a member makes a new note key: the owner's device makes NK', seals it to every remaining member, and sends all wraps in one call (`collab_remove`, which refuses an incomplete set). The epoch goes up. From then on:

- The server refuses changes sealed for an old epoch, so a removed person's devices can't write.
- New text is sealed with NK', which the removed person never had.
- What they saw before stays seen. Nothing can take back text that already reached their devices; the app says so in the remove confirmation.

The first device to open the note after a rotation writes a fresh snapshot under the new epoch. Older snapshots stay readable for version history because each member's devices keep the old note keys (sealed under their data key, in `note_member_keys`, a table for later). Leaving is the same rotation, done by the owner's next device to come online, or immediately if the owner is online.

### What the server can still see

Readable: who is a member of which shared note, their roles, who invited whom, when each member writes and how much (row sizes and timing), when someone has the note open (they're on its channel), and the number of members. The note's existence and its size.

Sealed: the text, the title, the page, every change and snapshot, cursors, selections, the "is typing" flag, and display names inside presence.

The profile name and photo are already readable (they appear on shared pages), so showing them to fellow members adds nothing new.

### Recovery

Nothing new. The identity key and every note key are reachable from the data key. Whoever can open their notes can open their shared notes. Someone who loses their data key loses access until a member re-invites them, which works because invitations are sealed to the identity key: after Start fresh a person has a new identity key, so they must be invited again (and the key change warning shows).

## 2. Editing at the same time

Today a note syncs as a whole body with a version check, and a conflict keeps the loser as a "conflicted copy". That's right for one person on two devices and wrong for two people typing in the same paragraph.

### The options

| Approach | How | Effort | Risk |
|---|---|---|---|
| Three-way merge of whole bodies | Keep the base version; on conflict, diff both sides and merge (the editor already has `TextDiff.merge` for typing during composition) | Low: 10 to 15 h | Overlapping edits still conflict; carets jump; at 0.35 s pushes with two typists, conflicts are constant. Not live. |
| Operational transform | Server orders operations and transforms them | High | The server must see operations to transform them. Doesn't fit end-to-end encryption without a trusted server. Rule it out. |
| Yjs (CRDT) | Encrypted updates relayed, as Proton Docs and Serenity Notes/secsync do | Medium | The best JavaScript story (MCP server, web), but the Swift side is Yrs through uniffi bindings that are thinly maintained |
| **Automerge (CRDT)** | Same encrypted relay; `automerge-swift` (maintained by the Automerge team, prebuilt XCFramework) and `@automerge/automerge` (WebAssembly) on the server | Medium: the plan below | WebAssembly in Supabase edge functions needs proving; the Swift `Cursor` can't be rebuilt from bytes yet (see Presence) |
| Loro (CRDT) | Same pattern; Swift and JS bindings | Medium | Younger; fewer people shipping it on iOS |

**Recommendation: Automerge, with the secsync pattern** (encrypted changes plus client snapshots). It is the only CRDT with first-class bindings on both sides we need, the binary format is stable across them, and a text object with UTF-16 indexing maps straight onto the editor's `NSString` ranges. The prototype runs it end to end on two iPhones.

### How it fits the app

- **The document.** Root map with `body` (Text, the markdown) and later `page` (Text, the page's HTML) and `meta` (pinned, title overrides). The markdown stays the note's real content: every AI, the share page and export read it as before.
- **Local edits.** The editor reports every keystroke (`onChange`). The difference from the document's text (common prefix and suffix, already in `TextDiff.edit`) becomes one `spliceText`. Changes go up as they happen, batched while one is in flight.
- **Remote edits.** Applied to the document; the merged text goes to the editor through `syncExternal`, which replaces only what differs and maps the caret, so your caret and scroll stay put. A shared note's editor ignores the note's mirrored body (`followsInitialText: false`): that copy can be a render behind and would undo a keystroke.
- **Storage.** The document's saved bytes go into SwiftData next to the note, so a shared note opens offline. Edits made offline are Automerge changes like any other; they merge when the device is back.
- **The server.** `note_updates` (sealed changes, in order) and `note_snapshots`. A device that has written a few hundred changes since the last snapshot seals `doc.save()` and posts it with `upto`; a trigger drops the changes it covers. A new device reads the newest snapshot and the changes after it.
- **Shared notes leave `notes`.** On sharing, the owner's `notes` row becomes a pointer (`shared_note_id`) with an empty sealed body, so the existing sync, version history and conflicted-copy logic never see the shared text. The note stays in the owner's folder; for invitees it lands in a "Shared with me" smart folder (and they can move it anywhere in their own library: placement is per person).
- **Version history.** Snapshots are versions. Automerge also keeps every change's author and time, so history can say "Sara, 14:05" without the server knowing.
- **Undo.** Undo stays local: it undoes your edits, not other people's (the editor already clears its undo stack when outside text lands; this needs a proper per-user undo on top of Automerge, part of the editor work).
- **Size.** Automerge keeps history; a note typed in for months grows. Snapshots are compressed, and compaction drops the changes they cover. The 2 MB note limit applies to the text; the document limit is 4 MB sealed.

## 3. Presence

A Realtime private channel `note:<id>` per open note, with RLS on `realtime.messages` so only members can join (the policies are in the migration). Each device tracks a sealed presence payload: `{name, caret, selection length, typing}`, re-sent when the caret moves, with each burst of typing, and every 2 seconds. Leaving the note, backgrounding the app or losing the connection drops it.

Where it shows:

- **Toolbar avatars.** iPhone: in the navigation bar, left of the More button. Mac: next to Share. Overlapping 28 pt circles, initials on the person's colour (their profile photo when they have one), a ring in the page colour so they read as separate, at most three and then "+2". A small pencil badge while someone types. Tapping opens the people sheet. With nobody else here the button is a plain "person.2" glyph, so a shared note always shows it is shared.
- **"Sara is editing"** under the toolbar while someone types, with a dot in her colour. VoiceOver reads the avatars as "In this note: Sara Lind, editing".
- **Carets.** A 2 pt bar in the person's colour where their caret is, their first name on a small flag above, and their selection tinted. Not hit-testable; you type through them.
- **Colours.** Six fixed colours, picked from the user id, the same on every device: teal, blue, violet, rose, green, slate. Amber is kept for AI edits, as it is today.
- **People sheet.** Everyone in the note with role and state (Here now, Editing now, Not here, Invited), your own row in amber, the invite field, and the safety code after an invite.

Caret positions in the prototype are UTF-16 offsets, moved locally through your own edits until the next presence arrives. The product should send Automerge cursors (stable through concurrent edits). `automerge-swift` exposes a cursor's bytes only as a hex description and has no initializer from them; that needs a small upstream change or a fork, a known gap.

## 4. AI and collaboration

- **Reading and writing.** An AI connection already holds a wrap of your data key under its token. For a shared note it also opens your `self_wrap` and gets NK. The MCP server loads the snapshot and changes, materializes the markdown, and returns it like any other note. A write becomes a diff from the current text, applied as Automerge splices and sealed as a change. Because it is a merge, an AI editing while you type doesn't overwrite you.
- **Who did it.** The change's author is the person (`author_id`, also in the AAD) and `client` names the AI (`pane_writer()`, as for notes today). The tint and receipt say "Sara's Claude changed 3 lines". Version history says the same.
- **Whose AI can reach what.** Only members' AIs, through their own wraps. Removing someone rotates the key, which also cuts off their AI. A viewer's AI can read but not write (the server refuses its changes, same as the viewer's).
- **Note pages.** A shared note's page is sealed with NK (`shared_notes.page_ct`, or a `page` text field in the document so two people editing the page merge). The page's data store is the note's markdown, so data the page writes is a normal edit of the shared text, seen by everyone. Device abilities a page uses (calendar, contacts, location) stay on the device that has them: they run there, and their results are never shared unless the page saves them into the note, which is then an ordinary edit everyone sees. The page sandbox already has no network; nothing changes there.
- **One honest limit stays.** As today, during an AI request the server decrypts in memory what the request needs. For a shared note that means a member's AI request exposes the shared note to the server for that request. The privacy page has to say this for shared notes too.

## 5. Permissions

- **Owner:** invites, removes, changes roles, makes and stops links, deletes the shared note for everyone. One owner; handing over ownership is later.
- **Can edit:** reads and writes the text and the page, and their AI can too.
- **Can view:** reads; their changes are refused by the server.
- **Per note first.** Shared folders later: a folder key that wraps each note key in the folder, so adding someone to a folder is one wrap, and a note moved in or out is a rewrap.

What enforces it: the server, with RLS and the triggers in the migration. A viewer holds NK (they must, to read), so cryptography alone can't stop them sealing a change; the server refuses it, and devices also drop changes whose author's role doesn't allow writing. That's the right trade for a notes app.

## Data model

`supabase/migrations/20261005120000_collaboration.sql` (prototype, tested in `supabase/functions/mcp/collab.pglite.test.ts`):

- `identity_keys`: public key, sealed private key.
- `shared_notes`: owner, epoch, sealed head and page.
- `note_members`: role, epoch, `key_wrap`, `wrapped_by`, `self_wrap`, invited by, accepted.
- `note_updates`, `note_snapshots`: sealed changes and snapshots, refused for stale epochs and for viewers; a snapshot drops the changes it covers.
- `note_invite_links`: hashed answer, sealed NK, expiry.
- Functions: `collab_publish_identity`, `collab_find_person`, `collab_members`, `collab_share`, `collab_invite`, `collab_accept`, `collab_remove`, `collab_create_link`, `collab_open_link`, `collab_join_link`, `collab_role`.
- Realtime: `note_updates` and `note_members` published; RLS policies for the private `note:<id>` channels.

## The prototype

`proto/collaboration`. Run it with `scripts/collab-demo.sh`.

What is real:

- The identity keys, the note key sealed from Emil to Sara (`amb3k`, with the sender proof), her check of it against his public key, her `self_wrap`.
- Automerge documents on both phones; every change sealed with the note key, sent, stored, relayed and merged; the first snapshot sealed by the owner.
- The schema and its rules, under row-level security, in a real Postgres (PGlite) with every existing migration.
- Presence sealed with the note key: the toolbar avatars, the typing pencil, "Sara is editing", carets with name flags.
- The people sheet invite (lookup by email, safety code) and the invitation alert with the safety code.
- Swift opens a wrap and a change made by the server's TypeScript (`CollabCryptoTests`), and a refused fake wrap.

What stands in or is missing:

- The backend is `scripts/collab-relay.ts`, a local stand-in for PostgREST and Realtime (Docker wasn't usable). The caller is named by a header, not a signed JWT.
- Accounts are made by the relay; there's no sign-in. The data key is made at launch, not taken from `AccountCrypto`.
- The typing is scripted inside the app through the text view's own input path (`insertText`, and Return through the editor's delegate so lists continue). No input events are posted and nothing drives the simulators from outside.
- Nothing persists: no SwiftData storage of the document, no offline queue, no compaction beyond the first snapshot, no version history for shared notes, no removal UI, no join links in the app (the server side of both is tested).
- The Mac app compiles with all of it but doesn't draw other people's carets.
- No AI path: the MCP server doesn't read shared notes yet. `@automerge/automerge` 3.5 was checked to run under Deno; not inside an edge function.

## Plan and effort

In agent hours, building on the prototype:

| Step | Hours |
|---|---|
| Identity keys from `AccountCrypto` (publish on startup, unwrap on new devices), key change warnings | 4 to 5 |
| Shared notes in the library: the `notes` pointer, "Shared with me", accept and decline, push for invites | 6 to 8 |
| Document storage and sync: SwiftData persistence, offline queue, catch-up by cursor, snapshots and compaction, migrating a note into a document on share | 10 to 12 |
| Editor: Mac carets and selections, per-user undo, IME and dictation cases, Automerge cursors | 6 to 8 |
| Presence on Realtime private channels with RLS; people sheet polish; avatars with photos | 4 to 5 |
| MCP server: read and write shared notes through `self_wrap`, Automerge in the edge function, attribution in tints and history | 7 to 9 |
| Note pages in shared notes | 3 to 4 |
| Remove, leave, rotation, roles UI; join links with the web page and universal link | 6 to 8 |
| Version history for shared notes | 4 to 5 |
| Tests (offscreen editor harness for concurrent typing, PGlite, e2e on the local stack), privacy policy and security review | 6 to 8 |
| **Total** | **56 to 72** |

## Risks

1. **Automerge in Supabase edge functions.** WebAssembly size and cold start in the MCP function. Mitigation: prove it first; the fallback is a separate function for shared notes.
2. **Editor fidelity.** The editor does its own list and table edits; each must become a splice of what changed, never a whole-body replace. The minimal diff does this today, but tables and checklist sorting make bigger edits that merge less gracefully with someone typing in the same table.
3. **Document growth.** Long-lived busy notes grow history. Snapshots with compaction keep the server small; device copies need the same.
4. **Server key substitution.** Mitigated, not removed, by safety codes and key change warnings.
5. **The AI exposure.** The server decrypts a shared note during a member's AI request. Same as today for your own notes, but now it's other people's text too; the policy and the sharing sheet have to say it.
6. **Removal can't unsee.** Anyone removed keeps what they already had. Normal for every product, worth saying in the confirmation.
7. **Two sync engines.** Shared notes go through the document path, the rest through today's engine. Keeping one note in exactly one of them (the pointer row) is the thing to get right.

## Open questions for Emil

1. Is per-note sharing enough for the first version, or do colleagues need a shared folder from day one?
2. Should invites go only to people with an Amber Notes account, or also send an email to someone without one?
3. Do you want join links in the first version, given that anyone holding the link becomes a member?
4. Who can invite: only the owner (the prototype), or every editor?
5. Does a shared note keep its place in the owner's folders and land in "Shared with me" for others, or should there be one "Shared" folder for everyone?
6. Free or paid? Collaboration is the clearest reason for a team plan, which runs against "no enterprise work this year"; a two-person share could stay free.
7. Is it fine that a member's AI request lets the server see the shared note during that request, as it does for your own notes now?
