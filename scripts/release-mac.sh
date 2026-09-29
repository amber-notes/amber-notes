#!/bin/zsh
# Releases Amber Notes for Mac: a notarized DMG on amber-notes.vercel.app/download, and a
# Sparkle update that every installed copy picks up within a day.
#
#   scripts/release-mac.sh 1.0.1 "What changed, one line per item"
#
# From a clean checkout of main (../AmberNotes-install): archive the PaneDirect target,
# export with Developer ID, notarize and staple the app, build the DMG, notarize and staple
# it, sign it for Sparkle (EdDSA key in the login Keychain), write the appcast and the
# download page's release.json, deploy the site, and tag the commit.
#
# Needs: .secrets/AuthKey_*.p8 + .secrets/asc.env (ASC_KEY_ID, ASC_ISSUER_ID) for notarytool,
# and the Sparkle key in the Keychain (account "amber-notes"). scripts/dmg/build-dmg.sh sets up
# dmgbuild in build/dmg-venv on first use.
#
# CI (.github/workflows/release.yml) runs the same steps with these set:
#   IN_PLACE=1                 build the current checkout instead of ../AmberNotes-install
#   ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID   the notarization key
#   SPARKLE_KEY_FILE           the Sparkle private key as a file (instead of the Keychain)
#   SKIP_DEPLOY=1, SKIP_TAG=1  the workflow deploys the site and tags the release itself
set -euo pipefail
MAIN="$(cd "$(dirname "$0")/.." && pwd)"
CLEAN="$MAIN/../AmberNotes-install"
DIST="$MAIN/build/dist"
DD="$MAIN/build/dddirect"
[[ -n ${DEVELOPER_DIR:-} ]] || export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
IN_PLACE=${IN_PLACE:-0}
[[ $IN_PLACE == 1 ]] && CLEAN="$MAIN"

VERSION=${1:?usage: scripts/release-mac.sh <version> [release notes]}
NOTES=${2:-}
BUILD=$(date -u +%Y%m%d%H%M)   # CFBundleVersion: always increasing, which is what Sparkle compares
FILE="Amber-Notes-$VERSION.dmg"   # for Sparkle (the appcast points here)
STABLE="Amber-Notes.dmg"          # for people (the download buttons point here)
MIN_OS=26.0

if [[ -n ${ASC_KEY_PATH:-} ]]; then
  KEY="$ASC_KEY_PATH"
else
  source "$MAIN/.secrets/asc.env"
  KEY="$MAIN/.secrets/AuthKey_${ASC_KEY_ID}.p8"
fi
[[ -f $KEY ]] || { echo "Missing $KEY (App Store Connect API key)." >&2; exit 1; }
# With the key in env (CI), Xcode signs through App Store Connect (cloud-managed certificates);
# locally it uses the Apple ID signed into Xcode.
auth=()
[[ -n ${ASC_KEY_PATH:-} ]] && auth=(-authenticationKeyPath "$KEY" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
notarize() { xcrun notarytool submit "$1" --key "$KEY" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" --wait --timeout 3h; }  # a team's first notarizations can take an hour or more

if [[ $IN_PLACE != 1 ]]; then
  echo "→ Clean checkout of main"
  [[ -d $CLEAN ]] || git -C "$MAIN" worktree add --detach "$CLEAN" main
  git -C "$CLEAN" checkout -q --detach main
  cp "$MAIN/Config/Backend.local.xcconfig" "$CLEAN/Config/"
fi
COMMIT=$(git -C "$CLEAN" rev-parse --short HEAD)
(cd "$CLEAN" && xcodegen generate >/dev/null)

echo "→ Archive $VERSION ($BUILD) from $COMMIT"
rm -rf "$DIST" && mkdir -p "$DIST"
xcodebuild -project "$CLEAN/Pane.xcodeproj" -scheme AmberNotesDirect -configuration Release \
  -destination 'generic/platform=macOS' -derivedDataPath "$DD" -archivePath "$DIST/AmberNotes.xcarchive" \
  -allowProvisioningUpdates "${auth[@]}" DEVELOPMENT_TEAM=4UM3XVUN9Y CODE_SIGN_STYLE=Automatic CODE_SIGN_IDENTITY="Apple Development" \
  MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD" archive | grep -E ": error: |\*\* ARCHIVE" || true
[[ -d $DIST/AmberNotes.xcarchive ]] || { echo "Archive failed." >&2; exit 1; }

echo "→ Export with Developer ID"
cat > "$DIST/ExportDeveloperID.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>developer-id</string>
<key>signingStyle</key><string>automatic</string>
<key>teamID</key><string>4UM3XVUN9Y</string>
<key>destination</key><string>export</string>
</dict></plist>
EOF
xcodebuild -exportArchive -archivePath "$DIST/AmberNotes.xcarchive" -exportOptionsPlist "$DIST/ExportDeveloperID.plist" \
  -exportPath "$DIST/export" -allowProvisioningUpdates "${auth[@]}" | grep -E "error|EXPORT" || true
APP="$DIST/export/Amber Notes.app"
[[ -d $APP ]] || { echo "Export failed." >&2; exit 1; }
codesign --verify --deep --strict "$APP"

echo "→ Notarize the app"
ditto -c -k --keepParent "$APP" "$DIST/app.zip"
notarize "$DIST/app.zip"
xcrun stapler staple "$APP"

echo "→ DMG"
# dmgbuild writes the window (background, icon positions, hidden bars, volume icon) straight into
# the compressed image. Don't re-pack it with `hdiutil create -srcfolder`: that drops the
# .DS_Store, and the window falls back to Finder's default.
"$CLEAN/scripts/dmg/build-dmg.sh" "$APP" "$DIST/$FILE"
# The Developer ID certificate is cloud-managed (only Xcode's export can use it); sign the DMG
# too when a local Developer ID identity exists. Notarization doesn't need a signed DMG.
if security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  codesign -s "Developer ID Application: Emil Wagman (4UM3XVUN9Y)" --timestamp "$DIST/$FILE"
fi

echo "→ Notarize the DMG"
notarize "$DIST/$FILE"
xcrun stapler staple "$DIST/$FILE"
# The app must pass Gatekeeper as notarized Developer ID. The DMG carries a stapled ticket but no
# signature of its own (cloud-managed certificate), which Gatekeeper accepts for disk images;
# spctl can't assess an unsigned DMG, so that line is informational only.
spctl -a -vv "$APP" 2>&1 | grep -q "source=Notarized Developer ID" || { echo "The app didn't pass Gatekeeper." >&2; spctl -a -vv "$APP"; exit 1; }
xcrun stapler validate "$DIST/$FILE" >/dev/null || { echo "The DMG has no notarization ticket." >&2; exit 1; }

echo "→ Sparkle signature and appcast"
SIGN=$(ls "$DD"/SourcePackages/artifacts/sparkle/Sparkle/bin/sign_update)
if [[ -n ${SPARKLE_KEY_FILE:-} ]]; then
  ATTRS=$("$SIGN" --ed-key-file "$SPARKLE_KEY_FILE" "$DIST/$FILE")
else
  ATTRS=$("$SIGN" --account amber-notes "$DIST/$FILE")
fi   # sparkle:edSignature="…" length="…"
SIZE=$(stat -f %z "$DIST/$FILE")
DATE=$(date -u "+%a, %d %b %Y %H:%M:%S +0000")
ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ITEMS=""
if [[ -n $NOTES ]]; then
  ITEMS=$(print -r -- "$NOTES" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g' | awk 'NF {print "<li>" $0 "</li>"}' | tr -d '\n')
fi
WEB="$CLEAN/web"
mkdir -p "$WEB/public/downloads" "$WEB/public/updates"
# Two copies of the same DMG: Amber-Notes.dmg is what people download (a stable name), and the
# versioned one is what Sparkle fetches, so the appcast's signature and length always match it.
rm -f "$WEB/public/downloads/"Amber-Notes*.dmg(N)   # old versioned and stable copies; (N): none yet is fine
cp "$DIST/$FILE" "$WEB/public/downloads/$FILE"
cp "$DIST/$FILE" "$WEB/public/downloads/$STABLE"
cat > "$WEB/public/updates/appcast.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Amber Notes</title>
    <link>https://amber-notes.vercel.app/updates/appcast.xml</link>
    <item>
      <title>Version $VERSION</title>
      <pubDate>$DATE</pubDate>
      <sparkle:version>$BUILD</sparkle:version>
      <sparkle:shortVersionString>$VERSION</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>$MIN_OS</sparkle:minimumSystemVersion>
      <description><![CDATA[<ul>$ITEMS</ul>]]></description>
      <enclosure url="https://amber-notes.vercel.app/downloads/$FILE" type="application/octet-stream" $ATTRS />
    </item>
  </channel>
</rss>
EOF
cat > "$WEB/content/release.json" <<EOF
{ "version": "$VERSION", "build": "$BUILD", "size": $SIZE, "date": "$ISO", "file": "$STABLE", "sparkleFile": "$FILE", "minimumSystemVersion": "$MIN_OS" }
EOF

if [[ ${SKIP_DEPLOY:-0} != 1 ]]; then
  echo "→ Deploy the site"
  (cd "$CLEAN" && scripts/deploy-web.sh)
fi
[[ ${SKIP_TAG:-0} == 1 ]] || git -C "$MAIN" tag -f "mac-v$VERSION" "$COMMIT"

echo "✓ Amber Notes $VERSION ($BUILD) is live: https://amber-notes.vercel.app/download"
