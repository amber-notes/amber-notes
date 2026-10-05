#!/bin/zsh
# Sharing prototype: one iPhone simulator shares a habit tracker (with its app) as an encrypted
# read-only link and as a template, Safari on the same phone opens both from the local site, and
# "Use template" adds a fresh copy in the app. Then Stop Sharing takes the link down.
#   scripts/share-demo.sh [out dir]
# Needs: the app built (scripts/collab-demo.sh builds it), and the site built with
#   (cd web && NEXT_PUBLIC_USERCONTENT_ORIGIN=http://127.0.0.1:56481 COLLAB_RELAY_URL=http://127.0.0.1:56480 pnpm exec next build)
# Output: <out>/share.mp4, screenshots, relay.log, web.log
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
OUT="${1:-$PWD/.shots/share}"
mkdir -p "$OUT"
OUT=${OUT:A}
PORT=56480
SITE=http://localhost:5230

S=$(xcrun simctl list devices available | grep "Amber collab Emil (" | head -1 | grep -oE '[0-9A-F-]{36}')
# A fresh boot: a system prompt left from an earlier run would sit over everything.
xcrun simctl shutdown "$S" 2>/dev/null || true
xcrun simctl boot "$S" 2>/dev/null || true
xcrun simctl bootstatus "$S" -b >/dev/null
xcrun simctl status_bar "$S" override --time "9:41" --batteryLevel 100 --cellularBars 4 --wifiBars 3 2>/dev/null || true
xcrun simctl ui "$S" appearance "${APPEARANCE:-light}"
APP=$(ls -d build/dd/Build/Products/Debug-iphonesimulator/Pane.app)
xcrun simctl terminate "$S" dev.emilwagman.pane 2>/dev/null || true
xcrun simctl install "$S" "$APP"
xcrun simctl terminate "$S" com.apple.mobilesafari 2>/dev/null || true

deno run -A scripts/collab-relay.ts $PORT > "$OUT/relay.log" 2>&1 &
RELAY=$!
(cd web && COLLAB_RELAY_URL=http://127.0.0.1:$PORT NEXT_PUBLIC_USERCONTENT_ORIGIN=http://127.0.0.1:$((PORT + 1)) \
  node_modules/.bin/next start -H localhost -p 5230 > "$OUT/web.log" 2>&1) &
WEB=$!
# Stop exactly what this run started: the relay, and whatever listens on the site's port from this subshell.
trap 'kill $RELAY 2>/dev/null; for p in $(lsof -tiTCP:5230 -sTCP:LISTEN 2>/dev/null); do [[ $(lsof -p $p | awk "\$4==\"cwd\"{print \$9}") == $PWD/web ]] && kill $p; done; true' EXIT
for i in {1..60}; do curl -s "$SITE/" >/dev/null && curl -s "http://127.0.0.1:$PORT/" >/dev/null && break; sleep 0.5; done

# Safari's first-run tips show once, before the recording.
xcrun simctl openurl "$S" "$SITE/templates"
sleep 6
xcrun simctl terminate "$S" com.apple.mobilesafari 2>/dev/null || true

# The app writes its links here; a file from an earlier run would hand over dead links.
rm -f "$(xcrun simctl get_app_container "$S" dev.emilwagman.pane data)/Documents/share-demo.txt"

xcrun simctl io "$S" recordVideo --codec h264 --force "$OUT/share.mp4" 2>/dev/null &
REC=$!
sleep 1.5
xcrun simctl launch "$S" dev.emilwagman.pane -uitest -demo -collabRelay "http://127.0.0.1:$PORT" -collab emil -collabName "Emil Wagman" -collabPhoto "$PWD/web/public/emil-wagman.jpg" \
  -collabScript share -collabPage "$PWD/demo/collab/habit-tracker.html" -shareSite "$SITE" >/dev/null
DATA=$(xcrun simctl get_app_container "$S" dev.emilwagman.pane data)
for i in {1..80}; do grep -q "^template " "$DATA/Documents/share-demo.txt" 2>/dev/null && break; sleep 0.5; done
LINK=$(grep "^link " "$DATA/Documents/share-demo.txt" | tail -1 | cut -d' ' -f2)
TEMPLATE=$(grep "^template " "$DATA/Documents/share-demo.txt" | tail -1 | cut -d' ' -f2)
echo "link $LINK" > "$OUT/links.txt"; echo "template $TEMPLATE" >> "$OUT/links.txt"
sleep 2.5

# The encrypted link, opened in Safari: the note and its app, read only.
xcrun simctl openurl "$S" "$LINK"
sleep 8
xcrun simctl io "$S" screenshot "$OUT/link.png" >/dev/null 2>&1
# The template's page, then its live preview.
xcrun simctl openurl "$S" "$TEMPLATE"
sleep 6
xcrun simctl io "$S" screenshot "$OUT/template.png" >/dev/null 2>&1
xcrun simctl openurl "$S" "$TEMPLATE#preview"
sleep 5
xcrun simctl io "$S" screenshot "$OUT/template-preview.png" >/dev/null 2>&1
# Use template. The page's button opens ambernotes://shared-template/<id>, and iOS first asks
# "Open in Amber Notes?", which nothing here can tap; so the app comes forward and is handed the
# same id through a file (CollabDemo.share), and fetches the template exactly as the link would.
ID=${TEMPLATE##*/}
xcrun simctl launch "$S" dev.emilwagman.pane >/dev/null
sleep 1.2
echo "use $ID" > "$DATA/Documents/demo-command.txt"
sleep 6
xcrun simctl io "$S" screenshot "$OUT/used.png" >/dev/null 2>&1
# Stop Sharing the link (as its sheet's button does), then open the old link again.
echo "stop" > "$DATA/Documents/demo-command.txt"
sleep 2.5
xcrun simctl openurl "$S" "$LINK"
sleep 5
xcrun simctl io "$S" screenshot "$OUT/stopped.png" >/dev/null 2>&1
# A report came in: we take the template down, and its page goes at once.
curl -s -X POST "http://127.0.0.1:$PORT/dev/takedown" -d "{\"id\":\"$ID\",\"reason\":\"demo\"}" >/dev/null
xcrun simctl openurl "$S" "$TEMPLATE"
sleep 5
xcrun simctl io "$S" screenshot "$OUT/taken-down.png" >/dev/null 2>&1
kill -INT $REC; wait $REC 2>/dev/null || true
echo "$OUT"
