#!/bin/zsh
# Records a few seconds of the Mac app per note (opened by launch argument; no input events),
# then joins them. Only the app window's area is recorded, while the app is frontmost.
#   scripts/mac-scenes.sh <out.mp4> "Title" ["Title" ...]
set -e
cd "$(dirname "$0")/.."
OUT="$1"; shift
TMP=$(mktemp -d)
APP=build/ddmac/Build/Products/Debug/Pane.app
n=0
for title in "$@"; do
  open -n "$APP" --args -uitest -demo -open "$title"
  for i in {1..40}; do W=$(swift scripts/window-id.swift Pane 2>/dev/null); [ -n "$W" ] && break; sleep 0.25; done
  sleep 2
  set -- ${=W}
  screencapture -x -v -V 4 -R "$2,$3,$4,$5" "$TMP/$n.mov" >/dev/null 2>&1
  pkill -f "$PWD/$APP/Contents/MacOS/Pane" || true
  n=$((n+1))
  sleep 0.5
done
: > "$TMP/list.txt"
for i in $(seq 0 $((n-1))); do
  echo "clip $i: $(ffprobe -v error -show_entries format=duration -of csv=p=0 $TMP/$i.mov)s"
  ffmpeg -v error -y -i "$TMP/$i.mov" -vf "scale=1600:-2,fps=30,tpad=stop_mode=clone:stop_duration=4,trim=duration=3.5" -c:v libx264 -crf 22 -pix_fmt yuv420p -an "$TMP/$i.mp4"
  echo "file '$TMP/$i.mp4'" >> "$TMP/list.txt"
done
ffmpeg -v error -y -f concat -safe 0 -i "$TMP/list.txt" -c copy "$OUT"
rm -rf "$TMP"
echo "$OUT"
