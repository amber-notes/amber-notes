#!/bin/zsh
# Builds the Amber Notes DMG with its styled window: dmgbuild writes the window settings
# (.DS_Store), background and volume icon straight into the image. No Finder, no AppleScript.
#
#   scripts/dmg/build-dmg.sh <Amber Notes.app> <out.dmg> [background: dune | dusk | page]
#
# dmgbuild lives in a venv at build/dmg-venv, created on first use, and runs through
# scripts/dmg/run-dmgbuild.py, which works around hdiutil convert failing on this Mac.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
APP=${1:?usage: scripts/dmg/build-dmg.sh <app> <out.dmg> [background]}
OUT=${2:?usage: scripts/dmg/build-dmg.sh <app> <out.dmg> [background]}
BG=${3:-dune}
VENV="$REPO/build/dmg-venv"
[[ -x $VENV/bin/dmgbuild ]] || { python3 -m venv "$VENV" && "$VENV/bin/pip" install -q dmgbuild==1.6.7; }
[[ -f $REPO/brand/dmg/$BG/background.tiff ]] || { echo "No background $BG in brand/dmg." >&2; exit 1; }
"$VENV/bin/python" "$REPO/scripts/dmg/run-dmgbuild.py" -s "$REPO/scripts/dmg/settings.py" -D repo="$REPO" -D app="$APP" -D background="$BG" \
  "Amber Notes" "$OUT" >/dev/null
