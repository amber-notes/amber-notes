#!/bin/zsh
# Add a device through the real server functions, on the LOCAL Supabase stack only: two sessions
# of one account hand the key over, list themselves, and one removes the other
# (PaneTests/Network/AddDeviceLiveTests.swift). Needs `supabase start` with every migration applied.
# Each run makes two throwaway users and deletes them afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
# STACK_DIR: another directory holding the stack's supabase/config.toml (default: this checkout).
eval "$(cd "${STACK_DIR:-.}" && supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
[[ "$API_URL" == http://127.0.0.1:* ]] || { echo "Not a local stack: $API_URL"; exit 1; }
run=$(uuidgen | tr 'A-Z' 'a-z')
password="add-device-e2e-$run"
ids=()
for who in a b; do
  email="add-device-$who-$run@pane.local"
  curl -sf -X POST "$API_URL/rest/v1/signup_allowlist" -H "authorization: Bearer $SERVICE_ROLE_KEY" -H "apikey: $SERVICE_ROLE_KEY" \
    -H 'content-type: application/json' -H 'prefer: resolution=ignore-duplicates' -d "{\"email\":\"$email\"}" >/dev/null
  ids+=("$(curl -sf -X POST "$API_URL/auth/v1/admin/users" -H "authorization: Bearer $SERVICE_ROLE_KEY" -H "apikey: $SERVICE_ROLE_KEY" \
    -H 'content-type: application/json' -d "{\"email\":\"$email\",\"password\":\"$password\",\"email_confirm\":true}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')")
done
cleanup() {
  for id in $ids; do curl -sf -X DELETE "$API_URL/auth/v1/admin/users/$id" -H "authorization: Bearer $SERVICE_ROLE_KEY" -H "apikey: $SERVICE_ROLE_KEY" >/dev/null || true; done
  curl -sf -X DELETE "$API_URL/rest/v1/signup_allowlist?email=like.add-device-*-$run@pane.local" -H "authorization: Bearer $SERVICE_ROLE_KEY" -H "apikey: $SERVICE_ROLE_KEY" >/dev/null || true
}
trap cleanup EXIT
export TEST_RUNNER_PANE_LOCAL_API="$API_URL" TEST_RUNNER_PANE_LOCAL_ANON="$ANON_KEY" TEST_RUNNER_PANE_LOCAL_PASSWORD="$password"
export TEST_RUNNER_PANE_LOCAL_EMAIL="add-device-a-$run@pane.local" TEST_RUNNER_PANE_LOCAL_OTHER_EMAIL="add-device-b-$run@pane.local"
scripts/qa-test.sh PaneTests/AddDeviceLiveTests
