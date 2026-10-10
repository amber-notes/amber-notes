#!/bin/zsh
# Note pages (prototype): open-to-interactive times on the simulator, from NotePagesUITests/testPageTimings.
#   scripts/note-pages-timings.sh <label>    (run scripts/note-pages-ios.sh once first, to build)
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
OUT="$PWD/.shots/note-pages"; mkdir -p "$OUT"
SIM=$(xcrun simctl list devices available | grep "Amber note pages (" | head -1 | grep -oE '[0-9A-F-]{36}')
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null
TEST_RUNNER_PANE_SHOTS="$OUT" TEST_RUNNER_PAGES_DIR="$PWD/demo/note-pages" xcodebuild -project Pane.xcodeproj -scheme Pane \
  -destination "id=$SIM" -derivedDataPath build/dd CODE_SIGNING_ALLOWED=NO test-without-building \
  -only-testing:PaneUITests/NotePagesUITests/testPageTimings > "$OUT/timings-$1.log" 2>&1 || true
grep -E "Test Case.*(passed|failed)" "$OUT/timings-$1.log" | tail -1
DATA=$(xcrun simctl get_app_container "$SIM" dev.emilwagman.pane data)
cp "$DATA/Documents/note-page-timings.txt" "$OUT/timings-$1.txt" && rm "$DATA/Documents/note-page-timings.txt"
cat "$OUT/timings-$1.txt"
