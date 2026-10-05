#!/bin/zsh
# Note page widgets (prototype): plays NoteWidgetsUITests on its own iPhone simulator, recorded.
#   scripts/note-widgets-ios.sh [out dir]
# Output: <out>/<test>.mp4 and the screenshots the tests take. Signed ad hoc (not
# CODE_SIGNING_ALLOWED=NO): the widget needs the app group and Keychain group entitlements.
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
OUT="${1:-$PWD/.shots/note-widgets}"
mkdir -p "$OUT"
NAME="Amber widgets"
SIM=$(xcrun simctl list devices available | grep "$NAME (" | head -1 | grep -oE '[0-9A-F-]{36}' || true)
[[ -z "$SIM" ]] && SIM=$(xcrun simctl create "$NAME" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro)
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null
xcrun simctl status_bar "$SIM" override --time "9:41" --batteryLevel 100 --cellularBars 4 --wifiBars 3 2>/dev/null || true
xcrun simctl ui "$SIM" appearance "${APPEARANCE:-light}"

if [[ -z "$NO_BUILD" ]]; then
  xcodegen generate >/dev/null
  if ! nice -n 10 xcodebuild -project Pane.xcodeproj -scheme Pane -destination "id=$SIM" -derivedDataPath build/dd \
    build-for-testing > "$OUT/build.log" 2>&1; then
    grep -E "error:" "$OUT/build.log" | sort -u | head -20
    echo "BUILD FAILED"; exit 1
  fi
fi

for t in ${=TESTS:-testHabitWidgets}; do
  xcrun simctl io "$SIM" recordVideo --codec h264 --force "$OUT/$t.mp4" 2>/dev/null &
  REC=$!
  sleep 1.5
  TEST_RUNNER_PANE_SHOTS="$OUT" TEST_RUNNER_PAGES_DIR="$PWD/demo/note-pages" nice -n 10 xcodebuild -project Pane.xcodeproj -scheme Pane \
    -destination "id=$SIM" -derivedDataPath build/dd test-without-building \
    -only-testing:"PaneUITests/NoteWidgetsUITests/$t" > "$OUT/$t.log" 2>&1 || true
  kill -INT $REC; wait $REC 2>/dev/null || true
  grep -E "error|failed|passed" "$OUT/$t.log" | tail -8
done
echo "$OUT"
