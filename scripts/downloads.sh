#!/bin/zsh
# Prints the website's daily Mac download totals (supabase/migrations/20261001150000_download_counts.sql).
#
#   scripts/downloads.sh        # the last 30 days
#   scripts/downloads.sh 90     # the last 90 days
#
# Reads the site_downloads_daily view with the service key in .secrets/supabase-service-key.txt (in
# the main checkout, so every worktree shares it). The first run fetches the key with the Supabase CLI
# (`supabase login` first) and saves it there. The key is never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
days=${1:-30}
[[ $days == <1-> ]] || { echo "usage: scripts/downloads.sh [days]" >&2; exit 1; }

REF=${SUPABASE_PROJECT_REF:-rodegaeruhyybqilrnpn}
url=${SUPABASE_URL:-https://$REF.supabase.co}
secrets="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)/.secrets"
keyfile="$secrets/supabase-service-key.txt"

if [[ ! -s $keyfile ]]; then
  echo "→ Fetching the service key into .secrets (once)" >&2
  mkdir -p "$secrets"
  (umask 077; supabase projects api-keys --project-ref "$REF" -o json 2>/dev/null \
    | python3 -c "import sys,json;k=json.JSONDecoder().raw_decode(sys.stdin.read())[0];print(next(x['api_key'] for x in k if x.get('name')=='service_role'))" \
    > "$keyfile") || { rm -f "$keyfile"; echo "Couldn't fetch the key. Run supabase login, or put the service key in $keyfile." >&2; exit 1; }
fi
key=$(<"$keyfile")

table=$(cat <<'PY'
import sys, json
rows = json.load(sys.stdin)
if not rows:
    print("No downloads counted in this period.")
    sys.exit()
print(f"{'Day':<12}{'Product':<9}{'Downloads':>10}{'All time':>10}")
for r in rows:
    print(f"{r['day']:<12}{r['product']:<9}{r['downloads']:>10}{r['total']:>10}")
print(f"{'':<21}{sum(r['downloads'] for r in rows):>10}  in the last {sys.argv[1]} days")
PY
)
since=$(date -u -v-"$((days - 1))"d +%Y-%m-%d)
rows=$(curl -sf "$url/rest/v1/site_downloads_daily?select=day,product,downloads,total&day=gte.$since" \
  -H "apikey: $key" -H "Authorization: Bearer $key") \
  || { echo "Couldn't read the totals. Is 20261001150000_download_counts.sql applied?" >&2; exit 1; }
print -r -- "$rows" | python3 -c "$table" "$days"
