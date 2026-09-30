#!/bin/zsh
# Runs the MCP server's end-to-end tests against the LOCAL Supabase stack.
#   scripts/mcp-e2e.sh            # all tests
#   scripts/mcp-e2e.sh --filter tables
# Needs `supabase start` (the local edge runtime serves supabase/functions/mcp).
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(deno run -A scripts/dev-user.ts)"
cd supabase/functions/mcp
deno test -A --quiet notes.test.ts e2e.test.ts limits.e2e.test.ts ai_editor.e2e.test.ts locked.e2e.test.ts "$@"
