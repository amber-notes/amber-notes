#!/bin/zsh
# Password reset against the LOCAL Supabase stack (supabase start first; its config.toml wires the
# recovery template). Optionally RESET_SITE=http://127.0.0.1:5210 with the site built and served from
# web/ against the same stack (SUPABASE_URL and SUPABASE_ANON_KEY set, `pnpm build && pnpm start -p 5210`),
# so the link is also opened in headless Chrome. Not `pnpm dev`: the page's strict CSP stops the dev
# build's scripts. See scripts/password-reset-e2e.test.ts.
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|DB_URL|MAILPIT_URL|INBUCKET_URL)=')"
PANE_API=$API_URL PANE_ANON=$ANON_KEY PANE_DB=$DB_URL PANE_MAIL=${MAILPIT_URL:-$INBUCKET_URL} \
  deno test -A --no-check scripts/password-reset-e2e.test.ts "$@"
