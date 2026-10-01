# Amber Notes website

The whole public site, not just shared notes. What lives where:

- **Home, download and product pages** — `web/app/page.tsx`, `web/app/download/` and
  `web/app/support/`.
- **Blog** — posts are source-driven: `web/lib/posts.ts` plus `web/app/blog/` (each
  post's source under `web/app/blog/<slug>/`), with thumbnails in `public/blog/` and
  `web/lib/og/covers/`.
- **Help and FAQ** — `web/app/help/`, the questions live in `web/app/help/questions.ts`.
- **Changelog** — `web/content/changelog.json`, shown at `/changelog` and on the home page.
- **Legal** — `web/content/privacy-policy.md`, `terms-of-use.md` and `support.md`, shown at
  `/privacy`, `/terms` and `/support`.
- **Templates** — one JSON file each under `web/content/templates/`, with the gallery and
  pages in `web/app/templates/` (the app's data is served at `/templates/<slug>.json`).
- **Shared notes** — `/n/<slug>` (and its sub-notes at `/n/<slug>/<sub-note>`) read through
  the public `shared_note` RPC and the `share-files` function; the report form is `/report/<slug>`.
- **Connect** — where an AI client's sign-in lands (`web/app/connect/` and
  `web/app/open/connect/`); the MCP proxy is `web/middleware.ts`.

## Running it

`cd web && pnpm install && pnpm dev` serves it on http://localhost:5210.

### Which pages need `web/.env.local`

- **Work without it:** the home, download, blog, help, changelog, templates, legal and support
  pages are static. Try `pnpm dev` with no `.env.local` — everything builds and the
  marketing, blog and changelog pages render; only the shared-note, report and connect flows
  have no data.
- **Need it:** add the local stack's `SUPABASE_URL` and `SUPABASE_ANON_KEY` to a gitignored
  `web/.env.local`. The shared-note pages, the report page and a live connect request read
  Supabase through `lib/shared.ts`, `lib/report.ts` and `lib/connect.ts` respectively. With
  the keys missing they degrade gracefully — a shared note shows as not found, and a
  connect request shows a short error — rather than crashing.

## Checks

- `pnpm test` runs every `*.test.ts` and `*.test.tsx` in `web/` (Vitest).
- `pnpm typecheck` runs `tsc --noEmit` over the site.
- `pnpm build` builds it (Next.js).

## Deploys

`scripts/deploy-web.sh` deploys to Vercel, only in the personal team, and prints the URL. It
sets the Supabase URL and anon key on the Vercel project from `Config/Backend.local.xcconfig`;
put the URL back there as `PANE_SHARE_URL` so the app hands it out.

Backend tests: `scripts/share-e2e.sh` (local stack).

## Caching and privacy

The marketing, blog, help, changelog, template and legal pages are built once and served
statically. Shared-note and connect pages are rendered on every visit (not cached), so
“stop sharing” and locking a note take the page down at once, and nothing of a locked
note is served afterwards. Every page sends the same security headers, including
`Referrer-Policy: no-referrer`; most pages are `noindex, nofollow`, and the pages that may
be indexed are listed in `web/next.config.ts`.
