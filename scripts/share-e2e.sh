#!/bin/zsh
# Runs the share-link tests (RPCs and the share-files function) against the LOCAL Supabase stack.
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(deno run -A scripts/dev-user.ts)"
cd supabase/functions/share-files
deno test -A --quiet share.e2e.test.ts "$@"
