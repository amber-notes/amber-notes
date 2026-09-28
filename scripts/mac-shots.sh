#!/bin/zsh
# Captures the Mac app's window with a given note open, without any input events.
#   scripts/mac-shots.sh <out-dir> "Note title" ["Another title" ...]
set -e
cd "$(dirname "$0")/.."
OUT="$1"; shift
mkdir -p "$OUT"
APP=build/ddmac/Build/Products/Debug/Pane.app
for title in "$@"; do
  open -n "$APP" --args -uitest -demo -open "$title"
  sleep 0.5
  PID=$(pgrep -f "$PWD/$APP/Contents/MacOS/Pane" | head -1)
  for i in {1..40}; do W=$(swift scripts/window-id.swift "$PID" 2>/dev/null); [ -n "$W" ] && break; sleep 0.25; done
  sleep 2.5
  screencapture -x -o -l "${W%% *}" "$OUT/$(echo "$title" | tr ' /' '--').png"
  pkill -f "$PWD/$APP/Contents/MacOS/Pane" || true
  sleep 0.5
done
