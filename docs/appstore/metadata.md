# App Store metadata: Amber Notes (iOS 1.0)

Copy each field into App Store Connect → Amber Notes: Notes & Lists (app id 6817253103).
Character counts are checked by `scripts/check-metadata.py`.

## App Information

| Field | Value |
|---|---|
| Name | Amber Notes: Notes & Lists |
| Subtitle | Simple notes your AI can use |
| Primary category | Productivity |
| Secondary category | Utilities |
| Content rights | Does not contain, show or access third-party content |
| Privacy Policy URL | https://amber-notes.vercel.app/privacy |

The name under the icon on the home screen stays "Amber Notes".

## Version 1.0 page

**Promotional text** (can change any time without review):

```
Quick notes, checklists and tables that sync between your iPhone and Mac in about a second. Connect ChatGPT or Claude and let them read and update your notes.
```

**Description:**

```
Amber Notes is a calm place for everything you write down: ideas, lists, plans and trips. It feels like the notes app you already know, with a few things it always missed.

WRITE THE WAY YOU THINK
• Checklists that sink ticked items to the bottom
• Bulleted, dashed and numbered lists
• Headings, bold, italic, underline and quotes
• Real tables you edit cell by cell
• Images, PDFs and files right inside a note
• Sub-notes: link a note inside another and keep the details one tap away

ALWAYS IN SYNC
Your notes live in the cloud and update across your iPhone and Mac while you type. Start a list on your phone, finish it on your Mac.

YOUR AI, YOUR NOTES
Connect an AI assistant such as ChatGPT or Claude from Settings. You approve each connection in the app, choose read only or read and edit, and can disconnect it at any time. Every change an assistant makes keeps the previous version, so nothing is lost.

SHARE A NOTE AS A PAGE
Turn any note into a clean web page with a private link. Stop sharing whenever you like and the link stops working.

PRIVATE BY DESIGN
• Sign in with Apple, or with email
• No ads, no tracking, no analytics
• Delete your account and everything in it from Settings

Amber Notes is made by one person who wanted a simpler notes app. Feedback is always welcome at emil@norditech.se.
```

**Keywords** (no spaces after commas):

```
markdown,checklist,notepad,todo,list,journal,memo,writing,table,sync,ai,notebook,planner,outline
```

**Support URL:** https://amber-notes.vercel.app/support

**Marketing URL:** https://amber-notes.vercel.app

**Copyright:** 2026 Emil Wagman

**Version:** 1.0, build 2609291009 (select it under "Build").

## Screenshots

iPhone 6.5" slot (1284 × 2778), upload in this order from `.shots/appstore/6.5/`:

1. `light-2-lisbon.png`: a trip plan with checklist, sub-note and table
2. `light-1-list.png`: the note list
3. `light-3-groceries.png`: a checklist
4. `light-5-files.png`: files, images and links in a note
5. `dark-2-lisbon.png`: dark mode
6. `light-4-tracker.png` (optional: the table's last column is cut off at the edge)

The 6.9" set (1320 × 2868) is in `.shots/appstore/6.9/` if App Store Connect asks for it.
iPad 13" slot, from `.shots/appstore/ipad-13/` (2064 × 2752; a 2048 × 2732 copy of each is in
`ipad-13/2048x2732/` if the slot asks for that size), in this order:

1. `1-lisbon.png`: sidebar, list and note side by side
2. `2-groceries.png`
3. `3-files.png`
4. `5-lisbon-dark.png`
5. `4-tracker.png` (optional)

App icon: nothing to upload. The 1024 × 1024 App Store icon comes from the build
(AppIcon, opaque, no alpha channel), and App Store Connect shows it once the build is selected.

## Age rating (App Store Connect → App Information → Age Rating)

Answer **None** / **No** to every question, including:

- Violence, sexual content, profanity, horror, drugs, gambling, contests: **None**
- Unrestricted web access: **No** (links open in Safari; the app has no browser)
- User-generated content shared with other users in the app: **No** (nobody sees another person's notes in the app; shared notes are web pages with a report link)
- Messaging, advertising, in-app purchases: **No**

Expected result: **4+**.

## Pricing and availability

- Price: **Free** (USD 0)
- Availability: all countries and regions
- Distribution: App Store (public)

## App Review information

**Sign-in required:** Yes

- User name: `appreview@norditech.se`
- Password: in `.secrets/appreview.txt` (on the Mac; paste it into the form, never into chat)

**Contact:** Emil Wagman, emil@norditech.se, phone: (Emil's number, required by the form)

**Notes for the reviewer:**

```
Thanks for reviewing Amber Notes.

Sign in with the demo account above: the email and password fields are on the first screen, under Sign in with Apple. It already has notes in three folders (Personal, Work, Travel). Sign in with Apple also works and creates a new, empty account.

Things to try:
• Open "Lisbon in May": a checklist (tick an item and it moves down), a table you can edit cell by cell, and a sub-note ("Hotel booking").
• Create a note with the compose button, and try the checklist and table buttons above the keyboard.
• Share a note: open a note, tap ••• → Share → Share Link. The app warns first that the page is public. The page at amber-notes.vercel.app has a "Report this page" link; three reports from different people take a page down automatically, and the developer can take any page down by hand. Terms of use: amber-notes.vercel.app/terms.
• AI connections (optional): Settings → Connect an AI shows how to connect ChatGPT or Claude. Each connection needs approval inside the app. No AI connection is needed to use the app.
• Delete account: Settings → Account → Delete Account (at the bottom). It deletes the account and all its notes from the server.

The app has no in-app purchases, ads or tracking.
```

## EU Digital Services Act: trader status (Emil decides)

App Store Connect asks every developer distributing in the EU whether they're a **trader**
(Business → Agreements, or the prompt on the app's page).

- **Not a trader** fits a free app made by an individual, outside a trade or profession, with no
  payments, ads or commercial purpose. Then no address or phone number is shown on the App Store.
  Apple may still ask you to confirm.
- **Trader** is required if you make money from it (now or through it, e.g. promoting a business).
  Then your address, phone number and email are shown publicly on the product page in the EU.

If you answer "not a trader", the app stays available in the EU. If Amber Notes is ever run as part
of Norditech or Incredible, or becomes paid, switch to trader.

Clicks: App Store Connect → Business → (your account) → Digital Services Act → **Declare trader
status** → choose, then confirm.
