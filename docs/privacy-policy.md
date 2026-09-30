# Privacy Policy

Last updated: 30 September 2026

## The short version

- Your notes are yours. We store them so they sync between your iPhone and Mac, and for nothing else.
- No ads, no tracking and no third-party analytics in the apps, and we never sell or share your data. The website counts visits anonymously, without cookies.
- We count how features are used on our own server to improve the app. We never share or sell it.
- An AI assistant can only read your notes if you connect it and approve it in Amber Notes or on ambernotes.app. You can disconnect it at any time.
- A note you lock is encrypted on your device before it's uploaded. Nobody but you can read it: not us, and not an AI.
- A note you share can be read by anyone with its link, until you stop sharing.
- Your data is stored in the European Union (Frankfurt, Germany).
- **Settings → Delete Account** deletes your account and everything in it.

## Who we are

Amber Notes is made by Emil Wagman, an individual developer in Sweden. He is the controller of the personal data described here. Questions about privacy go to **emil@norditech.se**.

This policy covers the Amber Notes apps for iPhone and Mac, the service that lets AI assistants connect to your notes, and the website at ambernotes.app, including shared note pages.

## What we collect

**Your account**

- **Sign in with Apple:** Apple gives us an identifier for your account and an email address. If you choose Hide My Email, we only ever see Apple's relay address. We never see your Apple ID password.
- **Email and password:** your email address and a one-way hash of your password. We never store the password itself.
- **Sign-in records:** when you sign in, our hosting provider records the time and the IP address and device information of the request, to keep your account secure.

**Your profile, if you set one**

- The name and photo you choose in Settings. Photos are cropped, resized, and stripped of location and camera data on your device before they're uploaded.

**Your notes**

- Your notes, folders, checklists, tables, and the images and files you add.
- Earlier versions of each note, so a change can be undone: up to 100 per note. Each version records whether it came from the app, an AI connection, an import or a restore.

**Locked notes, if you lock any**

- A locked note's text is encrypted on your device with a key made from your notes password (AES-256-GCM, with the key derived by PBKDF2) before it's uploaded. We store that encrypted text and the note's title, which stays readable so your list can show it. Files and sub-notes can't be put in a locked note.
- To let your devices check the password, we store a random value (a salt), a small encrypted test value, and the password hint you write. We never receive or store the password or the key. On your device, the key can be kept in the Keychain so Face ID or Touch ID can unlock your notes; it never leaves the device.
- Locking a note deletes its earlier versions from our servers. While it's locked, earlier versions are kept only in encrypted form, and changing your notes password removes the versions encrypted with the old one. Text from before a note was locked can remain in our hosting provider's encrypted backups for a limited time, until they're replaced.
- If you forget your notes password, we can't recover your locked notes.
- Once you have a notes password, older versions of the app can't sync until they're updated, so they can never upload a readable copy of a locked note.

**AI connections, if you make any**

- For each connection: its name, whether it may edit or only read, when it was created and last used, and its access token, stored only as a one-way hash.
- For connections made by signing in from ChatGPT or Claude, also the name and return address the assistant registers, and short-lived access and refresh tokens, stored as one-way hashes.

**Shared notes, if you share any**

- The link, which note it shows, and whether sub-notes are included, until you stop sharing.

**Visits to the website**

- The website counts visits with Vercel Web Analytics: which page was viewed, the referring site, and the country, browser and device type. It uses no cookies and stores nothing on your device, and it doesn't identify you or follow you across sites. Visits are counted in aggregate; your network address is used only to tell visits apart for a day and isn't stored.

**Reports about shared pages**

- If someone reports a shared page: the page's link, the reason they give, any contact details they choose to add, and a salted one-way hash of their network address, so one person can't report a page many times. We don't store the address itself.

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
| Sign-in records, rate limits, hashed network addresses on reports | To keep the service secure and stop abuse | Legitimate interests |
| Reports about shared pages | To review and remove content that breaks our Terms | Legitimate interests, and legal obligations where they apply |
| Feature usage counts | To learn whether the app works for people and improve it | Legitimate interests |
| Anonymous website visit counts | To learn which pages people find and use | Legitimate interests |

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

| Service | What it does for us | Where |
|---|---|---|
| Supabase, Inc. | Database, file storage, sign-in and server functions | Frankfurt, Germany (EU) |
| Vercel, Inc. | The website, shared note pages, Mac app downloads, update checks and anonymous website visit counts | Pages are built in Frankfurt, Germany (EU) and delivered through Vercel's global network |
| Apple | Sign in with Apple and the App Store, if you use them | Under Apple's own privacy policy |

Supabase and Vercel process data only on our instructions. Both are US companies. Where data could be accessed from outside the EU, for example by their support staff, the transfer is covered by the European Commission's Standard Contractual Clauses or the EU-U.S. Data Privacy Framework.

All data travels encrypted (HTTPS). Each account can only read its own notes: the database enforces this on every request.

## How long we keep it

- **Notes you delete** stay in Recently Deleted for 30 days, then they're deleted for good, together with their earlier versions.
- **Your account** is kept until you delete it. **Settings → Delete Account** removes your account, notes, files, profile photo, versions, AI connections, share links and usage counts straight away.
- **Expired AI access tokens** are removed a day after they expire.
- **Reports** are kept while they're reviewed, and as long as needed to deal with repeated abuse.
- **Backups:** our hosting provider keeps encrypted backups for disaster recovery for a limited period. Deleted data disappears from them as they're replaced.
- **Website request logs** at Vercel are kept for a short period for security and operations.

## Your rights

Under the GDPR you can:

- **access** your data and get a copy of it;
- **correct** it (most of it you can edit directly in the app);
- **delete** it, in the app with **Delete Account** or by asking us;
- **take it with you:** your notes are plain text (Markdown), and on request we'll send you everything in a machine-readable format;
- **object** to processing based on legitimate interests, including the feature usage counts, or ask us to **restrict** it.

Write to **emil@norditech.se**. We answer within one month. If you think we've handled your data wrongly, you can complain to the Swedish Authority for Privacy Protection (Integritetsskyddsmyndigheten, IMY) at imy.se, or to the data protection authority where you live.

## Children

Amber Notes isn't directed at children under 13, or in the EU under the age your country sets for consenting to online services (up to 16). If you believe a child has given us personal data, write to us and we'll delete it.

## Security

We encrypt data in transit, store passwords and access tokens only as one-way hashes, limit each account to its own data at the database level, and rate-limit sign-in and connection endpoints. The code is open source, so anyone can check how it works. No system is perfectly secure. If something goes wrong that affects you, we'll tell you as the law requires.

## Changes to this policy

When this policy changes, the date at the top changes. If a change matters to you, we'll tell you in the app before it takes effect.

## Contact

Emil Wagman, Sweden · **emil@norditech.se**
