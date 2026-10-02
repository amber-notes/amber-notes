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
# Shared with the MCP function: lets it trust the caller's address the mcp.ambernotes.app proxy passes
# on (web/middleware.ts). Set the same value on the function:
#   supabase secrets set MCP_PROXY_SECRET="$(cat .secrets/mcp-proxy-secret.txt)" --project-ref <ref>
[[ -s .secrets/mcp-proxy-secret.txt ]] || openssl rand -hex 32 > .secrets/mcp-proxy-secret.txt
proxy_secret=$(cat .secrets/mcp-proxy-secret.txt)
# Website usage with PostHog (web/lib/posthog.ts), production only, from the environment or
# .secrets/posthog-key.txt. Public: it's in the page. Unset leaves whatever Vercel already has, and
# without a key in Vercel either the site loads no PostHog. docs/Evidence/website-posthog.md.
posthog_key=${NEXT_PUBLIC_POSTHOG_KEY:-$(cat .secrets/posthog-key.txt 2>/dev/null || true)}
cd web
vercel link --yes --project amber-notes --scope "$team" >/dev/null
for env in production preview; do
  pairs=("SUPABASE_URL=$url" "SUPABASE_ANON_KEY=$key" "REPORT_SALT=$salt")
  # Only production proxies mcp.ambernotes.app; a preview never holds the secret.
  [[ $env == production ]] && pairs+=("MCP_PROXY_SECRET=$proxy_secret")
  [[ $env == production && -n $posthog_key ]] && pairs+=("NEXT_PUBLIC_POSTHOG_KEY=$posthog_key")
  # The region the functions work in (the same value as the functions' FUNCTION_REGION secret), so
  # the site's own calls go straight there. Unset leaves whatever Vercel already has.
  [[ $env == production && -n ${FUNCTION_REGION:-} ]] && pairs+=("FUNCTION_REGION=$FUNCTION_REGION")
  for pair in "${pairs[@]}"; do
    name=${pair%%=*}; value=${pair#*=}
    vercel env rm "$name" "$env" --yes --scope "$team" >/dev/null 2>&1 || true
    # Secrets are stored as Sensitive, so nobody can read them back from the Vercel dashboard.
    flags=(); [[ $name == REPORT_SALT || $name == MCP_PROXY_SECRET ]] && flags=(--sensitive)
    printf '%s' "$value" | vercel env add "$name" "$env" "${flags[@]}" --scope "$team" >/dev/null
  done
done
vercel env rm MCP_PROXY_SECRET preview --yes --scope "$team" >/dev/null 2>&1 || true
url=$(vercel deploy --prod --yes --scope "$team" 2>/dev/null | tail -1)
echo "$url"
# Tell Bing and the other IndexNow engines about the pages (never fails the deploy).
../scripts/indexnow.sh || true
mkdir -p ../.secrets && echo "https://ambernotes.app/privacy" > ../.secrets/privacy-url.txt  # the stable alias, not this deployment
