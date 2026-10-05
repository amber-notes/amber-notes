#!/bin/zsh
# Collaboration prototype on the Mac: presence avatars in a real toolbar and the Share sheet, light
# and dark, from off-screen windows (nothing appears on the display), captured with screencapture -l.
#   scripts/collab-mac-shots.sh [out dir]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-$PWD/.shots/collab-mac}; [[ $OUT = /* ]] || OUT=$PWD/$OUT
rm -rf "$OUT" && mkdir -p "$OUT"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
TEST_RUNNER_AMBER_COLLAB_MAC="$OUT" TEST_RUNNER_AMBER_COLLAB_PHOTO="$PWD/web/public/emil-wagman.jpg" nice -n 10 xcodebuild -project Pane.xcodeproj -scheme Pane -configuration Debug -destination 'platform=macOS' \
  -derivedDataPath build/ddqa ENABLE_TESTABILITY=YES ENABLE_HARDENED_RUNTIME=NO ONLY_ACTIVE_ARCH=YES SWIFT_ACTIVE_COMPILATION_CONDITIONS='$(inherited) QA' \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= \
  test -only-testing:'PaneTests/CollabMacShots/frames()' > "$OUT/test.txt" 2>&1 &
test_pid=$!
while kill -0 $test_pid 2>/dev/null; do
  for ready in "$OUT"/ready-*(N); do
    scene=${ready:t}; scene=${scene#ready-}
    while read -r role id || [[ -n ${role:-} ]]; do
      screencapture -x -o -l "$id" "$OUT/$scene-$role.png"
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
