#!/bin/zsh
# Deploys the share site (web/) to Vercel. Emil chose the Incredible team for it (2026-09-29).
#
#   scripts/deploy-web.sh            # the Incredible team
#   scripts/deploy-web.sh <team-id>  # another team
#
# Sets the Supabase URL and anon key from Config/Backend.local.xcconfig, deploys to production,
# and prints the URL. Then put PANE_SHARE_URL = <that URL> in Config/Backend.local.xcconfig.
set -euo pipefail
cd "$(dirname "$0")/.."
team=${1:-incredible-team}

conf=Config/Backend.local.xcconfig
url=$(grep -E '^PANE_SUPABASE_URL' $conf | sed 's/.*= *//; s|:/\$()/|://|')
key=$(grep -E '^PANE_SUPABASE_KEY' $conf | sed 's/.*= *//')
[[ $url == https://* && -n $key ]] || { echo "Backend.local.xcconfig has no production Supabase settings." >&2; exit 1; }

cp docs/privacy-policy.md web/content/privacy-policy.md
cd web
vercel link --yes --project amber-notes --scope "$team" >/dev/null
for env in production preview; do
  for pair in "SUPABASE_URL=$url" "SUPABASE_ANON_KEY=$key"; do
    name=${pair%%=*}; value=${pair#*=}
    vercel env rm "$name" "$env" --yes --scope "$team" >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$name" "$env" --scope "$team" >/dev/null
  done
done
url=$(vercel deploy --prod --yes --scope "$team" 2>/dev/null | tail -1)
echo "$url"
mkdir -p ../.secrets && echo "$url/privacy" > ../.secrets/privacy-url.txt
