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
# Record the app window's screen area, and stop the moment the window closes
# so nothing else on the screen ends up in the video.
(
  for i in {1..60}; do
    W=$(swift scripts/window-id.swift Pane 2>/dev/null)
    [ -n "$W" ] && break
    sleep 0.5
  done
  [ -z "$W" ] && exit 0
  set -- ${=W}
  screencapture -x -v -V 180 -R "$2,$3,$4,$5" "$OUT/raw.mov" >/dev/null 2>&1 &
  CAP=$!
  START=$(date +%s.%N)
  while [ -n "$(swift scripts/window-id.swift Pane 2>/dev/null)" ]; do sleep 0.2; done
  END=$(date +%s.%N)
  kill -INT $CAP 2>/dev/null; wait $CAP 2>/dev/null
  # Cut a second off the end to drop the frames after the window closed.
  DUR=$(echo "$END - $START - 1.0" | bc)
  ffmpeg -v error -y -i "$OUT/raw.mov" -t "$DUR" -c:v libx264 -crf 22 -pix_fmt yuv420p -an "$OUT/video.mp4" && rm -f "$OUT/raw.mov"
) &
REC=$!
rm -rf "$OUT/result.xcresult"
TEST_RUNNER_PANE_SHOTS="$OUT" xcodebuild -resultBundlePath "$OUT/result.xcresult" -project Pane.xcodeproj -scheme Pane -destination "platform=macOS" -derivedDataPath build/ddmac \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= test-without-building -only-testing:"${ONLY:-PaneUITests/MacDogfoodTests}" > "$OUT/test.log" 2>&1 || true
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
            ext = os.path.splitext(a["exportedFileName"])[1] or ".png"
            shutil.copy(os.path.join(att, a["exportedFileName"]), os.path.join(out, base + ext))
PY
echo "$OUT"
