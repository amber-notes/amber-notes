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

# The legal pages ship as committed, never as someone's unsaved edit (DOCS_FROM_WORKTREE=1 overrides).
for doc in privacy-policy terms-of-use support; do
  if [[ ${DOCS_FROM_WORKTREE:-0} == 1 ]]; then cp "docs/$doc.md" "web/content/$doc.md"
  else git show "HEAD:docs/$doc.md" > "web/content/$doc.md"; fi
done
# Salt for hashing who reported a shared page (never stored anywhere else).
mkdir -p .secrets && [[ -s .secrets/report-salt.txt ]] || openssl rand -hex 32 > .secrets/report-salt.txt
salt=$(cat .secrets/report-salt.txt)
# Shared with the MCP function: lets it trust the caller's address the mcp.ambernotes.app proxy passes
# on (web/middleware.ts). Set the same value on the function:
#   supabase secrets set MCP_PROXY_SECRET="$(cat .secrets/mcp-proxy-secret.txt)" --project-ref <ref>
[[ -s .secrets/mcp-proxy-secret.txt ]] || openssl rand -hex 32 > .secrets/mcp-proxy-secret.txt
proxy_secret=$(cat .secrets/mcp-proxy-secret.txt)
cd web
vercel link --yes --project amber-notes --scope "$team" >/dev/null
for env in production preview; do
  pairs=("SUPABASE_URL=$url" "SUPABASE_ANON_KEY=$key" "REPORT_SALT=$salt")
  # Only production proxies mcp.ambernotes.app; a preview never holds the secret.
  [[ $env == production ]] && pairs+=("MCP_PROXY_SECRET=$proxy_secret")
  for pair in "${pairs[@]}"; do
    name=${pair%%=*}; value=${pair#*=}
    vercel env rm "$name" "$env" --yes --scope "$team" >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$name" "$env" --scope "$team" >/dev/null
  done
done
vercel env rm MCP_PROXY_SECRET preview --yes --scope "$team" >/dev/null 2>&1 || true
url=$(vercel deploy --prod --yes --scope "$team" 2>/dev/null | tail -1)
echo "$url"
mkdir -p ../.secrets && echo "https://ambernotes.app/privacy" > ../.secrets/privacy-url.txt  # the stable alias, not this deployment
