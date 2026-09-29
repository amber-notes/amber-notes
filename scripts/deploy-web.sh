#!/bin/zsh
# Deploys the share site (web/) to Vercel, in Emil's personal team only.
#
#   scripts/deploy-web.sh            # finds the personal team (not Incredible, not VISSAI)
#   scripts/deploy-web.sh <team-id>
#
# Sets the Supabase URL and anon key from Config/Backend.local.xcconfig, deploys to production,
# and prints the URL. Then put PANE_SHARE_URL = <that URL> in Config/Backend.local.xcconfig.
set -euo pipefail
cd "$(dirname "$0")/.."
NEVER=(incredible-team vissai)

team=${1:-}
if [[ -z $team ]]; then
  # The CLI prints the table on stderr: "✔ incredible-team  Incredible", "  vissai  VISSAI".
  team=$(vercel teams ls 2>&1 | sed 's/✔//' | awk 'NF>=2 && $1 !~ /^(id|Fetching|Vercel|>)$/ && $1 !~ /:/ {print $1}' | grep -vxE 'incredible-team|vissai' | head -1 || true)
fi
[[ -n $team ]] || { echo "No personal Vercel team yet. Create one at vercel.com/new-team (Hobby)." >&2; exit 2; }
for n in $NEVER; do [[ $team == $n ]] && { echo "Refusing to deploy Amber Notes to $team." >&2; exit 1; }; done

conf=Config/Backend.local.xcconfig
url=$(grep -E '^PANE_SUPABASE_URL' $conf | sed 's/.*= *//; s|:/\$()/|://|')
key=$(grep -E '^PANE_SUPABASE_KEY' $conf | sed 's/.*= *//')
[[ $url == https://* && -n $key ]] || { echo "Backend.local.xcconfig has no production Supabase settings." >&2; exit 1; }

cd web
vercel link --yes --project amber-notes --scope "$team" >/dev/null
for env in production preview; do
  for pair in "SUPABASE_URL=$url" "SUPABASE_ANON_KEY=$key"; do
    name=${pair%%=*}; value=${pair#*=}
    vercel env rm "$name" "$env" --yes --scope "$team" >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$name" "$env" --scope "$team" >/dev/null
  done
done
vercel deploy --prod --yes --scope "$team" 2>/dev/null | tail -1
