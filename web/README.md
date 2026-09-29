# Amber Notes share site

Renders a shared note at `/n/<slug>` (and its included sub-notes at `/n/<slug>/<sub-note id>`),
read through the public `shared_note` RPC and the `share-files` function. Nothing else is public.

- `cd web && pnpm install && pnpm dev` serves it on http://localhost:5210. It needs
  `web/.env.local` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the local stack's for development).
- `pnpm test` runs the renderer tests; `pnpm build` builds it.
- `scripts/deploy-web.sh` deploys to Vercel, only in the personal team, and prints the URL.
  Put that URL in `Config/Backend.local.xcconfig` as `PANE_SHARE_URL` so the app hands it out.
- Backend tests: `scripts/share-e2e.sh` (local stack).

Pages are cached for a minute, so edits show within about a minute; a stopped link returns 404
on the next render. Every page is `noindex, nofollow` with `Referrer-Policy: no-referrer`.
