#!/bin/zsh
# Captures the App Store scenes from a booted iPhone 17 Pro Max simulator at 1320×2868.
#   SIM=<udid> scripts/store-art/capture.sh [out-dir]
# The simulator must have the app installed (a Debug-iphonesimulator build). The first time the
# locale changes, reboot the simulator so the status bar picks it up.
set -euo pipefail
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "$(dirname "$0")/../.."
OUT=${1:-$PWD/.shots/appstore/art/captures}; [[ $OUT = /* ]] || OUT=$PWD/$OUT
mkdir -p "$OUT"
APP=dev.emilwagman.pane
: "${SIM:?set SIM to the simulator udid}"
# US English (9:41, US dates) and a clean status bar.
xcrun simctl spawn "$SIM" defaults write -g AppleLocale en_US
xcrun simctl spawn "$SIM" defaults write -g AppleLanguages -array en-US
xcrun simctl status_bar "$SIM" override --time "9:41" --batteryState discharging --batteryLevel 100 \
  --cellularMode active --cellularBars 4 --wifiBars 3 --operatorName ""

shoot() { # name appearance args...
  local name=$1 look=$2; shift 2
  xcrun simctl ui "$SIM" appearance "$look"
  xcrun simctl terminate "$SIM" $APP 2>/dev/null || true
  xcrun simctl launch "$SIM" $APP -uitest -demo "$@" >/dev/null
  sleep ${WAIT:-4}
  xcrun simctl io "$SIM" screenshot --type=png "$OUT/$name.png" >/dev/null
  echo "$OUT/$name.png"
}

shoot 1-paella light -storeScene paella -highlight "Paella rice|Saffron|Chorizo|Chicken thighs|Smoked paprika" -open Groceries
shoot 2-lisbon light -storeScene lisbon -highlight "Late checkout requested, confirm by 10 May" -open Lisbon
shoot 3-list light
shoot 4-groceries light -storeScene tick -open Groceries
shoot 5-files light -open "Trip documents"
shoot 6-lisbon-dark dark -open Lisbon
xcrun simctl ui "$SIM" appearance light
