#!/bin/zsh
# Archives Amber Notes and uploads it to App Store Connect for TestFlight.
#
#   scripts/testflight.sh [ios|mac|both]      (default: both)
#   UPLOAD=0 scripts/testflight.sh ios        (archive + export only, no upload)
#
# Builds from the clean checkout of main (../AmberNotes-install), so work in
# progress never ships. The build number is a timestamp (yymmddHHMM), set on the
# command line so git stays clean. Upload auth is the App Store Connect API key in
# .secrets/ (asc.env with ASC_KEY_ID and ASC_ISSUER_ID, plus AuthKey_<id>.p8).
# The Mac build is sandboxed (Pane-mac-appstore.entitlements), as TestFlight requires.
set -euo pipefail
MAIN="$(cd "$(dirname "$0")/.." && pwd)"
CLEAN="$MAIN/../AmberNotes-install"
OUT="$MAIN/build/testflight"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
WHICH=${1:-both}
UPLOAD=${UPLOAD:-1}
TEAM=4UM3XVUN9Y
BUILD=${BUILD:-$(date +%y%m%d%H%M)}

auth=()
if [[ -f $MAIN/.secrets/asc.env ]]; then
  source "$MAIN/.secrets/asc.env"
  KEY="$MAIN/.secrets/AuthKey_${ASC_KEY_ID}.p8"
  [[ -f $KEY ]] || KEY=$(ls "$MAIN"/.secrets/*.p8 | head -1)
  auth=(-authenticationKeyPath "$KEY" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
elif [[ $UPLOAD == 1 ]]; then
  echo "No .secrets/asc.env: can't upload. Use UPLOAD=0 to archive only." >&2; exit 1
fi

[[ -d $CLEAN ]] || git -C "$MAIN" worktree add --detach "$CLEAN" main
git -C "$CLEAN" checkout -q -f --detach main
cp "$MAIN/Config/Backend.local.xcconfig" "$CLEAN/Config/"
(cd "$CLEAN" && xcodegen generate >/dev/null)
mkdir -p "$OUT"

exportopts="$OUT/ExportOptions-$UPLOAD.plist"
cat > "$exportopts" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$([[ $UPLOAD == 1 ]] && echo upload || echo export)</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

ship() {
  local platform=$1 dest=$2; shift 2
  local archive="$OUT/$platform-$BUILD.xcarchive"
  echo "→ $platform build $BUILD: archiving"
  xcodebuild archive -project "$CLEAN/Pane.xcodeproj" -scheme Pane -configuration Release \
    -destination "$dest" -archivePath "$archive" -allowProvisioningUpdates "${auth[@]}" \
    DEVELOPMENT_TEAM=$TEAM CODE_SIGN_STYLE=Automatic CODE_SIGN_IDENTITY="Apple Development" \
    PROVISIONING_PROFILE_SPECIFIER= CURRENT_PROJECT_VERSION=$BUILD "$@" \
    > "$OUT/$platform-$BUILD-archive.log" 2>&1 || { grep -E " error: " "$OUT/$platform-$BUILD-archive.log" | head -20; return 1; }
  echo "→ $platform build $BUILD: $([[ $UPLOAD == 1 ]] && echo uploading || echo exporting)"
  xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$exportopts" \
    -exportPath "$OUT/$platform-$BUILD-export" -allowProvisioningUpdates "${auth[@]}" \
    > "$OUT/$platform-$BUILD-export.log" 2>&1 || { grep -iE "error|fail" "$OUT/$platform-$BUILD-export.log" | head -20; return 1; }
  echo "✓ $platform build $BUILD $([[ $UPLOAD == 1 ]] && echo "uploaded" || echo "exported to $OUT/$platform-$BUILD-export")"
}

# The Mac app installs as "Amber Notes.app" (dev builds keep the Pane product name), sandboxed.
macArgs=(PANE_MAC_ENTITLEMENTS=Pane-mac-appstore.entitlements "PANE_PRODUCT_NAME=Amber Notes")

case $WHICH in
  ios)  ship ios 'generic/platform=iOS' ;;
  mac)  ship mac 'generic/platform=macOS' "${macArgs[@]}" ;;
  both) ship ios 'generic/platform=iOS'; ship mac 'generic/platform=macOS' "${macArgs[@]}" ;;
  *) echo "usage: $0 [ios|mac|both]" >&2; exit 2 ;;
esac
echo "Version 1.0 ($BUILD)"
