# Collaboration and sharing: notes edited together, read-only links, and templates

Status: design and prototype (branch `proto/collaboration`, 5 October 2026). Nothing here is live. The prototype runs iPhone simulators against a local stand-in for the backend.

Revised twice the same day after Emil's review. Sharing is one sheet: the people in the note first, one **Share Link** button, and one line, "People with the link: Can edit / Can view / Off". The link itself is never shown. Email invites are out of v1 (people who sign in with Apple often hide their address). Avatars are calm solid circles with no badges and no "is editing" label (you see people editing in the note). Remote carets use stable Automerge cursors. Nothing in the presence UI is see-through.

What Emil asked for (5 October 2026): colleagues editing the same note, including notes with pages, and seeing who is in the note with a little avatar; read-only links as today, now with the note's page on the web; and "Share as template" for notes with an app.

One Share sheet, built around one link per note:

| People with the link | What opening it does | Account | Encrypted end to end |
|---|---|---|---|
| **Can view** (the default) | A read-only page in the browser, the note's app included, read only; in Amber Notes if they have it | Not needed | Yes: the key is in the link's fragment |
| **Can edit** | The same page, plus "Edit in Amber Notes": opening it in the app adds them to the note as an editor, with their avatar in People | Needed to edit (they sign in if they must) | Yes: the fragment also carries the join secret; the server keeps a hash |
| **Share as Template…** (its own item in the sheet) | A public page anyone can start their own copy from | Not needed | No, on purpose: public, with no personal data |

The sheet, top to bottom (iPhone and Mac):

1. **People**: everyone in the note, with their avatar and "Owner", "Can edit" or "Can view". Remove is in the row's context menu (and a swipe on iPhone), never a visible button. Tapping someone shows their safety code ("Verify Sara") for whoever wants it.
2. **Share Link**: one button. On iPhone it opens the system share sheet, which already has Copy; on Mac, the share menu. No separate Copy and Send buttons, and the URL is never shown.
3. **People with the link: Can edit / Can view / Off.** Off replaces Stop Sharing: the link stops working at once. Turning it on again makes a new link.
4. **Share as Template…**, at the bottom, in the normal label colour.

There is no Reset Link in the UI. Removing someone quietly makes a new note key and a new link (the old link would let them back in). If a link goes further than meant, Off and then on again gives a new link; anyone who already joined through it is listed in People and can be removed. Explanatory text: none, beyond the labels.

## The short version

- **Keys.** Every account gets an identity key pair (P-256). The private half is sealed under the account's data key and kept on the server, so any device that can open the notes can share. A note set to Edit gets its own random note key. Joining through the link opens that key and seals it to your own identity and data keys. The server never holds a key that opens anything.
- **Proving who sent the key.** The wrap mixes in the sender's identity key, so a server can't slip someone a key of its own. People can compare a 12-digit safety code if they want to be sure the server gave them each other's real keys.
- **Editing at the same time.** The note's text becomes an Automerge document (a text CRDT). Each keystroke burst is a small change, sealed with the note key, stored and relayed by the server, merged on each device. Devices write sealed snapshots now and then and the server drops the changes they cover.
- **Presence.** A private Realtime channel per note carries who's here and where their caret is (as an Automerge cursor, so it lands on the same character on every device), sealed with the note key. Calm, solid avatars sit in the note's toolbar; other people's carets show in the text with a small solid name flag that avoids covering text and fades. No badges, no "is editing" label: you see people edit in the note.
- **AI.** Your AI connection already opens your data key; through it, it opens the note keys you hold. It reads and writes the shared note like your device does. Its edits are marked as yours and its own, so the note says "Sara's Claude".
- **Permissions.** Owner, can edit, can view. Per note first; folders later.
- **Read-only links** become sealed links: `ambernotes.app/s/<id>#<secret>`. The device seals the note, its page and the page's data under a key from the secret; the browser opens it. Today's readable links keep working until their owner stops or switches them.
- **Pages on the web** run only on a separate user-content domain, in a sandboxed frame with no network, no storage and a bridge that refuses every write.
- **Share as template** publishes a readable copy at `ambernotes.app/t/<id>`: the note's skeleton, its app, sample rows if you choose, and the names of the keys its app asks for. "Use template" opens the app and makes a fresh copy.
- **Recommendation:** build it this way. About 76 to 98 agent hours for all of it, in the order under Plan.

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

### Sharing with a link (View or Edit)

Email invites were the first design and are out of v1: someone who signs in with Apple usually has a private relay address, so an email lookup can't find them. A link always reaches them, through whatever app the person sends it with.

`https://ambernotes.app/s/<id>#<secret>`, one per note. The secret is in the fragment, which browsers never send to a server. From it come (HKDF-SHA256, salt `amber-notes/e2ee`):

- `share <id>`: the key the read-only copy is sealed under (section 6). The link always works this way, View or Edit.
- `invite answer <id>`: what proves you hold the link. The server keeps only its SHA-256 (`note_invite_links.answer_hash`).
- `invite key <id>`: the key the note key is sealed under for whoever joins (`note_invite_links.key_wrap`, an `amb2` box with context `invite:<id>`).

Switching the link to **Edit** turns the note into a shared note (its own key, `collab_share`) and publishes the join row (`collab_create_link`). Switching back to **View** deletes the join row (`collab_stop_link`): the link opens the read-only page again, and people already in the note stay until removed.

Opening an Edit link in Amber Notes (the "Edit in Amber Notes" button on the page, or the universal link): the app proves the answer (`collab_open_link`), gets the sealed note key, opens it, seals it to its own identity key and data key, and joins as an editor (`collab_join_link`). It then appears in the owner's People with its avatar. Someone without the app gets the read-only page and the App Store; someone without an account signs in first.

A link makes a member of whoever holds it, as "anyone with the link" does everywhere; the sheet says so, People shows who joined, and Remove takes them out.

### Verifying it's really them

The weak point of any server-run key directory is that the server could hand out its own public key for someone and read what's shared. Two defenses:

- **Safety code.** On a person's row in People ("Verify Sara"), out of the main flow, a 12-digit code made from both public keys. Read it out in person or on a call; if it matches, the server gave each of you the other's real key. This is optional, like Signal's safety numbers. Most people won't, and that's fine for a notes app.
- **Key change warnings.** The app remembers each person's public key the first time it sees it (trust on first use). Since identity keys never change except through Start fresh, a different key for the same person is shown plainly: "Sara's key changed. If she didn't start fresh, don't share with her until you've checked the code."

Key transparency (a public log of identity keys) would close the gap entirely. It is not worth it before there are users who need it.

### Removing someone, and leaving

Removing a member makes a new note key and a new link, silently. The old link would let a removed person straight back in, so it always goes with the key. Removing: the owner's device makes NK', seals it to every remaining member, and sends all wraps in one call (`collab_remove`, which refuses an incomplete set). The epoch goes up. From then on:

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

A Realtime private channel `note:<id>` per open note, with RLS on `realtime.messages` so only members can join (the policies are in the migration). Each device tracks a sealed presence payload: `{name, caret, end, typing}`, re-sent when the caret moves, with each keystroke, and every 2 seconds. Leaving the note, backgrounding the app or losing the connection drops it. Someone who isn't editing (the keyboard is down) sends no caret.

**No caret animation.** A remote caret is tied to a character, so it never glides: it jumps to its new place in the same pass that changes the text, and its name flag moves with it (only the flag's fade after they stop is animated). The session hands carets straight to the text view right after each change that moves them: their text arriving, your typing, their presence. They don't wait for SwiftUI's next update, so no frame shows new text with an old caret. Checked frame by frame on the recording.

**Where a caret is.** `caret` and `end` are anchors, not offsets: the Automerge cursor (its bytes in hex) of the character just after the insertion point, or, at the very end of the note, of the last character with `after: true`. The receiver resolves them against its own merged text every time that text changes, so the caret sits exactly where the other person's insertion point is, after merges, at line ends, in lists and tables, and next to emoji and CJK (Automerge counts in UTF-16 here, as the editor does). A caret whose character hasn't arrived yet (presence travels faster than changes) keeps its last place until it does. While someone types, their caret is taken from the edit itself (right after what they typed), not from the text view, whose selection can trail a keystroke. `CollabCursorTests` round-trips cursors through concurrent edits, emoji, CJK, a table cell, a deleted character and the end of the note.

`automerge-swift` 0.7.2 has no public way to rebuild a cursor from its bytes, so the prototype vendors it (`Vendor/automerge-swift`, one initializer added, the released XCFramework unchanged); it's a small upstream pull request. Building it also showed a real bug for later: applying a saved document to an empty `Document(textEncoding: .utf16)` swaps in one that counts Unicode scalars, which puts every later splice next to an emoji in the wrong place. Documents now take a snapshot by merging (`CollabSession.absorb`), and a test pins it.

Where it shows:

- **Toolbar avatars.** iPhone: in the navigation bar, left of the More button. Mac: next to Share. Solid 28 pt circles: the person's photo when they have one, otherwise white initials on their colour. Each has a 2 pt opaque border, pure white in light mode and the toolbar's own dark colour in dark mode (#191919 on iPhone, #272524 on the Mac, measured on screen), and each avatar's border cuts cleanly over the previous one. They overlap gently (about a fifth of a circle), at most three and then a solid "+2". No badge and no transparency. The stack is flattened into one picture before the toolbar's glass draws it (`drawingGroup`): otherwise the glass blends every circle with what's behind it, and the white cut between two avatars showed a tint of the one underneath (seen zoomed at 3x). Measured after the fix: the border is 6 px of #FFFFFF (or #191919) at 3x and the avatar colours land exactly as defined. Tapping opens Share. With nobody else here the button is a plain "person.2" glyph. VoiceOver reads "In this note: Sara Lind". A single avatar in a list row has no ring.
- **Carets.** A 2 pt bar in the person's colour, exactly the line's height, and their selection tinted with a solid colour (their colour mixed 20% into the page, drawn behind the text). Their first name sits on a small solid flag above the line only when the line above is empty (or it's the first line), otherwise below it; it shows while they type or just after their caret moves and fades about 2.5 seconds later. Not hit-testable; you type through them.
- **A badge on the avatar.** A lone photo in the toolbar read like your own profile, so a co-editor's avatar carries a small pencil whenever they're in the note (option B of three rendered; A, pencil only while typing, left a lone avatar bare whenever they paused, and C, a live dot plus the pencil, added a second symbol and was the busiest stack). After Emil's review the pencil is the heavy weight at about 60% of its badge, so it reads at real size. The badge is smaller (the circle is 36% of the avatar), in the person's own colour with a white pencil, never black, and on the lower-right edge of its own circle along the 45° diagonal, its centre on the edge so about half of it sits over the circle. It's drawn on a layer above all the circles, and in a stack the next avatar starts where the badge ends, so a badge never reads as the next person's. The cost is that a stack sits side by side with a small gap instead of overlapping. A white badge with a pencil in their colour was also rendered; it vanishes against a white toolbar in light mode. `PencilStyle` and `BadgeOption` keep the alternatives for comparison (`-pencilStyle white`, `-badgeOption A|C`).
- **Photos.** Where a photo comes from in v1: Amber Notes accounts sign in with Apple or email, and neither gives a photo (Apple shares a name at most). The profile already supports one: `profiles.avatar_path` in the public `avatars` bucket under a random name, set in Settings › account with "Choose Photo…" (`ProfileStore.setPhoto`, already built), and `collab_members` returns it. For v1 that row stays where it is; the only addition is pointing to it when someone without a photo first shares a note. If Google sign-in is ever added, its picture URL becomes the default photo. The prototype shows Emil's real photo (the one in his emails) on his avatar in People and in Sara's toolbar; Sara has none and shows initials.
- **Colours.** Six muted, earthy colours that sit beside the amber brand without competing: clay #A85A3C, sage #5E7A5A, dusk blue #4F6B87, plum #7E5878, teal #3F7774, olive #7A6F3A. Picked from the user id, the same on every device; white initials reach at least 4.7:1 on each. Amber is you (with dark brown initials) and AI edits.
- **People, in Share.** Everyone in the note with role and state (Here now, Editing now, Not here), your own row in amber, Remove on each other row, and their safety code behind the row.

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

## 6. Read-only links

### How sharing works today

`Share link` on a note publishes a readable copy: the device sends `{title, body, pages, files}` with `share_note` / `publish_share`, two seconds after each change, into `note_shares`, `note_share_pages` and `note_share_files`. The site (`/n/<slug>`) reads it through the public `shared_note()` function and renders it on the server. A share counts only when its tag (an HMAC under the data key) verifies, so only the owner's devices can publish. Stop Sharing, locking, trashing, deleting, moving a sub-note away, three reports or a takedown delete the copies at once; the page is rendered on every visit, so it goes down at once too.

So today the server can read every shared note. That was the deliberate exception in the E2EE design ("a shared page shows a readable copy the device publishes"). A note's page isn't part of it.

### Sealed links

`https://ambernotes.app/s/<id>#<secret>`. The id is 16 random bytes and the secret another 16, both base64url, so the link stays about 70 characters.

- The device seals `{title, body, page, data, shared_by, updated_at}` as `amb3r.<b64 nonce ‖ ct ‖ tag>`: AES-256-GCM under HKDF-SHA256(secret, salt `amber-notes/e2ee`, info `share <id>`), AAD `amb3r|<id>` (`web/lib/sealed-share.ts`, `Pane/Collab/ShareLinks.swift`).
- `publish_sealed_link(id, note, ct)` stores it in `sealed_links`; editing the note republishes under the same id and secret, as today's links follow edits. The secret is kept in a synced Keychain item so every one of your devices can republish.
- The site's server fetches only the sealed copy (`sealed_link(id)`) and sends it with the page. The browser takes the secret from `location.hash` (never sent to any server), opens the copy with WebCrypto and renders it with the same renderer and layout as `/n` pages.
- Stop Sharing deletes the row: the next visit shows "This note isn't shared anymore". **Make a new link** (rotation) seals under a new id and secret; `publish_sealed_link` deletes the old row in the same statement, so the old address stops at once. Lock, trash and delete stop it as they stop today's links.
- Files in the note go up sealed under the same link key, one object each, and the browser fetches and opens them.

What changes compared with today:

| | Today (`/n/<slug>`) | Sealed (`/s/<id>#<secret>`) |
|---|---|---|
| Server can read the copy | Yes | No |
| Link previews (iMessage, Slack) | Title and first line | "A shared note · Amber Notes" only. An owner could choose to publish the title openly; not in v1 |
| Reports and takedowns | We read the copy and act | A report can include the full link (the reporter has it), so we can read that one copy; without it we can only take the link down blind |
| "Use this note" | Server hands the copy to the app | The page passes the secret to the app in the fragment of `ambernotes://copy-sealed/<id>#<secret>`; the app fetches and opens the copy itself |
| The note's page | Not shown | Shown, read only, on the user-content domain |
| Search engines | Not indexed (noindex) | Not indexed, and nothing to index |

### Moving existing links (expand, coexist, contract)

Links already sent must keep working; a sealed link can't take over an old address, because the key has to be in the link.

1. **Expand.** Ship `sealed_links`, the `/s` route and the user-content domain. Apps that know them make sealed links for every new share. `/n` keeps serving.
2. **Coexist.** A note with an old link says, in its share sheet: "This link shows a copy our server can read. Switch to an encrypted link?" Switching makes a sealed link and stops the old one, and says the old link stops working and to send the new one. Nothing switches by itself. Older apps keep publishing `/n` copies; the server keeps accepting them.
3. **Contract.** Once no supported app version makes `/n` links, `share_note` refuses new ones. Live `/n` links keep working until their owners stop or switch them. Ending them entirely is a separate decision with notice in the app, and not needed.

### Pages on the web

**No double titles.** When a note has an app, the app shows the note's title itself, so the page doesn't: the header becomes one quiet line under the Amber Notes mark, "Shared by Emil Wagman · Edited 5 October 2026", then the app. A note without an app keeps its title and byline. The same rule holds on the template page. (Apps showing the note's title, and `check_app` checking it, is the note-pages side.)

A note's page is someone's HTML and JavaScript. It never runs on ambernotes.app:

- **Its own domain.** `ambernotes-usercontent.app` (a separate registrable domain, so no cookie or storage can ever be shared with the site) serves one file: the frame (`usercontent/frame.html`), with `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors https://ambernotes.app`.
- **Sandboxed.** The site embeds it as `<iframe sandbox="allow-scripts">`: an opaque origin, no storage, no popups, no forms, no navigating the site. The site's own CSP allows frames only from that domain (`frame-src`, on `/s` and `/t` only).
- **No network.** The frame's CSP blocks every request, the same rules the app's page sandbox uses.
- **Read only.** The site posts the page and the note's data to the frame once. The frame puts a bridge in front of the page: `amber.note` (the same shape the app gives it), `amber.onChange` (called once), and `amber.update`, `amber.store.set` and `amber.files.add` all answer "This is a read-only copy." The page's stored data is a snapshot from when the copy was made. The only thing the frame can say back is its height.
- **Device abilities** (calendar, contacts, location) don't exist on the web; a page that asks gets nothing. What the page showed from them on the owner's device is in the copy only if the page saved it into the note.

The same frame serves today's `/n` links once their copies include the page (`note_share_pages` would get a sealed or readable page column like the note text).

## 7. Share as template

"Share as template" on a note with an app makes `https://ambernotes.app/t/<id>`, a public page that lets anyone start their own copy.

**What goes in** (`SharedTemplate` in `Pane/Collab/ShareLinks.swift`):

- the note's skeleton: its text with every table's rows taken out and checklists unticked;
- the page (the app), and its widget spec if it has one;
- the data layout: each table's columns;
- the keys and hosts the page declares it needs, by name and host only (`<meta name="amber-needs" …>` in the page, or the widget spec). `publish_template` refuses a key entry with anything besides a name and a host.

Never: other notes, the page's stored data, files, key values, the owner's email or account id. The maker's name is shown as they choose.

**Never the sharer's rows.** A template is the note's structure and its app, starting empty. There is no option to include data: the rows in someone's note are theirs, and `publish_template` refuses a template that carries any (`sample`). The template page shows the app in its empty state (the habit tracker reads "0 of 4 done today", "Start today"). An app could later declare a few neutral example rows of its own for the preview; not built.

**The sheet** (Share › Share as Template…, iPhone and Mac) is three things: a small preview of the card as people will see it (who shared it, the title, the headings and columns, "With its app"), one line, "Your notes and data aren't included.", and one button, "Share Template Link" (the system share sheet on iPhone; on the Mac it copies the link and says "Link Copied"). Once shared, a quiet "Stop Sharing Template" appears. What the app needs (keys, hosts) is said on the template page, not in the sheet.

**Why it isn't sealed.** A template is meant to be public, and sealing it would cost link previews for nothing. It's stored readable in `shared_templates` and reachable only by its id.

**The page** (`web/app/t/[id]`) reads as something a person shared, never as part of our Templates gallery: the same quiet page as a shared note (`/n`, `/s`), outside the site's header and navigation, with the Amber Notes mark in its bar. Then "Shared by Emil Wagman", one "Use template" button with one short line beside it, "Adds your own copy to Amber Notes. Download", then the app, live and read only on the user-content domain (or, without an app, the note's title and text), and, when keys are needed, one line such as "Needs a Strava access token, which you add yourself." The footer has "Report this template", which emails hello@ambernotes.app with the template's id and link.

It is kept out of sight, checked on the built site:

- `<meta name="robots" content="noindex, nofollow">` on the page (and on `/open/shared-template/<id>`);
- `X-Robots-Tag: noindex, nofollow` in the response (the site's catch-all header rule; `/t` isn't on its list of indexable paths);
- not in `sitemap.xml` (the sitemap lists only fixed pages and the gallery's own templates);
- not linked from any page of ours (no `/t/` link in the app source or the built pages).

Still to do: a screenshot fallback (the app already takes a snapshot of each page, `NotePageSnapshots` on the note-pages branch; it would go up with the template and show while the live preview loads, and in link previews).

**Use template.** The button goes to `/open/shared-template/<id>`, the universal link (as `/open/template/<slug>` works for the gallery today), which opens `ambernotes://shared-template/<id>`. The app fetches the template, adds a fresh note with the sample (or the skeleton) and the page, and opens it. The new page starts with no network; any hosts and keys it declared wait for the new owner to allow them and type their own keys.

**Stop sharing** deletes the row: the page and the Use template link both say the template isn't shared anymore. Copies people already made are theirs. Sharing again republishes under the same id (the latest note and page); a new id is only made after stopping.

**Reports and takedowns.** "Report this template" emails us the id. Taking one down, with the service role (in the product: the SQL editor, or `psql` with the database URL):

```sql
select public.takedown_template('<template id>', 'reported: <why>');
```

It deletes the template at once (the page and its Use template link say it isn't shared anymore) and records the note in `template_takedowns`, so `publish_template` refuses to share it again under any id. Owners can't call it. Tested in `collab.pglite.test.ts`; the sharing demo takes one down at the end (`/dev/takedown` on the relay stands in for the service role). The page's code runs only in the sandboxed frame.

**A gallery of people's templates (later idea, not built).** Shared templates stay link-only: nothing anyone shares appears on our site by itself. If a community gallery is ever wanted, every template in it goes through review before it's listed, because whatever is there appears under our name.

## Data model

`supabase/migrations/20261005160000_collaboration.sql` (prototype, tested in `supabase/functions/mcp/collab.pglite.test.ts`):

- `identity_keys`: public key, sealed private key.
- `shared_notes`: owner, epoch, sealed head and page.
- `note_members`: role, epoch, `key_wrap`, `wrapped_by`, `self_wrap`, invited by, accepted.
- `note_updates`, `note_snapshots`: sealed changes and snapshots, refused for stale epochs and for viewers; a snapshot drops the changes it covers.
- `note_invite_links`: the Edit side of a note's link (the same id as its sealed link), with the hashed answer and NK sealed under the link's key.
- Functions: `collab_publish_identity`, `collab_find_person`, `collab_members`, `collab_share`, `collab_invite` (kept for a later email invite), `collab_accept`, `collab_remove` (with no one removed it only renews the key), `collab_create_link`, `collab_stop_link`, `collab_open_link`, `collab_join_link`, `collab_role`.
- Realtime: `note_updates` and `note_members` published; RLS policies for the private `note:<id>` channels.

`supabase/migrations/20261005170000_sealed_links_and_templates.sql` (same tests):

- `sealed_links`: the sealed copy per note; `publish_sealed_link` (also rotation), `stop_sealed_link`, and the public `sealed_link(id)`.
- `shared_templates`: the template JSON per note; `publish_template` (refuses key values), `stop_template`, and the public `shared_template(id)`.
- `template_takedowns` and `takedown_template(id, reason)` (service role only): our side of a report.

## The prototype

`proto/collaboration`. Run collaboration with `scripts/collab-demo.sh` and sharing with `scripts/share-demo.sh` (it needs the site built; see the script).

What is real:

- The Share sheet (iPhone and Mac, light and dark): People with Remove (context menu, swipe) and Verify, one Share Link button, "People with the link: Can edit / Can view / Off", Share as Template. Measured at real size: avatars 28 pt in the toolbar (84 px on a 3x iPhone, 56 px on a 2x Mac), rings 1.5 pt, row avatars 32 pt.
- The Edit-link round trip: Emil sets the link to Edit; Sara's app opens the link, proves the answer, opens the note key with the link's key, seals it to herself and joins; she appears in Emil's People with her avatar, and they type together. The same link in a browser shows the read-only page with "Edit in Amber Notes".
- The identity keys, the sender proof on every note-key wrap, `self_wrap`, and a new key on Remove (server side tested; owner and member re-keying wired in the app, not recorded). Off is in the recording: the old link then says the note isn't shared anymore.
- Automerge documents on both phones; every change sealed with the note key, sent, stored, relayed and merged; the first snapshot sealed by the owner.
- The schema and its rules, under row-level security, in a real Postgres (PGlite) with every existing migration.
- Presence sealed with the note key: solid toolbar avatars, carets on Automerge cursors with solid name flags that avoid text and fade. A caret can trail by one keystroke for the moment between someone's presence and their change arriving (tens of milliseconds); it settles as the change lands.
- Swift opens a wrap and a change made by the server's TypeScript (`CollabCryptoTests`), and a refused fake wrap.
- Sharing, on one iPhone simulator against the same relay and the real site (`next build`, then `next start`): the app seals a habit tracker with its page into a sealed link and publishes it as a template. Safari on the phone opens the sealed link (the note and its app, live and read only, from the user-content port), then the template page and its live preview. The app is handed the template id and adds a fresh copy, as Use template's link does. Stop Sharing, and the old link says the note isn't shared anymore.
- The server side of rotation and of refusing key values is tested (`collab.pglite.test.ts`).

What stands in or is missing:

- The backend is `scripts/collab-relay.ts`, a local stand-in for PostgREST and Realtime (Docker wasn't usable). The caller is named by a header, not a signed JWT.
- Accounts are made by the relay; there's no sign-in. The data key is made at launch, not taken from `AccountCrypto`.
- The typing is scripted inside the app through the text view's own input path (`insertText`, and Return through the editor's delegate so lists continue). No input events are posted and nothing drives the simulators from outside.
- Sara gets Emil's link through a file the script puts in her app's container, standing in for a link sent in Messages (opening one from another app makes iOS ask "Open in Amber Notes?", which the script can't tap).
- Nothing persists: no SwiftData storage of the document, no offline queue, no compaction beyond the first snapshot and the re-key snapshot, no version history for shared notes. A View link opened in the app isn't handled yet (it says the link is view only; the product opens the read-only copy there too).
- The Mac app compiles with all of it but doesn't draw other people's carets.
- No AI path: the MCP server doesn't read shared notes yet. `@automerge/automerge` 3.5 was checked to run under Deno; not inside an edge function.
- Sharing: the user-content "domain" is the relay's second port; the site reads the relay instead of Supabase. The page HTML in the demo is the note-pages branch's habit tracker, copied; this branch doesn't render pages in the app, so the template's copy shows its text there. The `amber-needs` line in it is declared only to show the "What it needs" section. Use template's button would make iOS ask "Open in Amber Notes?"; the script can't tap that, so it brings the app forward and hands it the same id through a file. Files in sealed links, "Use this note" for sealed links, switching old links, the screenshot fallback and template link previews aren't built.

## Plan and effort

In agent hours, building on the prototype:

| Step | Hours |
|---|---|
| Identity keys from `AccountCrypto` (publish on startup, unwrap on new devices), key change warnings | 4 to 5 |
| Shared notes in the library: the `notes` pointer, "Shared with me", accept and decline, push for invites | 6 to 8 |
| Document storage and sync: SwiftData persistence, offline queue, catch-up by cursor, snapshots and compaction, migrating a note into a document on share | 10 to 12 |
| Editor: Mac carets and selections, per-user undo, IME and dictation cases (Automerge cursors done) | 5 to 7 |
| Presence on Realtime private channels with RLS; avatars with photos | 3 to 4 |
| The Share sheet: People, Share Link, Can edit / Can view / Off, Verify, Remove; View links in the app; upstreaming the cursor initializer | 5 to 6 |
| MCP server: read and write shared notes through `self_wrap`, Automerge in the edge function, attribution in tints and history | 7 to 9 |
| Note pages in shared notes | 3 to 4 |
| Leave, roles beyond editor, the universal link for joining | 3 to 4 |
| Version history for shared notes | 4 to 5 |
| Tests (offscreen editor harness for concurrent typing, PGlite, e2e on the local stack), privacy policy and security review | 6 to 8 |
| Sealed links: publish and republish from every device, the secret in a synced Keychain item, sealed files, the `/s` page, Use this note | 8 to 10 |
| The user-content domain and frame, pages on `/s` and `/n`, tests for the sandbox | 3 to 4 |
| Switching old links (share sheet copy, stopping the old one, server cutoff) | 2 to 3 |
| Share as template: the sheet, publishing, the `/t` page with screenshot fallback and link previews, Use template in the app, report and takedown | 8 to 10 |
| **Total** | **76 to 98** |

## Risks

1. **Automerge in Supabase edge functions.** WebAssembly size and cold start in the MCP function. Mitigation: prove it first; the fallback is a separate function for shared notes.
2. **Editor fidelity.** The editor does its own list and table edits; each must become a splice of what changed, never a whole-body replace. The minimal diff does this today, but tables and checklist sorting make bigger edits that merge less gracefully with someone typing in the same table.
3. **Document growth.** Long-lived busy notes grow history. Snapshots with compaction keep the server small; device copies need the same.
4. **Server key substitution.** Mitigated, not removed, by safety codes and key change warnings.
5. **The AI exposure.** The server decrypts a shared note during a member's AI request. Same as today for your own notes, but now it's other people's text too; the policy and the sharing sheet have to say it.
6. **Removal can't unsee.** Anyone removed keeps what they already had. Normal for every product, worth saying in the confirmation.
7. **Two sync engines.** Shared notes go through the document path, the rest through today's engine. Keeping one note in exactly one of them (the pointer row) is the thing to get right.
8. **Sealed links lose previews and easy moderation.** A pasted link shows no title, and a report needs the reporter's full link for us to see the note.
9. **Running other people's code on the web.** The frame's isolation is the whole defense; it needs its own security review, and the user-content domain must never serve anything else.

## Open questions for Emil

1. Is per-note sharing enough for the first version, or do colleagues need a shared folder from day one?
2. With Edit on, anyone holding the link becomes an editor. Is that the default you want, or should the owner approve each new person (a knock: "Sara wants to edit")?
3. Should editors be able to change the link (View/Edit, Reset) and remove people, or only the owner (the prototype)?
4. Email invites as a later convenience next to the link, or never?
5. Does a shared note keep its place in the owner's folders and land in "Shared with me" for others, or should there be one "Shared" folder for everyone?
6. Free or paid? Collaboration is the clearest reason for a team plan, which runs against "no enterprise work this year"; a two-person share could stay free.
7. Is it fine that a member's AI request lets the server see the shared note during that request, as it does for your own notes now?

Decided for v1 (5 October 2026, team lead, pending Emil's say):

- Sealed links show no title in link previews; the owner can't opt in to a public title yet.
- Old `/n` links are never switched automatically. The Share sheet offers "Switch to an encrypted link", and switching stops the old address.
- Shared templates stay link-only; none appear in the gallery for now.
