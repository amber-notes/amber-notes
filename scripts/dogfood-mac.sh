#!/bin/zsh
# Runs the Mac dogfood UI test, recording the app window region to video.
# Output: .shots/<run>/ with video.mov and per-step screenshots.
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
RUN="${1:-mac-$(date +%H%M%S)}"
OUT="$PWD/.shots/$RUN"
mkdir -p "$OUT"
xcodegen generate >/dev/null
if ! xcodebuild -project Pane.xcodeproj -scheme Pane -destination "platform=macOS" -derivedDataPath build/ddmac \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= build-for-testing > "$OUT/build.log" 2>&1; then
  grep -E "error:" "$OUT/build.log" | sort -u | head -20
  echo "BUILD FAILED"; exit 1
fi
# The window opens at a known size; record the screen area it will occupy once it appears.
(
  for i in {1..60}; do
    W=$(swift scripts/window-id.swift Pane 2>/dev/null)
    [ -n "$W" ] && break
    sleep 0.5
  done
  if [ -n "$W" ]; then
    set -- ${=W}
    screencapture -x -v -V 45 -R "$2,$3,$4,$5" "$OUT/video.mov" >/dev/null 2>&1
  fi
) &
REC=$!
rm -rf "$OUT/result.xcresult"
TEST_RUNNER_PANE_SHOTS="$OUT" xcodebuild -resultBundlePath "$OUT/result.xcresult" -project Pane.xcodeproj -scheme Pane -destination "platform=macOS" -derivedDataPath build/ddmac \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= test-without-building -only-testing:PaneUITests/MacDogfoodTests > "$OUT/test.log" 2>&1 || true
grep -E "error:|failed|passed" "$OUT/test.log" | grep -v Connection | tail -8
wait $REC 2>/dev/null || true
# Pull the step screenshots out of the result bundle.
mkdir -p "$OUT/att"
xcrun xcresulttool export attachments --path "$OUT/result.xcresult" --output-path "$OUT/att" >/dev/null 2>&1 || true
python3 - "$OUT" <<'PY'
import json, os, shutil, sys
out = sys.argv[1]; att = os.path.join(out, "att")
try: manifest = json.load(open(os.path.join(att, "manifest.json")))
except Exception: sys.exit()
for test in manifest:
    for a in test.get("attachments", []):
        name = a.get("suggestedHumanReadableName", "")
        base = name.split("_")[0] if name else ""
        if base[:2].isdigit():
            shutil.copy(os.path.join(att, a["exportedFileName"]), os.path.join(out, base + ".png"))
PY
echo "$OUT"
