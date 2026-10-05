#!/bin/zsh
# Note pages (prototype): frame hitches while scrolling a note with three app widgets, against the
# same note with plain links. Run scripts/note-pages-ios.sh first (it builds).
#   scripts/note-pages-scroll.sh
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
OUT="$PWD/.shots/note-pages"; mkdir -p "$OUT"
SIM=$(xcrun simctl list devices available | grep "Amber note pages (" | head -1 | grep -oE '[0-9A-F-]{36}')
xcrun simctl boot "$SIM" 2>/dev/null || true
for kind in ${=KINDS:-widgets links widgets links}; do
  TEST_RUNNER_WIDGETS=$kind TEST_RUNNER_PANE_SHOTS="$OUT" TEST_RUNNER_PAGES_DIR="$PWD/demo/note-pages" xcodebuild -project Pane.xcodeproj -scheme Pane \
    -destination "id=$SIM" -derivedDataPath build/dd CODE_SIGNING_ALLOWED=NO test-without-building \
    -only-testing:PaneUITests/NotePagesUITests/testWidgetScroll > "$OUT/scroll-$kind.log" 2>&1 || true
  DATA=$(xcrun simctl get_app_container "$SIM" dev.emilwagman.pane data)
  echo "$kind: frames hitches longest_ms = $(cat "$DATA/Documents/frame-probe.txt")"
  rm -f "$DATA/Documents/frame-probe.txt"
done
