#!/bin/zsh
# Account deletion against the LOCAL Supabase stack (supabase start first).
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|PUBLISHABLE_KEY|SECRET_KEY|DB_URL)=')"
PANE_API=$API_URL PANE_ANON=$PUBLISHABLE_KEY PANE_SERVICE=$SECRET_KEY PANE_DB=$DB_URL deno test -A supabase/functions/account/account.e2e.test.ts
