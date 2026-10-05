#!/bin/zsh
# Note apps (prototype), the best-apps set: plays BestAppsUITests on its own iPhone simulator, one
# recording per test, in the appearance given.
#   scripts/best-apps-ios.sh [out dir]          TESTS="testHabits testMoney" APPEARANCE=dark BUILD=0
# Output: <out>/<test>.mp4, the screenshots the tests take, and logs.
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
OUT="${1:-$PWD/.shots/best-apps}"
mkdir -p "$OUT"
NAME="Amber best apps"
SIM=$(xcrun simctl list devices available | grep "$NAME (" | head -1 | grep -oE '[0-9A-F-]{36}' || true)
[[ -z "$SIM" ]] && SIM=$(xcrun simctl create "$NAME" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro)
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null
xcrun simctl status_bar "$SIM" override --time "9:41" --batteryLevel 100 --cellularBars 4 --wifiBars 3 2>/dev/null || true
xcrun simctl ui "$SIM" appearance "${APPEARANCE:-light}"
# Rome for location; nothing else is granted ahead, so the system's own prompts show.
xcrun simctl location "$SIM" set 41.8986,12.4769 2>/dev/null || true
# No keyboard tips over the recordings.
xcrun simctl spawn "$SIM" defaults write com.apple.keyboard.preferences DidShowContinuousPathIntroduction -bool true
xcrun simctl spawn "$SIM" defaults write com.apple.Preferences DidShowContinuousPathIntroduction -bool true

if [[ "${BUILD:-1}" == 1 ]]; then
  xcodegen generate >/dev/null
  if ! nice -n 10 xcodebuild -project Pane.xcodeproj -scheme Pane -destination "id=$SIM" -derivedDataPath build/dd \
    CODE_SIGNING_ALLOWED=NO build-for-testing > "$OUT/build.log" 2>&1; then
    grep -E "error:" "$OUT/build.log" | sort -u | head -20
    echo "BUILD FAILED"; exit 1
  fi
fi

for t in ${=TESTS:-testStills}; do
  REC=""
  if [[ "${RECORD:-1}" == 1 ]]; then
    rm -f "$OUT"/mark-*.txt(N)
    xcrun simctl io "$SIM" recordVideo --codec h264 --force "$OUT/$t-${APPEARANCE:-light}.mp4" 2>/dev/null &
    REC=$!
    python3 -c 'import time; print(time.time())' > "$OUT/rec-start.txt"
    sleep 1.5
  fi
  TEST_RUNNER_PANE_SHOTS="$OUT" TEST_RUNNER_BEST_DIR="$PWD/demo/note-pages/best" TEST_RUNNER_SHOT_PREFIX="${APPEARANCE:-light}-" TEST_RUNNER_ONLY="${ONLY:-}" \
    nice -n 10 xcodebuild -project Pane.xcodeproj -scheme Pane -destination "id=$SIM" -derivedDataPath build/dd CODE_SIGNING_ALLOWED=NO test-without-building \
    -only-testing:"PaneUITests/BestAppsUITests/$t" > "$OUT/$t.log" 2>&1 || true
  if [[ -n "$REC" ]]; then
    python3 -c 'import time; print(time.time())' > "$OUT/$t-${APPEARANCE:-light}-rec-stop.txt"
    kill -INT $REC; wait $REC 2>/dev/null || true
    # Keep the marks with the clip, for trimming.
    for m in "$OUT"/mark-*.txt(N); do mv "$m" "$OUT/$t-${APPEARANCE:-light}-${m:t}"; done
    mv "$OUT/rec-start.txt" "$OUT/$t-${APPEARANCE:-light}-rec-start.txt"
  fi
  grep -E "error|failed|passed" "$OUT/$t.log" | tail -8
done
echo "$OUT"
