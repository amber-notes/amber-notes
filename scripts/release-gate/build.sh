#!/bin/zsh
# The release gate's builds of one commit (docs/Technical/release-gate.md):
#
#   scripts/release-gate/build.sh <ref> <out dir>
#
# Writes into <out dir>:
#   Amber Notes Beta.app   the Mac Release build (PaneDirect, Developer ID, team-signed), on the
#                          staging backend, with the gate's probe added (GateProbe.swift)
#   Amber-Notes-Beta.dmg   its DMG, as the download would be (not notarized)
#   ios/Pane.app           the iPhone Release build, unsigned, for its size
#   sizes.json             app, DMG and iPhone sizes
#
# The probe is the only change to the ref's code: GateProbe.swift goes into Pane/App, one line in
# PaneApp.init attaches it, and AppNetwork's session counts its requests. A ref older than Amber
# Notes Beta (Config/Beta.xcconfig, db66affa) gets that commit applied first, so it never shares
# the real app's bundle id, data or keychain.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REF=${1:?usage: build.sh <ref> <out dir>}
OUT=${2:?usage: build.sh <ref> <out dir>}
[[ -n ${DEVELOPER_DIR:-} ]] || export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
STAGING_CONFIG=${AMBER_STAGING_CONFIG:-$ROOT/Config/Backend.staging.local.xcconfig}
[[ -f $STAGING_CONFIG ]] || { echo "No $STAGING_CONFIG: run scripts/staging.sh app-config." >&2; exit 1; }
BETA_COMMIT=db66affa9ab1ae5de18471044248e05f76fe88c4

SHA=$(git -C "$ROOT" rev-parse --verify "$REF^{commit}")
SRC="$ROOT/build/release-gate/src-${SHA:0:10}"
DD="$ROOT/build/release-gate/dd-${SHA:0:10}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

echo "→ Checkout ${SHA:0:10} ($REF)"
if [[ -d $SRC ]]; then git -C "$SRC" checkout -q --force --detach "$SHA" && git -C "$SRC" clean -qfdx -e build
else git -C "$ROOT" worktree add -q --detach "$SRC" "$SHA"; fi
cd "$SRC"
if [[ ! -f Config/Beta.xcconfig ]]; then
  echo "→ Apply Amber Notes Beta (${BETA_COMMIT:0:8}): $REF predates it"
  git cherry-pick -n "$BETA_COMMIT" >/dev/null 2>&1 || true
  # Files the ref doesn't have stay out; for the rest the ref's own version wins (only the identity matters).
  git diff --name-only --diff-filter=U | while read -r f; do
    if [[ $(git status --porcelain -- "$f") == DU* ]]; then git rm -q --cached -- "$f"; rm -f -- "$f"
    else git checkout -q --ours -- "$f" && git add -- "$f"; fi
  done
  [[ -f Config/Beta.xcconfig ]] || { echo "Couldn't apply the Beta identity." >&2; exit 1; }
fi
cp "$STAGING_CONFIG" Config/Backend.staging.local.xcconfig

echo "→ Add the probe"
cp "$ROOT/scripts/release-gate/GateProbe.swift" Pane/App/GateProbe.swift
python3 - <<'PY'
import re, sys
def patch(path, old, new):
    s = open(path).read()
    if s.count(old) != 1: sys.exit(f"release gate: '{old.strip()}' should appear once in {path}")
    open(path, "w").write(s.replace(old, new))
patch("Pane/App/PaneApp.swift", "        _sync = State(initialValue: sync)\n",
      "        _sync = State(initialValue: sync)\n        #if os(macOS)\n        GateProbe.attach(backend: backend, sync: sync, container: container)\n        #endif\n")
patch("Pane/Sync/NetFault.swift", "        return .shared\n", "        #if os(macOS)\n        return GateNet.session\n        #else\n        return .shared\n        #endif\n")
PY
xcodegen generate >/dev/null

echo "→ Mac Release archive"
ARCHIVE="$DD/AmberNotes.xcarchive"
rm -rf "$ARCHIVE" "$DD/export"
nice -n 10 xcodebuild -project Pane.xcodeproj -scheme AmberNotesDirect -configuration Release \
  -destination 'generic/platform=macOS' -derivedDataPath "$DD" -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates -xcconfig Config/Beta.xcconfig DEVELOPMENT_TEAM=4UM3XVUN9Y CODE_SIGN_STYLE=Automatic \
  CODE_SIGN_IDENTITY="Apple Development" MARKETING_VERSION="gate-${SHA:0:7}" CURRENT_PROJECT_VERSION="$(date -u +%Y%m%d%H%M)" \
  archive > "$OUT/build-mac.log" 2>&1 || { grep -E ": error: " "$OUT/build-mac.log" | head -20 >&2; echo "Archive failed: $OUT/build-mac.log" >&2; exit 1; }
cat > "$DD/Export.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>developer-id</string>
<key>signingStyle</key><string>automatic</string>
<key>teamID</key><string>4UM3XVUN9Y</string>
<key>destination</key><string>export</string>
</dict></plist>
EOF
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$DD/Export.plist" -exportPath "$DD/export" \
  -allowProvisioningUpdates >> "$OUT/build-mac.log" 2>&1 || { echo "Export failed: $OUT/build-mac.log" >&2; exit 1; }
APP="$DD/export/Amber Notes Beta.app"
codesign --verify --deep --strict "$APP"
rm -rf "$OUT/Amber Notes Beta.app"
ditto "$APP" "$OUT/Amber Notes Beta.app"
codesign -d --entitlements - --xml "$APP" > "$OUT/entitlements.plist" 2>/dev/null

echo "→ DMG"
rm -f "$OUT/Amber-Notes-Beta.dmg"
"$SRC/scripts/dmg/build-dmg.sh" "$APP" "$OUT/Amber-Notes-Beta.dmg" >> "$OUT/build-mac.log" 2>&1 \
  || hdiutil create -quiet -fs APFS -format ULMO -srcfolder "$APP" "$OUT/Amber-Notes-Beta.dmg"

echo "→ iPhone Release build (unsigned, for its size)"
rm -rf "$OUT/ios"
if nice -n 10 xcodebuild -project Pane.xcodeproj -scheme Pane -configuration Release -destination 'generic/platform=iOS' \
     -derivedDataPath "$DD-ios" -xcconfig Config/Beta.xcconfig CODE_SIGNING_ALLOWED=NO build > "$OUT/build-ios.log" 2>&1; then
  mkdir -p "$OUT/ios"
  ditto "$(ls -d "$DD-ios"/Build/Products/Release-iphoneos/*.app | head -1)" "$OUT/ios/Pane.app"
else
  echo "  iPhone build failed: $OUT/build-ios.log" >&2
fi

python3 - "$OUT" <<'PY'
import json, os, subprocess, sys, zipfile
out = sys.argv[1]
def du(p):
    return sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(p) for f in fs if not os.path.islink(os.path.join(d, f))) if os.path.exists(p) else None
sizes = {"macAppBytes": du(os.path.join(out, "Amber Notes Beta.app")),
         "macDmgBytes": os.path.getsize(os.path.join(out, "Amber-Notes-Beta.dmg")) if os.path.exists(os.path.join(out, "Amber-Notes-Beta.dmg")) else None,
         "iosAppBytes": du(os.path.join(out, "ios/Pane.app"))}
# The App Store's download is the app compressed: the zipped .app is the closest stand-in without App Store thinning.
ios = os.path.join(out, "ios/Pane.app")
if os.path.exists(ios):
    z = os.path.join(out, "ios/Pane.ipa.zip")
    subprocess.run(["ditto", "-c", "-k", "--keepParent", ios, z], check=True)
    sizes["iosCompressedBytes"] = os.path.getsize(z)
json.dump(sizes, open(os.path.join(out, "sizes.json"), "w"), indent=1)
print(json.dumps(sizes))
PY
echo "✓ $OUT"
