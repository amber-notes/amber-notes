#!/bin/zsh
# Builds Amber Notes for the Mac, team-signed so Sign in with Apple works, from a
# clean checkout of main, and installs it to /Applications.
#
#   scripts/install-mac.sh
#
# Development and test builds stay ad-hoc (Pane-mac.entitlements): a restricted
# entitlement without a provisioning profile would stop them launching.
set -euo pipefail
MAIN="$(cd "$(dirname "$0")/.." && pwd)"
CLEAN="$MAIN/../AmberNotes-install"
DD="$MAIN/build/ddinstall"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

[[ -d $CLEAN ]] || git -C "$MAIN" worktree add --detach "$CLEAN" main
# The clean checkout only ever holds generated changes (xcodegen): drop them.
git -C "$CLEAN" checkout -q -f --detach main
cp "$MAIN/Config/Backend.local.xcconfig" "$CLEAN/Config/"
(cd "$CLEAN" && xcodegen generate >/dev/null)

app=$DD/Build/Products/Release/Pane.app
rm -rf "$app" # never install a stale build
xcodebuild -project "$CLEAN/Pane.xcodeproj" -scheme Pane -configuration Release -destination 'platform=macOS' \
  -derivedDataPath "$DD" -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM=4UM3XVUN9Y CODE_SIGN_STYLE=Automatic CODE_SIGN_IDENTITY="Apple Development" \
  PROVISIONING_PROFILE_SPECIFIER= PANE_MAC_ENTITLEMENTS=Pane-mac-signed.entitlements \
  build | grep -E "error:|\*\* BUILD" || true
[[ -d $app ]] || { echo "Build failed." >&2; exit 1; }

# Quit the running copy (exact PID), swap it, relaunch.
pid=$(pgrep -f "/Applications/Amber Notes.app/Contents/MacOS/" | head -1 || true)
[[ -n $pid ]] && kill "$pid" && sleep 1.5
rm -rf "/Applications/Amber Notes.app"
cp -R "$app" "/Applications/Amber Notes.app"
open "/Applications/Amber Notes.app"
echo "Installed /Applications/Amber Notes.app ($(codesign -dv "/Applications/Amber Notes.app" 2>&1 | grep TeamIdentifier))"
