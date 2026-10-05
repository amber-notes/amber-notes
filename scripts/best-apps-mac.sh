#!/bin/zsh
# Note apps (prototype), the best-apps set on the Mac: the scenes of PaneTests/HIG/BestAppsMacShots.swift, the real
# app in off-screen windows (nothing appears on the display), photographed with `screencapture -l`.
#   scripts/best-apps-mac.sh [out-dir]        (default .shots/note-pages-mac)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-$PWD/.shots/best-apps-mac}; [[ $OUT = /* ]] || OUT=$PWD/$OUT
rm -rf "$OUT" && mkdir -p "$OUT"

# US English (US dates, 1,284), whatever this Mac's region is. The same build settings as qa-test.sh.
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
TEST_RUNNER_AMBER_BEST_MAC="$OUT" TEST_RUNNER_AMBER_BEST_ONLY="${ONLY:-}" nice -n 10 xcodebuild -project Pane.xcodeproj -scheme Pane -configuration Debug -destination 'platform=macOS' \
  -derivedDataPath build/ddqa -testLanguage en -testRegion US \
  ENABLE_TESTABILITY=YES ENABLE_HARDENED_RUNTIME=NO ONLY_ACTIVE_ARCH=YES SWIFT_ACTIVE_COMPILATION_CONDITIONS='$(inherited) QA' \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= \
  test -only-testing:'PaneTests/BestAppsMacShots/frames()' > "$OUT/test.txt" 2>&1 &
test_pid=$!
# Each ready-<scene> lists "role window-number"; answer with shot-<scene> once they're captured.
while kill -0 $test_pid 2>/dev/null; do
  for ready in "$OUT"/ready-*(N); do
    scene=${ready:t}; scene=${scene#ready-}
    while read -r role id || [[ -n ${role:-} ]]; do
      screencapture -x -o -l "$id" "$OUT/$scene-$role.png"
      echo "captured $scene-$role"
    done < "$ready"
    rm "$ready"
    : > "$OUT/shot-$scene"
  done
  sleep 0.2
done
wait $test_pid || true
rm -f "$OUT"/shot-*(N)
grep -E "Test run with|TEST (SUCC|FAIL)|error:" "$OUT/test.txt" || tail -5 "$OUT/test.txt"
ls "$OUT"/*.png
