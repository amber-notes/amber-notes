#!/bin/zsh
# Amber Notes offline in the iPhone simulator (PaneUITests/OfflineUITests), against a local
# Supabase stack, never production. Light, then dark. Screenshots go to .shots/<run>/<appearance>.
#   API_URL=http://127.0.0.1:56421 SERVICE_KEY=<local secret key> scripts/offline-ios.sh [run]
# The stack needs every migration (`supabase start` from this checkout). Makes the account
# offline-qa@example.com if it's missing.
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
API_URL=${API_URL:-http://127.0.0.1:56421}
: ${SERVICE_KEY:?set SERVICE_KEY to the local stack secret key, from supabase status}
[[ $API_URL == http://127.0.0.1:* || $API_URL == http://localhost:* ]] || { echo "local stacks only"; exit 1; }
EMAIL=offline-qa@example.com PASSWORD=offline-qa-password-1
curl -s -X POST "$API_URL/auth/v1/admin/users" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true}" >/dev/null
RUN=${1:-offline-$(date +%H%M%S)}
OUT="$PWD/.shots/$RUN"
SIM=${SIM:-$(xcrun simctl list devices available | grep "iPhone 17 Pro (" | head -1 | grep -oE '[0-9A-F-]{36}')}
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null
xcrun simctl status_bar "$SIM" override --time "9:41" --batteryLevel 100 --cellularBars 4 --wifiBars 3 2>/dev/null || true
mkdir -p "$OUT"
xcodebuild -project Pane.xcodeproj -scheme Pane -destination "id=$SIM" -derivedDataPath build/ddsim CODE_SIGNING_ALLOWED=NO \
  "PANE_SUPABASE_URL=http:/\$()/${API_URL#http://}" build-for-testing > "$OUT/build.log" 2>&1 || { grep error: "$OUT/build.log" | head; exit 1; }
for look in light dark; do
  mkdir -p "$OUT/$look"
  xcrun simctl ui "$SIM" appearance $look
  TEST_RUNNER_PANE_EMAIL=$EMAIL TEST_RUNNER_PANE_PASSWORD=$PASSWORD TEST_RUNNER_PANE_SHOTS="$OUT/$look" \
    xcodebuild -project Pane.xcodeproj -scheme Pane -destination "id=$SIM" -derivedDataPath build/ddsim CODE_SIGNING_ALLOWED=NO \
    test-without-building -only-testing:PaneUITests/OfflineUITests > "$OUT/$look/test.log" 2>&1 || true
  grep -E "error:|Test Case.*(passed|failed)|PERF" "$OUT/$look/test.log"
done
xcrun simctl ui "$SIM" appearance light
echo "$OUT"
