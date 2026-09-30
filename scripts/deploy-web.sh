#!/bin/zsh
# Deploys the share site (web/) to Vercel. It lives in Emil's Personal team (moved from Incredible 2026-09-30).
#
#   scripts/deploy-web.sh            # the Personal team
#   scripts/deploy-web.sh <team-id>  # another team
#
# Sets the Supabase URL and anon key from Config/Backend.local.xcconfig, deploys to production,
# and prints the URL. Then put PANE_SHARE_URL = <that URL> in Config/Backend.local.xcconfig.
set -euo pipefail
cd "$(dirname "$0")/.."
team=${1:-emil-wagman-personal}

conf=Config/Backend.local.xcconfig
url=$(grep -E '^PANE_SUPABASE_URL' $conf | sed 's/.*= *//; s|:/\$()/|://|')
key=$(grep -E '^PANE_SUPABASE_KEY' $conf | sed 's/.*= *//')
[[ $url == https://* && -n $key ]] || { echo "Backend.local.xcconfig has no production Supabase settings." >&2; exit 1; }

# The legal pages ship as committed, never as someone's unsaved edit (DOCS_FROM_WORKTREE=1 overrides).
for doc in privacy-policy terms-of-use support; do
  if [[ ${DOCS_FROM_WORKTREE:-0} == 1 ]]; then cp "docs/$doc.md" "web/content/$doc.md"
  else git show "HEAD:docs/$doc.md" > "web/content/$doc.md"; fi
done
# Salt for hashing who reported a shared page (never stored anywhere else).
mkdir -p .secrets && [[ -s .secrets/report-salt.txt ]] || openssl rand -hex 32 > .secrets/report-salt.txt
salt=$(cat .secrets/report-salt.txt)
cd web
vercel link --yes --project amber-notes --scope "$team" >/dev/null
for env in production preview; do
  for pair in "SUPABASE_URL=$url" "SUPABASE_ANON_KEY=$key" "REPORT_SALT=$salt"; do
    name=${pair%%=*}; value=${pair#*=}
    vercel env rm "$name" "$env" --yes --scope "$team" >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$name" "$env" --scope "$team" >/dev/null
  done
done
url=$(vercel deploy --prod --yes --scope "$team" 2>/dev/null | tail -1)
echo "$url"
mkdir -p ../.secrets && echo "https://ambernotes.app/privacy" > ../.secrets/privacy-url.txt  # the stable alias, not this deployment
