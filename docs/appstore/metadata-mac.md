# App Store metadata: Amber Notes for Mac

The Mac App Store page of the same app record as the iPhone app (app id 6817253103, platform
macOS). Name, subtitle, category, privacy policy, age rating, price and App Privacy are shared with
the iPhone app and set there (see [metadata.md](metadata.md)); this page is what's Mac-only.

`deno run -A scripts/asc.ts mac-store` writes everything below into App Store Connect: the macOS
version (at the `MARKETING_VERSION` in project.yml), its text, the screenshots and the App Review
details. It never submits. With a build number (`mac-store 2610021200`) it also selects that build.
Character counts are checked by `python3 scripts/check-metadata.py docs/appstore/metadata-mac.md`.

## Version page

**Promotional text** (can change any time without review):

```
Tell ChatGPT "add oat milk to my groceries" and it's in your notes a second later, on your Mac and iPhone. The simple notes app your AI can finally read and update.
```

**Description:**

```
The notes app your AI can actually use.

Amber Notes feels like the notes app you already know: folders, checklists, tables and photos, nothing to learn. The difference: ChatGPT and Claude can read and update your notes when you let them.

TELL YOUR AI, IT'S IN YOUR NOTES
• "Add oat milk to my groceries." It's on your Mac and iPhone a second later.
• "What did we decide about the Lisbon hotel?" Your AI reads the note and answers.
• "Turn this meeting into a checklist in Work." Done, on every device.
• Every line an AI changes is highlighted when it lands, with Undo right there.

BRING YOUR NOTES WITH YOU
• Import every note and folder from Apple Notes in one step. Nothing in Apple Notes changes.
• Import from Evernote, Google Keep, or Markdown and text files, with folders, checklists and attachments.
• Start from a template on ambernotes.app: trackers and plans your AI fills in.

AS SIMPLE AS YOUR NOTES APP
• Checklists that move ticked items to the bottom
• Headings, bullets, dashes, numbered lists and quotes
• Tables you edit cell by cell
• Photos, PDFs and files inside a note
• Sub-notes that keep details one click away

ON YOUR MAC AND IPHONE
Your notes live in the cloud, encrypted end to end on your devices. Changes show on your other devices in about a second, even while you type.

YOU DECIDE WHO GETS IN
• You approve every AI connection, read-only or read and edit
• Disconnect any AI at any time; every AI change keeps the previous version
• Share a note as a web page, and stop sharing whenever you like
• No ads, no tracking. Open source.

Sign in with Apple or email.
```

**Keywords** (the same as the iPhone app; no spaces after commas):

```
ai,chatgpt,claude,notepad,checklist,todo,list,markdown,memo,journal,sync,planner,writing,notebook
```

**Support URL:** https://ambernotes.app/support

**Marketing URL:** https://ambernotes.app

**Copyright:** 2026 Emil Wagman

**What's New:** none. The first macOS version has no What's New field.

## Screenshots

Mac slot, 2880 × 1800, in this order from `.shots/appstore/mac/`:

1. `1-ai-change.png`: ChatGPT's change to Groceries, highlighted, with Undo
2. `2-connect.png`: Connect an AI, with ChatGPT and Claude connected
3. `3-template.png`: "Use this template" with the site's habit tracker
4. `4-import.png`: Import from Apple Notes
5. `5-notes-dark.png`: a trip plan in dark mode, and the dot on a note an AI edited

They're the real app on the demo library, drawn in off-screen windows (nothing on the display):

```
scripts/store-art/capture-mac.sh            # windows → .shots/appstore/mac/captures
python3 scripts/store-art/render-mac.py     # captions and layout → .shots/appstore/mac
```

## App Review information

Contact, phone and demo account are copied from the iPhone version. `mac-store` puts the
recovery key from the iPhone version's notes where the line below says so; it isn't kept here.

**Notes for the reviewer:**

```
ABOUT THE APP

1. This is the Mac version of Amber Notes, the same app record and the same account as the iPhone app. It is sandboxed and opens straight to the notes after sign-in.

2. Purpose and audience: Amber Notes is a simple notes app for iPhone and Mac, made to feel like Apple Notes, for people who already use AI assistants such as ChatGPT or Claude. If the user chooses to connect an assistant, it can search, read and edit their notes; every change is shown with Undo and kept in the note's version history. Without any assistant it is a complete notes app: folders, pinned notes, checklists, tables, attachments and sync between iPhone and Mac.

3. Setup and access: sign in with the demo account (enter its email on the first screen, under Sign in with Apple, then its password). Notes are end-to-end encrypted with a key kept in the user's iCloud Keychain. Because this Mac has not seen the demo account before, the app asks for the account's recovery key once after sign-in: RECOVERY KEY: (from the iPhone version). The account has notes in the folders Personal, Work and Travel. No AI connection is needed to review the app.

4. Mac only: File > Import from Apple Notes asks macOS for permission to read Notes (the Apple Events entitlement, limited to com.apple.Notes), lists the notes, and copies the ones the user picks. It never changes or deletes anything in Apple Notes. "Also bring over pinned notes" is off by default and asks for Full Disk Access only when the user turns it on.

5. Connecting an AI (optional): an assistant connects through ambernotes.app; the request appears on the user's own iPhone or Mac, and the user approves it by typing the two-digit number the browser shows. Reviewers can approve on the web page with the recovery key above.

6. External services: Supabase (sign-in, encrypted database, file storage and server functions, hosted in Frankfurt, Germany), Sign in with Apple, Apple Push Notification service (only to tell the user's own devices that an AI asked to connect; the notification contains no note content), and Vercel (the ambernotes.app website and the read-only pages for notes a user chooses to share). The app contains no AI service and no analytics, ads or tracking SDKs.

User-generated content: notes are private and encrypted. A user can publish one note as a read-only web page (the Share button > Share Link); the app warns first that the page is public, the user can stop sharing at any time, and every shared page has a "Report this page" link (three reports take a page down automatically, and the developer can remove any page). There is no messaging, commenting or feed between users.

Account deletion: Settings > Account > Delete Account deletes the account and all its notes from the server, after a confirmation.

Export compliance: the app uses only encryption provided by Apple's operating system (CryptoKit), so it qualifies for the exemption.
```
