#!/bin/zsh
# Deploys Pane's backend to YOUR Supabase project and points the app at it.
#
#   scripts/deploy-backend.sh <project-ref>
#
# Needs: `supabase login` (or SUPABASE_ACCESS_TOKEN) for the account that owns the project.
# What it does, in order:
#   1. links this folder to the project
#   2. applies the database schema (tables, row-level security, search, revisions, tokens)
#   3. deploys the MCP server (supabase/functions/mcp)
#   4. pushes auth settings: sign-ups off, 12+ character passwords
#   5. creates your account (asks for email + password) unless it exists
#   6. writes Config/Backend.local.xcconfig so builds sync with this project
set -euo pipefail
cd "$(dirname "$0")/.."
REF="${1:?usage: scripts/deploy-backend.sh <project-ref>}"

echo "→ Linking $REF"
supabase link --project-ref "$REF"

echo "→ Applying the schema"
supabase db push

echo "→ Deploying the MCP server"
supabase functions deploy mcp --no-verify-jwt --project-ref "$REF"

echo "→ Auth settings (sign-ups off)"
supabase config push --project-ref "$REF" <<< "y" || echo "  (config push skipped; turn off sign-ups in the dashboard: Authentication → Sign In / Providers)"

KEYS=$(supabase projects api-keys --project-ref "$REF" -o json)
ANON=$(echo "$KEYS" | python3 -c "import sys,json;k=json.load(sys.stdin);print(next(x['api_key'] for x in k if x.get('name') in ('anon','publishable')))")
SERVICE=$(echo "$KEYS" | python3 -c "import sys,json;k=json.load(sys.stdin);print(next(x['api_key'] for x in k if x.get('name') in ('service_role','secret')))")
URL="https://$REF.supabase.co"

echo "→ Your account"
read "EMAIL?Email: "
read -s "PASSWORD?Password (12+ characters): "; echo
curl -sf -X POST "$URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H "content-type: application/json" \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":sys.argv[2],"email_confirm":True}))' "$EMAIL" "$PASSWORD")" >/dev/null \
  && echo "  created $EMAIL" || echo "  $EMAIL already exists (or creation failed); sign in with your existing password"

cat > Config/Backend.local.xcconfig <<XC
// Written by scripts/deploy-backend.sh — your Supabase project. Gitignored.
PANE_SUPABASE_URL = https:/\$()/$REF.supabase.co
PANE_SUPABASE_KEY = $ANON
XC
echo "→ Done. Rebuild Pane; it now syncs with $URL"
echo "  MCP server: $URL/functions/v1/mcp  (create a token in Pane → Settings → AI access)"
