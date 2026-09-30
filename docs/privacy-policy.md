# Privacy Policy

Last updated: 30 September 2026

## The short version

- Your notes are yours. We store them so they sync between your iPhone and Mac, and for nothing else.
- No ads, no tracking and no third-party analytics, in the apps or on the website, and we never sell or share your data.
- We count how features are used on our own server to improve the app. We never share or sell it.
- An AI assistant can only read your notes if you connect it and approve it in Amber Notes or on ambernotes.app. You can disconnect it at any time.
- A note you lock is encrypted on your device before it's uploaded. Nobody but you can read it: not us, and not an AI.
- A note you share can be read by anyone with its link, until you stop sharing.
- Your data is stored in the European Union (Frankfurt, Germany).
- **Settings → Privacy & Security** lets you export all your data or delete your account and everything in it.
- We keep as few logs as we can, for as short a time as we can. The section on logs lists every one.

## Who we are

Amber Notes is made by Emil Wagman, an individual developer in Sweden. He is the controller of the personal data described here. Questions about privacy go to **emil@norditech.se**.

This policy covers the Amber Notes apps for iPhone and Mac, the service that lets AI assistants connect to your notes, and the website at ambernotes.app, including shared note pages.

## What we collect

**Your account**

- **Sign in with Apple:** Apple gives us an identifier for your account and an email address. If you choose Hide My Email, we only ever see Apple's relay address. We never see your Apple ID password.
- **Email and password:** your email address and a one-way hash of your password. We never store the password itself.
- **Sign-in records:** when you sign in, the sign-in service records the time, your email address and the IP address of the request, to keep your account secure. We delete these records after 30 days. While you're signed in on a device, that sign-in also keeps the IP address and device type from its last refresh, until you sign out or delete your account.

**Your profile, if you set one**

- The name and photo you choose in Settings. Photos are cropped, resized, and stripped of location and camera data on your device before they're uploaded.

**Your notes**

- Your notes, folders, checklists, tables, and the images and files you add.
- Earlier versions of each note, so a change can be undone: up to 100 per note. Each version records whether it came from the app, an AI connection, an import or a restore.

**Locked notes, if you lock any**

- A locked note's text is encrypted on your device with a key made from your notes password (AES-256-GCM, with the key derived by PBKDF2) before it's uploaded. We store that encrypted text and the note's title, which stays readable so your list can show it. Files and sub-notes can't be put in a locked note.
- To let your devices check the password, we store a random value (a salt), a small encrypted test value, and the password hint you write. We never receive or store the password or the key. On your device, the key can be kept in the Keychain so Face ID or Touch ID can unlock your notes; it never leaves the device.
- Locking a note deletes its earlier versions from our servers. While it's locked, earlier versions are kept only in encrypted form, and changing your notes password removes the versions encrypted with the old one.
- If you forget your notes password, we can't recover your locked notes.
- Once you have a notes password, older versions of the app can't sync until they're updated, so they can never upload a readable copy of a locked note.

**AI connections, if you make any**

- For each connection: its name, whether it may edit or only read, when it was created and last used, and its access token, stored only as a one-way hash.
- For connections made by signing in from ChatGPT or Claude, also the name and return address the assistant registers, and short-lived access and refresh tokens, stored as one-way hashes.

**Shared notes, if you share any**

- The link, which note it shows, and whether sub-notes are included, until you stop sharing.

**Reports about shared pages**

- If someone reports a shared page: the page's link, the reason they give, any contact details they choose to add, and a one-way hash of their network address made with a secret key that changes every month, so one person can't report a page many times. We don't store the address itself, and we blank the hash after 30 days.

**How the app is used**

We count how features are used on our own server to improve the app. We never share or sell it. That means:

- how many notes an AI connection changed on each day;
- which steps of the first-run setup you've completed;
- a random identifier for each installation of the app and its platform (iPhone or Mac), to count how many devices an account uses. It isn't linked to your device's hardware or advertising identifiers.

**What we don't collect**

- No advertising identifiers, no location, no contacts, and no third-party analytics or crash-reporting tools.
- The Apple Notes import runs on your Mac, and only the notes you choose are uploaded. If you turn on "Also bring over pinned notes", the app reads only which notes are pinned, from a temporary copy of the Notes database on your Mac, and deletes the copy straight after.

## Why we use it

We process personal data under the EU General Data Protection Regulation (GDPR) on these legal bases:

| What | Why | Legal basis |
|---|---|---|
| Account, profile, notes, files, versions, AI connections, share links | To provide the service: store, sync and show your notes | Performance of a contract |
| Sign-in records, rate limits, hashed network addresses, request logs | To keep the service secure and stop abuse | Legitimate interests |
| Reports about shared pages | To review and remove content that breaks our Terms | Legitimate interests, and legal obligations where they apply |
| Feature usage counts | To learn whether the app works for people and improve it | Legitimate interests |

We don't use your data for advertising, and we don't make automated decisions about you with legal or similarly significant effects.

## AI connections

Nothing reaches an AI assistant unless you connect one. When you connect ChatGPT, Claude, Claude Code, Codex or another assistant:

- You approve the connection in Amber Notes or on ambernotes.app and choose **read only** or **read and edit**.
- The assistant can then read the notes it asks for and, if you allowed editing, change them. Every change it makes keeps the previous version, so you can undo it.
- What you and the assistant exchange is handled by the company behind that assistant, under its own privacy policy. Notes it reads become part of your conversation with it.
- You can disconnect any assistant at any time in **Settings → Connect an AI**. It loses access immediately.
- Locked notes are encrypted, so an assistant sees only their titles. It can't read, search or change them.

## Shared notes

- A note you share becomes a web page at ambernotes.app. Anyone with the link can read it without signing in, and the link may be passed on.
- The page shows the note, your profile name and photo, and your email address unless it's an Apple relay address.
- Shared pages are hidden from search engines.
- **Stop Sharing** takes the page down at once. Images and files on a shared page are served through links that expire after an hour.
- Anyone can report a shared page. Reports are reviewed, and pages that break our Terms are removed.
- A locked note can't be shared. Locking a shared note stops its link.

## Where your data is stored

| Service | What it does for us | Where | Transfers outside the EU |
|---|---|---|---|
| Supabase (Supabase Pte. Ltd.) | Database, file storage, sign-in and server functions | Frankfurt, Germany (EU) | Standard Contractual Clauses, in its [data processing agreement](https://supabase.com/legal/dpa) ([sub-processors](https://supabase.com/legal/customer-resources/subprocessor-list)) |
| Vercel, Inc. | The website, shared note pages, the address AI apps connect to (mcp.ambernotes.app), Mac app downloads, update checks | Pages are built in Frankfurt, Germany (EU) and delivered through Vercel's global network | EU-U.S. Data Privacy Framework ([privacy policy](https://vercel.com/legal/privacy-policy), [sub-processors](https://vercel.com/legal/sub-processors)) |
| Apple | Sign in with Apple and the App Store, if you use them | Under Apple's own privacy policy | Apple's own terms |

Your notes and files are stored only at Supabase, in Frankfurt. Supabase processes them only on our instructions. Vercel handles requests to the website on their way through: it sees a shared note while it shows the page, and the requests AI apps send to mcp.ambernotes.app, but it doesn't store your notes. Either company's support staff could access data from outside the EU; those transfers are covered as the table says.

All data travels encrypted (HTTPS), and Supabase encrypts what it stores (AES-256). Each account can only read its own notes: the database enforces this on every request.

## Logs

We don't write the text of your notes, email addresses, access tokens or network addresses into any log of our own. When something fails on our server, the log says where and what kind of error, with names, addresses and ids blanked out.

Our hosting providers keep logs of the requests that reach them. We can't turn these off, but they're kept briefly:

| Log | What's in it | Kept for |
|---|---|---|
| Supabase request logs | For each request to our server: the time, the address it asked for, the IP address and device type it came from, and the approximate location the provider works out from the IP address | 1 day |
| Supabase sign-in logs | Each sign-in and sign-out: the time, the email address and the IP address | 1 day |
| Supabase server function and database logs | When each function ran and what it was asked for, and the errors described above | 1 day |
| Vercel request logs | For each request to the website: the time, the page, the IP address and device type, and whether it worked | 1 hour |
| Vercel performance charts | Counts and timings, without who asked | 12 hours |

Rate limits on sign-in and connection requests count a one-way hash of the IP address, made with a key that changes every day, and delete it after 2 hours.

## How long we keep it

- **Notes you delete** stay in Recently Deleted for 30 days, then they're deleted for good, together with their earlier versions and share links. This happens on our server even if you never open the app again.
- **Earlier versions** of a note: up to 100 per note, thinned out as they get older (all from the last day, one an hour for a week, one a day for 90 days, and every AI change for 90 days).
- **Files** you add stay until you delete them or your account.
- **Your account** is kept until you delete it. **Settings → Delete Account** removes your account, notes, files, profile photo, versions, AI connections, share links, notes password settings, usage counts, sign-in records and reports about your shared pages straight away.
- **Usage counts** (AI changes per day, days of use, tips, app installations): 12 months.
- **Sign-in records:** 30 days. **Rate-limit hashes:** 2 hours. **Unfinished AI sign-ins and expired access tokens:** a day after they expire.
- **Reports:** the reporter's hash is blanked after 30 days; a report is deleted 12 months after it was made, once it's been reviewed.
- **Logs** at our hosting providers: 1 hour to 1 day, as listed under Logs.
- **Backups:** our current hosting plan keeps no backups of the database, so what's deleted is gone.

## Your rights

Under the GDPR you can:

- **access** your data and get a copy of it;
- **correct** it (most of it you can edit directly in the app);
- **delete** it, in the app with **Delete Account** or by asking us;
- **take it with you:** **Settings → Privacy & Security → Export My Data** gives you a zip with every note as Markdown and everything else we keep about you as JSON. You can also ask us for it;
- **object** to processing based on legitimate interests, including the feature usage counts, or ask us to **restrict** it.

Write to **emil@norditech.se**. We answer within one month. If you think we've handled your data wrongly, you can complain to the Swedish Authority for Privacy Protection (Integritetsskyddsmyndigheten, IMY) at imy.se, or to the data protection authority where you live.

## Cookies and storage on the website

The website sets no cookies and uses no analytics or tracking scripts. Only the page where you approve an AI connection (ambernotes.app/connect) stores anything in your browser, and only what that page needs to work:

- **sessionStorage, `amber.connect.pkce`:** a one-time code for Sign in with Apple, kept while you go to Apple and back, and deleted as soon as you return.
- **localStorage, `amber.connect.app`:** set only if you choose to answer in the Amber Notes app from now on, so the page opens the app straight away next time. Clearing your browser's site data removes it.

Your sign-in on that page stays in the page's memory and is gone when you close it. Because these are strictly necessary for something you asked for, there's no cookie banner.

## Children

Amber Notes isn't directed at children under 13, or in the EU under the age your country sets for consenting to online services (up to 16). If you believe a child has given us personal data, write to us and we'll delete it.

## Security

We encrypt data in transit, store passwords and access tokens only as one-way hashes, limit each account to its own data at the database level, and rate-limit sign-in and connection endpoints. The code is open source, so anyone can check how it works. No system is perfectly secure. If something goes wrong that affects you, we'll tell you as the law requires.

## Changes to this policy

When this policy changes, the date at the top changes. If a change matters to you, we'll tell you in the app before it takes effect.

## Contact

Emil Wagman, Sweden · **emil@norditech.se**
