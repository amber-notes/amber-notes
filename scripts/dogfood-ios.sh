#!/bin/zsh
# Runs the dogfood UI test on an iPhone simulator, recording video.
# Output: .shots/<run>/ with video.mp4 and per-step screenshots.
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
DEVICE="${DEVICE:-iPhone 17 Pro}"
RUN="${1:-ios-$(date +%H%M%S)}"
OUT="$PWD/.shots/$RUN"
mkdir -p "$OUT"
SIM=$(xcrun simctl list devices available | grep "$DEVICE (" | head -1 | grep -oE '[0-9A-F-]{36}')
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null
xcrun simctl status_bar "$SIM" override --time "9:41" --batteryLevel 100 --cellularBars 4 --wifiBars 3 2>/dev/null || true

xcodegen generate >/dev/null
if ! xcodebuild -project Pane.xcodeproj -scheme Pane -destination "id=$SIM" -derivedDataPath build/dd \
  CODE_SIGNING_ALLOWED=NO build-for-testing > "$OUT/build.log" 2>&1; then
  grep -E "error:" "$OUT/build.log" | sort -u | head -20
  echo "BUILD FAILED"; exit 1
fi

xcrun simctl io "$SIM" recordVideo --codec h264 --force "$OUT/video.mp4" &
REC=$!
sleep 1
TEST_RUNNER_PANE_SHOTS="$OUT" xcodebuild -project Pane.xcodeproj -scheme Pane -destination "id=$SIM" -derivedDataPath build/dd \
  CODE_SIGNING_ALLOWED=NO test-without-building -only-testing:"${ONLY:-PaneUITests/DogfoodTests}" 2>&1 \
  > "$OUT/test.log" || true; grep -E "error|failed|passed|t = " "$OUT/test.log" | tail -40
kill -INT $REC; wait $REC 2>/dev/null || true
echo "$OUT"
