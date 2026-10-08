#!/bin/zsh
# Collaboration prototype: two iPhone simulators share a note through the local relay and type into
# it at once. Records each simulator and puts them side by side.
#   scripts/collab-demo.sh [out dir]          (build first: see the xcodebuild line below)
# Output: <out>/emil.mp4, <out>/sara.mp4, <out>/side-by-side.mp4, <out>/relay.log
# Needs Automerge in the app, which it doesn't link for now: see Pane/Collab/CollabText.swift.
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
OUT="${1:-$PWD/.shots/collab}"
PORT="${PORT:-56480}"
mkdir -p "$OUT"
OUT=${OUT:A}

sim() {
  local id=$(xcrun simctl list devices available | grep "$1 (" | head -1 | grep -oE '[0-9A-F-]{36}' || true)
  [[ -z "$id" ]] && id=$(xcrun simctl create "$1" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro)
  echo $id
}
A=$(sim "Amber collab Emil")
B=$(sim "Amber collab Sara")
for S in $A $B; do
  xcrun simctl boot "$S" 2>/dev/null || true
  xcrun simctl bootstatus "$S" -b >/dev/null
  xcrun simctl status_bar "$S" override --time "9:41" --batteryLevel 100 --cellularBars 4 --wifiBars 3 2>/dev/null || true
  xcrun simctl ui "$S" appearance "${APPEARANCE:-light}"
  # No keyboard tutorial card over the note.
  xcrun simctl spawn "$S" defaults write com.apple.keyboard.preferences DidShowContinuousPathIntroduction -bool true
  xcrun simctl spawn "$S" defaults write com.apple.Preferences DidShowContinuousPathIntroduction -bool true
  xcrun simctl spawn "$S" defaults write com.apple.Preferences KeyboardDidShowProductivityTutorial -bool true
done

if [[ -z "$SKIP_BUILD" ]]; then
  xcodegen generate >/dev/null
  nice -n 10 xcodebuild -project Pane.xcodeproj -scheme Pane -destination "id=$A" -derivedDataPath build/dd \
    CODE_SIGNING_ALLOWED=NO build > "$OUT/build.log" 2>&1 || { grep -E "error:" "$OUT/build.log" | sort -u | head; exit 1; }
fi
APP=$(ls -d build/dd/Build/Products/Debug-iphonesimulator/Pane.app)
for S in $A $B; do
  xcrun simctl terminate "$S" dev.emilwagman.pane 2>/dev/null || true
  xcrun simctl install "$S" "$APP"
done

# A fresh relay (an empty database) for each run.
deno run -A scripts/collab-relay.ts "$PORT" > "$OUT/relay.log" 2>&1 &
RELAY=$!
trap 'kill $RELAY 2>/dev/null || true' EXIT
for i in {1..60}; do curl -s "http://127.0.0.1:$PORT/" >/dev/null && break; sleep 0.5; done

xcrun simctl io "$A" recordVideo --codec h264 --force "$OUT/emil.mp4" 2>/dev/null &
RA=$!
xcrun simctl io "$B" recordVideo --codec h264 --force "$OUT/sara.mp4" 2>/dev/null &
RB=$!
sleep 1.5
ARGS=(-uitest -demo -collabRelay "http://127.0.0.1:$PORT")
DA=$(xcrun simctl get_app_container "$A" dev.emilwagman.pane data)
DB=$(xcrun simctl get_app_container "$B" dev.emilwagman.pane data)
rm -f "$DA/Documents/share-demo.txt" "$DB/Documents/demo-command.txt"
xcrun simctl launch "$B" dev.emilwagman.pane "${ARGS[@]}" -collab sara -collabName "Sara Lind" -collabScript member >/dev/null
sleep 0.4
xcrun simctl launch "$A" dev.emilwagman.pane "${ARGS[@]}" -collab emil -collabName "Emil Wagman" -collabPhoto "$PWD/web/public/emil-wagman.jpg" -collabScript owner >/dev/null
# Emil sets the link to Edit; it goes to Sara as a message would (her app gets it through a file:
# a link from Messages would ask "Open in Amber Notes?", which nothing here can tap).
for i in {1..80}; do grep -q "^edit-link " "$DA/Documents/share-demo.txt" 2>/dev/null && break; sleep 0.5; done
LINK=$(grep "^edit-link " "$DA/Documents/share-demo.txt" | tail -1 | cut -d' ' -f2)
echo "edit link: $LINK"
sleep 1.5
xcrun simctl io "$A" screenshot "$OUT/emil-share-edit.png" >/dev/null 2>&1 || true
echo "join $LINK" > "$DB/Documents/demo-command.txt"
sleep 3.5
xcrun simctl io "$A" screenshot "$OUT/emil-share-people.png" >/dev/null 2>&1 || true
xcrun simctl io "$B" screenshot "$OUT/sara-joined.png" >/dev/null 2>&1 || true
sleep "${DURATION:-34}"
xcrun simctl io "$A" screenshot "$OUT/emil-end.png" >/dev/null 2>&1 || true
xcrun simctl io "$B" screenshot "$OUT/sara-end.png" >/dev/null 2>&1 || true
kill -INT $RA $RB; wait $RA $RB 2>/dev/null || true

# Side by side on the website's cream (this ffmpeg has no drawtext; the page names the phones).
ffmpeg -y -loglevel error -i "$OUT/emil.mp4" -i "$OUT/sara.mp4" -filter_complex \
  "[0:v]scale=-2:1400,pad=iw+60:ih+60:30:30:color=0xF6EFE7[a];[1:v]scale=-2:1400,pad=iw+60:ih+60:30:30:color=0xF6EFE7[b];\
   [a][b]hstack=inputs=2,fps=30,format=yuv420p" -c:v libx264 -crf 22 -preset medium "$OUT/side-by-side.mp4"
echo "$OUT"
