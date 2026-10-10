# Drafts: what to say about app telemetry

**Drafts for Emil. Nothing here is published.** These are the text changes that have to go out
together with the first release that ships app telemetry (`docs/Technical/app-telemetry.md`).
The live files are untouched: today's policy, website and App Store label still describe the
released app correctly, and they must keep doing so until that release is out. Delete this page
once the changes are made.

The order that keeps every public statement true:

1. Before the release is submitted: update the App Store privacy label (section 2) and publish
   the policy and website changes (sections 1 and 3).
2. Ship the release.

## 1. Privacy policy

In `docs/privacy-policy.md` and `web/content/privacy-policy.md`. Change the date at the top. The
policy's last section says a change that matters is told in the app before it takes effect: this
one is, by the line under the sign-in form and the What's new card for the release.

**The short version.** Replace

> No ads, no tracking and no third-party analytics in the apps, and we never sell or share your data.

with

> No ads and no tracking, and we never sell or share your data. The apps send error and crash
> reports and a few usage counts to PostHog in the EU, never your notes or anything you write.
> One switch in Settings turns it off.

**What we collect.** Add after "How the app is used":

> **Diagnostics and usage from the apps**
>
> The iPhone and Mac apps report on themselves, so we find out when something is broken instead
> of waiting for someone to write to us. They send:
>
> - **errors:** that a step failed and its error code, such as a save to the Keychain that was
>   refused, a sync that keeps failing, or a sign-in that didn't work;
> - **crashes and hangs,** from Apple's own diagnostics: the kind of crash and where in our code
>   it happened, as numbers;
> - **a few events:** that the app was opened, that you signed in and how (Apple, Google or
>   email), which screen you saw while a new device was getting your key, your first note and
>   first sync, and that an AI was connected (Claude, ChatGPT or other; never its name or address);
> - **speed:** how long the app took to open and to sync, and roughly how many notes you have
>   (as a range such as 11 to 100, never the number).
>
> With each: the app's version, iPhone, iPad or Mac, the system version, and your account's
> identifier, so we can tell that one account keeps hitting the same problem. Before you sign in,
> a random identifier is used instead, made new each time the app starts and never stored on
> your device.
>
> They never send your notes, titles, folder or file names, what you search for, anything an AI
> wrote, your email address, your recovery key or any other key, or your device's name. The app
> has no code path that could: an event can only hold numbers, yes or no, and words from a fixed
> list. The full list of events is in the open at
> github.com/pinto-notes/pinto-notes/blob/main/docs/Technical/app-telemetry.md.
>
> The reports go to PostHog, hosted in Frankfurt, Germany (EU). PostHog keeps no profile of you,
> works out no location, and records no screens. **Settings → General → Share diagnostics and
> usage** turns all of it off; nothing is kept or sent while it's off.

**What we don't collect.** Replace

> No advertising identifiers, no location, no contacts, and no third-party analytics or crash-reporting tools in the apps.

with

> No advertising identifiers, no location and no contacts. The apps link no analytics or
> crash-reporting SDK: crash reports come from Apple's own diagnostics, and the app sends its
> reports itself (see Diagnostics and usage from the apps).

**Why we use it.** Add a row:

> | Diagnostics and usage from the apps | To find and fix errors, and to learn where people get stuck | Legitimate interests. You can turn it off in Settings at any time |

**What stays readable to us.** Add to the list:

> - the diagnostics and usage reports described under What we collect;

**Where your data is stored.** In the PostHog row, replace "Website usage only: …" and "and never
in the apps" with

> Website usage: page views, clicks, where on a page people click, and scroll depth, and, if you
> accept cookies, recognising return visits. Never on shared notes or the connect pages. From the
> apps: the diagnostics and usage reports, linked to your account's identifier

**How long we keep it.** Add:

> - **Diagnostics and usage from the apps:** for as long as PostHog's plan keeps events (look up
>   the project's setting and write the period here before publishing), or until you ask us to
>   delete them. Deleting your account stops new reports; write to us to have the old ones removed.

That last sentence is the honest state today: Delete Account does not reach PostHog. If you'd
rather it did, see "Deleting what PostHog holds" in `docs/Technical/app-telemetry.md`.

**Your rights.** In "object to processing based on legitimate interests, including the feature
usage counts", add "and the diagnostics and usage reports (or turn them off in Settings)".

## 2. App Store privacy label

Replacement text for `docs/app-privacy-answers.md`. The data types in step 3 become:

> 3. Tick these data types, and nothing else:
>    - **Contact Info → Email Address** (as today)
>    - **Contact Info → Name** (as today)
>    - **User Content → Photos or Videos** (as today)
>    - **User Content → Other User Content** (as today)
>    - **Identifiers → User ID** (the account identifier). Purposes: **App Functionality** and
>      **Analytics** (it's sent with diagnostics and usage reports).
>    - **Identifiers → Device ID** (the installation identifier the app already keeps on our own
>      server, as today; the diagnostics reports store no device identifier). Purposes: **App
>      Functionality** and **Analytics**.
>    - **Usage Data → Product Interaction** (feature counts on our own server, and the app's
>      product events: app opened, signed in, first note, first sync, AI connected). Purposes:
>      **Analytics** and **App Functionality**.
>    - **Diagnostics → Crash Data** (crash and hang summaries from Apple's MetricKit).
>      Purposes: **App Functionality** and **Analytics**.
>    - **Diagnostics → Performance Data** (launch time, sync times, a library size range).
>      Purposes: **App Functionality** and **Analytics**.
>    - **Diagnostics → Other Diagnostic Data** (error reports: which step failed and its code).
>      Purposes: **App Functionality** and **Analytics**.
> 4. For every type: **Linked to the user's identity → Yes** (reports carry the account
>    identifier). **Used for tracking → No**: nothing is joined with data from other companies,
>    and nothing goes to an advertiser or a data broker.

And the closing paragraph becomes:

> Not collected (leave unticked): location, contacts, browsing or search history, health,
> financial info, purchases, sensitive info. The app links no analytics, ads or crash-reporting
> SDK; it sends its own reports to PostHog in the EU (docs/Technical/app-telemetry.md), which is
> a third-party partner in Apple's sense, so the types above are ticked.

`Pane/Resources/PrivacyInfo.xcprivacy` already says the same in this pull request (it ships
with the code). Device ID and Other Data Types were in the manifest before; check them against
the label while you're there.

## 3. Other places that say "no analytics"

Each of these is true today and stops being true with the release. Suggested wording:

| Where | Today | Draft |
|---|---|---|
| `README.md` line 53 | No ads, no analytics or tracking in the app; the website counts visits without cookies. | No ads and no tracking. The app sends error reports and a few usage counts, never your notes, and one switch turns that off; the website counts visits without cookies. |
| `web/lib/privacy.ts`, the "No ads, no tracking in the app" fact | No ads, no tracking and no third-party analytics in the apps. The apps count a few things on our own server. | No ads and no tracking in the apps. They send error reports and a few usage counts, never your notes, to our own server and to PostHog in the EU, and one switch in Settings turns the reports off. |
| `web/app/privacy-security/page.tsx` line 109 | The apps have no tracking, no third-party analytics and no crash-reporting tools. | The apps have no tracking and link no analytics or crash-reporting SDK. They send error and crash reports and a few usage counts to PostHog in the EU: never your notes, titles or anything you write. Settings, General, Share diagnostics and usage turns it off. |
| `web/app/help/questions.ts` line 32 | free, with no ads and no tracking in the app | Can stay: "tracking" is still true. |
| `web/app/Sections.tsx` lines 175 and 278 | No ads, no tracking in the app | Can stay. |
| `docs/appstore/metadata.md` line 51 | • No ads, no tracking, no analytics | • No ads, no tracking |
| `docs/appstore/metadata.md` line 135 (review notes) | The app has no in-app purchases, ads or tracking. | Can stay. Consider adding to the review notes: "The app sends error reports and usage counts to PostHog (EU); the switch is in Settings, General." |
| `docs/appstore/metadata-mac.md` line 108 (external services) | Supabase, Sign in with Apple, Apple Push Notification service … | Add: PostHog (EU), for error reports and usage counts from the app. |
| `docs/gdpr/records-of-processing.md` | PostHog: website only | Add an activity row: "App diagnostics and usage. Data subjects: app users. Data: account id (before sign-in, a random id made new at each launch and not stored), error codes, crash summaries, product events, performance numbers, app and OS version, device class. Purpose: finding and fixing errors, product improvement. Basis: legitimate interests, with an opt-out. Recipient: PostHog (EU). Retention: per PostHog's plan." And in the processor table, PostHog's row: "website and app". |

## 4. Words in the app

In this pull request, for Emil to change or approve:

- **The switch** (Settings → General): "Share diagnostics and usage". Under it: "Sends error and
  crash reports, how fast the app is, and a few counts such as “signed in” and “first sync”,
  linked to your account. Never your notes, their titles, file names or anything you type."
- **Under the sign-in form,** after the terms sentence: "The app sends error reports and a few
  usage counts, never your notes. You can turn this off in Settings."
