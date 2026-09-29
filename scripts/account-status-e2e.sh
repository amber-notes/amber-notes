#!/bin/zsh
# account-status against the LOCAL Supabase stack: runs the function on :8000 against the local
# database, runs the end-to-end test, then stops the function.
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(supabase status -o env 2>/dev/null | grep -E '^DB_URL=')"
SUPABASE_DB_URL=$DB_URL ACCOUNT_STATUS_SALT=e2e deno run -A --quiet supabase/functions/account-status/index.ts &
fn=$!
trap 'kill $fn 2>/dev/null' EXIT
sleep 2
PANE_DB=$DB_URL deno test -A --quiet supabase/functions/account-status/account-status.e2e.test.ts "$@"
