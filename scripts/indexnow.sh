#!/bin/zsh
# Tells IndexNow search engines (Bing, and through it ChatGPT search; also Yandex, Seznam, Naver)
# that every page in the live sitemap may have changed. Runs after each web deploy; safe to run by hand.
# The key is public by design: IndexNow checks it at https://ambernotes.app/<key>.txt.
set -euo pipefail
cd "$(dirname "$0")/.."
key_file=$(ls web/public | grep -E '^[0-9a-f]{32}\.txt$' | head -1)
[[ -n $key_file ]] || { echo "indexnow: no key file in web/public" >&2; exit 1; }
key=${key_file%.txt}
curl -sf https://ambernotes.app/sitemap.xml | python3 -c '
import json, re, sys
key = sys.argv[1]
urls = re.findall(r"<loc>([^<]+)</loc>", sys.stdin.read())
print(json.dumps({"host": "ambernotes.app", "key": key,
  "keyLocation": f"https://ambernotes.app/{key}.txt", "urlList": urls}))
' "$key" | curl -s -o /dev/null -w "indexnow: HTTP %{http_code}\n" -X POST https://api.indexnow.org/indexnow \
  -H 'content-type: application/json; charset=utf-8' --data-binary @-
