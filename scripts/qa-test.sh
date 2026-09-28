#!/bin/zsh
# Runs Mac unit tests in the QA derived data, with a hard time limit per run.
#   scripts/qa-test.sh [PaneTests/SuiteName[/testName] ...]
# The test host runs without a window or Dock icon (see PaneApp.isUnitTestHost).
set -uo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
only=()
for t in "$@"; do only+=(-only-testing:$t); done
[[ ${#only[@]} -eq 0 ]] && only=(-only-testing:PaneTests)
LIMIT=${LIMIT:-240}
log=$(mktemp)
xcodebuild -project Pane.xcodeproj -scheme Pane -destination 'platform=macOS' -derivedDataPath build/ddqa \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= \
  test "${only[@]}" >"$log" 2>&1 &
pid=$!
for i in $(seq 1 $LIMIT); do kill -0 $pid 2>/dev/null || break; sleep 1; done
if kill -0 $pid 2>/dev/null; then
  echo "TIMEOUT after ${LIMIT}s"
  # Only this run's own host app and xcodebuild.
  for h in $(pgrep -f "$PWD/build/ddqa/Build/Products/Debug/Pane.app/Contents/MacOS/Pane"); do kill $h; done
  kill $pid 2>/dev/null
fi
wait $pid 2>/dev/null
grep -A2 -E "error:|✘|✔ Test run|Test run with|TEST (SUCC|FAIL)|passed after|timeout" "$log" | grep -v "^20[0-9][0-9]-" | grep -vE "✔ (Suite|Test [a-zA-Z]+\(\) passed)" | head -${LINES_OUT:-40}
rm -f "$log"
