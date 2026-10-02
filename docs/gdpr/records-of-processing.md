# Record of processing activities

Internal record under GDPR Article 30. Last reviewed 2 October 2026. Keep it in step with
`docs/privacy-policy.md` (what people read) and `web/lib/privacy.ts` (the website's short form).

**Controller:** Emil Wagman, individual developer, Sweden. Contact: emil@norditech.se.
**Representative / DPO:** none. Not required: no EU representative (the controller is in the EU),
and no DPO (no large-scale special-category data or systematic monitoring).
**Supervisory authority:** Integritetsskyddsmyndigheten (IMY), Sweden.

## Processing activities

| # | Activity | People | Personal data | Purpose | Legal basis | Recipients | Retention |
|---|---|---|---|---|---|---|---|
| 1 | Accounts and sign-in | Users | Email or Apple relay address, Apple user id, password hash, sign-in time, IP address and user agent (`auth.sessions`, `auth.audit_log_entries`) | Provide the service; secure accounts | Contract (Art. 6(1)(b)); legitimate interests in security (6(1)(f)) | Supabase; Apple (Sign in with Apple) | Account: until deleted. Audit log: 30 days (`pane_forget_daily`). Session: until sign-out or deletion |
| 2 | Notes and files | Users, and anyone named in their notes | Note text, folders, files, earlier versions, locked-note ciphertext, notes-password salt, verifier and hint | Store, sync and show notes | Contract | Supabase | Until deleted. Recently Deleted: 30 days. Versions: thinned, max 100 per note, 90 days for older ones |
| 3 | Profile | Users | Display name, photo (EXIF stripped on device) | Shown on shared pages | Contract | Supabase; visitors of shared pages | Until changed or account deleted |
| 4 | AI connections | Users | Connection name, read/write, created and last-used times, token hashes, client name and redirect host | Let approved AI apps read and edit notes | Contract | Supabase; the AI provider the user connects (independent controller) | Until disconnected or account deleted; expired OAuth tokens 1 day after expiry |
| 5 | Shared pages | Users; visitors | The note, owner's profile name, photo and non-relay email | Publish a note the user chose to share | Contract | Vercel (renders the page); anyone with the link | Until Stop Sharing, locking, or 30 days after the note is deleted |
| 6 | Reports about shared pages | Visitors who report | Reason, optional contact, monthly-keyed HMAC of IP address | Review and remove content that breaks the Terms (App Store 1.2) | Legitimate interests; legal obligations where they apply | Supabase | Reporter hash blanked after 30 days; report deleted 12 months after creation once reviewed |
| 7 | Rate limiting | Anyone calling sign-in and connect endpoints | Daily-keyed HMAC of IP address | Stop abuse | Legitimate interests | Supabase | 2 hours |
| 8 | Usage counts | Users | AI edits per day, active days, tips shown and used, setup steps, install id and platform | Learn whether the app works; ask once to share after a week | Legitimate interests (objection honoured on request) | Supabase | 12 months |
| 9 | Hosting logs | Users; website visitors | IP address, user agent, path and query, rough location, time | Operate and secure the service (the hosts' own logs) | Legitimate interests | Supabase, Vercel | Supabase: 1 day. Vercel runtime logs: 1 hour; Observability: 12 hours |
| 10 | Support email | Anyone who writes | Email, message | Answer questions and GDPR requests | Legitimate interests; legal obligation for GDPR requests | Email provider (norditech.se mail host) | As long as needed to answer, then deleted |
| 11 | Website usage | Website visitors (never on shared notes, connect, report or universal-link pages) | Vercel Web Analytics: page, referrer, country, browser and device, day-scoped hash. PostHog: page, clicks on links and buttons, scroll depth, referrer, browser and device, a random per-page-load id kept in memory; no cookies, no person profiles, no recordings, IP discarded in the project settings | Learn how people find the site and which pages lead to a download | Legitimate interests | Vercel; PostHog (EU cloud) | As long as each plan keeps it (at least a month) |

No special categories are processed on purpose. Notes can contain anything the user writes; they're
processed only to store and show them to the user and the AI apps the user approves.

## Processors and transfers

| Processor | Role | Region | Contract | Transfer mechanism |
|---|---|---|---|---|
| Supabase Pte. Ltd. | Database, storage, auth, Edge Functions | eu-central-1 (Frankfurt) | [DPA](https://supabase.com/legal/dpa), part of the Terms, covers the Free plan | SCCs (in the DPA). [Sub-processors](https://supabase.com/legal/customer-resources/subprocessor-list) |
| Vercel, Inc. | Website, shared pages, MCP proxy at mcp.ambernotes.app, downloads | fra1 (Frankfurt) functions, global CDN | **Gap:** Vercel's [DPA](https://vercel.com/legal/dpa) applies to Pro and Enterprise only; the project is on Hobby | EU-U.S. Data Privacy Framework ([privacy policy](https://vercel.com/legal/privacy-policy)). [Sub-processors](https://vercel.com/legal/sub-processors) |
| PostHog, Inc. | Website usage analytics (page views, clicks, scroll depth); website only, off unless `NEXT_PUBLIC_POSTHOG_KEY` is set | EU Cloud (Frankfurt, Germany) | [DPA](https://posthog.com/dpa) | SCCs (in the DPA). [Sub-processors](https://posthog.com/subprocessors) |
| Apple | Sign in with Apple, App Store, TestFlight | Global | Apple's developer terms | Apple's own |

**Open item:** move the Vercel project to Pro (the DPA then applies), or accept the risk in writing.
Vercel's Hobby terms also restrict Hobby to non-commercial use.

## Technical and organisational measures

- TLS everywhere; Supabase encrypts storage at rest (AES-256).
- Row-level security on every table; a user can only read and write their own rows.
- Locked notes are end-to-end encrypted on device (AES-256-GCM, PBKDF2).
- Passwords (bcrypt, by Supabase Auth), AI tokens and OAuth codes are stored only as SHA-256 hashes.
- IP addresses are never stored in the clear by our code: rate limits use a daily-keyed HMAC, and
  reports use a monthly-keyed HMAC blanked after 30 days.
- Server logs are scrubbed (`supabase/functions/_shared/log.ts`): no note text, emails, ids, tokens or addresses.
- Retention runs on the server (`20260930171500_retention.sql`, pg_cron).
- Deleting an account removes everything (`supabase/functions/account/forget.ts`, tested in
  `account.pglite.test.ts`, including a test that every new table is covered).
- Export My Data (`GET /functions/v1/account/export`) gives the user everything we hold about them.
- Only the controller has access to the production dashboards. The code is open source.

## DPIA: needed?

Assessed against Article 35 and IMY's list of processing that requires a DPIA. **Not required now.**

- No systematic monitoring, profiling with significant effects, automated decisions, or large-scale
  special-category data. Usage counts are coarse per-day counters, not behavioural profiles.
- Notes may contain sensitive data the user chooses to write, but we don't analyse them. They're
  stored, synced and passed only to AI apps the user approves.
- Scale is small (a free app from one developer).
- Two IMY criteria are borderline: data concerning vulnerable people (only if a user writes about
  them) and innovative technology (AI connections). With no evaluation, scoring or monitoring, one
  or two weak criteria don't make the processing high risk.

Revisit when: server-side AI processing of note content is added, full E2EE ships (the MCP path will
decrypt in memory), user numbers grow a lot, or a paid tier adds payment data.

## Children

Not directed at children. Terms and policy: 13+, or the national age of digital consent in the EU (up to 16).
On a report that a child's data was given to us, delete the account.

## Data subject requests

| Right | How |
|---|---|
| Access, portability | In the app: Settings → Privacy & Security → Export My Data. By email: run the export for the user and send the zip over a secure channel |
| Rectification | Most data is editable in the app; the rest by email |
| Erasure | Settings → Delete Account, or by email: run the same function (`DELETE /functions/v1/account`) as the user, or `forget()` plus the storage removal |
| Restriction, objection | By email. To stop usage counts for one account, delete its `pane_activity`, `pane_tip_activity`, `pane_active_days` and `pane_devices` rows and note the objection here |
| Complaint | IMY, imy.se |

Answer within one month (Article 12(3)). Verify the requester through the email on the account.
