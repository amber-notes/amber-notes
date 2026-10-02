# Privacy Policy

Last updated: 2 October 2026

## The short version

- Your notes are yours. Your notes, their titles, folder names, file names and files, and earlier versions are encrypted on your iPhone or Mac with a key only your devices hold, before they're uploaded. We store the encrypted copies so they sync, and we can't read them.
- Some details stay readable to us, such as your email address, dates and sizes, and how your notes are organized. The section on end-to-end encryption lists all of them, and its limits.
- No ads, no tracking and no third-party analytics in the apps, and we never sell or share your data.
- The website counts page views and where visitors came from with Vercel Web Analytics, and which links and buttons are clicked, where on a page people click and how far pages are scrolled with PostHog, in the EU. These are counted across all visitors; no visit is recorded. Neither uses cookies, stores anything in your browser or keeps a profile of you, and neither runs on shared notes or the connect pages. It also counts Mac downloads as daily totals. None of this touches your notes or your computer.
- We count how features are used on our own server to improve the app. We never share or sell it.
- An AI assistant can only read your notes if you connect it and approve it on your iPhone or Mac, or with your recovery key on ambernotes.app. While it works, our server opens the notes it asks for in memory. You can disconnect it at any time.
- A note you lock is encrypted a second time with your notes password. Not us and not an AI can read its text.
- A note you share can be read by anyone with its link, until you stop sharing.
- Your data is stored in the European Union (Frankfurt, Germany).
- **Settings → Privacy & Security** lets you export your notes, and **Settings → Delete Account** deletes your account and everything in it.
- We keep as few logs as we can, for as short a time as we can. The section on logs lists every one.

## Who we are

Amber Notes is made by Emil Wagman, an individual developer in Sweden. He is the controller of the personal data described here. Questions about privacy go to **hello@ambernotes.app**.

This policy covers the Amber Notes apps for iPhone and Mac, the service that lets AI assistants connect to your notes, and the website at ambernotes.app, including shared note pages.

## What we collect

**Your account**

- **Sign in with Apple:** Apple gives us an identifier for your account and an email address. If you choose Hide My Email, we only ever see Apple's relay address. We never see your Apple ID password.
- **Email and password:** your email address and a one-way hash of your password. We never store the password itself.
- **Sign-in records:** when you sign in, the sign-in service records the time, your email address and the IP address of the request, to keep your account secure. We delete these records after 30 days. While you're signed in on a device, that sign-in also keeps the IP address and device type from its last refresh, until you sign out or delete your account.

**Your profile, if you set one**

- The name and photo you choose in Settings. Photos are cropped, resized, and stripped of location and camera data on your device before they're uploaded.

**Your notes, encrypted**

- Your notes, folders, checklists, tables, and the images and files you add, and earlier versions of each note, so a change can be undone: up to 100 per note. We receive them only encrypted (see End-to-end encryption below). Each version records whether it came from the app, an AI connection, an import or a restore.
- With each note, file and version we also store, readable: its size and dates, its folder, its parent note if it's a sub-note, whether it's pinned or locked, and which device or AI app wrote it.

**Your encryption key, locked**

- Your notes' key is made on your first device and kept in your iCloud Keychain. We never receive it in readable form.
- We store a short identifier of the key and a check value that lets your devices confirm they have the right key. Neither can be used to read your notes.
- Your recovery key is a key you save yourself. We store your notes' key locked with it, so a device can get your key with the recovery key. We never receive the recovery key.
- Each AI connection you approve gets a copy of your notes' key, locked with a key derived from that connection's access token, which we store only as a hash (see AI connections).

**Your devices**

- The devices signed in to your account, so they can approve AI connections and keep your key in step.

**Locked notes, if you lock any**

- A locked note's text is encrypted on your device with a key made from your notes password (AES-256-GCM, with the key derived by PBKDF2) before it's uploaded, and its title is encrypted with your notes' key like every other title. Files and sub-notes can't be put in a locked note.
- To let your devices check the password, we store a random value (a salt), a small encrypted test value, and the password hint you write. We never receive or store the password or the key. On your device, the key can be kept in the Keychain so Face ID or Touch ID can unlock your notes; it never leaves the device.
- Locking a note deletes its earlier versions from our servers. While it's locked, earlier versions are kept only in encrypted form, and changing your notes password removes the versions encrypted with the old one.
- If you forget your notes password, we can't recover your locked notes.
- Once you have a notes password, older versions of the app can't sync until they're updated, so they can never upload a readable copy of a locked note.

**AI connections, if you make any**

- For each connection: its name, whether it may edit or only read, when it was created and last used, its access token, stored only as a one-way hash, and its locked copy of your notes' key.
- For connections made by signing in from ChatGPT, Claude or another assistant, also the name and return address the assistant registers, and short-lived access and refresh tokens, stored as one-way hashes.
- While a connection is being approved from a browser: which account asked, when, a description of the browser (such as "Chrome on a Mac"), the browser's public key, and the approval sealed to that browser until it picks it up.

**Shared notes, if you share any**

- The link, which note it shows, whether sub-notes are included, and a readable copy of the note (with its included sub-notes and files) that your device publishes for the link. The copy is deleted when you stop sharing.

**Reports about shared pages**

- If someone reports a shared page: the page's link, the reason they give, any contact details they choose to add, and a one-way hash of their network address made with a secret key that changes every month, so one person can't report a page many times. We don't store the address itself, and we blank the hash after 30 days.

**How the app is used**

We count how features are used on our own server to improve the app. We never share or sell it. That means:

- how many notes an AI connection changed on each day;
- which steps of the first-run setup you've completed;
- a random identifier for each installation of the app and its platform (iPhone or Mac), to count how many devices an account uses. It isn't linked to your device's hardware or advertising identifiers.

**Visits to the website**

- **Page views,** with Vercel Web Analytics: which page was viewed, the site you came from, and your country, browser and type of device. It uses no cookies and stores nothing on your device, and it doesn't identify you or follow you to other sites. Vercel tells visits apart for a day with a hash it doesn't store. Shared notes, the connect pages and report pages are never counted, and page addresses are counted without anything after them, such as a code in a link.
- **Clicks and scrolling,** with PostHog, hosted in Frankfurt, Germany (EU): which pages were viewed, which links and buttons were clicked on them (such as Download for Mac, Use template, or a link to the App Store or GitHub), how far down each page you scrolled, the site you came from, and your browser and type of device. On the home, download, templates, blog, help, changelog and Privacy & Security pages it also notes where on the page each click landed, and clicks that did nothing or were repeated on one spot, so we can see which parts of a page people try to use. These are added up across all visitors into a map of each page; no visit is recorded or replayed. It uses no cookies and stores nothing on your device: each visit gets a random id that's gone when you leave or reload the page. It keeps no profile of you, records no screens or keystrokes, and is set not to keep your IP address. It never runs on shared notes, the connect pages, report pages or the links that open the app, page addresses are sent without anything after them, and it doesn't run at all if your browser sends Do Not Track or Global Privacy Control.
- **Mac downloads,** as one total per day: the date and a number. Nothing about who downloaded, not even a network address. Updates the Mac app installs itself aren't counted.
- None of this touches your notes or your computer, and none of it is linked to your account.

**What we don't collect**

- No advertising identifiers, no location, no contacts, and no third-party analytics or crash-reporting tools in the apps.
- We never receive your notes' key, your recovery key or your notes password in readable form, except that during an AI connection's requests our server unlocks your notes' key in memory (see AI connections).
- The Apple Notes import runs on your Mac, and only the notes you choose are uploaded. If you turn on "Also bring over pinned notes", the app reads only which notes are pinned, from a temporary copy of the Notes database on your Mac, and deletes the copy straight after.

## Why we use it

We process personal data under the EU General Data Protection Regulation (GDPR) on these legal bases:

| What | Why | Legal basis |
|---|---|---|
| Account, profile, encrypted notes, files and versions, devices, AI connections, share links | To provide the service: store and sync your notes, and answer the AI apps you connect | Performance of a contract |
| Sign-in records, rate limits, hashed network addresses, request logs | To keep the service secure and stop abuse | Legitimate interests |
| Reports about shared pages | To review and remove content that breaks our Terms | Legitimate interests, and legal obligations where they apply |
| Feature usage counts | To learn whether the app works for people and improve it | Legitimate interests |
| Website page views, clicks and scroll depth, and daily download totals | To learn how people find the website, which pages help, and how many download the app | Legitimate interests |

We don't use your data for advertising, and we don't make automated decisions about you with legal or similarly significant effects.

## End-to-end encryption

**What's encrypted.** Your notes, their titles and previews, folder names, file names and files, and every earlier version are encrypted on your iPhone or Mac (AES-256-GCM) with a key only your devices hold, before they're uploaded. iCloud Keychain, which Apple encrypts end to end, carries the key between your iPhone and Mac. Your recovery key is the fallback when a device can't get it from iCloud Keychain. We store only the encrypted copies, and we can't read them. Signing in, with Apple or a password, only identifies you; your password has nothing to do with the key.

**What stays readable to us:**

- your email address and sign-in records;
- your profile name and photo;
- your notes-password hint;
- the size and dates of each note, file and version;
- the folder and sub-note tree: which folder each note is in, and which notes are sub-notes of which;
- which notes are pinned, and which are locked;
- the names of the AI apps that edited a note;
- your list of devices;
- your AI connections;
- the usage counts described under How the app is used;
- a note you share, while it's shared.

**Limits.** End-to-end encryption doesn't cover everything, and we'd rather say so:

- **AI requests.** While an AI you connected works, our server unlocks your whole notes' key in memory and handles the text the AI asks for (see AI connections). A changed server could copy it.
- **The recovery key in the browser.** Approving on ambernotes.app with your recovery key runs our code in your browser. The page never stores the recovery key or your notes' key or sends them to us, but a changed page could read them. When you can, approve from your iPhone or Mac instead.
- **No key rotation yet.** Your notes' key stays the same for the life of your account.
- **The database.** Someone running the database can't read your notes, but could roll a note back to an earlier encrypted version, or hide notes from your devices.

## AI connections

Nothing reaches an AI assistant unless you connect one. When you connect ChatGPT, Claude, Claude Code, Codex or another assistant:

- You approve the connection on your iPhone or Mac and choose **read only** or **read and edit**. When you start from a browser, the page shows a number and your device asks you to tap the same one. With no device nearby, you can approve on ambernotes.app with your recovery key.
- Approving gives that connection a copy of your notes' key, locked with a key derived from that connection's access token. We keep only a hash of the token; the token itself arrives with each of the assistant's requests. During each request, our server unlocks your whole notes' key in memory, decrypts the notes the assistant asks for, encrypts any change it makes, and forgets the key when the request ends.
- For those requests, the text the assistant reads or writes, and its access tokens, pass through our hosting providers Vercel and Supabase in readable form on their way. Neither stores your notes.
- The assistant can read the notes it asks for and, if you allowed editing, change them. Every change it makes keeps the previous version, so you can undo it.
- What you and the assistant exchange is handled by the company behind that assistant, under its own privacy policy. Notes it reads become part of your conversation with it.
- You can disconnect any assistant at any time in **Settings → Connect an AI**. It loses access immediately, and its copy of your notes' key is deleted.
- Locked notes are encrypted with your notes password, which our server never has, so an assistant sees only their titles. It can't read, search or change them.

## Shared notes

- A note you share becomes a web page at ambernotes.app. Your device publishes a readable copy of it for the page, so the shared note isn't end-to-end encrypted while it's shared. Changes, including an AI's, show on the page after your device's next sync. Anyone with the link can read it without signing in, and the link may be passed on.
- The page shows the note, your profile name and photo, and your email address unless it's an Apple relay address.
- Shared pages are hidden from search engines.
- **Stop Sharing** takes the page down at once and deletes the readable copy. Images and files on a shared page are served through links that expire after an hour.
- Anyone can report a shared page. Reports are reviewed, and pages that break our Terms are removed.
- A locked note can't be shared. Locking a shared note stops its link.

## Where your data is stored

| Service | What it does for us | Where | Transfers outside the EU |
|---|---|---|---|
| Supabase (Supabase Pte. Ltd.) | Database, file storage, sign-in and server functions | Frankfurt, Germany (EU). A request to a server function enters Supabase's network at the location nearest its sender and is passed to Frankfurt, where it is handled | Standard Contractual Clauses, in its [data processing agreement](https://supabase.com/legal/dpa) ([sub-processors](https://supabase.com/legal/customer-resources/subprocessor-list)) |
| Vercel, Inc. | The website, shared note pages, the address AI apps connect to (mcp.ambernotes.app), Mac app downloads, update checks, website page view counts | Pages are built in Frankfurt, Germany (EU) and delivered through Vercel's global network | EU-U.S. Data Privacy Framework ([privacy policy](https://vercel.com/legal/privacy-policy), [sub-processors](https://vercel.com/legal/sub-processors)) |
| PostHog, Inc. | Website usage only: page views, clicks, where on a page people click, and scroll depth. Never on shared notes or the connect pages, and never in the apps | Frankfurt, Germany (EU) | Standard Contractual Clauses, in its [data processing agreement](https://posthog.com/dpa) ([sub-processors](https://posthog.com/subprocessors)) |
| Apple | Sign in with Apple and the App Store, if you use them | Under Apple's own privacy policy | Apple's own terms |
| Forward Email and Google (Gmail) | Email you send to hello@ambernotes.app: Forward Email passes it on, and it's read and kept in Gmail | United States | Under each company's own terms |

Your encrypted notes and files are stored only at Supabase, in Frankfurt. Supabase processes them only on our instructions. Our server functions do their work in Frankfurt too. A request to one enters Supabase's network at the location nearest whoever sent it, which can be outside the EU, and is passed to Frankfurt, where it is handled. If Frankfurt can't be reached, a request that only reads is answered where it arrived, and a request that changes something fails so it can be tried again. Vercel handles requests to the website on their way through: it sees a shared note while it shows the page, and the requests AI apps send to mcp.ambernotes.app, including the text of the notes they read or write, but it doesn't store your notes. Either company's support staff could access data from outside the EU; those transfers are covered as the table says.

On top of end-to-end encryption, all data travels encrypted (HTTPS), and Supabase encrypts its disks (AES-256). Each account can only reach its own data: the database enforces this on every request.

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
- **Website counts:** page view counts stay at Vercel, and clicks and scroll depth at PostHog, for as long as their plans keep them (at least a month). Daily download totals hold nothing about a person and are kept.
- **Your notes' key, locked:** the copy locked with your recovery key is kept until you delete your account or start fresh; each AI connection's copy is deleted when you disconnect it.
- **Browser approvals:** the approval sealed to a browser is kept until the browser picks it up, and the request expires after 10 minutes.
- **Backups:** our current hosting plan keeps no backups of the database, so what's deleted is gone. If that changes, a backup would hold only the encrypted copies and the locked copies of your key, for the period this policy states.

## Your rights

Under the GDPR you can:

- **access** your data and get a copy of it;
- **correct** it (most of it you can edit directly in the app);
- **delete** it, in the app with **Delete Account** or by asking us;
- **take it with you:** **Settings → Privacy & Security → Export Your Notes** makes a zip on your device with every note as Markdown in its folder, with its files. We can't read your notes, so only your device can export them. Ask us for everything else we keep about you, and we'll send it as JSON;
- **object** to processing based on legitimate interests, including the feature usage counts, or ask us to **restrict** it.

Write to **hello@ambernotes.app**. We answer within one month. If you think we've handled your data wrongly, you can complain to the Swedish Authority for Privacy Protection (Integritetsskyddsmyndigheten, IMY) at imy.se, or to the data protection authority where you live.

## Cookies and storage on the website

The website sets no cookies. Its page view counts (Vercel Web Analytics) and its click and scroll counts (PostHog) store nothing in your browser; PostHog's random visit id lives only in the open page's memory. Only the page where you connect an AI (ambernotes.app/connect) stores anything in your browser, and only what that page needs to work:

- **sessionStorage, `amber.connect.pkce`:** a one-time code for Sign in with Apple, kept while you go to Apple and back, and deleted as soon as you return.

Everything else on that page stays in its memory and is gone when you close it: your sign-in (which it ends when the connection is allowed, declined or expires, or when you close the page), the key and secret it uses to receive your device's approval, and, if you use it, your recovery key. Because these are strictly necessary for something you asked for, there's no cookie banner.

## Children

Amber Notes isn't directed at children under 13, or in the EU under the age your country sets for consenting to online services (up to 16). If you believe a child has given us personal data, write to us and we'll delete it.

## Security

We encrypt your notes end to end on your devices, encrypt data in transit, store passwords and access tokens only as one-way hashes, limit each account to its own data at the database level, and rate-limit sign-in and connection endpoints. The code is open source, so anyone can check how it works. No system is perfectly secure. If something goes wrong that affects you, we'll tell you as the law requires.

## Changes to this policy

When this policy changes, the date at the top changes. If a change matters to you, we'll tell you in the app before it takes effect.

## Contact

Emil Wagman, Sweden · **hello@ambernotes.app**
