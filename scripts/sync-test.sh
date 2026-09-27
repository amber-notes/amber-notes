#!/bin/zsh
# Runs the sync UI test on the iPhone simulator against the local Supabase stack.
# Needs: supabase start, supabase functions serve mcp, and the dev user (scripts/dev-user.sh).
set -e
cd "$(dirname "$0")/.."
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL)=')"
export TEST_RUNNER_PANE_MCP_URL="$API_URL/functions/v1/mcp"
export TEST_RUNNER_PANE_TOKEN="${PANE_TOKEN:?set PANE_TOKEN to a dev access token}"
export TEST_RUNNER_PANE_EMAIL="${PANE_EMAIL:-dev@pane.local}"
export TEST_RUNNER_PANE_PASSWORD="${PANE_PASSWORD:-pane-dev-password-1}"
ONLY=PaneUITests/SyncTests ./scripts/dogfood-ios.sh "${1:-sync-$(date +%H%M%S)}"
