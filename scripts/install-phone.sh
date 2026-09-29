#!/bin/zsh
# Builds Amber Notes and installs it on a connected iPhone.
#
#   scripts/install-phone.sh            # the first connected iPhone
#
# Signs with the paid team set in project.yml: an install lasts a year and
# the share extension works (app group group.dev.emilwagman.pane).
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

DD=build/ddphone

# devicectl and xcodebuild name the phone differently: keep both.
json=$(mktemp)
xcrun devicectl list devices --json-output "$json" >/dev/null 2>&1
read device udid <<<"$(python3 -c '
import json, os, sys
want = os.environ.get("PHONE", "Emil")  # only this phone, never another device this Mac knows
for d in json.load(open(sys.argv[1]))["result"]["devices"]:
    hw, cp, props = d.get("hardwareProperties", {}), d.get("connectionProperties", {}), d.get("deviceProperties", {})
    if hw.get("deviceType") == "iPhone" and want.lower() in props.get("name", "").lower() and cp.get("tunnelState") == "connected":
        print(d["identifier"], hw.get("udid", "")); break
' "$json")"
rm -f "$json"
if [[ -z ${device:-} ]]; then
  echo "Your iPhone (${PHONE:-Emil}) isn't connected. Plug it in or put it on the same Wi-Fi, unlock it, and try again." >&2
  exit 1
fi
echo "Installing on $device"

app=$DD/Build/Products/Release-iphoneos/Pane.app
rm -rf "$app" # never install a stale build
xcodegen generate >/dev/null
xcodebuild -project Pane.xcodeproj -scheme Pane -configuration Release \
  -destination "platform=iOS,id=$udid" -derivedDataPath $DD -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  build | grep -E "error|BUILD" || true

[[ -d $app ]] || { echo "Build failed." >&2; exit 1; }
xcrun devicectl device install app --device "$device" "$app"
echo "Installed. First launch: Settings → General → VPN & Device Management → trust your Apple ID."
