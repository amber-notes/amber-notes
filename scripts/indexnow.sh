#!/bin/zsh
# Tells IndexNow search engines (Bing, and through it ChatGPT search; also Yandex, Seznam, Naver)
# that every page in the live sitemap may have changed. Runs after each web deploy; safe to run by hand.
# The key is public by design: IndexNow checks it at https://pintonotes.com/<key>.txt.
#
# `scripts/indexnow.sh --moved` also pings the same pages at the old address, ambernotes.app, so
# those engines fetch them again and see where each one went. Run it once after the move to
# pintonotes.com (October 2026), and again if old addresses linger in Bing. ambernotes.app keeps
# serving the key for this (web/lib/site-move.ts).
set -euo pipefail
cd "$(dirname "$0")/.."
key_file=$(ls web/public | grep -E '^[0-9a-f]{32}\.txt$' | head -1)
[[ -n $key_file ]] || { echo "indexnow: no key file in web/public" >&2; exit 1; }
key=${key_file%.txt}
sitemap=$(curl -sf https://pintonotes.com/sitemap.xml)

ping() { # host
  print -r -- "$sitemap" | python3 -c '
import json, re, sys
key, host = sys.argv[1], sys.argv[2]
urls = [u.replace("https://pintonotes.com", f"https://{host}", 1) for u in re.findall(r"<loc>([^<]+)</loc>", sys.stdin.read())]
print(json.dumps({"host": host, "key": key, "keyLocation": f"https://{host}/{key}.txt", "urlList": urls}))
' "$key" "$1" | curl -s -o /dev/null -w "indexnow $1: HTTP %{http_code}\n" -X POST https://api.indexnow.org/indexnow \
    -H 'content-type: application/json; charset=utf-8' --data-binary @-
}

ping pintonotes.com
if [[ ${1:-} == --moved ]]; then ping ambernotes.app; fi
