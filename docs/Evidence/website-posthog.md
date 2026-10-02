# Website analytics with PostHog: setup

PostHog measures the website only (ambernotes.app): page views and page leaves with scroll depth, clicks on links and buttons, and a few named clicks. The apps have no analytics and never will from this; the App Store privacy label says so. The code is `web/lib/posthog.ts` (what's sent) and `web/app/PostHogAnalytics.tsx` (sending it), rendered from `web/app/SiteAnalytics.tsx` in the root layout.

Until `NEXT_PUBLIC_POSTHOG_KEY` is set in Vercel, nothing loads: no PostHog code is fetched and the CSP stays `connect-src 'self'`. Verified on 2 October 2026 with a local `next start` (below).

## 1. Create the PostHog project

Use a personal PostHog account, not Incredible's organization.

1. Sign up at https://eu.posthog.com (EU cloud, hosted in Frankfurt). Pick EU when asked for a region; it can't be changed later.
2. Create a project named "Amber Notes website". Skip the onboarding snippets.
3. Project settings, before the key goes live:
   - **IP data capture:** turn on "Discard client IP data". The SDK can't do this itself (its `ip` option has no effect), and the privacy policy says PostHog is set not to keep IP addresses.
   - **Session replay:** off ("Record user sessions" unchecked). The site also disables it in code.
   - **Surveys, heatmaps, web vitals, exception autocapture, dead clicks:** leave off. The code turns them off and loads no extra scripts, so turning them on here does nothing, but keep the settings honest.
   - **Person profiles:** the site sends `person_profiles: 'never'` and never calls `identify`, so no person is ever created. If the project offers a person-processing switch, leave it off.
   - **Cookieless mode:** off. It isn't used; the site keeps its random id in memory instead.
   - **Autocapture:** on. The site limits it to clicks on links and buttons.
   - **Data retention:** the shortest the plan allows that still covers a few months of trends.
4. Sign the DPA (Settings, Organization, Legal or https://posthog.com/dpa). The privacy policy names it as the transfer safeguard.
5. Copy the project API key (starts with `phc_`). It's public by design: it ends up in the page.

## 2. Put the key in Vercel

Production only, so preview deploys don't count. Either:

- **With the deploy script:** save the key in `.secrets/posthog-key.txt` (gitignored) or export `NEXT_PUBLIC_POSTHOG_KEY`, then run `scripts/deploy-web.sh`. It sets `NEXT_PUBLIC_POSTHOG_KEY` on the production environment along with the other variables. With neither, it leaves whatever Vercel already has.
- **By hand:** `cd web && printf '%s' phc_… | vercel env add NEXT_PUBLIC_POSTHOG_KEY production --scope emil-wagman-personal`, then redeploy. A `NEXT_PUBLIC_` variable is baked in at build time, so a redeploy is required.

`NEXT_PUBLIC_POSTHOG_HOST` is optional and defaults to `https://eu.i.posthog.com`. Set it only for a reverse proxy; the CSP's `connect-src` follows it.

To turn PostHog off again: `vercel env rm NEXT_PUBLIC_POSTHOG_KEY production` and redeploy.

## 3. What's sent, and what never is

- **Never loads** on `/n/*` (shared notes), `/connect*`, `/open/*` (universal links), `/report/*` and `/download/mac`. Gated by pathname in `SiteAnalytics`; tested in `web/app/SiteAnalytics.test.tsx` and `web/lib/posthog.test.ts`. If a visitor navigates into one of those pages from a public page, `before_send` drops anything that would be sent there.
- **Never fetched** when the browser sends Do Not Track or Global Privacy Control.
- **Nothing stored:** `persistence: 'memory'`. No cookies, localStorage or sessionStorage (checked in the browser below). Each full page load gets a new random id; client-side navigation keeps it.
- **No queries or fragments:** every `…url` and `…referrer` property is cut to origin and path. UTM parameters are kept as their own properties; ad click ids are masked.
- **No remote config, flags, surveys, replay or extra scripts:** `advanced_disable_flags` and `disable_external_dependency_loading`. The page only calls `https://eu.i.posthog.com/e/`.

### Events

| Event | When | Properties |
|---|---|---|
| `$pageview`, `$pageleave` | Every public page, including client-side navigation | PostHog's own, including `$prev_pageview_max_scroll_percentage` |
| `scroll_depth` | The window's bottom first passes 25, 50, 75 and 100% of the page, once each per page view | `percent`, `path` |
| `download_mac_clicked` | Any link to `/download/mac` (Download for Mac) | `path` |
| `use_template_clicked` | Any link to `/open/template/<slug>` | `path`, `template` |
| `copy_prompt_clicked` | The Copy the prompt button on template pages (`data-event` on the button) | `path` |
| `outbound_app_store_clicked`, `outbound_github_clicked`, `outbound_claude_clicked`, `outbound_chatgpt_clicked` | Links to apps.apple.com, github.com, claude.ai or claude.com, chatgpt.com or openai.com | `path`, `destination` (origin and path) |
| `$autocapture` | Other clicks on links and buttons | PostHog's own element chain |

A new named click: give the element `data-event="<name>"`, or add a host to `OUTBOUND` in `web/lib/posthog.ts`.

### The download funnel

In PostHog, a funnel insight with step 1 `$pageview` where `$pathname` = `/` (or any landing page), and step 2 `download_mac_clicked`. Break it down by `path` to see which page the download started on, or by `$referring_domain` or `utm_source` for where visitors came from. The funnel works within one page load and its client-side navigation, which covers the site's links; a full reload starts a new anonymous id because nothing is stored.

## 4. Local check, 2 October 2026

Built with `NEXT_PUBLIC_POSTHOG_KEY=phc_dummy_local_test pnpm build`, served with `next start`, and driven by headless Chrome over CDP with a normal desktop user agent (PostHog ignores headless user agents):

- `/`, `/blog/apple-notes-api`, `/download`: the PostHog chunk loads and events go to `https://eu.i.posthog.com/e/`. Decoded: `$pageview`, `download_mac_clicked` with `path`, `$autocapture`, `scroll_depth` 25/50/75/100, and the next `$pageview` with `$prev_pageview_max_scroll_percentage`. `$current_url` and `$session_entry_url` arrive without the `?ref=x#y` the page was opened with. No cookies, nothing in localStorage or sessionStorage.
- `/n/x`, `/connect`, `/open/connect`, `/report/x`: no PostHog chunk and no requests.
- Built without a key: no PostHog chunk on `/` or `/blog/*`, no requests, CSP `connect-src 'self'`.

## 5. After it's live

Load https://ambernotes.app in a normal browser and watch PostHog's Activity tab: a `$pageview` should arrive within a minute. Check one event's properties: no `$ip`, and `$process_person_profile` false.
